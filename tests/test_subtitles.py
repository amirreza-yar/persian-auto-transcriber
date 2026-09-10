from app.services.subtitles import cues_to_srt, cues_to_vtt


def test_subtitle_formats_keep_ids_and_timestamps():
    cues = [
        {"id": "S000001", "start": 1.25, "end": 3.5, "text": "سلام دنیا"},
    ]
    srt = cues_to_srt(cues)
    vtt = cues_to_vtt(cues)
    assert "00:00:01,250 --> 00:00:03,500" in srt
    assert "WEBVTT" in vtt
    assert "S000001" in vtt
    assert "00:00:01.250 --> 00:00:03.500" in vtt
