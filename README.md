# Persian STT Backend

A small local-first backend for queued Persian audio transcription and text cleaning.

## Runtime

- FastAPI API
- SQLite job/task state
- Faster-Whisper `large-v3-turbo` on the transcription worker
- 60-second core windows with configurable overlap
- Hazm normalization
- Gemini cleanup on a separate network worker
- SOCKS5 proxy support for network-dependent features
- TXT artifacts only

The API never performs Whisper work. Closing the browser or restarting the API does not stop the worker containers.

## Start

```bash
cp .env.example .env
```

Set `APP_SECRET_KEY` to a long random value and keep it stable; changing it later makes existing encrypted API tokens unreadable. If the SOCKS proxy runs on the Docker host, use for example:

```env
BOOTSTRAP_SOCKS5_PROXY=socks5://host.docker.internal:9004
```

Generate the lock file once:

```bash
uv lock
```

Then:

```bash
docker compose up -d --build
```

Open:

- API docs: `http://localhost:8000/docs`
- Health: `http://localhost:8000/api/health`

The first transcription can download the Whisper model. The model cache is stored in the persistent `model_cache` Docker volume.

## Custom DNS

DNS is container-level rather than runtime application configuration. Start with the override when needed:

```bash
DNS_SERVER=1.1.1.1 docker compose -f compose.yaml -f compose.dns.yaml up -d
```

## Add a Gemini token

```bash
curl -X POST http://localhost:8000/api/tokens \
  -H 'Content-Type: application/json' \
  -d '{
    "label": "main",
    "token": "YOUR_GEMINI_API_KEY",
    "priority": 10
  }'
```

Tokens are encrypted at rest with `APP_SECRET_KEY`. The API only returns masked values.

Gemini returns token usage for each generation request. The backend records prompt, response, and total token usage per token. Google does not return a simple remaining-free-quota value in a normal generation response, so `remaining_*_today` is calculated only when you configure a local `daily_token_limit` or `daily_request_limit` for that token.

## Upload audio

One upload request may contain several files. Each file becomes its own schedulable job and all receive the same `batch_id`.

```bash
curl -X POST http://localhost:8000/api/jobs/upload \
  -F 'files=@meeting-1.mp3' \
  -F 'files=@meeting-2.mp3'
```

Schedule for later. Incoming timestamps with offsets are normalized to UTC internally; naive timestamps are treated as UTC.


```bash
curl -X POST http://localhost:8000/api/jobs/upload \
  -F 'files=@meeting.mp3' \
  -F 'scheduled_for=2026-09-11T01:00:00+03:30'
```

## Manage queue

```bash
curl http://localhost:8000/api/jobs
```

Pause/resume/cancel/retry:

```bash
curl -X POST http://localhost:8000/api/jobs/JOB_ID/pause
curl -X POST http://localhost:8000/api/jobs/JOB_ID/resume
curl -X POST http://localhost:8000/api/jobs/JOB_ID/cancel
curl -X POST http://localhost:8000/api/jobs/JOB_ID/retry
```

Reorder jobs:

```bash
curl -X POST http://localhost:8000/api/jobs/reorder \
  -H 'Content-Type: application/json' \
  -d '{"job_ids":["JOB_3","JOB_1","JOB_2"]}'
```

Higher `priority` is processed first. Within the same priority, `queue_position` controls order.

## Runtime settings

```bash
curl http://localhost:8000/api/settings
```

Example update:

```bash
curl -X PATCH http://localhost:8000/api/settings \
  -H 'Content-Type: application/json' \
  -d '{
    "values": {
      "transcription.core_seconds": 60,
      "transcription.context_seconds": 2,
      "cleaning.chunk_chars": 3500,
      "cleaning.retry_count": 4,
      "network.proxy_url": "socks5://host.docker.internal:9004"
    }
  }'
```

A stage snapshots its settings when it starts. Changing transcription chunk size while an audio file is already being transcribed therefore affects future transcription tasks, not the running checkpoint layout.

## Artifacts

Current features create:

- `raw_text`: Whisper output
- `normalized_text`: Hazm-normalized text
- `final_text`: Gemini-cleaned text, or normalized text if cleaning is disabled

```bash
curl 'http://localhost:8000/api/artifacts?job_id=JOB_ID'
```

Download:

```bash
curl -OJ http://localhost:8000/api/artifacts/ARTIFACT_ID/download
```

## Events and progress

Historical log:

```bash
curl http://localhost:8000/api/events
```

SSE stream for the future SPA:

```text
GET /api/events/stream
GET /api/events/stream?job_id=JOB_ID
```

FastAPI's SSE endpoint can be consumed directly by the browser `EventSource` API.

## Feature layout

Feature work is registered by task kind and queue:

```text
app/features/
├── transcription/
│   └── feature.py
└── cleaning/
    ├── feature.py
    └── prompt.py
```

Each feature provides `kind`, `queue`, and `run(task_id)`. The generic worker claims tasks from a queue and dispatches them through the feature registry.

A future summarizer can register `summarize` on the `network` queue. A DOCX exporter can register `export_docx` on a lightweight `general` queue. New outputs go into the existing `artifacts` table, so the file API does not need to be redesigned.

## Storage

```text
/data/app.db
/data/jobs/<job-id>/source/...
/data/jobs/<job-id>/work/transcription/chunks/...
/data/jobs/<job-id>/work/cleaning/chunks/...
/data/jobs/<job-id>/artifacts/...
```

Transcription and cleaning checkpoints survive worker restarts.

## Notes

SQLite is intentional for the single-server version. If the application later runs across multiple machines or many workers, PostgreSQL should replace SQLite before scaling worker concurrency significantly.
