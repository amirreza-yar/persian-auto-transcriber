import argparse
import json
import time
from pathlib import Path

import httpx


TERMINAL = {"completed", "failed", "cancelled"}


def current_task(job: dict) -> dict | None:
    stage = job.get("stage")
    kind = "clean_text" if stage == "clean" else "transcribe"
    matches = [task for task in job.get("tasks", []) if task.get("kind") == kind]
    return matches[-1] if matches else None


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload one audio file and follow the complete backend pipeline")
    parser.add_argument("audio", type=Path)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--poll", type=float, default=5.0)
    parser.add_argument("--timeout", type=int, default=4 * 60 * 60)
    parser.add_argument("--no-cleaning", action="store_true")
    args = parser.parse_args()

    if not args.audio.is_file():
        raise SystemExit(f"Audio file not found: {args.audio}")

    base_url = args.base_url.rstrip("/")
    cleaning = json.dumps({"enabled": not args.no_cleaning})

    with httpx.Client(base_url=base_url, timeout=60) as client:
        with args.audio.open("rb") as handle:
            response = client.post(
                "/api/jobs/upload",
                files={"files": (args.audio.name, handle, "application/octet-stream")},
                data={"cleaning_overrides": cleaning, "batch_name": "live-backend-test"},
            )
        response.raise_for_status()
        job = response.json()[0]
        job_id = job["id"]
        print(f"Created job {job_id}")

        deadline = time.monotonic() + args.timeout
        last_line = None
        while time.monotonic() < deadline:
            response = client.get(f"/api/jobs/{job_id}")
            response.raise_for_status()
            job = response.json()
            task = current_task(job)
            detail = task.get("last_error") if task else None
            line = (
                f"status={job['status']} stage={job['stage']} "
                f"progress={job['progress']:.3f}"
            )
            if task:
                line += f" task={task['status']} task_progress={task['progress']:.3f}"
            if detail:
                line += f" last_error={detail}"
            if line != last_line:
                print(line)
                last_line = line

            if job["status"] in TERMINAL:
                break
            time.sleep(args.poll)
        else:
            raise SystemExit("Timed out waiting for the job")

        if job["status"] != "completed":
            raise SystemExit(f"Pipeline ended with status={job['status']}: {job.get('error')}")

        kinds = {artifact["kind"] for artifact in job.get("artifacts", [])}
        required = {"raw_text", "normalized_text", "final_text", "subtitle_raw_json", "subtitle_raw_srt", "subtitle_raw_vtt"}
        if not args.no_cleaning:
            required |= {"subtitle_cleaned_json", "subtitle_cleaned_srt", "subtitle_cleaned_vtt"}

        missing = sorted(required - kinds)
        if missing:
            raise SystemExit(f"Job completed but artifacts are missing: {', '.join(missing)}")

        print("Pipeline completed and required artifacts exist")


if __name__ == "__main__":
    main()
