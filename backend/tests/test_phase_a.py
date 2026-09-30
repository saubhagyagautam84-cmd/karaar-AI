"""Phase A: milestones, proof photos, change orders, the mediator and IVR, plus frontend/backend hash parity."""

import copy
import hashlib
import json
from datetime import date
from pathlib import Path

import pytest

from app.v1.amend import effective_terms, extract_delta, hash_amendment, paid_total, total_payable, verify_chain
from app.v1.mediator import mediate, rs
from app.v1.seal import hash_agreement

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "hash_parity.json").read_text(encoding="utf-8"))
TODAY = date(2026, 10, 5)
AFTER = {"id": "p1", "kind": "after", "hash": "a" * 64, "takenAt": "2026-10-03T10:00:00.000Z", "size": 1000}
JPEG = b"\xff\xd8\xff\xe0" + b"karaar-test-photo" * 20


def record(settlement=False):
    a = copy.deepcopy(FIXTURE["agreement"])
    if not settlement:
        a["amendments"] = a["amendments"][:1]
    return a


def base():
    """The sealed agreement alone (no amendments), ready to PUT."""
    a = record()
    a.pop("amendments")
    return a


def pay(kind, amount, ref="U0", mid=None):
    p = {"id": f"{kind}-{ref}", "kind": kind, "amount": amount, "at": "2026-10-01T00:00:00.000Z", "upiRef": ref}
    if mid:
        p["milestoneId"] = mid
    return p


# ---- parity with frontend/lib/hash.ts (fixture written by `npm run test:parity-fixture`) ----

def test_hash_parity_with_frontend():
    a = FIXTURE["agreement"]
    assert hash_agreement(a) == FIXTURE["expected"]["agreement"]
    assert [hash_amendment(am) for am in a["amendments"]] == FIXTURE["expected"]["amendments"]
    assert verify_chain(a) == {"ok": True, "checked": 3}


def test_chain_breaks_on_edit_or_relink():
    edited = record(settlement=True)
    edited["amendments"][0]["delta"]["priceChange"] = 3000
    assert verify_chain(edited)["broken"] == "KR-7001-A1"
    relinked = record(settlement=True)
    relinked["amendments"][1]["parentHash"] = relinked["hash"]
    assert verify_chain(relinked)["broken"] == "KR-7001-S1"


def test_effective_terms_and_delta():
    a = record()
    t = effective_terms(a)
    assert t["price"] == 20000 and t["deadline"] == "2026-10-08" and t["durationDays"] == 8
    assert [m["id"] for m in t["milestones"]] == ["m1", "m2", "c1"]
    assert a["terms"]["price"] == 18000 and total_payable(a) == 20000
    d = extract_delta([{"speaker": "hirer", "text": "Balcony bhi paint kar dena.", "t": 0},
                       {"speaker": "worker", "text": "Theek hai, 2000 rupaye extra lagenge aur ek din aur lagega.", "t": 4}])
    assert d["addScope"] == [{"en": "Balcony", "hi": "बालकनी"}] and d["priceChange"] == 2000 and d["extraDays"] == 1
    removed = extract_delta([{"speaker": "hirer", "text": "Kitchen mat karo, 1500 kam kar do", "t": 0}])
    assert [s["en"] for s in removed["removeScope"]] == ["Kitchen"] and removed["priceChange"] == -1500


# ---- mediator: same numbers as frontend/tests/phaseA.test.ts ----

def test_mediator_quality_with_milestones():
    a = record()
    a["payments"] = [pay("advance", 5000), pay("milestone", 6500, "U1", "m1")]
    a["progress"] = {"m1": {"status": "paid", "photos": [AFTER]}, "m2": {"status": "submitted", "photos": [AFTER]},
                     "c1": {"status": "rejected", "photos": [], "rejectReason": "Uneven coat"}}
    m = mediate(a, "Quality of work", TODAY)
    assert m["payToWorker"] == 7650 and m["refundToHirer"] == 0
    assert m["calculation"][-1]["amount"] == 7650
    assert any("Uneven coat" in c for c in m["contested"])
    assert m["evidence"][0].startswith("Sealed agreement KR-7001")


