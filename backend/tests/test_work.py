"""Phase 5 acceptance: completing an agreement updates the worker profile."""

from urllib.parse import parse_qs, urlparse

from tests.fixtures.transcripts import T1
from tests.helpers import confirm_both, draft


def worker_key(client, tokens):
    link = client.get(f"/api/confirm/{tokens['worker']}").json()["worker_link"]
    url = urlparse(link)
    return int(url.path.rsplit("/", 1)[1]), parse_qs(url.query)["key"][0]


def complete(client, aid):
    intent = client.post(f"/api/agreements/{aid}/payments/advance/intent", json={"payee_vpa": "ramesh@upi"}).json()
    assert intent["upi_link"].startswith("upi://pay?") and aid in intent["upi_link"] and "am=2000.00" in intent["upi_link"]
    assert client.post(f"/api/agreements/{aid}/payments/advance/confirm", json={}).json()["status"] == "ADVANCE_PAID"
    assert client.post(f"/api/agreements/{aid}/start", json={"by": "worker"}).json()["status"] == "IN_PROGRESS"
    res = client.post(f"/api/agreements/{aid}/done", data={"party": "worker"},
                      files={"photo": ("wall.jpg", b"\xff\xd8fake-jpeg", "image/jpeg")})
    assert res.json() == {"status": "IN_PROGRESS", "completed": False}
    assert client.post(f"/api/agreements/{aid}/done", data={"party": "client"}).json()["status"] == "COMPLETED"
    final = client.post(f"/api/agreements/{aid}/payments/final/confirm", json={}).json()
    assert final["amount_inr"] == 6000


def test_completing_updates_worker_profile(client):
    aid = draft(client, transcript=T1)["agreement_id"]
    tokens = confirm_both(client, aid)
    wid, key = worker_key(client, tokens)

    before = client.get(f"/api/workers/{wid}", params={"key": key}).json()
    assert before["jobs_completed"] == 0 and before["total_earned_inr"] == 0

    complete(client, aid)

    after = client.get(f"/api/workers/{wid}", params={"key": key}).json()
    assert after["jobs_completed"] == 1
    assert after["total_earned_inr"] == 8000          # advance + final
    assert after["on_time_rate"] == 1.0               # finished before the deadline
    assert after["trades"] == ["painter"]
    kinds = [m["type"] for m in client.get(f"/api/agreements/{aid}/milestones").json()]
    assert kinds == ["advance_paid", "work_started", "work_done_worker", "work_done_client", "work_completed",
                     "final_payment"]
    # The worker got a WhatsApp with their record link
    assert any("शाबाश" in m["body"] for m in client.get(f"/api/agreements/{aid}/messages").json())


def test_same_worker_phone_builds_one_history(client):
    for _ in range(2):
        aid = draft(client, transcript=T1)["agreement_id"]
        tokens = confirm_both(client, aid)
        complete(client, aid)
    wid, key = worker_key(client, tokens)
    assert client.get(f"/api/workers/{wid}", params={"key": key}).json()["jobs_completed"] == 2


def test_profile_is_private_and_share_link_expires(client):
    aid = draft(client, transcript=T1)["agreement_id"]
    tokens = confirm_both(client, aid)
    wid, key = worker_key(client, tokens)

    assert client.get(f"/api/workers/{wid}").status_code == 404
    assert client.get(f"/api/workers/{wid}", params={"key": "wrong"}).status_code == 404

    link = client.post(f"/api/workers/{wid}/share", json={"key": key}).json()
    share = parse_qs(urlparse(link["url"]).query)["share"][0]
    viewer = client.get(f"/api/workers/{wid}", params={"share": share}).json()
    assert viewer["access"] == "viewer" and "share_links" not in viewer

    # expire it
    from app.models import db
    with db.connect() as conn:
        conn.execute("UPDATE share_links SET expires_at = '2000-01-01T00:00:00+00:00'")
    assert client.get(f"/api/workers/{wid}", params={"share": share}).status_code == 404

    assert client.post(f"/api/workers/{wid}/share", json={"key": "wrong"}).status_code == 404


def test_eshram_link(client):
    aid = draft(client, transcript=T1)["agreement_id"]
    wid, key = worker_key(client, confirm_both(client, aid))
    assert client.post(f"/api/workers/{wid}/eshram", json={"key": key, "uan": "123"}).status_code == 409
    res = client.post(f"/api/workers/{wid}/eshram", json={"key": key, "uan": "1234 5678 9012"}).json()
    assert res["uan_masked"] == "XXXX XXXX 9012"
    assert client.get(f"/api/workers/{wid}", params={"key": key}).json()["eshram_linked"] is True


def test_payment_rules(client):
    aid = draft(client, transcript=T1)["agreement_id"]
    # cannot pay before both confirm
    assert client.post(f"/api/agreements/{aid}/payments/advance/confirm", json={}).status_code == 409
    confirm_both(client, aid)
    assert client.post(f"/api/agreements/{aid}/payments/advance/intent", json={"payee_vpa": "nope"}).status_code == 409
    # cannot start before paying the advance
    assert client.post(f"/api/agreements/{aid}/start", json={}).status_code == 409
    client.post(f"/api/agreements/{aid}/payments/advance/confirm", json={})
    # cannot pay the advance twice
    assert client.post(f"/api/agreements/{aid}/payments/advance/confirm", json={}).status_code == 409
    # final payment only after completion
    assert client.post(f"/api/agreements/{aid}/payments/final/confirm", json={}).status_code == 409
