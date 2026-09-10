# Changelog

## v2.1.0
Planned media/transcript release: timed Whisper cues, Gemini cue-preserving cleanup, SRT/VTT/JSON subtitle artifacts, and browser-player support.

## v2.0.0
Backend control-plane release:
- Source audio API with metadata, tags, descriptions, download, stream and guarded deletion.
- Batch records and batch pause/resume/cancel/retry controls.
- Per-job transcription and cleaning overrides snapshotted at upload.
- Job history/search/filter endpoint.
- File validation through FFprobe and support for common FFmpeg-readable audio containers.
- Unified persisted SSE events plus live system SSE snapshots.
- Worker/model readiness state and pre-run task claiming.
- CPU, RAM, disk, queue, worker and circuit-breaker status endpoint.
- Gemini provider circuit breaker and manual reset endpoint.
- Host Hugging Face model-cache mounting and local-only model mode support.

## v1.0.0
Original backend baseline.
