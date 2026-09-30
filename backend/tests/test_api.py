from datetime import date

from app.config import settings
from app.models import db
from tests.helpers import CONSENT, PARTIES, draft


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["mode"] == "mock"
    assert set(body["providers"]) >= {"speech", "translate", "payment", "identity", "eshram", "notify", "llm"}


def test_draft_from_audio_is_persisted_and_audited(client):
    terms = draft(client)
    agreement_id = terms["agreement_id"]
    assert agreement_id == f"KA-{date.today().year}-DL-00001"
    assert terms["status"] == "DRAFT" and terms["price_inr"] == 8000

    assert client.get(f"/api/agreements/{agreement_id}").json()["agreement"]["price_inr"] == 8000
    trail = client.get(f"/api/agreements/{agreement_id}/audit").json()
    providers = {row["provider"] for row in trail}
    assert {"speech.mock", "llm.mock"} <= providers
    assert (settings.recordings_dir / f"{agreement_id}.webm").read_bytes() == b"fake-audio"


def test_phones_are_masked_and_hashed_never_raw(client):
    terms = draft(client)
    assert terms["parties"]["client"]["phone"] == "+91XXXXXX3210"
    with db.connect() as conn:
        dump = repr([dict(r) for t in ("agreements", "parties", "audit_log", "workers")
                     for r in conn.execute(f"SELECT * FROM {t}")])
    assert "9810043210" not in dump and "98100 43210" not in dump and "9876517788" not in dump


def test_consent_required(client):
    res = client.post("/api/agreements/draft", data={**PARTIES, "transcript": "x"})
    assert res.status_code == 400 and "agree to record" in res.json()["detail"]


def test_ids_increment(client):
    assert draft(client)["agreement_id"].endswith("00001")
    assert draft(client)["agreement_id"].endswith("00002")


def test_empty_upload_rejected(client):
    res = client.post("/api/agreements/draft", data=CONSENT, files={"audio": ("a.webm", b"", "audio/webm")})
    assert res.status_code == 400


def test_unknown_agreement_404(client):
    assert client.get("/api/agreements/KA-2026-DL-99999").status_code == 404
