import argparse
import logging
import time
from datetime import timedelta

from app.config import settings
from app.core.events import add_event
from app.core.runtime_settings import bootstrap_settings, get_all_settings
from app.db import Base, SessionLocal, engine, utcnow
from app.features.registry import registry
from app.models import Task
from app.services.network import apply_proxy_environment
from app.services.task_queue import claim_task, retry_task, start_task
from app.services.worker_state import create_worker, update_worker
from app.workers.exceptions import JobCancelled, JobPaused, RetryLater


logging.basicConfig(level=settings.log_level)
logger = logging.getLogger("worker")


def reset_stale_tasks(queue: str) -> None:
    with SessionLocal() as db:
        values = get_all_settings(db)
        now = utcnow()
        cutoff = now - timedelta(seconds=int(values["worker.stale_after_seconds"]))
        tasks = db.query(Task).filter(Task.queue == queue, Task.status.in_(("claimed", "running"))).all()
        for task in tasks:
            if task.heartbeat_at is not None and task.heartbeat_at > cutoff:
                continue
            task.status = "queued"
            task.next_run_at = now
            task.heartbeat_at = None
            if task.job.status == "running":
                task.job.status = "queued"
            add_event(db, f"Recovered stale {task.kind} task", task.job_id, "warning", event_type="job.recovered", data={"task_id": task.id})
        db.commit()


def warmup_queue(queue: str, worker_id: str) -> None:
    if queue != "transcribe":
        with SessionLocal() as db:
            update_worker(db, worker_id, status="ready", emit=True)
            db.commit()
        return

    feature = registry.get("transcribe")
    warmup = getattr(feature, "warmup", None)
    if warmup is None:
        return

    with SessionLocal() as db:
        update_worker(db, worker_id, status="loading_model", detail="Loading default Whisper model", emit=True)
        db.commit()
    model_name = warmup()
    with SessionLocal() as db:
        update_worker(db, worker_id, status="ready", model_name=model_name, detail=None, emit=True)
        db.commit()


def set_ready(worker_id: str) -> None:
    with SessionLocal() as db:
        update_worker(db, worker_id, status="ready", current_job_id=None, detail=None, emit=True)
        db.commit()


def run(queue: str) -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        bootstrap_settings(db)
        values = get_all_settings(db)
        apply_proxy_environment(values["network.proxy_url"])
        worker = create_worker(db, queue)
        worker_id = worker.id
        db.commit()

    from app.features.load import load_features
    load_features()
    reset_stale_tasks(queue)

    try:
        warmup_queue(queue, worker_id)
    except Exception as exc:
        logger.exception("Worker warmup failed")
        with SessionLocal() as db:
            update_worker(db, worker_id, status="error", detail=str(exc)[:1000], emit=True)
            db.commit()
        raise

    last_recovery = time.monotonic()

    while True:
        with SessionLocal() as db:
            values = get_all_settings(db)
            poll_seconds = float(values["worker.poll_seconds"])
            update_worker(db, worker_id)
            db.commit()

        if time.monotonic() - last_recovery >= 60:
            reset_stale_tasks(queue)
            last_recovery = time.monotonic()

        with SessionLocal() as db:
            task = claim_task(db, queue)

        if not task:
            time.sleep(poll_seconds)
            continue

        feature = registry.get(task.kind)
        try:
            prepare = getattr(feature, "prepare", None)
            if prepare is not None:
                with SessionLocal() as db:
                    status = "loading_model" if queue == "transcribe" else "preparing"
                    update_worker(db, worker_id, status=status, current_job_id=task.job_id, emit=True)
                    db.commit()
                model_name = prepare(task.id)
                with SessionLocal() as db:
                    update_worker(db, worker_id, model_name=model_name if queue == "transcribe" else None)
                    db.commit()

            with SessionLocal() as db:
                current = db.get(Task, task.id)
                if not current:
                    continue
                if current.job.cancel_requested:
                    raise JobCancelled()
                if current.job.is_paused:
                    raise JobPaused()
                start_task(db, current)
                update_worker(db, worker_id, status="busy", current_job_id=current.job_id, emit=True)
                db.commit()

            feature.run(task.id)
            with SessionLocal() as db:
                current = db.get(Task, task.id)
                if current and current.status == "running":
                    current.status = "completed"
                    current.progress = 1.0
                    current.completed_at = utcnow()
                    current.heartbeat_at = None
                    db.commit()
            set_ready(worker_id)

        except JobPaused:
            with SessionLocal() as db:
                current = db.get(Task, task.id)
                if current:
                    current.status = "queued"
                    current.heartbeat_at = None
                    current.job.status = "queued"
                    add_event(db, "Job paused", current.job_id, event_type="job.status", data={"paused": True})
                    db.commit()
            set_ready(worker_id)

        except JobCancelled:
            with SessionLocal() as db:
                current = db.get(Task, task.id)
                if current:
                    current.status = "cancelled"
                    current.heartbeat_at = None
                    current.job.status = "cancelled"
                    current.job.stage = "done"
                    current.job.completed_at = utcnow()
                    add_event(db, "Job cancelled", current.job_id, "warning", event_type="job.status", data={"status": "cancelled"})
                    db.commit()
            set_ready(worker_id)

        except RetryLater as exc:
            with SessionLocal() as db:
                current = db.get(Task, task.id)
                if current:
                    retry_task(db, current, str(exc), exc.delay_seconds)
                    db.commit()
            set_ready(worker_id)

        except Exception as exc:
            logger.exception("Task failed: %s", task.id)
            with SessionLocal() as db:
                current = db.get(Task, task.id)
                if not current:
                    set_ready(worker_id)
                    continue
                values = get_all_settings(db)
                max_attempts = int(values["worker.max_attempts"])
                base_delay = int(values["worker.retry_base_seconds"])
                if current.attempts < max_attempts:
                    retry_task(db, current, str(exc), base_delay * (2 ** max(0, current.attempts - 1)))
                else:
                    current.status = "failed"
                    current.last_error = str(exc)[:4000]
                    current.job.status = "failed"
                    current.job.error = str(exc)[:4000]
                    current.heartbeat_at = None
                    add_event(db, f"Task failed: {exc}", current.job_id, "error", event_type="job.failed", data={"task_id": current.id, "error": current.last_error})
                    db.commit()
            set_ready(worker_id)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue", required=True)
    args = parser.parse_args()
    run(args.queue)


if __name__ == "__main__":
    main()