def test_mediator_plain_overpaid_and_unpaid_advance():
    plain = record()
    plain["terms"].pop("milestones")
    plain["amendments"][0]["delta"].pop("addMilestones")
    plain["payments"] = [pay("advance", 5000)]
    assert mediate(plain, "Quality of work", TODAY)["payToWorker"] == 13500
    assert mediate(plain, "Late payment", TODAY)["payToWorker"] == 15000
    over = {**plain, "payments": [pay("balance", 21000, "U9")]}
    m = mediate(over, "Other", TODAY)
    assert m["refundToHirer"] == 1000 and m["payToWorker"] == 0
    ms = record()
    ms["progress"] = {"m1": {"status": "approved", "photos": [AFTER]}}
    assert mediate(ms, "Late payment", TODAY)["payToWorker"] == 11500


def test_rupee_format_matches_en_in():
    assert rs(1234567) == "₹12,34,567" and rs(850) == "₹850" and rs(12150) == "₹12,150"


# ---- endpoints ----

@pytest.fixture
def sealed_deal(client):
    a = base()
    assert client.put("/v1/agreements/KR-7001", json=a).status_code == 200
    return a


def test_amendments_are_stored_chained_and_frozen(client, sealed_deal):
    a = record(settlement=True)
    change, settlement = a["amendments"]
    res = client.post("/v1/amendments", json={"agreementId": "KR-7001", "amendment": change})
    assert res.status_code == 200 and res.json()["chain"] == {"ok": True, "checked": 2}
    # Out of order: the settlement must chain to the change, which it does.
    assert client.post("/v1/amendments", json={"agreementId": "KR-7001", "amendment": settlement}).json()["chain"]["checked"] == 3
    # Idempotent re-post; an edited copy of a sealed change is refused.
    assert client.post("/v1/amendments", json={"agreementId": "KR-7001", "amendment": change}).status_code == 200
    tampered = copy.deepcopy(change)
    tampered["delta"]["priceChange"] = 9000
    assert client.post("/v1/amendments", json={"agreementId": "KR-7001", "amendment": tampered}).status_code == 409
    # A PUT cannot drop or rewrite a sealed change either.
    stored = client.get("/v1/agreements/KR-7001").json()
    dropped = {**stored, "amendments": stored["amendments"][:1]}
    assert client.put("/v1/agreements/KR-7001", json=dropped).status_code == 409
    assert client.get("/v1/agreements/KR-7001/verify").json()["chain"]["ok"] is True


def test_amendment_must_link_to_head(client, sealed_deal):
    settlement = record(settlement=True)["amendments"][1]  # parent is the change, which is not stored
    assert client.post("/v1/amendments", json={"agreementId": "KR-7001", "amendment": settlement}).status_code == 409


def test_change_extract_endpoint(client):
    res = client.post("/v1/amendments/extract", json={"transcript": [{"speaker": "hirer", "text": "Gate bhi, 1500 extra", "t": 0}]})
    assert res.json()["addScope"][0]["en"] == "Main gate" and res.json()["priceChange"] == 1500


def test_photo_upload_rehashes_bytes(client, sealed_deal):
    h = hashlib.sha256(JPEG).hexdigest()
    form = {"photoId": "ph1", "agreementId": "KR-7001", "milestoneId": "m1", "kind": "after", "hash": h}
    res = client.post("/v1/photos", data=form, files={"image": ("a.jpg", JPEG, "image/jpeg")})
    assert res.status_code == 200 and res.json() == {"id": "ph1", "hash": h, "url": "/v1/photos/ph1"}
    assert client.get("/v1/photos/ph1").content == JPEG
    bad = client.post("/v1/photos", data={**form, "hash": "0" * 64}, files={"image": ("a.jpg", JPEG, "image/jpeg")})
    assert bad.status_code == 409
    not_image = client.post("/v1/photos", data={**form, "hash": hashlib.sha256(b"hello").hexdigest()},
                            files={"image": ("a.txt", b"hello", "text/plain")})
    assert not_image.status_code == 415


