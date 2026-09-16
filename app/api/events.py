import asyncio
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Header, Query
from fastapi.sse import EventSourceResponse, ServerSentEvent
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.db import SessionLocal
from app.models import Event
from app.schemas import EventOut
from app.services.presenters import event_to_out

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=list[EventOut])
def list_events(
    job_id: str | None = None,
    batch_id: str | None = None,
    event_type: str | None = None,
    after_id: int = 0,
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    stmt = select(Event).where(Event.id > after_id)
    if job_id:
        stmt = stmt.where(Event.job_id == job_id)
    if batch_id:
        stmt = stmt.where(Event.batch_id == batch_id)
    if event_type:
        stmt = stmt.where(Event.event_type == event_type)
    events = db.scalars(stmt.order_by(Event.id.desc()).limit(limit)).all()
    return [event_to_out(event) for event in events]


@router.get("/stream", response_class=EventSourceResponse)
async def stream_events(
    after_id: int = 0,
    job_id: str | None = None,
    batch_id: str | None = None,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
) -> AsyncIterator[ServerSentEvent]:
    try:
        resumed_id = int(last_event_id) if last_event_id is not None else 0
    except ValueError:
        resumed_id = 0

    last_id = max(after_id, resumed_id)

    while True:
        pending: list[tuple[int, str, dict]] = []

        with SessionLocal() as db:
            stmt = select(Event).where(Event.id > last_id)
            if job_id:
                stmt = stmt.where(Event.job_id == job_id)
            if batch_id:
                stmt = stmt.where(Event.batch_id == batch_id)

            rows = db.scalars(stmt.order_by(Event.id).limit(100)).all()
            for row in rows:
                out = event_to_out(row)
                pending.append((row.id, row.event_type, out.model_dump(mode="json")))

        # The database connection is returned to the pool before network I/O.
        for event_id, event_type, data in pending:
            last_id = event_id
            yield ServerSentEvent(
                id=str(event_id),
                event=event_type,
                data=data,
            )

        await asyncio.sleep(1)
