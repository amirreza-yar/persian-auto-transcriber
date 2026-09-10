# Persian STT Backend v2.1

Local-LAN Persian speech-to-text backend with a persistent job queue, Faster-Whisper transcription, optional Gemini cleanup, timed subtitles and APIs intended for a future React SPA.

## Release tags

- `v1.0.0` - original backend baseline.
- `v2.0.0` - files, batches, job overrides/history, SSE, worker/model readiness, system resources, validation and Gemini circuit breaker.
- `v2.1.0` - timed Whisper cues, cue-preserving Gemini cleanup, SRT/VTT/JSON subtitles and browser audio streaming support.

The source bundle includes these tags in the accompanying Git bundle.

## Architecture

```text
Browser / future React SPA
        |
        | REST + SSE
        v
      FastAPI
        |
        +---- SQLite: jobs, batches, tasks, events, workers, circuits, tokens
        |
        +---- /data: source audio, checkpoints, TXT/JSON/SRT/VTT artifacts

Transcriber worker                 Network worker
Faster-Whisper                     Gemini cleanup
resident CPU model                 SOCKS5-aware
60 s core + overlap                cue IDs preserved
```

The API process never performs Whisper inference. Worker restarts do not erase queue state or completed checkpoints.

## Fresh v2 installation

v2 has a different database schema from v1. `Base.metadata.create_all()` creates missing tables but does not alter existing v1 tables. Keep v1 as its own release and let v2 use a fresh data volume.

```bash
cp .env.example .env
```

Set a stable `APP_SECRET_KEY`. If your already-downloaded Faster-Whisper model is in the normal Hugging Face cache, point v2 at the **hub** directory, for example:

```env
WHISPER_MODEL_CACHE=/home/amirreza/.cache/huggingface/hub
WHISPER_LOCAL_FILES_ONLY=true
```

If model download is still allowed, use:

```env
WHISPER_MODEL_CACHE=./models
WHISPER_LOCAL_FILES_ONLY=false
```

If Docker build-time `uv sync` needs your host SOCKS proxy and you build with host networking:

```env
BUILD_PROXY=socks5://127.0.0.1:9004
```

Generate/update the lock file on your server:

```bash
uv lock
```

Start:

```bash
docker compose up -d --build
```

LAN endpoints:

```text
http://SERVER_IP:8000/docs
http://SERVER_IP:8000/api/health
```

## Model readiness

The transcriber loads the default model before accepting work. A task is first marked `claimed`; the job remains queued while a per-job model is prepared. Only after preparation succeeds is the job marked `running`.

```bash
curl http://SERVER_IP:8000/api/system/model
curl http://SERVER_IP:8000/api/system/workers
```

Worker states include `starting`, `loading_model`, `ready`, `busy`, `error` and `offline` (derived from a stale heartbeat).

## Upload and validation

FFprobe validates that each upload contains a readable audio stream, has a valid duration, and stays within configured size/duration limits. The original sample rate/channels/codec are stored as metadata. FFmpeg converts only temporary transcription windows to 16 kHz mono PCM, so the original upload is preserved.

Common MP3, WAV, M4A/AAC, FLAC, OGG/Opus, WebM, MP4 and other FFmpeg-readable audio containers can be used; validation is based on the actual audio stream rather than only the filename extension.

```bash
curl -X POST http://SERVER_IP:8000/api/jobs/upload \
  -F 'files=@meeting-1.mp3' \
  -F 'files=@meeting-2.m4a' \
  -F 'batch_name=Thursday meeting' \
  -F 'description=Vadi 7 discussion' \
  -F 'tags=["vadi-7","meeting"]'
```

Every file becomes an independent job. The upload also creates one explicit batch containing those jobs.

### Per-job overrides

Overrides are JSON objects and are snapshotted on the job.

