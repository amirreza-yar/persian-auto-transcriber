import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.core.events import add_event
from app.db import utcnow
from app.models import Job, Task
from app.schemas import JobOut, JobPatch, ReorderRequest
from app.services.audio import audio_duration
from app.services.storage import delete_job_files, save_upload
from app.services.task_queue import enqueue_task


router = APIRouter(prefix="/jobs", tags=["jobs"])


def _job_stmt():
    return select(Job).options(selectinload(Job.tasks), selectinload(Job.artifacts))


@router.post("/upload", response_model=list[JobOut])
def upload_jobs(
    files: list[UploadFile] = File(...),
    scheduled_for: datetime | None = Form(None),
    priority: int = Form(0),
    db: Session = Depends(get_db),
):
    if not files:
        raise HTTPException(400, "No files supplied")

    batch_id = str(uuid.uuid4())
    max_position = db.scalar(select(func.max(Job.queue_position))) or 0
    scheduled = scheduled_for or utcnow()
    if scheduled.tzinfo is not None:
        scheduled = scheduled.astimezone(UTC).replace(tzinfo=None)

    created_ids: list[str] = []
    try:
        for offset, upload in enumerate(files, start=1):
            job_id = str(uuid.uuid4())
            source, size = save_upload(job_id, upload)
            try:
                duration = audio_duration(source)
            except Exception as exc:
                delete_job_files(job_id)
                raise HTTPException(400, f"Could not read {upload.filename}: {exc}") from exc

            job = Job(
                id=job_id,
                batch_id=batch_id,
                original_name=upload.filename or source.name,
                source_path=str(source),
                duration_seconds=duration,
                size_bytes=size,
                priority=priority,
                queue_position=max_position + offset * 10,
                scheduled_for=scheduled,
            )
            db.add(job)
            db.flush()
            enqueue_task(db, job_id, "transcribe", "transcribe", scheduled)
            add_event(db, "Audio uploaded and queued", job_id)
            created_ids.append(job_id)
        db.commit()
    except Exception:
        db.rollback()
        for job_id in created_ids:
            delete_job_files(job_id)
        raise

    jobs = db.scalars(_job_stmt().where(Job.id.in_(created_ids)).order_by(Job.queue_position)).all()
    return [JobOut.model_validate(job) for job in jobs]


@router.get("", response_model=list[JobOut])
def list_jobs(
    status: str | None = None,
    batch_id: str | None = None,
    db: Session = Depends(get_db),
):
    stmt = _job_stmt()
    if status:
        stmt = stmt.where(Job.status == status)
    if batch_id:
        stmt = stmt.where(Job.batch_id == batch_id)
    stmt = stmt.order_by(case((Job.status == "running", 0), else_=1), Job.priority.desc(), Job.queue_position, Job.created_at)
    jobs = db.scalars(stmt).unique().all()
    return [JobOut.model_validate(job) for job in jobs]


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    if not job:
        raise HTTPException(404, "Job not found")
    return JobOut.model_validate(job)


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
        scheduled = patch.scheduled_for
        if scheduled.tzinfo is not None:
            scheduled = scheduled.astimezone(UTC).replace(tzinfo=None)
        job.scheduled_for = scheduled
    add_event(db, "Job scheduling updated", job.id)
    db.commit()
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    return JobOut.model_validate(job)


@router.post("/reorder", response_model=list[JobOut])
def reorder_jobs(body: ReorderRequest, db: Session = Depends(get_db)):
    jobs = db.scalars(select(Job).where(Job.id.in_(body.job_ids))).all()
    found = {job.id: job for job in jobs}
    missing = [job_id for job_id in body.job_ids if job_id not in found]
    if missing:
        raise HTTPException(404, f"Unknown jobs: {', '.join(missing)}")
    for index, job_id in enumerate(body.job_ids, start=1):
        found[job_id].queue_position = index * 10
    db.commit()
    result = db.scalars(_job_stmt().where(Job.id.in_(body.job_ids)).order_by(Job.queue_position)).unique().all()
    return [JobOut.model_validate(job) for job in result]


@router.post("/{job_id}/pause", response_model=JobOut)
def pause_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status not in ("completed", "cancelled"):
        job.is_paused = True
        add_event(db, "Pause requested", job.id)
        db.commit()
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    return JobOut.model_validate(job)


@router.post("/{job_id}/resume", response_model=JobOut)
def resume_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status in ("completed", "cancelled"):
        raise HTTPException(409, "Finished job cannot be resumed")
    job.is_paused = False
    add_event(db, "Job resumed", job.id)
    db.commit()
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    return JobOut.model_validate(job)


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
        if task.status == "running":
            running = True
        elif task.status in ("queued", "retry_wait"):
            task.status = "cancelled"
    if not running:
        job.status = "cancelled"
        job.stage = "done"
        job.completed_at = utcnow()
    add_event(db, "Cancellation requested", job.id, "warning")
    db.commit()
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    return JobOut.model_validate(job)


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
    elif not any(task.status in ("queued", "running") for task in job.tasks):
        kind = "clean_text" if job.stage == "clean" else "transcribe"
        queue = "network" if kind == "clean_text" else "transcribe"
        enqueue_task(db, job.id, kind, queue, now)
    add_event(db, "Job queued for retry", job.id)
    db.commit()
    job = db.scalar(_job_stmt().where(Job.id == job_id))
    return JobOut.model_validate(job)


@router.delete("/{job_id}")
def delete_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if any(task.status == "running" for task in job.tasks):
        raise HTTPException(409, "Cancel the running job before deleting it")
    db.delete(job)
    db.commit()
    delete_job_files(job_id)
    return {"deleted": job_id}
