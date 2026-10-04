# Persian STT — Windows customer package

This folder is intended to be handed to a Windows customer after the application image has been published to GHCR.

## Customer prerequisites

1. Install Docker Desktop and keep Linux containers enabled.
2. If Gemini is unavailable on the customer's normal connection, connect the customer's normal Windows VPN.
3. Double-click **Persian STT.cmd**.

The launcher creates `.env` automatically the first time it runs. Keep that file: its generated `APP_SECRET_KEY` is used to encrypt/decrypt Gemini API keys stored in the persistent database.

## Buttons

- **Start** — starts the existing local containers without forcing an image update.
- **Open** — opens `http://127.0.0.1:8000`.
- **Update** — pulls the current `:stable` GHCR image and recreates containers.
- **Stop** — stops containers but does not delete them or any volumes.

The launcher never runs `docker compose down -v`; application data and the Whisper model are therefore preserved.

## Persistent Docker volumes

- `persian-stt-data` → `/data`: SQLite, source audio, checkpoints, outputs, runtime settings and encrypted Gemini keys.
- `persian-stt-models` → `/models`: Faster-Whisper model cache.

On the first transcription/model warmup, the Whisper model may be downloaded because `WHISPER_LOCAL_FILES_ONLY=false`. Later starts reuse the model volume.

## LAN access

The default is deliberately local-only:

```env
API_BIND=127.0.0.1
```

If a customer intentionally needs other trusted LAN devices to access the application, change it to:

```env
API_BIND=0.0.0.0
```

Do not expose port 8000 directly to the public internet; this project currently assumes a trusted local network and does not provide end-user authentication.
