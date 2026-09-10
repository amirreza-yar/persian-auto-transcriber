import hashlib
import json
import time
from pathlib import Path

from google import genai
from google.genai import errors, types
from sqlalchemy.orm import Session

from app.core.events import add_event
from app.core.runtime_settings import get_all_settings, get_setting
from app.db import SessionLocal, utcnow
from app.features.cleaning.prompt import SYSTEM_PROMPT
from app.models import Artifact, Job, Task
from app.services.circuit_breaker import allow_request, get_circuit, record_circuit_failure, record_circuit_success
from app.services.network import validate_proxy
from app.services.storage import register_text_artifact, work_dir
from app.services.task_queue import heartbeat
from app.services.token_manager import acquire_token, record_failure, record_success
from app.workers.exceptions import JobCancelled, JobPaused, RetryLater


def split_text(text: str, max_chars: int) -> list[str]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    chunks: list[str] = []
    current: list[str] = []
    length = 0
    for line in lines:
        if current and length + len(line) + 1 > max_chars:
            chunks.append("\n".join(current))
            current = []
            length = 0
        if len(line) > max_chars and not current:
            for start in range(0, len(line), max_chars):
                chunks.append(line[start:start + max_chars])
            continue
        current.append(line)
        length += len(line) + 1
    if current:
        chunks.append("\n".join(current))
    return chunks


