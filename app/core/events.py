import json
from typing import Any

from sqlalchemy.orm import Session

from app.models import Event


def add_event(
    db: Session,
    message: str,
    job_id: str | None = None,
    level: str = "info",
    event_type: str = "log",
    data: dict[str, Any] | None = None,
    batch_id: str | None = None,
) -> None:
    if job_id and not batch_id:
        from app.models import Job

        job = db.get(Job, job_id)
        if job:
            batch_id = job.batch_id

    db.add(
        Event(
            job_id=job_id,
            batch_id=batch_id,
            event_type=event_type,
            level=level,
            message=message,
            data_json=json.dumps(data or {}, ensure_ascii=False),
        )
    )
