import re


SPACE_RE = re.compile(r"\s+")


def _clean_piece(text: str) -> str:
    return SPACE_RE.sub(" ", text).strip()


def cues_to_reading_text(cues: list[dict]) -> str:
    """Build readable plain text without exposing subtitle cue boundaries."""
    paragraphs: list[str] = []
    current: list[str] = []

    for cue in cues:
        text = _clean_piece(str(cue.get("text", "")))
        if text:
            current.append(text)

        if cue.get("paragraph_after") is True and current:
            paragraphs.append(" ".join(current))
            current = []

    if current:
        paragraphs.append(" ".join(current))

    return "\n\n".join(paragraphs).strip()
