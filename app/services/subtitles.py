import json
from pathlib import Path


def seconds_to_srt(seconds: float) -> str:
    total_ms = max(0, round(seconds * 1000))
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def seconds_to_vtt(seconds: float) -> str:
    return seconds_to_srt(seconds).replace(",", ".")


def cues_to_srt(cues: list[dict]) -> str:
    blocks: list[str] = []
    for index, cue in enumerate(cues, start=1):
        blocks.append(
            f"{index}\n"
            f"{seconds_to_srt(float(cue['start']))} --> {seconds_to_srt(float(cue['end']))}\n"
            f"{cue['text'].strip()}"
        )
    return "\n\n".join(blocks).strip() + "\n"


def cues_to_vtt(cues: list[dict]) -> str:
    blocks = ["WEBVTT"]
    for cue in cues:
        blocks.append(
            f"{cue['id']}\n"
            f"{seconds_to_vtt(float(cue['start']))} --> {seconds_to_vtt(float(cue['end']))}\n"
            f"{cue['text'].strip()}"
        )
    return "\n\n".join(blocks).strip() + "\n"


def dump_cues(cues: list[dict], source_name: str, version: str) -> str:
    return json.dumps(
        {
            "version": version,
            "source_name": source_name,
            "cues": cues,
        },
        ensure_ascii=False,
        indent=2,
    )


def load_cues(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    cues = payload.get("cues", [])
    if not isinstance(cues, list):
        raise ValueError("Subtitle JSON is invalid")
    return cues


def split_cues(cues: list[dict], max_chars: int) -> list[list[dict]]:
    chunks: list[list[dict]] = []
    current: list[dict] = []
    current_chars = 0

    for cue in cues:
        cost = len(str(cue.get("id", ""))) + len(str(cue.get("text", ""))) + 20
        if current and current_chars + cost > max_chars:
            chunks.append(current)
            current = []
            current_chars = 0
        current.append(cue)
        current_chars += cost

    if current:
        chunks.append(current)
    return chunks
