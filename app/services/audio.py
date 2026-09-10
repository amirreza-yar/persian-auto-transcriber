import json
import subprocess
from pathlib import Path


AUDIO_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".webm", ".mp4", ".mka"
}


class AudioValidationError(ValueError):
    pass


def probe_audio(path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries",
            "format=duration,format_name,bit_rate:stream=index,codec_type,codec_name,sample_rate,channels,bit_rate",
            "-of", "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    audio_streams = [stream for stream in payload.get("streams", []) if stream.get("codec_type") == "audio"]
    if not audio_streams:
        raise AudioValidationError("File contains no readable audio stream")

    stream = audio_streams[0]
    fmt = payload.get("format", {})
    try:
        duration = float(fmt.get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0
    if duration <= 0:
        raise AudioValidationError("Audio duration could not be determined")

    bit_rate = stream.get("bit_rate") or fmt.get("bit_rate")
    return {
        "duration_seconds": duration,
        "format": fmt.get("format_name"),
        "codec": stream.get("codec_name"),
        "sample_rate": int(stream["sample_rate"]) if stream.get("sample_rate") else None,
        "channels": int(stream["channels"]) if stream.get("channels") else None,
        "bit_rate": int(bit_rate) if bit_rate else None,
    }


def validate_audio(path: Path, size_bytes: int, max_bytes: int, max_duration_seconds: int) -> dict:
    if path.suffix.lower() not in AUDIO_EXTENSIONS:
        raise AudioValidationError(f"Unsupported audio extension: {path.suffix or 'none'}")
    if size_bytes <= 0:
        raise AudioValidationError("Audio file is empty")
    if size_bytes > max_bytes:
        raise AudioValidationError(f"Audio file exceeds the {max_bytes} byte upload limit")

    metadata = probe_audio(path)
    if metadata["duration_seconds"] > max_duration_seconds:
        raise AudioValidationError("Audio duration exceeds the configured limit")
    return metadata


def audio_duration(path: Path) -> float:
    return float(probe_audio(path)["duration_seconds"])


def extract_window(source: Path, destination: Path, start: float, duration: float) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-ss", str(start),
            "-i", str(source),
            "-t", str(duration),
            "-vn",
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            str(destination),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
