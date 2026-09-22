from __future__ import annotations

from dataclasses import dataclass

from app.services.subtitles import split_cues

MIN_CHUNK_TEXT_RATIO = 0.65
MAX_CHUNK_TEXT_RATIO = 1.60


def _compact_chars(value: object) -> int:
    return len("".join(str(value or "").split()))


@dataclass(frozen=True)
class CleanupIntegrityResult:
    ok: bool
    reason: str | None
    suspicious_chunks: list[int]
    normalized_cues: int
    cleaned_cues: int
    normalized_chars: int
    cleaned_chars: int


def validate_cleaned_chunk(
    source_cues: list[dict], cleaned_items: list[dict]
) -> list[dict]:
    """Validate one Gemini/checkpoint chunk and rebuild immutable cue fields.

    A chunk is accepted only when every normalized cue is represented exactly
    once, in the same order, with non-empty cleaned text.  The text-size guard
    intentionally has a wide range: it is only meant to catch truncation,
    summarisation, or accidental expansion, not ordinary cleanup edits.
    """
    if not isinstance(cleaned_items, list):
        raise RuntimeError("Cleaned subtitle checkpoint/result is not a list")
    if len(cleaned_items) != len(source_cues):
        raise RuntimeError(
            f"Cleaned subtitle cue count mismatch: expected {len(source_cues)}, got {len(cleaned_items)}"
        )

    expected_ids = [str(cue.get("id", "")) for cue in source_cues]
    returned_ids = [str(item.get("id", "")) for item in cleaned_items]
    if returned_ids != expected_ids:
        raise RuntimeError(
            "Cleaned subtitle cue IDs do not exactly match normalized subtitle cue IDs"
        )

    source_chars = sum(_compact_chars(cue.get("text", "")) for cue in source_cues)
    cleaned_chars = sum(_compact_chars(item.get("text", "")) for item in cleaned_items)
    if source_chars >= 200:
        ratio = cleaned_chars / source_chars if source_chars else 1.0
        if ratio < MIN_CHUNK_TEXT_RATIO or ratio > MAX_CHUNK_TEXT_RATIO:
            raise RuntimeError(
                f"Cleaned subtitle content size changed too much: ratio={ratio:.2f}"
            )

    validated: list[dict] = []
    for original, item in zip(source_cues, cleaned_items, strict=True):
        text = str(item.get("text", "")).strip()
        if not text:
            raise RuntimeError(f"Cleaned subtitle text is empty for {original['id']}")
        paragraph_after = item.get("paragraph_after", False)
        if not isinstance(paragraph_after, bool):
            raise RuntimeError(
                f"Cleaned subtitle paragraph_after is invalid for {original['id']}"
            )

        # Timing and every other immutable field always come from the normalized
        # transcript. Gemini/checkpoints are allowed to change text only.
        validated.append({**original, "text": text, "paragraph_after": paragraph_after})
    return validated


