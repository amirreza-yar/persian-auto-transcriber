# Extending the backend

The backend uses generic task queues and artifacts so new text/media features do not need a second scheduler.

## Feature handler

```python
class SummaryFeature:
    kind = "summarize"
    queue = "network"

    def run(self, task_id: str) -> None:
        ...
```

Register the feature in `app/features/load.py`, then enqueue it with `enqueue_task()`.

Use:

- `jobs` for the user-visible unit of work.
- `batches` for grouped uploads/control.
- `tasks` for worker scheduling/retries/checkpoints.
- `artifacts` for generated TXT/JSON/SRT/VTT or future output files.
- `events` for persisted frontend-visible state changes and SSE.
- `worker_states` for readiness/resource ownership.
- `circuit_breakers` for provider-wide failure state.
- `app_settings` for runtime defaults.
- `api_tokens` for encrypted external credentials and usage.

## Optional preparation

A feature may expose `prepare(task_id)` when it must initialize resources before the job should become `running`. The transcription feature uses this to load/switch Whisper models while the task is in `claimed` state.

A resident feature may also expose `warmup()` for startup initialization.

## Queue choice

- `transcribe`: CPU-heavy resident Whisper model.
- `network`: Gemini and future network text processing.
- Add another queue only for materially different resource requirements.

## Timed text

Do not let text-cleaning providers regenerate timestamps. Keep stable cue IDs and timestamps from the ASR stage and only replace cue text. `app/services/subtitles.py` provides SRT/VTT/JSON helpers.

## Artifacts

Use `register_text_artifact()` for text-based artifacts. Give each artifact kind a stable semantic name such as:

```text
summary
translation
transcript_edited
subtitle_translated_json
subtitle_translated_vtt
```

## Settings

Global settings are defaults. Job-specific transcription/cleaning settings are snapshotted before their stages. Network routing remains live by design.

## Database schema

v2.1 still uses `Base.metadata.create_all()` and is intended as a fresh v2 deployment. Before making post-v2.1 schema changes on a database that must preserve production data, add proper Alembic migrations instead of relying on `create_all()`.
