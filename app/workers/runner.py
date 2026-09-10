import argparse
import logging
import time
from datetime import timedelta

from app.config import settings
from app.core.events import add_event
from app.core.runtime_settings import bootstrap_settings, get_all_settings
from app.db import Base, SessionLocal, engine, utcnow
from app.features.registry import registry
from app.services.network import apply_proxy_environment
from app.models import Task
from app.services.task_queue import claim_task, retry_task
from app.workers.exceptions import JobCancelled, JobPaused, RetryLater


logging.basicConfig(level=settings.log_level)
logger = logging.getLogger("worker")


def reset_stale_tasks(queue: str) -> None:
    with SessionLocal() as db:
        values = get_all_settings(db)
        now = utcnow()
        cutoff = now - timedelta(seconds=int(values["worker.stale_after_seconds"]))
        tasks = db.query(Task).filter(Task.queue == queue, Task.status == "running").all()
        for task in tasks:
            if task.heartbeat_at is not None and task.heartbeat_at > cutoff:
                continue
            task.status = "queued"
            task.next_run_at = now
            task.heartbeat_at = None
            task.job.status = "queued"
            add_event(db, f"Recovered stale {task.kind} task", task.job_id, "warning")
        db.commit()


def run(queue: str) -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        bootstrap_settings(db)
        values = get_all_settings(db)
        apply_proxy_environment(values["network.proxy_url"])

    from app.features.load import load_features
    load_features()
    reset_stale_tasks(queue)
    last_recovery = time.monotonic()

    while True:
        with SessionLocal() as db:
            values = get_all_settings(db)
            poll_seconds = float(values["worker.poll_seconds"])

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
            feature.run(task.id)
            with SessionLocal() as db:
                current = db.get(Task, task.id)
                if current and current.status == "running":
                    current.status = "completed"
                    current.progress = 1.0
                    current.completed_at = utcnow()
                    current.heartbeat_at = None
                    db.commit()
        except JobPaused:
            with SessionLocal() as db:
                current = db.get(Task, task.id)
                if current:
                    current.status = "queued"
                    current.heartbeat_at = None
                    current.job.status = "queued"
                    add_event(db, "Job paused", current.job_id)
                    db.commit()
        except JobCancelled:
            with SessionLocal() as db:
                current = db.get(Task, task.id)
                if current:
                    current.status = "cancelled"
                    current.heartbeat_at = None
                    current.job.status = "cancelled"
                    current.job.stage = "done"
                    current.job.completed_at = utcnow()
                    add_event(db, "Job cancelled", current.job_id, "warning")
                    db.commit()
        except RetryLater as exc:
            with SessionLocal() as db:
                current = db.get(Task, task.id)
                if current:
                    retry_task(db, current, str(exc), exc.delay_seconds)
                    add_event(db, f"Task delayed: {exc}", current.job_id, "warning")
                    db.commit()
        except Exception as exc:
            logger.exception("Task failed: %s", task.id)
            with SessionLocal() as db:
                current = db.get(Task, task.id)
                if not current:
                    continue
                values = get_all_settings(db)
                max_attempts = int(values["worker.max_attempts"])
                base_delay = int(values["worker.retry_base_seconds"])
                if current.attempts < max_attempts:
                    retry_task(db, current, str(exc), base_delay * (2 ** max(0, current.attempts - 1)))
                    add_event(db, f"Task retry scheduled: {exc}", current.job_id, "warning")
                    db.commit()
                else:
                    current.status = "failed"
                    current.last_error = str(exc)[:4000]
                    current.job.status = "failed"
                    current.job.error = str(exc)[:4000]
                    current.heartbeat_at = None
                    add_event(db, f"Task failed: {exc}", current.job_id, "error")
                    db.commit()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue", required=True)
    args = parser.parse_args()
    run(args.queue)


if __name__ == "__main__":
    main()
