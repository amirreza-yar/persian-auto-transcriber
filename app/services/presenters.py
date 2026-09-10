import json
from datetime import timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.runtime_settings import get_setting
from app.db import utcnow
from app.models import Batch, CircuitBreaker, Event, Job, WorkerState
from app.schemas import AudioFileOut, BatchOut, EventOut, JobOut, WorkerStateOut


def tags_for(job: Job) -> list[str]:
    try:
        value = json.loads(job.tags_json or "[]")
        return [str(tag) for tag in value] if isinstance(value, list) else []
    except json.JSONDecodeError:
        return []


def job_to_out(job: Job) -> JobOut:
    return JobOut(
        id=job.id,
        batch_id=job.batch_id,
        original_name=job.original_name,
        duration_seconds=job.duration_seconds,
        size_bytes=job.size_bytes,
        source_mime_type=job.source_mime_type,
        source_format=job.source_format,
        source_codec=job.source_codec,
        sample_rate=job.sample_rate,
        channels=job.channels,
        bit_rate=job.bit_rate,
        source_available=bool(job.source_path) and job.source_deleted_at is None and Path(job.source_path).exists(),
        description=job.description,
        tags=tags_for(job),
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        priority=job.priority,
        queue_position=job.queue_position,
        scheduled_for=job.scheduled_for,
        is_paused=job.is_paused,
        cancel_requested=job.cancel_requested,
        error=job.error,
        transcription_config=json.loads(job.transcription_config) if job.transcription_config else None,
        cleaning_config=json.loads(job.cleaning_config) if job.cleaning_config else None,
        created_at=job.created_at,
        updated_at=job.updated_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        tasks=list(job.tasks),
        artifacts=list(job.artifacts),
    )


def audio_to_out(job: Job) -> AudioFileOut:
    return AudioFileOut(
        id=job.id,
        job_id=job.id,
        batch_id=job.batch_id,
        name=job.original_name,
        duration_seconds=job.duration_seconds,
        size_bytes=job.size_bytes,
        mime_type=job.source_mime_type,
        format=job.source_format,
        codec=job.source_codec,
        sample_rate=job.sample_rate,
        channels=job.channels,
        bit_rate=job.bit_rate,
        source_available=bool(job.source_path) and job.source_deleted_at is None and Path(job.source_path).exists(),
        description=job.description,
        tags=tags_for(job),
        job_status=job.status,
        created_at=job.created_at,
    )


def batch_status(batch: Batch) -> tuple[str, float, dict[str, int]]:
    jobs = list(batch.jobs)
    counts = {
        "completed": sum(job.status == "completed" for job in jobs),
        "failed": sum(job.status == "failed" for job in jobs),
        "running": sum(job.status == "running" for job in jobs),
        "queued": sum(job.status in ("queued", "retry_wait") for job in jobs),
    }
    progress = sum(job.progress for job in jobs) / len(jobs) if jobs else 0.0
    statuses = {job.status for job in jobs}
    if not jobs:
        status = "empty"
    elif statuses == {"completed"}:
        status = "completed"
    elif "running" in statuses:
        status = "running"
    elif statuses <= {"cancelled", "completed"}:
        status = "cancelled"
    elif "failed" in statuses and not (statuses & {"queued", "running", "retry_wait"}):
        status = "failed"
    elif any(job.is_paused for job in jobs) and not (statuses & {"running"}):
        status = "paused"
    else:
        status = "queued"
    return status, progress, counts


def batch_to_out(batch: Batch, include_jobs: bool = True) -> BatchOut:
    status, progress, counts = batch_status(batch)
    return BatchOut(
        id=batch.id,
        name=batch.name,
        description=batch.description,
        status=status,
        progress=progress,
        total_jobs=len(batch.jobs),
        completed_jobs=counts["completed"],
        failed_jobs=counts["failed"],
        running_jobs=counts["running"],
        queued_jobs=counts["queued"],
        created_at=batch.created_at,
        updated_at=batch.updated_at,
        jobs=[job_to_out(job) for job in batch.jobs] if include_jobs else [],
    )


def event_to_out(event: Event) -> EventOut:
    try:
        data = json.loads(event.data_json or "{}")
    except json.JSONDecodeError:
        data = {}
    return EventOut(
        id=event.id,
        job_id=event.job_id,
        batch_id=event.batch_id,
        event_type=event.event_type,
        level=event.level,
        message=event.message,
        data=data,
        created_at=event.created_at,
    )


def worker_to_out(db: Session, worker: WorkerState) -> WorkerStateOut:
    stale_after = int(get_setting(db, "worker.stale_after_seconds"))
    stale = worker.heartbeat_at < utcnow() - timedelta(seconds=stale_after)
    return WorkerStateOut(
        id=worker.id,
        queue=worker.queue,
        status="offline" if stale else worker.status,
        current_job_id=worker.current_job_id,
        model_name=worker.model_name,
        detail=worker.detail,
        started_at=worker.started_at,
        heartbeat_at=worker.heartbeat_at,
        updated_at=worker.updated_at,
        stale=stale,
    )
