# Adding a feature

A feature is a task handler with a task kind and a worker queue.

```python
class SummaryFeature:
    kind = "summarize"
    queue = "network"

    def run(self, task_id: str) -> None:
        ...
```

Register it in `app/features/load.py` and enqueue it with `enqueue_task()`.

Use the existing pieces rather than creating feature-specific infrastructure:

- `tasks` for scheduling, retries, progress and worker ownership
- `artifacts` for generated files
- `events` for frontend-visible logs
- `app_settings` for runtime configuration
- `api_tokens` for external model credentials and usage

A feature that needs new persistent domain data can add a table in `app/models.py`. Once the schema starts changing between deployed versions, add Alembic migrations; version 0.1 deliberately uses `Base.metadata.create_all()` to keep initial deployment small.

## Queue choice

Use `transcribe` for the resident Whisper worker. Use `network` for API-dependent text features. Add a new queue only when a feature has materially different resource requirements.

## Artifacts

Register output files through `register_text_artifact()` instead of adding download endpoints per feature. The existing artifact API will expose them automatically.

Examples of future kinds:

```text
summarize       -> network
rewrite_text    -> network
export_docx     -> general
export_pdf      -> general
```

## Settings

Algorithm settings are snapshotted at the start of a stage. Network proxy settings remain live so a proxy can be changed while an API task is waiting or retrying.
