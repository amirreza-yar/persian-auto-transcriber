import asyncio

from fastapi import APIRouter, Depends, Query
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
):
    async def generate():
        last_id = after_id
        while True:
            with SessionLocal() as db:
                stmt = select(Event).where(Event.id > last_id)
                if job_id:
                    stmt = stmt.where(Event.job_id == job_id)
                if batch_id:
                    stmt = stmt.where(Event.batch_id == batch_id)
                events = db.scalars(stmt.order_by(Event.id).limit(100)).all()
                for event in events:
                    last_id = event.id
                    out = event_to_out(event)
                    yield ServerSentEvent(
                        id=str(event.id),
                        event=event.event_type,
                        data=out.model_dump(mode="json"),
                    )
            await asyncio.sleep(1)
    return EventSourceResponse(generate())