```bash
curl -X POST http://SERVER_IP:8000/api/jobs/upload \
  -F 'files=@meeting.mp3' \
  -F 'transcription_overrides={"core_seconds":90,"beam_size":5}' \
  -F 'cleaning_overrides={"enabled":true,"chunk_chars":4200}'
```

A queued job can also be changed before the relevant stage starts:

```bash
curl -X PATCH http://SERVER_IP:8000/api/jobs/JOB_ID/settings \
  -H 'Content-Type: application/json' \
  -d '{"cleaning":{"enabled":false}}'
```

Transcription settings lock once transcription is claimed/running/completed. Cleaning settings lock once the cleaning task is claimed/running/completed.

## Jobs and history

```bash
curl http://SERVER_IP:8000/api/jobs
curl 'http://SERVER_IP:8000/api/jobs/history?status=completed&tag=vadi-7&q=vadi&limit=50'
```

History supports `status`, `stage`, `batch_id`, `tag`, free-text `q`, `created_from`, `created_to`, `offset` and `limit`.

Queue controls:

```bash
curl -X POST http://SERVER_IP:8000/api/jobs/JOB_ID/pause
curl -X POST http://SERVER_IP:8000/api/jobs/JOB_ID/resume
curl -X POST http://SERVER_IP:8000/api/jobs/JOB_ID/cancel
curl -X POST http://SERVER_IP:8000/api/jobs/JOB_ID/retry
```

Reorder:

```bash
curl -X POST http://SERVER_IP:8000/api/jobs/reorder \
  -H 'Content-Type: application/json' \
  -d '{"job_ids":["JOB_3","JOB_1","JOB_2"]}'
```

## Batches

```bash
curl http://SERVER_IP:8000/api/batches
curl http://SERVER_IP:8000/api/batches/BATCH_ID
curl -X POST http://SERVER_IP:8000/api/batches/BATCH_ID/pause
curl -X POST http://SERVER_IP:8000/api/batches/BATCH_ID/resume
curl -X POST http://SERVER_IP:8000/api/batches/BATCH_ID/cancel
curl -X POST http://SERVER_IP:8000/api/batches/BATCH_ID/retry
```

Batch progress/status is calculated from member jobs.

## Source audio file API

The current file ID is the same UUID as its job because v2 keeps one source audio per job.

```bash
curl http://SERVER_IP:8000/api/files
curl http://SERVER_IP:8000/api/files/FILE_ID
```

Update description/tags:

```bash
curl -X PATCH http://SERVER_IP:8000/api/files/FILE_ID \
  -H 'Content-Type: application/json' \
  -d '{"description":"جلسه وادی هفتم","tags":["وادی","جلسه"]}'
```

Download:

```text
GET /api/files/FILE_ID/download
```

Browser/audio-player stream:

```text
GET /api/files/FILE_ID/stream
```

The stream uses `FileResponse`, so byte-range requests are supported for normal seek behavior in an HTML audio player.

Source audio can be deleted only after the job is completed or cancelled:

```text
DELETE /api/files/FILE_ID
```

Generated transcripts/subtitles remain available after source deletion.

## Transcript and subtitle pipeline

Whisper still runs on overlapping 60-second core windows by default, but v2.1 preserves segment/word timing instead of flattening everything immediately.

```text
Whisper chunk
  -> retained core words
  -> stable timed cues S000001, S000002, ...
  -> Hazm normalization per cue
  -> Gemini receives groups of cue IDs + text
  -> Gemini must return the exact same IDs/order
  -> corrected text is attached to the original timestamps
```

Gemini never controls timestamps and is not allowed to merge/split/reorder cues. This keeps playback synchronization deterministic.

Artifacts can include:

```text
raw_text
normalized_text
final_text
subtitle_raw_json
subtitle_raw_srt
subtitle_raw_vtt
subtitle_normalized_json
subtitle_cleaned_json
subtitle_cleaned_srt
subtitle_cleaned_vtt
```

The final TXT contains corrected cue text separated by line breaks; cue IDs and timestamps are not included in the TXT.