def verify_cleaned_cues(
    normalized_cues: list[dict],
    cleaned_cues: list[dict],
    chunk_chars: int,
) -> CleanupIntegrityResult:
    """Compare a published cleaned transcript with its normalized source.

    The verifier reports 1-based *current cleaning chunks* that are suspicious.
    It catches full missing chunks, missing/duplicate/reordered cue IDs, empty
    cue text, changed timing, and chunk-sized text shrink/expansion.
    """
    chunks = split_cues(normalized_cues, chunk_chars)
    all_chunk_numbers = list(range(1, len(chunks) + 1))
    suspicious: set[int] = set()
    reasons: list[str] = []

    normalized_ids = [str(cue.get("id", "")) for cue in normalized_cues]
    cleaned_ids = [str(cue.get("id", "")) for cue in cleaned_cues]

    cleaned_by_id: dict[str, dict] = {}
    duplicate_ids: set[str] = set()
    for cue in cleaned_cues:
        cue_id = str(cue.get("id", ""))
        if cue_id in cleaned_by_id:
            duplicate_ids.add(cue_id)
        else:
            cleaned_by_id[cue_id] = cue

    normalized_id_set = set(normalized_ids)
    unknown_ids = [cue_id for cue_id in cleaned_ids if cue_id not in normalized_id_set]
    if duplicate_ids:
        reasons.append(f"duplicate cleaned cue IDs: {len(duplicate_ids)}")
    if unknown_ids:
        reasons.append(f"unknown cleaned cue IDs: {len(unknown_ids)}")

    for chunk_number, source_chunk in enumerate(chunks, start=1):
        source_ids = [str(cue.get("id", "")) for cue in source_chunk]
        chunk_cleaned: list[dict] = []
        missing = False
        invalid = False

        for source in source_chunk:
            cue_id = str(source.get("id", ""))
            item = cleaned_by_id.get(cue_id)
            if item is None:
                missing = True
                continue
            chunk_cleaned.append(item)

            if not str(item.get("text", "")).strip():
                invalid = True

            try:
                if (
                    abs(float(item.get("start", 0.0)) - float(source.get("start", 0.0)))
                    > 0.01
                ):
                    invalid = True
                if (
                    abs(float(item.get("end", 0.0)) - float(source.get("end", 0.0)))
                    > 0.01
                ):
                    invalid = True
            except (TypeError, ValueError):
                invalid = True

        if missing:
            suspicious.add(chunk_number)
            reasons.append(f"chunk {chunk_number} has missing cue IDs")
            continue

        if invalid:
            suspicious.add(chunk_number)
            reasons.append(f"chunk {chunk_number} has empty text or changed timing")

        source_chars = sum(_compact_chars(cue.get("text", "")) for cue in source_chunk)
        cleaned_chars = sum(
            _compact_chars(cue.get("text", "")) for cue in chunk_cleaned
        )
        if source_chars >= 200:
            ratio = cleaned_chars / source_chars if source_chars else 1.0
            if ratio < MIN_CHUNK_TEXT_RATIO or ratio > MAX_CHUNK_TEXT_RATIO:
                suspicious.add(chunk_number)
                reasons.append(f"chunk {chunk_number} text ratio is {ratio:.2f}")

        returned_ids = [str(cue.get("id", "")) for cue in chunk_cleaned]
        if returned_ids != source_ids:
            suspicious.add(chunk_number)
            reasons.append(f"chunk {chunk_number} cue order differs")

    # Exact global ID equality is mandatory. If the mismatch cannot be localized
    # cleanly (for example, unknown/reordered IDs), mark every chunk suspicious.
    if cleaned_ids != normalized_ids:
        reasons.append(
            f"cleaned cue sequence differs: normalized={len(normalized_ids)}, cleaned={len(cleaned_ids)}"
        )
        if not suspicious or duplicate_ids or unknown_ids:
            suspicious.update(all_chunk_numbers)

    normalized_chars = sum(
        _compact_chars(cue.get("text", "")) for cue in normalized_cues
    )
    cleaned_chars = sum(_compact_chars(cue.get("text", "")) for cue in cleaned_cues)

    if not normalized_cues:
        return CleanupIntegrityResult(
            ok=True,
            reason=None,
            suspicious_chunks=[],
            normalized_cues=0,
            cleaned_cues=len(cleaned_cues),
            normalized_chars=normalized_chars,
            cleaned_chars=cleaned_chars,
        )

    ok = not suspicious and cleaned_ids == normalized_ids
    reason = "; ".join(dict.fromkeys(reasons)) if reasons else None
    return CleanupIntegrityResult(
        ok=ok,
        reason=reason,
        suspicious_chunks=sorted(suspicious),
        normalized_cues=len(normalized_cues),
        cleaned_cues=len(cleaned_cues),
        normalized_chars=normalized_chars,
        cleaned_chars=cleaned_chars,
    )
