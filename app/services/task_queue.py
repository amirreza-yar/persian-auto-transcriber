import uuid
from datetime import timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.events import add_event
from app.db import utcnow
from app.models import Job, Task, WorkerState


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

    task.status = "claimed"
    task.attempts += 1
    task.heartbeat_at = now
    db.commit()
    db.refresh(task)
    return task


def start_task(db: Session, task: Task) -> None:
    now = utcnow()
    task.status = "running"
    task.started_at = task.started_at or now
    task.heartbeat_at = now
    task.job.status = "running"
    task.job.started_at = task.job.started_at or now
    add_event(
        db,
        f"{task.kind} started",
        task.job_id,
        event_type="job.status",
        data={"status": "running", "stage": task.job.stage, "task_id": task.id, "task_kind": task.kind},
    )
    db.commit()


def heartbeat(
    db: Session,
    task: Task,
    progress: float | None = None,
    job_progress: float | None = None,
) -> None:
    now = utcnow()
    task.heartbeat_at = now
    worker = db.get(WorkerState, task.queue)
    if worker:
        worker.heartbeat_at = now
        worker.status = "busy"
        worker.current_job_id = task.job_id
    if progress is not None:
        task.progress = max(0.0, min(1.0, progress))
    if job_progress is not None:
        task.job.progress = max(0.0, min(1.0, job_progress))
    add_event(
        db,
        "Job progress updated",
        task.job_id,
        event_type="job.progress",
        data={
            "status": task.job.status,
            "stage": task.job.stage,
            "progress": task.job.progress,
            "task_id": task.id,
            "task_progress": task.progress,
        },
    )
    db.commit()


def retry_task(db: Session, task: Task, error: str, delay_seconds: int) -> None:
    task.status = "retry_wait"
    task.last_error = error[:4000]
    task.next_run_at = utcnow() + timedelta(seconds=delay_seconds)
    task.heartbeat_at = None
    task.job.status = "queued"
    task.job.error = error[:4000]
    add_event(
        db,
        "Task retry scheduled",
        task.job_id,
        level="warning",
        event_type="job.retry",
        data={
            "task_id": task.id,
            "task_kind": task.kind,
            "attempts": task.attempts,
            "next_run_at": task.next_run_at.isoformat(),
            "error": task.last_error,
        },
    )
    db.commit()


def complete_task(db: Session, task: Task) -> None:
    task.status = "completed"
    task.progress = 1.0
    task.completed_at = utcnow()
    task.heartbeat_at = None
    db.commit()
