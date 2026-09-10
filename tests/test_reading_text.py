from app.services.reading_text import cues_to_reading_text


def test_cues_become_continuous_text_without_paragraph_marks():
    cues = [
        {"id": "S000001", "text": "جمله اول."},
        {"id": "S000002", "text": "جمله دوم."},
        {"id": "S000003", "text": "جمله سوم."},
    ]
    assert cues_to_reading_text(cues) == "جمله اول. جمله دوم. جمله سوم."


def test_paragraph_after_creates_blank_line_only_at_marked_boundary():
    cues = [
        {"id": "S000001", "text": "جمله اول.", "paragraph_after": False},
        {"id": "S000002", "text": "پایان پاراگراف.", "paragraph_after": True},
        {"id": "S000003", "text": "پاراگراف بعدی.", "paragraph_after": False},
    ]
    assert cues_to_reading_text(cues) == (
        "جمله اول. پایان پاراگراف.\n\nپاراگراف بعدی."
    )


def test_reading_text_collapses_cue_whitespace():
    cues = [
        {"id": "S000001", "text": "  متن   اول  "},
        {"id": "S000002", "text": " متن\nدوم "},
    ]
    assert cues_to_reading_text(cues) == "متن اول متن دوم"
