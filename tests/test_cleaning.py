from app.services.subtitles import split_cues


def test_split_cues_respects_text_budget():
    cues = [
        {"id": f"S{i:06d}", "start": float(i), "end": float(i + 1), "text": "الف " * 20}
        for i in range(1, 8)
    ]
    chunks = split_cues(cues, 180)
    assert len(chunks) > 1
    assert [cue["id"] for chunk in chunks for cue in chunk] == [cue["id"] for cue in cues]
