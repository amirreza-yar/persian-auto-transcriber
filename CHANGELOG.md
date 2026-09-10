# Changelog

## v2.2.0
- Final TXT is now prose-oriented instead of one subtitle cue per line.
- Gemini returns a structured `paragraph_after` annotation while preserving cue IDs and timestamps.
- If paragraph metadata is unavailable, final TXT falls back to one continuous text rather than artificial line breaks.
- Retry-wait is now a distinct non-running job state; recoverable cleaner failures stay in `Task.last_error` instead of polluting terminal `Job.error`.
- Starting a retry clears stale recoverable job errors.
- Add optional Vite `frontend/dist` serving and SPA fallback on the same FastAPI port, without requiring Node in production.
- Add repeatable unit/read-only smoke test pipeline and an optional live audio end-to-end test script.


## v2.1.0
- Preserve Whisper timing as stable cue IDs.
- Clean cue text with Gemini while enforcing unchanged cue IDs/order.
- Generate raw/cleaned JSON, SRT and WebVTT subtitle artifacts.
- Produce final TXT without cue IDs/timestamps while retaining cue line boundaries.
- Add `/api/subtitles` endpoints for player-friendly timed text.
- Add byte-range-capable source audio streaming for a future browser audio player.
- Keep original formats/sample rates while FFmpeg normalizes only temporary inference windows.

## v2.0.0
- Source audio API with metadata, tags, descriptions, download, stream and guarded deletion.
- Explicit batch records with batch pause/resume/cancel/retry controls.
- Per-job transcription and cleaning overrides at upload and before stage start.
- Job history/search/filter endpoint.
- FFprobe file validation and broad FFmpeg-readable audio support.
- Persisted typed SSE events plus live system SSE snapshots.
- Worker/model readiness state and `claimed -> prepare -> running` task flow.
- CPU, RAM, disk, queue, worker and circuit-breaker status endpoints.
- Gemini provider circuit breaker and manual reset endpoint.
- Host Hugging Face model-cache mounting and local-only model mode support.

## v1.0.0
Original backend baseline.
