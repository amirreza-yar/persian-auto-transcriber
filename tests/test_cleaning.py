from app.features.cleaning.feature import split_text


def test_split_text_respects_limit_for_normal_lines():
    text = "\n".join(["الف " * 20, "ب " * 20, "پ " * 20])
    chunks = split_text(text, 100)
    assert len(chunks) >= 2
    assert all(len(chunk) <= 100 for chunk in chunks)
