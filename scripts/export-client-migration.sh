#!/usr/bin/env bash
set -euo pipefail

# Run from the existing Persian STT project directory on the Linux source machine.
# Produces a folder that can be copied to Windows and selected with
# "Import migration" in PersianSTT.exe.

ENV_FILE="${ENV_FILE:-.env}"
OUTPUT_PARENT="${1:-./migration-export}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$(mkdir -p "$OUTPUT_PARENT" && cd "$OUTPUT_PARENT" && pwd)/persian-stt-$STAMP"
mkdir -p "$OUT"

read_env() {
  local key="$1" default="${2:-}"
  if [[ -f "$ENV_FILE" ]]; then
    local value
    value="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
    if [[ -n "$value" ]]; then printf '%s' "$value"; return; fi
  fi
  printf '%s' "$default"
}

DATA_VOLUME="$(read_env DATA_VOLUME_NAME persian-stt-v2-data)"
MODEL_VOLUME="$(read_env MODEL_VOLUME_NAME '')"
MODEL_PATH="$(read_env WHISPER_MODEL_CACHE ./models)"
APP_IMAGE="$(read_env APP_IMAGE ghcr.io/amirreza-yar/persian-auto-transcriber:stable)"
APP_SECRET_KEY="$(read_env APP_SECRET_KEY '')"

if [[ -z "$APP_SECRET_KEY" ]]; then
  echo "ERROR: APP_SECRET_KEY was not found in $ENV_FILE."
  echo "It is required if encrypted Gemini tokens/settings in /data must keep working."
  exit 1
fi

if ! docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1; then
  echo "ERROR: Docker data volume '$DATA_VOLUME' was not found."
  echo "Set DATA_VOLUME_NAME in .env or run: ENV_FILE=/path/to/.env $0"
  exit 1
fi

if ! docker image inspect "$APP_IMAGE" >/dev/null 2>&1; then
  echo "ERROR: Image '$APP_IMAGE' is not available locally."
  echo "Pull it while your VPN is connected, then rerun this script."
  exit 1
fi

mapfile -t RUNNING_SERVICES < <(docker compose ps --status running --services 2>/dev/null || true)
if (( ${#RUNNING_SERVICES[@]} > 0 )); then
  echo "Stopping running Persian STT services for a consistent SQLite/data backup…"
  docker compose stop "${RUNNING_SERVICES[@]}"
fi

restart_if_needed() {
  if (( ${#RUNNING_SERVICES[@]} > 0 )); then
    echo "Restarting the services that were running before export…"
    docker compose start "${RUNNING_SERVICES[@]}" >/dev/null || true
  fi
}
trap restart_if_needed EXIT

echo "Exporting data volume: $DATA_VOLUME"
docker run --rm \
  -v "$DATA_VOLUME:/source:ro" \
  -v "$OUT:/backup" \
  "$APP_IMAGE" \
  python -c "import tarfile; t=tarfile.open('/backup/app-data.tar.gz','w:gz'); t.add('/source',arcname='.'); t.close()"

# New customer installs use a named model volume. Older installs used ./models.
if [[ -n "$MODEL_VOLUME" ]] && docker volume inspect "$MODEL_VOLUME" >/dev/null 2>&1; then
  echo "Exporting model volume: $MODEL_VOLUME"
  docker run --rm \
    -v "$MODEL_VOLUME:/source:ro" \
    -v "$OUT:/backup" \
    "$APP_IMAGE" \
    python -c "import tarfile; t=tarfile.open('/backup/models.tar.gz','w:gz'); t.add('/source',arcname='.'); t.close()"
elif [[ -d "$MODEL_PATH" ]]; then
  echo "Exporting model directory: $MODEL_PATH"
  tar -C "$MODEL_PATH" -czf "$OUT/models.tar.gz" .
else
  echo "Model cache not found; skipping it. The Windows client can download the model again."
fi

cat > "$OUT/migration.env" <<META
APP_SECRET_KEY=$APP_SECRET_KEY
SOURCE_DATA_VOLUME=$DATA_VOLUME
CREATED_AT=$(date -Iseconds)
META

cat > "$OUT/README.txt" <<'TXT'
Persian STT migration bundle

Copy this whole folder to the Windows client.
Open PersianSTT.exe -> Import migration -> select this folder.

app-data.tar.gz is required.
models.tar.gz is optional.
migration.env carries the original APP_SECRET_KEY so encrypted Gemini tokens remain readable.
TXT

echo
echo "Migration bundle created at:"
echo "$OUT"
echo "Copy the entire folder to the client PC."
