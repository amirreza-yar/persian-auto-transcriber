import hashlib
import json
import logging
import time
import uuid
from pathlib import Path

from google import genai
from google.genai import errors, types
from sqlalchemy.orm import Session

from app.core.events import add_event
from app.core.runtime_settings import get_all_settings, get_setting, make_job_config
from app.db import SessionLocal, utcnow
from app.features.cleaning.prompt import CUE_SYSTEM_PROMPT
from app.models import Artifact, Job, Task
from app.services.circuit_breaker import (
    allow_request,
    get_circuit,
    record_circuit_failure,
    record_circuit_success,
)
from app.services.network import validate_proxy
from app.services.reading_text import cues_to_reading_text
from app.services.storage import artifact_dir, work_dir
from app.services.subtitles import (
    cues_to_srt,
    cues_to_vtt,
    dump_cues,
    load_cues,
    split_cues,
)
from app.services.task_queue import heartbeat
from app.services.token_manager import acquire_token, record_failure, record_success
from app.workers.exceptions import JobCancelled, JobPaused, RetryLater

logger = logging.getLogger("cleaning")


CLEANING_CHECKPOINT_VERSION = "paragraphs-v2-validated"


class CleaningFeature:
    kind = "clean_text"
    queue = "network"

    def _config(self, db: Session, job: Job) -> dict:
        config = (
            json.loads(job.cleaning_config)
            if job.cleaning_config
            else make_job_config(db, "cleaning")
        )
        config["circuit_failure_threshold"] = int(
            get_setting(db, "circuit.gemini.failure_threshold")
        )
        config["circuit_cooldown_seconds"] = int(
            get_setting(db, "circuit.gemini.cooldown_seconds")
        )
        if not job.cleaning_config:
            stored = {
                key: value
                for key, value in config.items()
                if not key.startswith("circuit_")
            }
            job.cleaning_config = json.dumps(stored, ensure_ascii=False)
            db.commit()
        return config

    def _client(self, api_key: str, proxy: str, timeout_seconds: int):
        proxy = validate_proxy(proxy)
        client_args = {"proxy": proxy} if proxy else {}
        return genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=timeout_seconds * 1000,
                client_args=client_args,
            ),
        )

    def _subtitle_artifact(self, db: Session, job_id: str) -> Artifact:
        artifact = (
            db.query(Artifact)
            .filter(
                Artifact.job_id == job_id,
                Artifact.kind == "subtitle_normalized_json",
            )
            .first()
        )
        if not artifact:
            raise RuntimeError("Normalized subtitle data is missing")
        return artifact

    def _validate_cleaned_chunk(
        self, source_cues: list[dict], cleaned_items: list[dict]
    ) -> list[dict]:
        if not isinstance(cleaned_items, list):
            raise RuntimeError("Cleaned subtitle checkpoint/result is not a list")
        if len(cleaned_items) != len(source_cues):
            raise RuntimeError(
                f"Cleaned subtitle cue count mismatch: expected {len(source_cues)}, got {len(cleaned_items)}"
            )

        expected_ids = [str(cue.get("id", "")) for cue in source_cues]
        returned_ids = [str(item.get("id", "")) for item in cleaned_items]
        if returned_ids != expected_ids:
            raise RuntimeError(
                "Cleaned subtitle cue IDs do not exactly match normalized subtitle cue IDs"
            )

        source_chars = sum(
            len("".join(str(cue.get("text", "")).split())) for cue in source_cues
        )
        cleaned_chars = sum(
            len("".join(str(item.get("text", "")).split())) for item in cleaned_items
        )
        if source_chars >= 200:
            ratio = cleaned_chars / source_chars if source_chars else 1.0
            if ratio < 0.65 or ratio > 1.60:
                raise RuntimeError(
                    f"Cleaned subtitle content size changed too much: ratio={ratio:.2f}"
                )

        validated: list[dict] = []
        for original, item in zip(source_cues, cleaned_items, strict=True):
            text = str(item.get("text", "")).strip()
            if not text:
                raise RuntimeError(
                    f"Cleaned subtitle text is empty for {original['id']}"
                )
            paragraph_after = item.get("paragraph_after", False)
            if not isinstance(paragraph_after, bool):
                raise RuntimeError(
                    f"Cleaned subtitle paragraph_after is invalid for {original['id']}"
                )
            # Rebuild from the normalized cue so a checkpoint can never alter timing
            # or other immutable subtitle fields.
            validated.append(
                {**original, "text": text, "paragraph_after": paragraph_after}
            )
        return validated

    def _write_checkpoint(self, checkpoint: Path, cleaned: list[dict]) -> None:
        temporary = checkpoint.with_suffix(checkpoint.suffix + ".tmp")
        temporary.write_text(json.dumps(cleaned, ensure_ascii=False), encoding="utf-8")
        temporary.replace(checkpoint)

    def _register_cleaned(self, db: Session, job: Job, cues: list[dict]) -> None:
        stem = Path(job.original_name).stem
        generation = uuid.uuid4().hex[:12]
        generation_dir = artifact_dir(job.id) / "cleaned" / generation
        generation_dir.mkdir(parents=True, exist_ok=True)

        outputs = [
            (
                "final_text",
                f"{stem}.txt",
                cues_to_reading_text(cues),
                "text/plain; charset=utf-8",
            ),
            (
                "subtitle_cleaned_json",
                f"{stem}_cleaned.json",
                dump_cues(cues, job.original_name, "cleaned"),
                "application/json; charset=utf-8",
            ),
            (
                "subtitle_cleaned_srt",
                f"{stem}_cleaned.srt",
                cues_to_srt(cues),
                "application/x-subrip; charset=utf-8",
            ),
            (
                "subtitle_cleaned_vtt",
                f"{stem}_cleaned.vtt",
                cues_to_vtt(cues),
                "text/vtt; charset=utf-8",
            ),
        ]

        prepared: list[tuple[str, str, Path, str]] = []
        for kind, name, text, mime_type in outputs:
            path = generation_dir / name
            path.write_text(text, encoding="utf-8-sig")
            prepared.append((kind, name, path, mime_type))

        # Only after every new file exists do we repoint artifact records. The
        # enclosing transaction is committed after the job is marked completed,
        # so a failed re-clean leaves the previous artifact generation usable.
        for kind, name, path, mime_type in prepared:
            artifact = (
                db.query(Artifact)
                .filter(
                    Artifact.job_id == job.id,
                    Artifact.kind == kind,
                )
                .first()
            )
            if artifact:
                artifact.name = name
                artifact.path = str(path)
                artifact.mime_type = mime_type
            else:
                db.add(
                    Artifact(
                        id=str(uuid.uuid4()),
                        job_id=job.id,
                        kind=kind,
                        name=name,
                        path=str(path),
                        mime_type=mime_type,
                    )
                )
        db.flush()

    def run(self, task_id: str) -> None:
        with SessionLocal() as db:
            task = db.get(Task, task_id)
            if not task:
                return
            job = task.job
            config = self._config(db, job)
            artifact = self._subtitle_artifact(db, job.id)
            cues = load_cues(Path(artifact.path))

            if not config.get("enabled", True):
                self._register_cleaned(db, job, cues)
                job.stage = "done"
                job.status = "completed"
                job.progress = 1.0
                job.completed_at = utcnow()
                add_event(
                    db,
                    "Cleaning skipped; job completed",
                    job.id,
                    event_type="job.completed",
                    data={"progress": 1.0},
                )
                db.commit()
                return

            chunks = split_cues(cues, int(config["chunk_chars"]))
            checkpoint_dir = work_dir(job.id, "cleaning") / "cues"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            cleaned_cues: list[dict] = []
            job.stage = "clean"
            add_event(
                db,
                "Subtitle-aware text cleaning started",
                job.id,
                event_type="job.stage",
                data={"stage": "clean", "chunks": len(chunks)},
            )
            db.commit()

            for index, chunk in enumerate(chunks):
                db.refresh(job)
                if job.cancel_requested:
                    raise JobCancelled()
                if job.is_paused:
                    raise JobPaused()

                digest_source = json.dumps(
                    {"version": CLEANING_CHECKPOINT_VERSION, "chunk": chunk},
                    ensure_ascii=False,
                    sort_keys=True,
                )
                digest = hashlib.sha256(digest_source.encode("utf-8")).hexdigest()[:12]
                checkpoint = checkpoint_dir / f"{index:06d}_{digest}.json"
                cleaned: list[dict]
                if checkpoint.exists():
                    try:
                        cached = json.loads(checkpoint.read_text(encoding="utf-8"))
                        cleaned = self._validate_cleaned_chunk(chunk, cached)
                        logger.info(
                            "Cleanup checkpoint accepted job=%s chunk=%s/%s cues=%s",
                            job.id,
                            index + 1,
                            len(chunks),
                            len(cleaned),
                        )
                    except Exception as exc:
                        logger.warning(
                            "Cleanup checkpoint rejected job=%s chunk=%s/%s: %s",
                            job.id,
                            index + 1,
                            len(chunks),
                            exc,
                        )
                        checkpoint.unlink(missing_ok=True)
                        cleaned = self._clean_cue_chunk(db, job.id, chunk, config)
                        self._write_checkpoint(checkpoint, cleaned)
                else:
                    cleaned = self._clean_cue_chunk(db, job.id, chunk, config)
                    self._write_checkpoint(checkpoint, cleaned)

                cleaned_cues.extend(cleaned)
                stage_progress = (index + 1) / max(1, len(chunks))
                heartbeat(
                    db,
                    task,
                    stage_progress,
                    0.85 + stage_progress * 0.15,
                    detail=f"Cleaning chunk {index + 1}/{len(chunks)}",
                )
                logger.info(
                    "Cleanup progress job=%s chunk=%s/%s cues=%s/%s",
                    job.id,
                    index + 1,
                    len(chunks),
                    len(cleaned_cues),
                    len(cues),
                )

            # Validate the assembled output too. This catches any checkpoint or
            # chunk-boundary corruption before final artifacts are replaced.
            cleaned_cues = self._validate_cleaned_chunk(cues, cleaned_cues)
            self._register_cleaned(db, job, cleaned_cues)
            job.stage = "done"
            job.status = "completed"
            job.progress = 1.0
            job.error = None
            job.completed_at = utcnow()
            add_event(
                db,
                "Job completed",
                job.id,
                event_type="job.completed",
                data={"progress": 1.0, "cues": len(cleaned_cues)},
            )
            db.commit()

    def _clean_cue_chunk(
        self, db: Session, job_id: str, cues: list[dict], config: dict
    ) -> list[dict]:
        input_items = [{"id": cue["id"], "text": cue["text"]} for cue in cues]
        expected_ids = [item["id"] for item in input_items]
        payload = json.dumps({"items": input_items}, ensure_ascii=False)
        attempts = max(1, int(config["retry_count"]) + 1)
        last_error = "No Gemini token available"

        for attempt in range(attempts):
            allowed, wait_seconds = allow_request(db, "gemini")
            if not allowed:
                circuit = get_circuit(db, "gemini")
                raise RetryLater(
                    f"Gemini circuit is open: {circuit.last_error or 'provider unavailable'}",
                    wait_seconds,
                )

            acquired = acquire_token(db, "gemini")
            if not acquired:
                raise RetryLater(last_error, int(config["retry_base_seconds"]))

            token, api_key = acquired
            client = None
            try:
                proxy_url = get_setting(db, "network.proxy_url")
                client = self._client(
                    api_key, proxy_url, int(config["request_timeout_seconds"])
                )
                response = client.models.generate_content(
                    model=config["model"],
                    contents=payload,
                    config=types.GenerateContentConfig(
                        system_instruction=CUE_SYSTEM_PROMPT,
                        response_mime_type="application/json",
                    ),
                )
                result = json.loads((response.text or "").strip())
                items = result.get("items", [])
                returned_ids = [str(item.get("id", "")) for item in items]
                if returned_ids != expected_ids:
                    raise RuntimeError(
                        "Gemini changed, removed, added or reordered subtitle cue IDs"
                    )

                cleaned = self._validate_cleaned_chunk(cues, items)

                usage = response.usage_metadata
                prompt_tokens = (
                    int(getattr(usage, "prompt_token_count", 0) or 0) if usage else 0
                )
                response_tokens = (
                    int(getattr(usage, "response_token_count", 0) or 0) if usage else 0
                )
                total_tokens = (
                    int(getattr(usage, "total_token_count", 0) or 0) if usage else 0
                )
                previous_state = get_circuit(db, "gemini").state
                record_success(db, token, prompt_tokens, response_tokens, total_tokens)
                record_circuit_success(db, "gemini")
                if previous_state != "closed":
                    add_event(
                        db,
                        "Gemini circuit recovered",
                        job_id,
                        event_type="circuit.status",
                        data={"name": "gemini", "state": "closed"},
                    )
                db.commit()
                return cleaned

            except errors.APIError as exc:
                code = int(getattr(exc, "code", 0) or 0)
                last_error = f"Gemini {code}: {exc}"
                disable = code == 401
                cooldown = (
                    int(config["token_cooldown_seconds"])
                    if code in (403, 429)
                    else int(config["retry_base_seconds"])
                )
                record_failure(
                    db, token, last_error, cooldown_seconds=cooldown, disable=disable
                )
                if code == 429 or code >= 500:
                    circuit = record_circuit_failure(
                        db,
                        "gemini",
                        last_error,
                        int(config["circuit_failure_threshold"]),
                        int(config["circuit_cooldown_seconds"]),
                    )
                    if circuit.state == "open":
                        add_event(
                            db,
                            "Gemini circuit opened",
                            job_id,
                            level="warning",
                            event_type="circuit.status",
                            data={
                                "name": "gemini",
                                "state": "open",
                                "opened_until": (
                                    circuit.opened_until.isoformat()
                                    if circuit.opened_until
                                    else None
                                ),
                            },
                        )
                    db.commit()
                    if circuit.state == "open":
                        raise RetryLater(
                            last_error, int(config["circuit_cooldown_seconds"])
                        )

            except RetryLater:
                raise
            except Exception as exc:
                last_error = f"Gemini network/error: {exc}"
                record_failure(
                    db,
                    token,
                    last_error,
                    cooldown_seconds=int(config["retry_base_seconds"]),
                )
                circuit = record_circuit_failure(
                    db,
                    "gemini",
                    last_error,
                    int(config["circuit_failure_threshold"]),
                    int(config["circuit_cooldown_seconds"]),
                )
                if circuit.state == "open":
                    add_event(
                        db,
                        "Gemini circuit opened",
                        job_id,
                        level="warning",
                        event_type="circuit.status",
                        data={
                            "name": "gemini",
                            "state": "open",
                            "opened_until": (
                                circuit.opened_until.isoformat()
                                if circuit.opened_until
                                else None
                            ),
                        },
                    )
                db.commit()
                if circuit.state == "open":
                    raise RetryLater(
                        last_error, int(config["circuit_cooldown_seconds"])
                    )
            finally:
                if client is not None:
                    try:
                        client.close()
                    except Exception:
                        pass

            if attempt + 1 < attempts:
                time.sleep(min(int(config["retry_base_seconds"]) * (2**attempt), 60))

        raise RetryLater(last_error, int(config["retry_base_seconds"]))
