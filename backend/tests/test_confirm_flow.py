"""Phase 3 + 4 acceptance: draft -> sent -> both confirmed -> verified; tamper fails; Hindi message."""

import copy

from app.services.lifecycle import compute_hash
from tests.helpers import draft, send


def test_full_flow_and_tamper(client):
    aid = draft(client)["agreement_id"]
    tokens = send(client, aid)

    # Phase 4: Hindi message for the worker, English for the client, in the outbox
    msgs = {m["party_role"]: m for m in client.get(f"/api/agreements/{aid}/messages").json()}
    assert "पक्का" in msgs["worker"]["body"] and "₹8,000" in msgs["worker"]["body"]
    assert msgs["worker"]["to_masked"] == "+91XXXXXX7788"
    assert "Haan, pakka" in msgs["client"]["body"]

    view = client.get(f"/api/confirm/{tokens['worker']}").json()
    assert view["role"] == "worker" and view["lang"] == "hi" and len(view["summary"]) <= 8
    assert any("₹8,000" in line for line in view["summary"])

    res = client.post(f"/api/confirm/{tokens['worker']}", json={"decision": "yes"})
    assert res.json()["status"] == "CONFIRMED_BY_ONE"
    done = client.post(f"/api/confirm/{tokens['client']}", json={"decision": "yes"}).json()
    assert done["status"] == "CONFIRMED_BY_BOTH" and done["hash"].startswith("sha256:")

    v = client.get(f"/api/agreements/{aid}/verify").json()
    assert v["valid"] is True and v["stored_hash"] == done["hash"]

    tampered = copy.deepcopy(v["payload"])
    tampered["terms"]["price_inr"] = 6000
    assert compute_hash(tampered) != v["stored_hash"]

    # frozen: editing now is a 409
    res = client.post(f"/api/agreements/{aid}/answers", json={"field": "delay_terms", "answer": "500 kam"})
    assert res.status_code == 409
    # double confirmation is a 409
    assert client.post(f"/api/confirm/{tokens['client']}", json={"decision": "yes"}).status_code == 409
    # both parties were told it is pakka
    assert len(client.get(f"/api/agreements/{aid}/messages").json()) == 4


def test_editing_after_send_resets_to_draft(client):
    aid = draft(client)["agreement_id"]
    tokens = send(client, aid)
    client.post(f"/api/confirm/{tokens['worker']}", json={"decision": "yes"})
    res = client.post(f"/api/agreements/{aid}/answers",
                      json={"field": "delay_terms", "answer": "har din ki deri par 200 kam"})
    assert res.json()["agreement"]["status"] == "DRAFT"
    # old links no longer work
    assert client.get(f"/api/confirm/{tokens['client']}").status_code == 404
    trail = client.get(f"/api/agreements/{aid}/audit").json()
    assert any(r["from_state"] == "CONFIRMED_BY_ONE" and r["to_state"] == "DRAFT" for r in trail)


def test_kuch_galat_hai_returns_to_draft_with_question(client):
    aid = draft(client)["agreement_id"]
    tokens = send(client, aid)
    res = client.post(f"/api/confirm/{tokens['worker']}", json={"decision": "no", "note": "advance 3000 tha"})
    assert res.json()["status"] == "DRAFT"
    terms = client.get(f"/api/agreements/{aid}").json()["agreement"]
    assert any(a["field"] == "correction" and "advance 3000 tha" in a["question_en"] for a in terms["ambiguities"])


def test_cannot_send_twice(client):
    aid = draft(client)["agreement_id"]
    send(client, aid)
    assert client.post(f"/api/agreements/{aid}/send", json={}).status_code == 409


def test_verify_before_confirmation(client):
    aid = draft(client)["agreement_id"]
    assert client.get(f"/api/agreements/{aid}/verify").json()["hashed"] is False


def test_send_phone_must_match(client):
    aid = draft(client)["agreement_id"]
    res = client.post(f"/api/agreements/{aid}/send", json={"worker_phone": "9999999999"})
    assert res.status_code == 409