Player-friendly subtitle JSON:

```text
GET /api/subtitles/JOB_ID?version=cleaned
GET /api/subtitles/JOB_ID?version=raw
GET /api/subtitles/JOB_ID?version=normalized
```

SRT/VTT:

```text
GET /api/subtitles/JOB_ID/srt?version=cleaned
GET /api/subtitles/JOB_ID/vtt?version=cleaned
```

A future React player can fetch `/api/files/JOB_ID/stream` and `/api/subtitles/JOB_ID?version=cleaned`, highlight the active cue and seek when a subtitle line is clicked.

## SSE live events

Persistent application events:

```text
GET /api/events
GET /api/events/stream
GET /api/events/stream?job_id=JOB_ID
GET /api/events/stream?batch_id=BATCH_ID
```

Event types include:

```text
job.created
job.status
job.stage
job.progress
job.retry
job.completed
job.failed
job.recovered
job.settings
batch.created
batch.status
batch.updated
file.updated
file.deleted
queue.updated
worker.status
circuit.status
```

Progress is emitted after each transcription or Gemini-cleaning checkpoint, not every inference token.

Live server/resource snapshots:

```text
GET /api/system/stream
```

## System/resource status

```bash
curl http://SERVER_IP:8000/api/system/status
curl http://SERVER_IP:8000/api/system/model
curl http://SERVER_IP:8000/api/system/workers
curl http://SERVER_IP:8000/api/system/circuits
```

The status includes CPU, RAM, disk, job-state counts, worker/model state and provider circuit state.

## Gemini retry and circuit breaker

Token-level cooldown remains in place. In addition, repeated network/429/5xx failures can open the provider-level `gemini` circuit. While open, cleaning tasks move to retry-wait instead of repeatedly hammering the unavailable provider.

Defaults:

```text
circuit.gemini.failure_threshold = 4
circuit.gemini.cooldown_seconds = 300
```

Manual reset:

```bash
curl -X POST http://SERVER_IP:8000/api/system/circuits/gemini/reset
```

401 disables the failing credential. 403 is handled at token level. 429, 5xx and network failures contribute to the provider circuit.

## Gemini tokens

```bash
curl -X POST http://SERVER_IP:8000/api/tokens \
  -H 'Content-Type: application/json' \
  -d '{"label":"main","token":"YOUR_KEY","priority":10}'
```

Credentials are encrypted at rest using `APP_SECRET_KEY`. Usage metadata is tracked per token.

## Runtime settings

```bash
curl http://SERVER_IP:8000/api/settings
```

Useful defaults include:

```text
transcription.model = large-v3-turbo
transcription.core_seconds = 60
transcription.context_seconds = 2
transcription.cpu_threads = 4
transcription.beam_size = 5
cleaning.enabled = true
cleaning.model = gemini-3.5-flash-lite
cleaning.chunk_chars = 3500
upload.max_bytes = 157286400
upload.max_duration_seconds = 21600
worker.stale_after_seconds = 300
```

Algorithmic per-job settings are snapshotted. `network.proxy_url` stays live so the frontend can change the SOCKS5 route while a Gemini task is waiting/retrying.

## Storage

```text
/data/app.db
/data/jobs/<job-id>/source/<original-audio>
/data/jobs/<job-id>/work/transcription/chunks/*.json
/data/jobs/<job-id>/work/cleaning/cues/*.json
/data/jobs/<job-id>/artifacts/*.txt
/data/jobs/<job-id>/artifacts/*.json
/data/jobs/<job-id>/artifacts/*.srt
/data/jobs/<job-id>/artifacts/*.vtt
```

Both transcription and cleaning checkpoints survive worker restarts.

## LAN-only scope

There is intentionally no authentication layer in v2.1. Bind/expose port 8000 only on a trusted LAN. Add authentication before exposing these token-management and file endpoints to the public internet.
