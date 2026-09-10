from sqlalchemy.orm import Session

from app.core.events import add_event
from app.db import utcnow
from app.models import WorkerState


def create_worker(db: Session, queue: str) -> WorkerState:
    worker = db.get(WorkerState, queue)
    if worker is None:
        worker = WorkerState(id=queue, queue=queue, status="starting")
        db.add(worker)
    else:
        worker.status = "starting"
        worker.current_job_id = None
        worker.detail = None
        worker.started_at = utcnow()
        worker.heartbeat_at = utcnow()
    db.flush()
    add_event(
        db,
        f"{queue} worker starting",
        event_type="worker.status",
        data={"worker_id": worker.id, "queue": queue, "status": "starting"},
    )
    return worker


def update_worker(
    db: Session,
    worker_id: str,
    status: str | None = None,
    current_job_id: str | None = None,
    model_name: str | None = None,
    detail: str | None = None,
    emit: bool = False,
) -> WorkerState | None:
    worker = db.get(WorkerState, worker_id)
    if not worker:
        return None
    if status is not None:
        worker.status = status
    worker.current_job_id = current_job_id
    if model_name is not None:
        worker.model_name = model_name
    worker.detail = detail
    worker.heartbeat_at = utcnow()
    if emit:
        add_event(
            db,
            f"{worker.queue} worker {worker.status}",
            job_id=current_job_id,
            event_type="worker.status",
            data={
                "worker_id": worker.id,
                "queue": worker.queue,
                "status": worker.status,
                "current_job_id": worker.current_job_id,
                "model_name": worker.model_name,
                "detail": worker.detail,
            },
        )
    db.flush()
    return worker