def test_milestone_endpoints_and_payment_refs(client, sealed_deal):
    url = "/v1/milestones/m1/{}"
    assert client.post(url.format("submit"), json={"agreementId": "KR-7001"}).status_code == 409  # needs an after photo
    a = client.post(url.format("submit"), json={"agreementId": "KR-7001", "photos": [AFTER]}).json()
    assert a["progress"]["m1"]["status"] == "submitted"
    assert client.post(url.format("reject"), json={"agreementId": "KR-7001"}).status_code == 409  # needs a reason
    a = client.post(url.format("reject"), json={"agreementId": "KR-7001", "reason": "Patches"}).json()
    assert a["progress"]["m1"]["rejectReason"] == "Patches"
    client.post(url.format("submit"), json={"agreementId": "KR-7001"})
    assert client.get("/v1/payments/KR-7001-milestone-m2").status_code == 409  # not approved
    a = client.post(url.format("approve"), json={"agreementId": "KR-7001"}).json()
    assert a["progress"]["m1"]["status"] == "approved"
    assert client.get("/v1/payments/KR-7001-milestone-m1").status_code == 409  # advance first
    a["payments"] = [pay("advance", 5000)]
    client.put("/v1/agreements/KR-7001", json=a)
    assert client.get("/v1/payments/KR-7001-milestone-m1").json()["amount"] == 6500
    assert client.get("/v1/payments/KR-7001-balance").json()["amount"] == 13000
    assert client.get("/v1/payments/KR-7001-settlement").status_code == 409
    assert client.post("/v1/milestones/m1/explode", json={"agreementId": "KR-7001"}).status_code == 404


def test_sealing_with_bad_milestones_is_refused(client):
    a = base()
    a["terms"]["milestones"][1]["amount"] = 6000
    a["hash"] = hash_agreement(a)
    res = client.put("/v1/agreements/KR-7001", json=a)
    assert res.status_code == 409 and "add up" in res.json()["detail"]


def test_mediate_endpoint(client, sealed_deal):
    a = record()
    a["payments"] = [pay("advance", 5000)]
    res = client.post("/v1/mediate", json={"agreement": a, "reason": "Late payment"})
    assert res.status_code == 200 and res.json()["engine"] == "rules" and "not a legal judgment" in res.json()["disclaimer"]
    tampered = copy.deepcopy(a)
    tampered["terms"]["price"] = 1
    assert client.post("/v1/mediate", json={"agreement": tampered, "reason": "Late payment"}).status_code == 409
    assert client.post("/v1/mediate", json={"agreement": a, "reason": "Because"}).status_code == 400


def test_settlement_payment_ref(client, sealed_deal):
    a = client.get("/v1/agreements/KR-7001").json()
    a["status"] = "disputed"
    a["dispute"] = {"raisedBy": "hirer", "raisedAt": "2026-10-04T00:00:00.000Z", "reason": "Quality of work", "statements": {},
                    "previousStatus": "sealed", "outcome": "settled",
                    "mediation": {"payToWorker": 7650, "refundToHirer": 0}}
    client.put("/v1/agreements/KR-7001", json=a)
    assert client.get("/v1/payments/KR-7001-settlement").json()["amount"] == 7650
    assert client.get("/v1/payments/KR-7001-advance").status_code == 409  # paused during the dispute


def test_ivr_call_and_keys(client, sealed_deal):
    call = client.post("/v1/ivr/call", json={"agreementId": "KR-7001", "role": "worker"}).json()["callId"]
    key = lambda d: client.post("/v1/ivr/webhook", json={"callId": call, "agreementId": "KR-7001", "role": "worker", "digits": d})
    assert [key(d).json()["action"] for d in "1297"] == ["confirm", "change", "repeat", "unknown"]
    assert client.post("/v1/ivr/webhook", json={"callId": "nope", "agreementId": "KR-7001", "role": "worker", "digits": "1"}).status_code == 404


def test_paid_total_counts_refunds():
    a = record()
    a["payments"] = [pay("balance", 21000), pay("settlement", -1000, "U2")]
    assert paid_total(a) == 20000 == total_payable(a)


def test_price_and_advance_in_one_sentence(client):
    segs = [{"speaker": "hirer", "text": "do bedroom aur hall ki putai, poora kitna hoga?", "t": 0},
            {"speaker": "worker", "text": "atharah hazaar lagega, paanch hazaar advance pehle de dijiye.", "t": 5}]
    terms = client.post("/v1/extract", json={"transcript": segs, "hints": {"jobType": "Painting"}}).json()["terms"]
    assert terms["price"] == 18000 and terms["advance"] == 5000
