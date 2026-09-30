"""The /v1 contract used by the Next.js frontend."""

import copy
import json
from datetime import date

import pytest

from app.models import db
from app.services.samples import SAMPLES
from app.v1 import seed
from app.v1.router import to_segments
from app.v1.seal import hash_agreement

WORKER_PHONE = "98100 12345"
HIRER_PHONE = "98990 67890"


@pytest.fixture
def small_seed(monkeypatch):
    # Keep tests quick: a thin synthetic dataset instead of ~40k rows.
    monkeypatch.setattr(seed, "STATES", {"Delhi": 0.05, "Maharashtra": 0.05, "Karnataka": 0.05})
    seed.generate()


def agreement(client, status="review"):
    segs = to_segments(SAMPLES[5]["text"])
    ext = client.post("/v1/extract", json={"transcript": segs, "hints": {"jobType": "Painting",
                                                                          "location": "Lajpat Nagar, New Delhi"}}).json()
    return {
        "id": "KR-6123",
        "createdAt": "2026-09-30T10:00:00.000Z",
        "status": status,
        "worker": {"name": "Ramesh Kumar", "phone": WORKER_PHONE, "lang": "hinglish", "role": "worker"},
        "hirer": {"name": "Anita Sharma", "phone": HIRER_PHONE, "lang": "en", "role": "hirer"},
        "consent": {"worker": True, "hirer": True, "at": "2026-09-30T10:00:00.000Z"},
        "audioSeconds": 44,
        "transcript": segs,
        "terms": ext["terms"],
        "flags": ext["flags"],
        "confirmations": {},
        "payments": [],
        "events": [{"at": "2026-09-30T10:00:00.000Z", "label": "Both parties consented to recording"}],
    }


def sealed(a):
    a = copy.deepcopy(a)
    a["terms"]["advanceAdjusted"] = True
    a["confirmations"] = {
        "worker": {"at": "2026-09-30T10:05:00.000Z", "channel": "whatsapp", "reply": "हाँ, पक्का ✅", "lang": "hinglish"},
        "hirer": {"at": "2026-09-30T10:06:00.000Z", "channel": "in_app", "reply": "Haan, pakka ✅", "lang": "en"},
    }
    a["status"] = "sealed"
    a["hash"] = hash_agreement(a)
    a["sealedAt"] = "2026-09-30T10:06:00.000Z"
    return a


def test_health_and_transcribe(client):
    h = client.get("/v1/health").json()
    assert h["status"] == "ok" and "speech" in h["simulated"]
    res = client.post("/v1/transcribe", files={"audio": ("deal.webm", b"voice", "audio/webm")},
                      data={"lang": "hinglish"})
    segs = res.json()["segments"]
    assert len(segs) == 10 and segs[0]["speaker"] == "hirer" and segs[3]["t"] == 15
    assert "athaarah hazaar" in segs[3]["text"]
    assert client.post("/v1/transcribe", files={"audio": ("a.webm", b"", "audio/webm")}).status_code == 400


def test_extract_matches_the_frontend_demo(client):
    a = agreement(client)
    t = a["terms"]
    assert (t["price"], t["advance"], t["durationDays"], t["materialsBy"]) == (18000, 5000, 6, None)
    assert [s["en"] for s in t["scope"]] == ["2 bedrooms", "Hall / living room", "Kitchen", "Walls: 2 coats, with primer"]
    assert [f["id"] for f in a["flags"]] == ["ceiling", "materials", "advance", "deadline", "balance", "mode"]
    advance = next(f for f in a["flags"] if f["id"] == "advance")
    assert "₹13,000" in advance["detail"] and advance["evidence"].startswith("Paanch hazaar advance")


def test_put_scrubs_raw_phones(client):
    res = client.put("/v1/agreements/KR-6123", json=agreement(client))
    assert res.status_code == 200
    stored = client.get("/v1/agreements/KR-6123").json()
    assert stored["worker"]["phone"] == "xxxxxx2345" and len(stored["worker"]["phoneHash"]) == 64
    with db.connect() as conn:
        dump = json.dumps([dict(r) for t in ("v1_agreements", "audit_log", "messages")
                           for r in conn.execute(f"SELECT * FROM {t}")], ensure_ascii=False)
    assert "9810012345" not in dump and "98100 12345" not in dump and "9899067890" not in dump


