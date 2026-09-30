from datetime import date

from app.schemas.agreement import Party, WorkerParty
from app.services import pipeline, summary
from tests.fixtures.transcripts import T1, T2


def build(text):
    return pipeline.build_terms("KA-TEST", text, Party(preferred_lang="en"), WorkerParty(preferred_lang="hi"),
                                None, date(2026, 9, 29))


def test_hindi_summary_is_short_with_rupee_digits():
    lines = summary.summary_lines(build(T1), "hi")
    assert len(lines) <= 8
    text = "\n".join(lines)
    assert "₹8,000" in text and "₹2,000" in text
    assert "1 अक्टूबर" in text and "6 अक्टूबर" in text
    assert lines[-1] == "सही है तो 'हाँ, पक्का' दबाइए।"


def test_english_summary_lists_open_questions():
    lines = summary.summary_lines(build(T2), "en")
    assert len(lines) <= 8
    assert any(line.startswith("Some questions are still open:") for line in lines)
    assert "Total price: not decided" in lines
