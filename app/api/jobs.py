import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.core.events import add_event
from app.core.runtime_settings import get_all_settings, make_job_config, merge_job_config
from app.db import utcnow
from app.models import Batch, Job
from app.schemas import JobHistoryPage, JobOut, JobPatch, JobSettingsPatch, ReorderRequest
from app.services.audio import AudioValidationError, guess_audio_mime, validate_audio
from app.services.presenters import job_to_out
from app.services.storage import delete_job_files, save_upload
from app.services.task_queue import enqueue_task


router = APIRouter(prefix="/jobs", tags=["jobs"])


def _job_stmt():
    return select(Job).options(selectinload(Job.tasks), selectinload(Job.artifacts))


def _utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _json_object(raw: str | None, name: str) -> dict:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"{name} must be valid JSON") from exc
    if not isinstance(value, dict):
        raise HTTPException(400, f"{name} must be a JSON object")
    return value


def _tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
        if isinstance(value, list):
            candidates = [str(item) for item in value]
        else:
            candidates = [item for item in raw.split(",")]
    except json.JSONDecodeError:
        candidates = [item for item in raw.split(",")]
    result: list[str] = []
    seen: set[str] = set()
    for raw_tag in candidates:
        tag = raw_tag.strip()
        if not tag or tag.casefold() in seen:
            continue
        seen.add(tag.casefold())
        result.append(tag[:64])
    return result[:30]


def _filtered_jobs(
    status: str | None,
    stage: str | None,
    batch_id: str | None,
    tag: str | None,
    q: str | None,
    created_from: datetime | None,
    created_to: datetime | None,
    related: bool = True,
):
    stmt = _job_stmt() if related else select(Job)
    if status:
        stmt = stmt.where(Job.status == status)
    if stage:
        stmt = stmt.where(Job.stage == stage)
    if batch_id:
        stmt = stmt.where(Job.batch_id == batch_id)
    if tag:
        stmt = stmt.where(Job.tags_json.like(f'%"{tag}"%'))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Job.original_name.ilike(like), Job.description.ilike(like), Job.error.ilike(like)))
    if created_from:
        stmt = stmt.where(Job.created_at >= _utc_naive(created_from))
    if created_to:
        stmt = stmt.where(Job.created_at <= _utc_naive(created_to))
    return stmt


@router.post("/upload", response_model=list[JobOut])
def upload_jobs(
    files: list[UploadFile] = File(...),
    scheduled_for: datetime | None = Form(None),
    priority: int = Form(0),
    batch_name: str | None = Form(None),
    batch_description: str | None = Form(None),
    description: str | None = Form(None),
    tags: str | None = Form(None),
    transcription_overrides: str | None = Form(None),
    cleaning_overrides: str | None = Form(None),
    db: Session = Depends(get_db),
):
    if not files:
        raise HTTPException(400, "No files supplied")

    values = get_all_settings(db)
    try:
        transcription_config = make_job_config(db, "transcription", _json_object(transcription_overrides, "transcription_overrides"))
        cleaning_config = make_job_config(db, "cleaning", _json_object(cleaning_overrides, "cleaning_overrides"))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    batch = Batch(
        id=str(uuid.uuid4()),
        name=(batch_name or "").strip() or None,
        description=(batch_description or "").strip() or None,
    )
    db.add(batch)

    max_position = db.scalar(select(func.max(Job.queue_position))) or 0
    scheduled = _utc_naive(scheduled_for) if scheduled_for else utcnow()
    common_tags = _tags(tags)
    created_ids: list[str] = []

    try:
        for offset, upload in enumerate(files, start=1):
            job_id = str(uuid.uuid4())
            source, size = save_upload(job_id, upload)
            created_ids.append(job_id)
            try:
                metadata = validate_audio(
                    source,
                    size,
                    int(values["upload.max_bytes"]),
                    int(values["upload.max_duration_seconds"]),
                )
            except (AudioValidationError, Exception) as exc:
                delete_job_files(job_id)
                raise HTTPException(400, f"Could not use {upload.filename}: {exc}") from exc

            job = Job(
                id=job_id,
                batch_id=batch.id,
                original_name=upload.filename or source.name,
                source_path=str(source),
                duration_seconds=metadata["duration_seconds"],
                size_bytes=size,
                source_mime_type=guess_audio_mime(source, upload.content_type),
                source_format=metadata["format"],
                source_codec=metadata["codec"],
                sample_rate=metadata["sample_rate"],
                channels=metadata["channels"],
                bit_rate=metadata["bit_rate"],
                description=(description or "").strip() or None,
                tags_json=json.dumps(common_tags, ensure_ascii=False),
                priority=priority,
                queue_position=max_position + offset * 10,
                scheduled_for=scheduled,
                transcription_config=json.dumps(transcription_config, ensure_ascii=False),
                cleaning_config=json.dumps(cleaning_config, ensure_ascii=False),
            )
            db.add(job)
            db.flush()
            enqueue_task(db, job_id, "transcribe", "transcribe", scheduled)
            add_event(
                db,
                "Audio uploaded and queued",
                job_id,
                event_type="job.created",
                data={"status": "queued", "stage": "transcribe", "progress": 0.0, "filename": job.original_name},
            )
        add_event(db, f"Batch created with {len(created_ids)} file(s)", batch_id=batch.id, event_type="batch.created", data={"count": len(created_ids)})
        db.commit()
    except Exception:
        db.rollback()
        for job_id in created_ids:
            delete_job_files(job_id)
        raise

    jobs = db.scalars(_job_stmt().where(Job.id.in_(created_ids)).order_by(Job.queue_position)).unique().all()
    return [job_to_out(job) for job in jobs]