def test_seal_is_verified_and_frozen(client):
    a = agreement(client)
    client.put("/v1/agreements/KR-6123", json=a)
    s = sealed(a)

    bad = copy.deepcopy(s)
    bad["hash"] = "0" * 64
    assert client.post("/v1/agreements/KR-6123/seal", json={"hash": bad["hash"], "agreement": bad}).status_code == 409

    assert client.post("/v1/agreements/KR-6123/seal", json={"hash": s["hash"], "agreement": s}).json()["sealed"] is True
    v = client.get("/v1/agreements/KR-6123/verify").json()
    assert v["valid"] is True and v["storedHash"] == s["hash"]

    # The seal survives the phone scrub: re-hashing the stored (masked + phoneHash) copy gives the same value.
    assert hash_agreement(client.get("/v1/agreements/KR-6123").json()) == s["hash"]

    tampered = copy.deepcopy(s)
    tampered["terms"]["price"] = 12000
    assert client.put("/v1/agreements/KR-6123", json=tampered).status_code == 409
    back = copy.deepcopy(s)
    back["status"] = "review"
    assert client.put("/v1/agreements/KR-6123", json=back).status_code == 409

    # Outside the hash: status, payments and events may change.
    paid = copy.deepcopy(s)
    paid["status"] = "advance_paid"
    paid["payments"] = [{"id": "advance-1", "kind": "advance", "amount": 5000, "at": "2026-09-30T11:00:00.000Z",
                         "upiRef": "MOCKUPI1"}]
    assert client.put("/v1/agreements/KR-6123", json=paid).status_code == 200


def test_payments(client):
    a = agreement(client)
    client.put("/v1/agreements/KR-6123", json=a)
    assert client.get("/v1/payments/KR-6123-advance").status_code == 409  # not sealed yet
    s = sealed(a)
    client.post("/v1/agreements/KR-6123/seal", json={"hash": s["hash"], "agreement": s})
    adv = client.get("/v1/payments/KR-6123-advance").json()
    assert adv["amount"] == 5000 and adv["upiRef"].startswith("MOCKUPI")
    # The balance reference is what is left after the recorded payments.
    assert client.get("/v1/payments/KR-6123-balance").json()["amount"] == 18000
    paid = copy.deepcopy(s)
    paid["status"] = "advance_paid"
    paid["payments"] = [{"id": "advance-1", "kind": "advance", "amount": 5000, "at": "2026-09-30T11:00:00.000Z", "upiRef": adv["upiRef"]}]
    client.put("/v1/agreements/KR-6123", json=paid)
    assert client.get("/v1/payments/KR-6123-balance").json()["amount"] == 13000
    assert client.get("/v1/payments/KR-9999-advance").status_code == 404
    assert client.get("/v1/payments/nonsense").status_code == 400


def test_notify_masks_numbers(client):
    client.put("/v1/agreements/KR-6123", json=agreement(client))
    res = client.post("/v1/notify/whatsapp", json={"agreementId": "KR-6123", "role": "worker",
                                                   "text": "करार KR-6123", "phone": WORKER_PHONE})
    assert res.json()["messageId"].startswith("MOCK")
    with db.connect() as conn:
        row = conn.execute("SELECT to_masked, party_role FROM messages").fetchone()
    assert row["to_masked"] == "xxxxxx2345" and row["party_role"] == "worker"


def test_consent_and_ids_enforced(client):
    a = agreement(client)
    a["consent"]["hirer"] = False
    assert client.put("/v1/agreements/KR-6123", json=a).status_code == 409
    a = agreement(client)
    a["id"] = "EVIL-1"
    assert client.put("/v1/agreements/EVIL-1", json=a).status_code == 409


def test_analytics_shape_and_real_agreements(client, small_seed):
    before = client.get("/v1/analytics", params={"state": "Delhi"}).json()
    for key in ("monthly", "wages", "delays", "disputes", "kpis", "meta"):
        assert key in before
    assert len(before["monthly"]) == 12 and before["meta"]["real"] == 0
    assert all(set(x) == {"label", "value"} for x in before["wages"] + before["delays"])

    a = agreement(client)
    client.put("/v1/agreements/KR-6123", json=a)
    s = sealed(a)
    s["createdAt"] = date.today().isoformat() + "T10:00:00.000Z"  # inside the dashboard's window
    s["hash"] = hash_agreement(s)
    client.put("/v1/agreements/KR-6123", json=s)
    after = client.get("/v1/analytics", params={"state": "Delhi"}).json()
    assert after["meta"]["real"] == 1
    assert after["kpis"]["agreements"] == before["kpis"]["agreements"] + 1

    # Only aggregates: no names, phones or agreement IDs.
    dump = json.dumps(after, ensure_ascii=False)
    for secret in ("Ramesh", "Anita", "KR-", "xxxx", "Lajpat"):
        assert secret not in dump

    assert client.get("/v1/analytics", params={"state": "Goa"}).status_code == 400
    assert client.get("/v1/analytics", params={"months": 5}).status_code == 400


def test_small_groups_suppressed(client, monkeypatch):
    monkeypatch.setattr(seed, "STATES", {"Delhi": 0.004, "Maharashtra": 0.004, "Karnataka": 0.004})
    seed.generate()
    d = client.get("/v1/analytics", params={"state": "Delhi", "months": 3}).json()
    assert d["meta"]["suppressed"]
    assert all(w["label"] not in {s.split(": ", 1)[1] for s in d["meta"]["suppressed"] if s.startswith("wage")}
               for w in d["wages"])


def test_reset(client):
    client.put("/v1/agreements/KR-6123", json=agreement(client))
    assert client.post("/v1/demo/reset").json() == {"removed": 1}
    assert client.get("/v1/agreements").json() == []
