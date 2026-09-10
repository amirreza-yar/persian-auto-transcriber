import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base, utcnow
from app.models import Batch, Job
from app.services.task_queue import claim_task, enqueue_task, start_task


def test_claim_prepares_before_job_becomes_running():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

    with SessionLocal() as db:
        batch = Batch(id=str(uuid.uuid4()))
        job = Job(
            id=str(uuid.uuid4()),
            batch_id=batch.id,
            original_name="test.wav",
            source_path="/tmp/test.wav",
            scheduled_for=utcnow(),
        )
        db.add(batch)
        db.add(job)
        db.flush()
        enqueue_task(db, job.id, "transcribe", "transcribe")
        db.commit()

    with SessionLocal() as db:
        task = claim_task(db, "transcribe")
        assert task is not None
        assert task.status == "claimed"
        assert task.job.status == "queued"

        start_task(db, task)
        assert task.status == "running"
        assert task.job.status == "running"