class CleaningFeature:
    kind = "clean_text"
    queue = "network"

    def _config(self, db: Session, job: Job) -> dict:
        if job.cleaning_config:
            return json.loads(job.cleaning_config)
        values = get_all_settings(db)
        config = {
            "model": values["cleaning.model"],
            "chunk_chars": int(values["cleaning.chunk_chars"]),
            "retry_count": int(values["cleaning.retry_count"]),
            "retry_base_seconds": int(values["cleaning.retry_base_seconds"]),
            "request_timeout_seconds": int(values["cleaning.request_timeout_seconds"]),
            "token_cooldown_seconds": int(values["cleaning.token_cooldown_seconds"]),
            "enabled": bool(values["cleaning.enabled"]),
            "circuit_failure_threshold": int(values["circuit.gemini.failure_threshold"]),
            "circuit_cooldown_seconds": int(values["circuit.gemini.cooldown_seconds"]),
        }
        job.cleaning_config = json.dumps(config, ensure_ascii=False)
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

    def run(self, task_id: str) -> None:
        with SessionLocal() as db:
            task = db.get(Task, task_id)
            if not task:
                return
            job = task.job
            existing_config = json.loads(job.cleaning_config) if job.cleaning_config else None
            if existing_config is not None and not existing_config.get("enabled", True):
                artifact = db.query(Artifact).filter(
                    Artifact.job_id == job.id,
                    Artifact.kind == "normalized_text",
                ).first()
                if not artifact:
                    raise RuntimeError("Normalized transcript is missing")
                text = Path(artifact.path).read_text(encoding="utf-8-sig")
                stem = Path(job.original_name).stem
                register_text_artifact(db, job.id, "final_text", f"{stem}.txt", text)
                job.stage = "done"
                job.status = "completed"
                job.progress = 1.0
                job.completed_at = utcnow()
                add_event(db, "Cleaning skipped; job completed", job.id)
                db.commit()
                return

            config = self._config(db, job)
            artifact = db.query(Artifact).filter(
                Artifact.job_id == job.id,
                Artifact.kind == "normalized_text",
            ).first()
            if not artifact:
                raise RuntimeError("Normalized transcript is missing")

            text = Path(artifact.path).read_text(encoding="utf-8-sig")
            chunks = split_text(text, config["chunk_chars"])
            checkpoint_dir = work_dir(job.id, "cleaning") / "chunks"
            checkpoint_dir.mkdir(parents=True, exist_ok=True)
            cleaned_parts: list[str] = []
            add_event(db, "Text cleaning started", job.id)
            job.stage = "clean"
            db.commit()

            for index, chunk in enumerate(chunks):
                db.refresh(job)
                if job.cancel_requested:
                    raise JobCancelled()
                if job.is_paused:
                    raise JobPaused()

                digest = hashlib.sha256(chunk.encode("utf-8")).hexdigest()[:12]
                checkpoint = checkpoint_dir / f"{index:06d}_{digest}.txt"
                if checkpoint.exists():
                    cleaned = checkpoint.read_text(encoding="utf-8").strip()
                else:
                    cleaned = self._clean_chunk(db, chunk, config)
                    checkpoint.write_text(cleaned, encoding="utf-8")

                cleaned_parts.append(cleaned)
                stage_progress = (index + 1) / max(1, len(chunks))
                heartbeat(db, task, stage_progress, 0.85 + stage_progress * 0.15)

            final_text = "\n\n".join(cleaned_parts)
            stem = Path(job.original_name).stem
            register_text_artifact(db, job.id, "final_text", f"{stem}.txt", final_text)
            job.stage = "done"
            job.status = "completed"
            job.progress = 1.0
            job.error = None
            job.completed_at = utcnow()
            add_event(db, "Job completed", job.id)
            db.commit()

    def _clean_chunk(self, db: Session, chunk: str, config: dict) -> str:
        allowed, wait_seconds = allow_request(db, "gemini")
        if not allowed:
            circuit = get_circuit(db, "gemini")
            raise RetryLater(f"Gemini circuit is open: {circuit.last_error or 'provider unavailable'}", wait_seconds)

        attempts = max(1, config["retry_count"] + 1)
        last_error = "No Gemini token available"

        for attempt in range(attempts):
            acquired = acquire_token(db, "gemini")
            if not acquired:
                raise RetryLater(last_error, config["retry_base_seconds"])

            token, api_key = acquired
            try:
                proxy_url = get_setting(db, "network.proxy_url")
                client = self._client(api_key, proxy_url, config["request_timeout_seconds"])
                response = client.models.generate_content(
                    model=config["model"],
                    contents=chunk,
                    config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT),
                )
                cleaned = (response.text or "").strip()
                if not cleaned:
                    raise RuntimeError("Gemini returned empty text")

                usage = response.usage_metadata
                prompt_tokens = int(getattr(usage, "prompt_token_count", 0) or 0) if usage else 0
                response_tokens = int(getattr(usage, "response_token_count", 0) or 0) if usage else 0
                total_tokens = int(getattr(usage, "total_token_count", 0) or 0) if usage else 0
                previous_state = get_circuit(db, "gemini").state
                record_success(db, token, prompt_tokens, response_tokens, total_tokens)
                record_circuit_success(db, "gemini")
                db.commit()
                if previous_state != "closed":
                    add_event(db, "Gemini circuit recovered", event_type="circuit.status", data={"name": "gemini", "state": "closed"})
                    db.commit()
                client.close()
                return cleaned

            except errors.APIError as exc:
                code = int(getattr(exc, "code", 0) or 0)
                last_error = f"Gemini {code}: {exc}"
                disable = code == 401
                cooldown = config["token_cooldown_seconds"] if code in (403, 429) else config["retry_base_seconds"]
                record_failure(db, token, last_error, cooldown_seconds=cooldown, disable=disable)
                if code == 429 or code >= 500:
                    circuit = record_circuit_failure(db, "gemini", last_error, config["circuit_failure_threshold"], config["circuit_cooldown_seconds"])
                    if circuit.state == "open":
                        add_event(db, "Gemini circuit opened", level="warning", event_type="circuit.status", data={"name": "gemini", "state": "open", "opened_until": circuit.opened_until.isoformat() if circuit.opened_until else None})
                    db.commit()
            except Exception as exc:
                last_error = f"Gemini network/error: {exc}"
                record_failure(db, token, last_error, cooldown_seconds=config["retry_base_seconds"])
                circuit = record_circuit_failure(db, "gemini", last_error, config["circuit_failure_threshold"], config["circuit_cooldown_seconds"])
                if circuit.state == "open":
                    add_event(db, "Gemini circuit opened", level="warning", event_type="circuit.status", data={"name": "gemini", "state": "open", "opened_until": circuit.opened_until.isoformat() if circuit.opened_until else None})
                db.commit()

            if attempt + 1 < attempts:
                time.sleep(min(config["retry_base_seconds"] * (2 ** attempt), 60))

        raise RetryLater(last_error, config["retry_base_seconds"])
