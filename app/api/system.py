import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import psutil
from fastapi import APIRouter, Depends
from fastapi.sse import EventSourceResponse, ServerSentEvent
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.events import add_event
from app.core.runtime_settings import get_setting
from app.db import SessionLocal
from app.models import CircuitBreaker, Job, WorkerState
from app.services.circuit_breaker import reset_circuit
from app.services.presenters import worker_to_out

router = APIRouter(tags=["system"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


def system_snapshot(db: Session) -> dict:
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage("/data" if Path("/data").exists() else "/")
    workers = db.scalars(
        select(WorkerState).order_by(WorkerState.started_at.desc())
    ).all()
    circuits = db.scalars(select(CircuitBreaker).order_by(CircuitBreaker.name)).all()
    queue_counts = dict(
        db.execute(select(Job.status, func.count(Job.id)).group_by(Job.status)).all()
    )
    return {
        "system": {
            "cpu_percent": psutil.cpu_percent(interval=None),
            "cpu_count": psutil.cpu_count(),
            "memory_total": memory.total,
            "memory_used": memory.used,
            "memory_percent": memory.percent,
            "disk_total": disk.total,
            "disk_used": disk.used,
            "disk_free": disk.free,
            "disk_percent": disk.percent,
        },
        "workers": [
            worker_to_out(db, worker).model_dump(mode="json") for worker in workers
        ],
        "circuits": [
            {
                "name": circuit.name,
                "state": circuit.state,
                "consecutive_failures": circuit.consecutive_failures,
                "opened_until": (
                    circuit.opened_until.isoformat() if circuit.opened_until else None
                ),
                "last_error": circuit.last_error,
                "last_failure_at": (
                    circuit.last_failure_at.isoformat()
                    if circuit.last_failure_at
                    else None
                ),
                "last_success_at": (
                    circuit.last_success_at.isoformat()
                    if circuit.last_success_at
                    else None
                ),
            }
            for circuit in circuits
        ],
        "jobs": queue_counts,
    }


@router.get("/system/status")
def status(db: Session = Depends(get_db)):
    return system_snapshot(db)


@router.get("/system/workers")
def workers(db: Session = Depends(get_db)):
    rows = db.scalars(select(WorkerState).order_by(WorkerState.queue)).all()
    return [worker_to_out(db, row).model_dump(mode="json") for row in rows]


@router.get("/system/model")
def model_status(db: Session = Depends(get_db)):
    worker = db.get(WorkerState, "transcribe")
    if not worker:
        return {"status": "offline", "model_name": None, "current_job_id": None}
    out = worker_to_out(db, worker)
    return {
        "status": out.status,
        "model_name": out.model_name,
        "current_job_id": out.current_job_id,
        "detail": out.detail,
        "heartbeat_at": out.heartbeat_at,
        "stale": out.stale,
    }


@router.get("/system/circuits")
def circuits(db: Session = Depends(get_db)):
    rows = db.scalars(select(CircuitBreaker).order_by(CircuitBreaker.name)).all()
    return [
        {
            "name": row.name,
            "state": row.state,
            "consecutive_failures": row.consecutive_failures,
            "opened_until": row.opened_until,
            "last_error": row.last_error,
            "last_failure_at": row.last_failure_at,
            "last_success_at": row.last_success_at,
            "updated_at": row.updated_at,
        }
        for row in rows
    ]


@router.get("/system/stream", response_class=EventSourceResponse)
async def stream_system() -> AsyncIterator[ServerSentEvent]:
    while True:
        with SessionLocal() as db:
            interval = float(get_setting(db, "system.stream_interval_seconds"))
            snapshot = system_snapshot(db)

        # Do not keep a SQLAlchemy session checked out while SSE sends data.
        yield ServerSentEvent(
            event="system.snapshot",
            data=snapshot,
        )

        await asyncio.sleep(interval)


@router.post("/system/circuits/{name}/reset")
def reset_provider_circuit(name: str, db: Session = Depends(get_db)):
    circuit = reset_circuit(db, name)
    add_event(
        db,
        f"Circuit {name} manually reset",
        event_type="circuit.status",
        data={"name": name, "state": circuit.state},
    )
    db.commit()
    return {"name": circuit.name, "state": circuit.state}
