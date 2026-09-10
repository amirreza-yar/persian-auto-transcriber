from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_db
from app.core.events import add_event
from app.db import utcnow
from app.models import Batch, Job, Task
from app.schemas import BatchOut, BatchPatch
from app.services.presenters import batch_to_out


router = APIRouter(prefix="/batches", tags=["batches"])


def _batch_stmt():
    return select(Batch).options(
        selectinload(Batch.jobs).selectinload(Job.tasks),
        selectinload(Batch.jobs).selectinload(Job.artifacts),
    )


@router.get("", response_model=list[BatchOut])
def list_batches(limit: int = Query(100, ge=1, le=1000), db: Session = Depends(get_db)):
    batches = db.scalars(_batch_stmt().order_by(Batch.created_at.desc()).limit(limit)).unique().all()
    return [batch_to_out(batch, include_jobs=False) for batch in batches]


@router.get("/{batch_id}", response_model=BatchOut)
def get_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = db.scalar(_batch_stmt().where(Batch.id == batch_id))
    if not batch:
        raise HTTPException(404, "Batch not found")
    return batch_to_out(batch)


@router.patch("/{batch_id}", response_model=BatchOut)
def update_batch(batch_id: str, body: BatchPatch, db: Session = Depends(get_db)):
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")
    if body.name is not None:
        batch.name = body.name.strip() or None
    if body.description is not None:
        batch.description = body.description.strip() or None
    add_event(db, "Batch metadata updated", batch_id=batch.id, event_type="batch.updated")
    db.commit()
    batch = db.scalar(_batch_stmt().where(Batch.id == batch_id))
    return batch_to_out(batch)


def _load_batch(db: Session, batch_id: str) -> Batch:
    batch = db.scalar(_batch_stmt().where(Batch.id == batch_id))
    if not batch:
        raise HTTPException(404, "Batch not found")
    return batch


@router.post("/{batch_id}/pause", response_model=BatchOut)
def pause_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = _load_batch(db, batch_id)
    for job in batch.jobs:
        if job.status not in ("completed", "cancelled"):
            job.is_paused = True
    add_event(db, "Batch pause requested", batch_id=batch.id, event_type="batch.status", data={"status": "paused"})
    db.commit()
    batch = _load_batch(db, batch_id)
    return batch_to_out(batch)


@router.post("/{batch_id}/resume", response_model=BatchOut)
def resume_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = _load_batch(db, batch_id)
    for job in batch.jobs:
        if job.status not in ("completed", "cancelled"):
            job.is_paused = False
    add_event(db, "Batch resumed", batch_id=batch.id, event_type="batch.status", data={"status": "queued"})
    db.commit()
    batch = _load_batch(db, batch_id)
    return batch_to_out(batch)


@router.post("/{batch_id}/cancel", response_model=BatchOut)
def cancel_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = _load_batch(db, batch_id)
    for job in batch.jobs:
        if job.status == "completed":
            continue
        job.cancel_requested = True
        has_running = False
        for task in job.tasks:
            if task.status in ("claimed", "running"):
                has_running = True
            elif task.status in ("queued", "retry_wait"):
                task.status = "cancelled"
        if not has_running:
            job.status = "cancelled"
            job.stage = "done"
            job.completed_at = utcnow()
    add_event(db, "Batch cancellation requested", batch_id=batch.id, level="warning", event_type="batch.status", data={"status": "cancelled"})
    db.commit()
    batch = _load_batch(db, batch_id)
    return batch_to_out(batch)


@router.post("/{batch_id}/retry", response_model=BatchOut)
def retry_batch(batch_id: str, db: Session = Depends(get_db)):
    batch = _load_batch(db, batch_id)
    now = utcnow()
    for job in batch.jobs:
        if job.status not in ("failed", "cancelled"):
            continue
        job.cancel_requested = False
        job.is_paused = False
        job.error = None
        job.status = "queued"
        job.completed_at = None
        retryable = [task for task in job.tasks if task.status in ("failed", "cancelled", "retry_wait")]
        for task in retryable:
            task.status = "queued"
            task.next_run_at = now
            task.last_error = None
    add_event(db, "Batch retry queued", batch_id=batch.id, event_type="batch.status", data={"status": "queued"})
    db.commit()
    batch = _load_batch(db, batch_id)
    return batch_to_out(batch)
