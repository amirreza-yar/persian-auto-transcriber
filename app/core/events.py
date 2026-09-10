from sqlalchemy.orm import Session

from app.models import Event


def add_event(db: Session, message: str, job_id: str | None = None, level: str = "info") -> None:
    db.add(Event(job_id=job_id, level=level, message=message))
