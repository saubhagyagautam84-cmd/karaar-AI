"""Phase 2 acceptance: the 3 Appendix transcripts produce correct JSON; Transcript 2 has >= 2 ambiguities."""

from datetime import date

from app.schemas.agreement import Party, WorkerParty
from app.services import pipeline
from tests.fixtures.transcripts import T1, T2, T3, T4
from tests.helpers import draft

TODAY = date(2026, 9, 29)


def build(text, lang="hi"):
    return pipeline.build_terms("KA-TEST", text, Party(preferred_lang="en"),
                                WorkerParty(preferred_lang=lang), None, TODAY)


def fields(terms):
    return {a.field for a in terms.ambiguities}


def test_transcript_1_clear_deal():
    t = build(T1)
    assert (t.price_inr, t.advance_inr, t.materials_provided_by) == (8000, 2000, "client")
    assert (t.start_date, t.deadline) == (date(2026, 10, 1), date(2026, 10, 6))
    assert t.parties.worker.trade == "painter"
    assert "2 bedrooms" in t.scope and "walls" in t.scope and "2 coats" in t.scope
    assert t.conditions == ["Client removes furniture before work starts."]
    assert fields(t) == {"delay_terms"}  # "expect 0 ambiguities except delay terms"


def test_transcript_2_messy_deal():
    t = build(T2)
    assert t.price_inr is None, "Transcript 2 must never produce a confident price"
    assert t.deadline is None and t.materials_provided_by is None
    assert t.start_date == date(2026, 9, 30)
    assert {"price_inr", "materials_provided_by", "deadline"} <= fields(t)
    assert len(t.ambiguities) >= 2
    jaldi = [a for a in t.ambiguities if a.field == "deadline"][0]
    assert "Jaldi" in jaldi.question_en


def test_transcript_3_conflict_resolved():
    t = build(T3, lang="en")
    assert (t.price_inr, t.advance_inr, t.materials_provided_by) == (4200, 1000, "worker")
    assert t.deadline == date(2026, 10, 3)
    assert t.parties.worker.trade == "carpenter"
    assert t.scope == "Fix three cupboard doors and one bed."
    # English-speaking worker: local questions are in English
    assert all(a.question_local == a.question_en for a in t.ambiguities)


def test_ceiling_flagged_when_not_discussed():
    t = build(T4)
    assert any(a.question_en == "Is ceiling painting included?" for a in t.ambiguities)


def test_every_value_has_evidence_from_transcript():
    for text in (T1, T2, T3):
        t = build(text)
        evidenced = {e.field for e in t.evidence}
        for f in ("scope", "price_inr", "advance_inr", "materials_provided_by", "start_date", "deadline"):
            if getattr(t, f) is not None:
                assert f in evidenced
                assert any(e.quote.lower() in text.lower() for e in t.evidence if e.field == f)


def test_rules_catch_advance_over_price():
    text = ("Client: Ghar paint karna hai.\nWorker: Paanch hazaar final, advance chhe hazaar.\n"
            "Client: Theek hai. Paint main laaungi. Parso se shuru, Friday tak khatam.")
    t = build(text)
    assert t.price_inr == 5000 and t.advance_inr == 6000
    assert any("more than the price" in a.question_en for a in t.ambiguities)


def test_hallucinated_value_without_evidence_is_dropped(monkeypatch):
    from app.services import rule_extractor

    real = rule_extractor.extract

    def lying_extract(text, today):
        r = real(text, today)
        r.price_inr = 9999
        r.evidence = [e for e in r.evidence if e.field != "price_inr"] + [
            rule_extractor.ExtractedEvidence(field="price_inr", quote="nau hazaar nau sau")]
        return r

    monkeypatch.setattr(rule_extractor, "extract", lying_extract)
    t = build(T1)
    assert t.price_inr is None
    assert any(a.field == "price_inr" and "not clearly said" in a.question_en for a in t.ambiguities)


def test_samples_via_api_and_answers(client):
    terms = draft(client, sample=2)
    assert terms["price_inr"] is None
    aid = terms["agreement_id"]
    q = next(a for a in terms["ambiguities"] if a["field"] == "price_inr")
    res = client.post(f"/api/agreements/{aid}/answers",
                      json={"field": "price_inr", "question_en": q["question_en"], "answer": "saadhe saat hazaar"})
    assert res.status_code == 200
    updated = res.json()["agreement"]
    assert updated["price_inr"] == 7500
    assert not any(a["field"] == "price_inr" for a in updated["ambiguities"])
    assert any(e["source"] == "answer" for e in updated["evidence"])

    bad = client.post(f"/api/agreements/{aid}/answers", json={"field": "deadline", "answer": "pata nahi"})
    assert bad.status_code == 422

    res = client.post(f"/api/agreements/{aid}/answers", json={"field": "deadline", "answer": "agle Sunday"})
    assert res.json()["agreement"]["deadline"] is not None


def test_ceiling_answer_no_becomes_condition(client):
    terms = draft(client, sample=4)
    aid = terms["agreement_id"]
    res = client.post(f"/api/agreements/{aid}/answers", json={
        "field": "scope", "question_en": "Is ceiling painting included?", "answer": "nahi"})
    updated = res.json()["agreement"]
    assert "Ceiling painting is not included." in updated["conditions"]
    assert not any(a["question_en"] == "Is ceiling painting included?" for a in updated["ambiguities"])


def test_typed_transcript(client):
    terms = draft(client, transcript=T3)
    assert terms["price_inr"] == 4200 and terms["audio_ref"] is None
