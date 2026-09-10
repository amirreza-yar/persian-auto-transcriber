import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base, utcnow
from app.models import Batch, Job
from app.services.task_queue import enqueue_task, retry_task, start_task


def _make_job(db: Session):
    batch = Batch(id=str(uuid.uuid4()))
    job = Job(
        id=str(uuid.uuid4()),
        batch_id=batch.id,
        original_name="test.wav",
        source_path="/tmp/test.wav",
        scheduled_for=utcnow(),
    )
    db.add_all([batch, job])
    db.flush()
    return job


def test_retry_wait_is_not_reported_as_running_or_terminal_error():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        job = _make_job(db)
        task = enqueue_task(db, job.id, "clean_text", "network")
        start_task(db, task)
        retry_task(db, task, "No Gemini token available", 30)

        assert task.status == "retry_wait"
        assert job.status == "retry_wait"
        assert task.last_error == "No Gemini token available"
        assert job.error is None


def test_starting_retry_clears_stale_job_error():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        job = _make_job(db)
        task = enqueue_task(db, job.id, "clean_text", "network")
        job.error = "old recoverable error"
        task.last_error = "old task error"
        start_task(db, task)

        assert job.status == "running"
        assert job.error is None
        assert task.last_error is None
