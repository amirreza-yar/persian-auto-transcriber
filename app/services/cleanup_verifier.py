from __future__ import annotations

import json
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.events import add_event
from app.core.runtime_settings import make_job_config
from app.db import utcnow
from app.models import Artifact, Job, Task
from app.services.cleanup_integrity import CleanupIntegrityResult, verify_cleaned_cues
from app.services.subtitles import load_cues, split_cues
from app.services.task_queue import enqueue_task

logger = logging.getLogger("cleanup_verifier")
ACTIVE_TASK_STATES = ("queued", "retry_wait", "claimed", "running")


def _artifact(job: Job, kind: str) -> Artifact | None:
    return next((artifact for artifact in job.artifacts if artifact.kind == kind), None)


def _cleaning_config(db: Session, job: Job) -> dict:
    if job.cleaning_config:
        try:
            value = json.loads(job.cleaning_config)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            pass
    return make_job_config(db, "cleaning")


def verify_job_cleanup(db: Session, job: Job) -> CleanupIntegrityResult | None:
    """Return integrity status for jobs with a normalized transcript.

    None means the job is not eligible for cleanup verification yet.
    """
    normalized = _artifact(job, "subtitle_normalized_json")
    if not normalized or not Path(normalized.path).exists():
        return None

    config = _cleaning_config(db, job)
    if not config.get("enabled", True):
        return None

    try:
        normalized_cues = load_cues(Path(normalized.path))
    except Exception as exc:
        logger.error("Could not read normalized transcript job=%s: %s", job.id, exc)
        return None

    chunks = split_cues(normalized_cues, int(config["chunk_chars"]))
    required_kinds = (
        "subtitle_cleaned_json",
        "final_text",
        "subtitle_cleaned_srt",
        "subtitle_cleaned_vtt",
    )
    missing_artifacts = [
        kind
        for kind in required_kinds
        if (artifact := _artifact(job, kind)) is None
        or not Path(artifact.path).exists()
    ]
    cleaned = _artifact(job, "subtitle_cleaned_json")
    if missing_artifacts or not cleaned:
        normalized_chars = sum(
            len("".join(str(cue.get("text", "")).split())) for cue in normalized_cues
        )
        return CleanupIntegrityResult(
            ok=False,
            reason=f"published cleaned artifacts are missing: {', '.join(missing_artifacts)}",
            suspicious_chunks=list(range(1, len(chunks) + 1)),
            normalized_cues=len(normalized_cues),
            cleaned_cues=0,
            normalized_chars=normalized_chars,
            cleaned_chars=0,
        )

    try:
        cleaned_cues = load_cues(Path(cleaned.path))
    except Exception as exc:
        return CleanupIntegrityResult(
            ok=False,
            reason=f"cleaned subtitle artifact cannot be read: {exc}",
            suspicious_chunks=list(range(1, len(chunks) + 1)),
            normalized_cues=len(normalized_cues),
            cleaned_cues=0,
            normalized_chars=sum(
                len("".join(str(cue.get("text", "")).split()))
                for cue in normalized_cues
            ),
            cleaned_chars=0,
        )

    return verify_cleaned_cues(
        normalized_cues,
        cleaned_cues,
        int(config["chunk_chars"]),
    )


def has_active_cleanup(job: Job) -> bool:
    return any(
        task.kind == "clean_text" and task.status in ACTIVE_TASK_STATES
        for task in job.tasks
    )


def queue_cleanup_repair(
    db: Session,
    job: Job,
    result: CleanupIntegrityResult,
) -> bool:
    """Queue a repair without deleting good checkpoints or current artifacts."""
    if has_active_cleanup(job):
        return False
    if job.cancel_requested or job.status == "cancelled" or job.is_paused:
        return False

    enqueue_task(db, job.id, "clean_text", "network", utcnow())
    job.status = "queued"
    job.stage = "clean"
    job.progress = max(job.progress, 0.85)
    job.error = None
    job.completed_at = None

    chunks = result.suspicious_chunks
    chunk_preview = chunks[:20]
    add_event(
        db,
        "Cleanup integrity check queued a repair",
        job.id,
        level="warning",
        event_type="job.cleanup_repair",
        data={
            "reason": result.reason,
            "suspicious_chunks": chunk_preview,
            "suspicious_chunk_count": len(chunks),
            "normalized_cues": result.normalized_cues,
            "cleaned_cues": result.cleaned_cues,
            "normalized_chars": result.normalized_chars,
            "cleaned_chars": result.cleaned_chars,
        },
    )
    logger.warning(
        "Cleanup repair queued job=%s suspicious_chunks=%s reason=%s",
        job.id,
        chunks if len(chunks) <= 20 else f"{chunks[:20]}... ({len(chunks)} total)",
        result.reason,
    )
    return True


def verify_and_queue_cleanup_repairs(db: Session) -> tuple[int, int]:
    """Verify all eligible jobs and queue repairs for incomplete cleaned output.

    Returns (checked, queued). The existing cleaned artifact remains available
    until a repaired generation passes the normal final validation.
    """
    jobs = db.scalars(select(Job).order_by(Job.created_at.asc())).unique().all()
    checked = 0
    queued = 0

    for job in jobs:
        if has_active_cleanup(job):
            continue
        result = verify_job_cleanup(db, job)
        if result is None:
            continue
        checked += 1
        if result.ok:
            continue
        if queue_cleanup_repair(db, job, result):
            queued += 1

    if queued:
        db.commit()
    return checked, queued