@router.get("", response_model=list[JobOut])
def list_jobs(
    status: str | None = None,
    stage: str | None = None,
    batch_id: str | None = None,
    tag: str | None = None,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    stmt = _filtered_jobs(status, stage, batch_id, tag, q, None, None)
    stmt = stmt.order_by(case((Job.status == "running", 0), else_=1), Job.priority.desc(), Job.queue_position, Job.created_at.desc()).limit(limit)
    jobs = db.scalars(stmt).unique().all()
    return [job_to_out(job) for job in jobs]


@router.get("/history", response_model=JobHistoryPage)
def job_history(
    status: str | None = None,
    stage: str | None = None,
    batch_id: str | None = None,
    tag: str | None = None,
    q: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    filtered = _filtered_jobs(status, stage, batch_id, tag, q, created_from, created_to)
    count_base = _filtered_jobs(status, stage, batch_id, tag, q, created_from, created_to, related=False)
    count_stmt = select(func.count()).select_from(count_base.with_only_columns(Job.id).order_by(None).subquery())
    total = int(db.scalar(count_stmt) or 0)
    jobs = db.scalars(filtered.order_by(Job.created_at.desc()).offset(offset).limit(limit)).unique().all()
    return JobHistoryPage(total=total, offset=offset, limit=limit, items=[job_to_out(job) for job in jobs])


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    if not job:
        raise HTTPException(404, "Job not found")
    return job_to_out(job)


@router.patch("/{job_id}", response_model=JobOut)
def update_job(job_id: str, patch: JobPatch, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status in ("completed", "cancelled"):
        raise HTTPException(409, "Finished jobs cannot be rescheduled")
    if patch.priority is not None:
        job.priority = patch.priority
    if patch.scheduled_for is not None:
        job.scheduled_for = _utc_naive(patch.scheduled_for)
    add_event(db, "Job scheduling updated", job.id, event_type="job.updated", data={"priority": job.priority, "scheduled_for": job.scheduled_for.isoformat()})
    db.commit()
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    return job_to_out(job)


@router.post("/reorder", response_model=list[JobOut])
def reorder_jobs(body: ReorderRequest, db: Session = Depends(get_db)):
    jobs = db.scalars(select(Job).where(Job.id.in_(body.job_ids))).all()
    found = {job.id: job for job in jobs}
    missing = [job_id for job_id in body.job_ids if job_id not in found]
    if missing:
        raise HTTPException(404, f"Unknown jobs: {', '.join(missing)}")
    for index, job_id in enumerate(body.job_ids, start=1):
        found[job_id].queue_position = index * 10
    add_event(db, "Queue order updated", event_type="queue.updated", data={"job_ids": body.job_ids})
    db.commit()
    result = db.scalars(_job_stmt().where(Job.id.in_(body.job_ids)).order_by(Job.queue_position)).unique().all()
    return [job_to_out(job) for job in result]


@router.patch("/{job_id}/settings", response_model=JobOut)
def update_job_settings(job_id: str, body: JobSettingsPatch, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    try:
        if body.transcription is not None:
            transcribe_started = any(
                task.kind == "transcribe" and task.status in ("claimed", "running", "completed")
                for task in job.tasks
            )
            if transcribe_started:
                raise HTTPException(409, "Transcription settings cannot change after transcription starts")
            current = json.loads(job.transcription_config) if job.transcription_config else make_job_config(db, "transcription")
            job.transcription_config = json.dumps(merge_job_config(db, "transcription", current, body.transcription), ensure_ascii=False)
        if body.cleaning is not None:
            cleaning_started = any(
                task.kind == "clean_text" and task.status in ("claimed", "running", "completed")
                for task in job.tasks
            )
            if cleaning_started:
                raise HTTPException(409, "Cleaning settings cannot change after cleaning starts")
            current = json.loads(job.cleaning_config) if job.cleaning_config else make_job_config(db, "cleaning")
            updated = merge_job_config(db, "cleaning", current, body.cleaning)
            job.cleaning_config = json.dumps(updated, ensure_ascii=False)
            transcribe_done = any(task.kind == "transcribe" and task.status == "completed" for task in job.tasks)
            clean_exists = any(task.kind == "clean_text" for task in job.tasks)
            if updated.get("enabled", True) and transcribe_done and not clean_exists:
                enqueue_task(db, job.id, "clean_text", "network")
                job.status = "queued"
                job.stage = "clean"
                job.progress = 0.85
                job.completed_at = None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    add_event(db, "Job settings updated", job.id, event_type="job.settings")
    db.commit()
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    return job_to_out(job)


@router.post("/{job_id}/pause", response_model=JobOut)
def pause_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status not in ("completed", "cancelled"):
        job.is_paused = True
        add_event(db, "Pause requested", job.id, event_type="job.status", data={"paused": True})
        db.commit()
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    return job_to_out(job)


@router.post("/{job_id}/resume", response_model=JobOut)
def resume_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status in ("completed", "cancelled"):
        raise HTTPException(409, "Finished job cannot be resumed")
    job.is_paused = False
    add_event(db, "Job resumed", job.id, event_type="job.status", data={"paused": False, "status": job.status})
    db.commit()
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    return job_to_out(job)


@router.post("/{job_id}/cancel", response_model=JobOut)
def cancel_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status == "completed":
        raise HTTPException(409, "Completed job cannot be cancelled")

    job.cancel_requested = True
    running = False
    for task in job.tasks:
        if task.status in ("claimed", "running"):
            running = True
        elif task.status in ("queued", "retry_wait"):
            task.status = "cancelled"
    if not running:
        job.status = "cancelled"
        job.stage = "done"
        job.completed_at = utcnow()
    add_event(db, "Cancellation requested", job.id, "warning", event_type="job.status", data={"status": job.status, "cancel_requested": True})
    db.commit()
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    return job_to_out(job)


@router.post("/{job_id}/retry", response_model=JobOut)
def retry_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status == "completed":
        raise HTTPException(409, "Completed job does not need retry")

    job.cancel_requested = False
    job.is_paused = False
    job.error = None
    job.status = "queued"
    job.completed_at = None
    now = utcnow()
    retryable = [task for task in job.tasks if task.status in ("failed", "cancelled", "retry_wait")]
    if retryable:
        for task in retryable:
            task.status = "queued"
            task.next_run_at = now
            task.last_error = None
    elif not any(task.status in ("claimed", "queued", "running") for task in job.tasks):
        kind = "clean_text" if job.stage == "clean" else "transcribe"
        queue = "network" if kind == "clean_text" else "transcribe"
        enqueue_task(db, job.id, kind, queue, now)
    add_event(db, "Job queued for retry", job.id, event_type="job.retry", data={"status": "queued"})
    db.commit()
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    return job_to_out(job)


@router.delete("/{job_id}")
def delete_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if any(task.status in ("claimed", "running") for task in job.tasks):
        raise HTTPException(409, "Cancel the running job before deleting it")
    batch_id = job.batch_id
    db.delete(job)
    db.flush()
    remaining = db.scalar(select(func.count(Job.id)).where(Job.batch_id == batch_id)) or 0
    if remaining == 0:
        batch = db.get(Batch, batch_id)
        if batch:
            db.delete(batch)
    db.commit()
    delete_job_files(job_id)
    return {"deleted": job_id}
