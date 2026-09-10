import json
import logging
import math
import tempfile
from pathlib import Path

from faster_whisper import WhisperModel
from hazm import Normalizer
from sqlalchemy.orm import Session

from app.config import settings
from app.core.events import add_event
from app.core.runtime_settings import get_setting, make_job_config
from app.db import SessionLocal, utcnow
from app.models import Job, Task
from app.services.audio import extract_window
from app.services.network import apply_proxy_environment
from app.services.storage import register_text_artifact, work_dir
from app.services.reading_text import cues_to_reading_text
from app.services.subtitles import cues_to_srt, cues_to_vtt, dump_cues
from app.services.task_queue import enqueue_task, heartbeat
from app.workers.exceptions import JobCancelled, JobPaused


logger = logging.getLogger("transcriber")


class TranscriptionFeature:
    kind = "transcribe"
    queue = "transcribe"

    def __init__(self) -> None:
        self.model: WhisperModel | None = None
        self.model_key: tuple[str, int] | None = None
        self.normalizer = Normalizer()

    def _config(self, db: Session, job: Job) -> dict:
        if job.transcription_config:
            return json.loads(job.transcription_config)
        config = make_job_config(db, "transcription")
        job.transcription_config = json.dumps(config, ensure_ascii=False)
        db.commit()
        return config

    def _ensure_model(self, config: dict, proxy_url: str) -> WhisperModel:
        key = (str(config["model"]), int(config["cpu_threads"]))
        if self.model is not None and self.model_key == key:
            return self.model

        apply_proxy_environment(proxy_url)
        settings.model_dir.mkdir(parents=True, exist_ok=True)
        logger.info("Loading Whisper model %s from %s", config["model"], settings.model_dir)
        self.model = WhisperModel(
            config["model"],
            device="cpu",
            compute_type="int8",
            cpu_threads=int(config["cpu_threads"]),
            num_workers=1,
            download_root=str(settings.model_dir),
            local_files_only=settings.whisper_local_files_only,
        )
        self.model_key = key
        logger.info("Whisper model ready: %s", config["model"])
        return self.model

    def warmup(self) -> str:
        with SessionLocal() as db:
            config = make_job_config(db, "transcription")
            self._ensure_model(config, get_setting(db, "network.proxy_url"))
            return str(config["model"])

    def prepare(self, task_id: str) -> str:
        with SessionLocal() as db:
            task = db.get(Task, task_id)
            if not task:
                raise RuntimeError("Task disappeared before transcription preparation")
            config = self._config(db, task.job)
            self._ensure_model(config, get_setting(db, "network.proxy_url"))
            return str(config["model"])

    def _register_subtitle_artifacts(self, db: Session, job: Job, stem: str, cues: list[dict], version: str) -> None:
        register_text_artifact(
            db,
            job.id,
            f"subtitle_{version}_json",
            f"{stem}_{version}.json",
            dump_cues(cues, job.original_name, version),
            "application/json; charset=utf-8",
        )
        register_text_artifact(
            db,
            job.id,
            f"subtitle_{version}_srt",
            f"{stem}_{version}.srt",
            cues_to_srt(cues),
            "application/x-subrip; charset=utf-8",
        )
        register_text_artifact(
            db,
            job.id,
            f"subtitle_{version}_vtt",
            f"{stem}_{version}.vtt",
            cues_to_vtt(cues),
            "text/vtt; charset=utf-8",
        )

    def run(self, task_id: str) -> None:
        with SessionLocal() as db:
            task = db.get(Task, task_id)
            if not task:
                return
            job = task.job
            config = self._config(db, job)
            model = self._ensure_model(config, get_setting(db, "network.proxy_url"))
            job.stage = "transcribe"
            add_event(db, "Transcription started", job.id, event_type="job.stage", data={"stage": "transcribe"})
            db.commit()

            chunk_dir = work_dir(job.id, "transcription") / "chunks"
            chunk_dir.mkdir(parents=True, exist_ok=True)
            duration = float(job.duration_seconds or 0)
            core = float(config["core_seconds"])
            context = float(config["context_seconds"])
            total_chunks = max(1, math.ceil(duration / core))
            all_cues: list[dict] = []

            with tempfile.TemporaryDirectory() as tmp:
                tmp_path = Path(tmp)
                for index in range(total_chunks):
                    db.refresh(job)
                    if job.cancel_requested:
                        raise JobCancelled()
                    if job.is_paused:
                        raise JobPaused()

                    core_start = index * core
                    core_end = min(core_start + core, duration)
                    checkpoint = chunk_dir / f"{index:06d}.json"

                    if checkpoint.exists():
                        chunk_cues = json.loads(checkpoint.read_text(encoding="utf-8"))
                    else:
                        temp_audio = tmp_path / f"{index:06d}.wav"
                        slice_start = max(0.0, core_start - context)
                        slice_end = min(duration, core_end + context)
                        extract_window(Path(job.source_path), temp_audio, slice_start, slice_end - slice_start)
                        segments, _ = model.transcribe(
                            str(temp_audio),
                            language="fa",
                            task="transcribe",
                            beam_size=int(config["beam_size"]),
                            temperature=0.0,
                            condition_on_previous_text=False,
                            vad_filter=False,
                            no_speech_threshold=None,
                            log_prob_threshold=None,
                            initial_prompt=None,
                            hotwords=None,
                            word_timestamps=True,
                        )

                        chunk_cues = []
                        for segment in list(segments):
                            retained = []
                            for word in segment.words or []:
                                if word.start is None or word.end is None:
                                    continue
                                absolute_start = slice_start + float(word.start)
                                absolute_end = slice_start + float(word.end)
                                midpoint = (absolute_start + absolute_end) / 2
                                if core_start <= midpoint < core_end:
                                    retained.append((word.word, absolute_start, absolute_end))

                            if not retained:
                                continue
                            text = "".join(item[0] for item in retained).strip()
                            start = max(core_start, retained[0][1])
                            end = min(core_end, retained[-1][2])
                            if text and end > start:
                                chunk_cues.append({"start": round(start, 3), "end": round(end, 3), "text": text})

                        checkpoint.write_text(json.dumps(chunk_cues, ensure_ascii=False), encoding="utf-8")

                    all_cues.extend(chunk_cues)
                    stage_progress = (index + 1) / total_chunks
                    heartbeat(db, task, stage_progress, stage_progress * 0.85)

            raw_cues: list[dict] = []
            normalized_cues: list[dict] = []
            for index, cue in enumerate(all_cues, start=1):
                cue_id = f"S{index:06d}"
                raw = {"id": cue_id, "start": cue["start"], "end": cue["end"], "text": cue["text"].strip()}
                normalized = {**raw, "text": self.normalizer.normalize(raw["text"])}
                raw_cues.append(raw)
                normalized_cues.append(normalized)

            raw_text = "\n".join(cue["text"] for cue in raw_cues if cue["text"])
            normalized_text = "\n".join(cue["text"] for cue in normalized_cues if cue["text"])
            stem = Path(job.original_name).stem

            register_text_artifact(db, job.id, "raw_text", f"{stem}_raw.txt", raw_text)
            register_text_artifact(db, job.id, "normalized_text", f"{stem}_normalized.txt", normalized_text)
            self._register_subtitle_artifacts(db, job, stem, raw_cues, "raw")
            register_text_artifact(
                db,
                job.id,
                "subtitle_normalized_json",
                f"{stem}_normalized.json",
                dump_cues(normalized_cues, job.original_name, "normalized"),
                "application/json; charset=utf-8",
            )

            cleaning_config = json.loads(job.cleaning_config) if job.cleaning_config else make_job_config(db, "cleaning")
            if cleaning_config.get("enabled", True):
                enqueue_task(db, job.id, "clean_text", "network")
                job.stage = "clean"
                job.status = "queued"
                job.progress = 0.85
                add_event(
                    db,
                    "Transcription completed; cleaning queued",
                    job.id,
                    event_type="job.stage",
                    data={"stage": "clean", "status": "queued", "progress": 0.85, "cues": len(normalized_cues)},
                )
            else:
                register_text_artifact(db, job.id, "final_text", f"{stem}.txt", cues_to_reading_text(normalized_cues))
                self._register_subtitle_artifacts(db, job, stem, normalized_cues, "cleaned")
                job.stage = "done"
                job.status = "completed"
                job.progress = 1.0
                job.error = None
                job.completed_at = utcnow()
                add_event(db, "Job completed", job.id, event_type="job.completed", data={"progress": 1.0})
            db.commit()
