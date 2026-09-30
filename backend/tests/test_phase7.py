"""Phase 7: disputes + PDF, right to erasure, demo reset, and the demo script 3 times in a row."""

import re
import sys
from pathlib import Path

from app.config import settings
from app.models import db
from tests.fixtures.transcripts import T1
from tests.helpers import confirm_both, draft

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "seed"))
import generate_seed  # noqa: E402


def paid(client, aid):
    client.post(f"/api/agreements/{aid}/payments/advance/confirm", json={})


def test_dispute_flow_and_pdf(client):
    aid = draft(client, transcript=T1)["agreement_id"]
    confirm_both(client, aid)
    # not before the advance is paid
    assert client.post(f"/api/agreements/{aid}/dispute", json={"party": "client", "reason": "x"}).status_code == 409
    paid(client, aid)
    assert client.post(f"/api/agreements/{aid}/dispute", json={"party": "client", "reason": ""}).status_code == 409
    res = client.post(f"/api/agreements/{aid}/dispute",
                      json={"party": "client", "reason": "Worker stopped after one coat"})
    assert res.json()["status"] == "DISPUTED"

    pdf = client.get(f"/api/agreements/{aid}/dispute.pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    body = pdf.content
    assert body.startswith(b"%PDF-1.4") and body.rstrip().endswith(b"%%EOF")
    for text in (b"Dispute summary", aid.encode(), b"Rs 8,000", b"Worker stopped after one coat",
                 b"Intact", b"sha256:", b"edaakhil.nic.in"):
        assert text in body, text
    # xref offsets point at real objects
    xref = int(re.search(rb"startxref\n(\d+)", body).group(1))
    assert body[xref:xref + 4] == b"xref"

    assert client.post(f"/api/agreements/{aid}/dispute/resolve", json={}).json()["status"] == "RESOLVED"
    assert client.post(f"/api/agreements/{aid}/dispute/escalate", json={}).status_code == 409


def test_erasure_keeps_counts_but_removes_personal_data(client):
    generate_seed.generate(500)
    aid = draft(client)["agreement_id"]  # with audio
    tokens = confirm_both(client, aid)
    assert (settings.recordings_dir / f"{aid}.webm").exists()
    before = client.get("/api/analytics/summary").json()["agreements"]

    assert client.post(f"/api/confirm/{tokens['client']}/erase").json() == {"erased": True}

    terms = client.get(f"/api/agreements/{aid}").json()["agreement"]
    assert terms["parties"]["client"]["name"] is None and terms["parties"]["client"]["phone"] is None
    assert terms["audio_ref"] is None and terms["evidence"] == []
    assert terms["price_inr"] == 8000  # the anonymised numbers stay
    assert not (settings.recordings_dir / f"{aid}.webm").exists()
    v = client.get(f"/api/agreements/{aid}/verify").json()
    assert v["erased_at"] and v["valid"] is None
    assert client.get("/api/analytics/summary").json()["agreements"] == before
    with db.connect() as conn:
        row = conn.execute("SELECT name, phone_hash FROM parties WHERE agreement_id = ? AND role = 'client'",
                           (aid,)).fetchone()
    assert row["name"] is None and row["phone_hash"] is None


def test_worker_can_erase_record(client):
    aid = draft(client, transcript=T1)["agreement_id"]
    tokens = confirm_both(client, aid)
    link = client.get(f"/api/confirm/{tokens['worker']}").json()["worker_link"]
    wid, key = re.match(r"/worker/(\d+)\?key=(.+)", link).groups()
    assert client.post(f"/api/workers/{wid}/erase", json={"key": key}).json() == {"erased": True}
    # the old key no longer opens anything
    assert client.get(f"/api/workers/{wid}", params={"key": key}).status_code == 404


def test_demo_reset_keeps_seed(client):
    generate_seed.generate(50)
    draft(client)
    assert client.post("/api/demo/reset").json()["removed_agreements"] == 1
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM agreements WHERE is_seed = 1").fetchone()[0] == 50
        assert conn.execute("SELECT COUNT(*) FROM agreements WHERE is_seed = 0").fetchone()[0] == 0


def test_demo_reset_disabled_outside_demo_mode(client, monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", False)
    assert client.post("/api/demo/reset").status_code == 404


def test_demo_script_three_times(client):
    """Step 9 via the API, 3 runs with a reset between, all offline mocks."""
    generate_seed.generate(500)
    for _ in range(3):
        terms = draft(client, sample=4)
        aid = terms["agreement_id"]
        assert aid.endswith("00001")  # reset gives a clean slate every run
        ceiling = next(a for a in terms["ambiguities"] if a["question_en"] == "Is ceiling painting included?")
        client.post(f"/api/agreements/{aid}/answers", json={"field": "scope", "question_en": ceiling["question_en"],
                                                            "answer": "nahi"})
        confirm_both(client, aid)
        assert any("पक्का" in m["body"] for m in client.get(f"/api/agreements/{aid}/messages").json())
        assert client.get(f"/api/agreements/{aid}/verify").json()["valid"] is True
        assert client.get("/api/analytics/all").status_code == 200
        client.post("/api/demo/reset")
