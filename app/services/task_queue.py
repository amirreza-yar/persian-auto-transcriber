import uuid
from datetime import timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db import utcnow
from app.models import Job, Task


def enqueue_task(db: Session, job_id: str, kind: str, queue: str, next_run_at=None) -> Task:
    task = Task(
        id=str(uuid.uuid4()),
        job_id=job_id,
        kind=kind,
        queue=queue,
        status="queued",
        next_run_at=next_run_at or utcnow(),
    )
    db.add(task)
    db.flush()
    return task


def claim_task(db: Session, queue: str) -> Task | None:
    now = utcnow()
    if db.bind and db.bind.dialect.name == "sqlite":
        db.execute(text("BEGIN IMMEDIATE"))

    stmt = (
        select(Task)
        .join(Job, Job.id == Task.job_id)
        .where(
            Task.queue == queue,
            Task.status.in_(("queued", "retry_wait")),
            Task.next_run_at <= now,
            Job.scheduled_for <= now,
            Job.is_paused.is_(False),
            Job.cancel_requested.is_(False),
            Job.status.notin_(("completed", "cancelled")),
        )
        .order_by(Job.priority.desc(), Job.queue_position.asc(), Task.created_at.asc())
        .limit(1)
    )
    task = db.scalar(stmt)
    if not task:
        db.commit()
        return None

    task.status = "running"
    task.attempts += 1
    task.started_at = task.started_at or now
    task.heartbeat_at = now
    task.job.status = "running"
    task.job.started_at = task.job.started_at or now
    db.commit()
    db.refresh(task)
    return task


def heartbeat(
    db: Session,
    task: Task,
    progress: float | None = None,
    job_progress: float | None = None,
) -> None:
    task.heartbeat_at = utcnow()
    if progress is not None:
        task.progress = max(0.0, min(1.0, progress))
    if job_progress is not None:
        task.job.progress = max(0.0, min(1.0, job_progress))
    db.commit()


def retry_task(db: Session, task: Task, error: str, delay_seconds: int) -> None:
    task.status = "retry_wait"
    task.last_error = error[:4000]
    task.next_run_at = utcnow() + timedelta(seconds=delay_seconds)
    task.heartbeat_at = None
    task.job.status = "queued"
    task.job.error = error[:4000]
    db.commit()


def complete_task(db: Session, task: Task) -> None:
    task.status = "completed"
    task.progress = 1.0
    task.completed_at = utcnow()
    task.heartbeat_at = None
    db.commit()
