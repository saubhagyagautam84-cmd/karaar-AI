"""Phase B: phone OTP login, public verification, consent-based sharing and the access log."""

import copy
import json
from pathlib import Path

import pytest

from app.config import settings
from app.models import db
from app.v1.seal import phone_hash

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "hash_parity.json").read_text(encoding="utf-8"))
RAMESH = "98100 12345"


@pytest.fixture(autouse=True)
def demo(monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", True)


def login(client, phone=RAMESH, role="worker"):
    assert client.post("/v1/auth/otp/send", json={"phone": phone}).json()["demoCode"] == "123456"
    res = client.post("/v1/auth/otp/verify", json={"phone": phone, "code": "123456", "role": role})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['token']}"}


def test_otp_login_flow_and_roles(client):
    sent = client.post("/v1/auth/otp/send", json={"phone": "+91 98100 12345"}).json()
    assert sent["to"] == "xxxxxx2345"
    bad = client.post("/v1/auth/otp/verify", json={"phone": RAMESH, "code": "000000", "role": "worker"})
    assert bad.status_code == 400
    ok = client.post("/v1/auth/otp/verify", json={"phone": RAMESH, "code": "123456", "role": "officer"}).json()
    assert ok["role"] == "officer" and ok["phone"] == "xxxxxx2345" and ok["phoneHash"] == phone_hash(RAMESH)
    headers = {"Authorization": f"Bearer {ok['token']}"}
    assert client.get("/v1/auth/me", headers=headers).json()["role"] == "officer"
    # The code is single-use; logout ends the session.
    assert client.post("/v1/auth/otp/verify", json={"phone": RAMESH, "code": "123456", "role": "worker"}).status_code == 400
    client.post("/v1/auth/logout", headers=headers)
    assert client.get("/v1/auth/me", headers=headers).status_code == 401
    assert client.post("/v1/auth/otp/send", json={"phone": "12345"}).status_code == 400
    assert client.post("/v1/auth/otp/verify", json={"phone": RAMESH, "code": "123456", "role": "king"}).status_code == 400


def test_otp_never_stores_numbers_or_codes(client):
    login(client)
    with db.connect() as conn:
        dump = json.dumps([dict(r) for t in ("v1_otps", "v1_sessions", "messages", "audit_log")
                           for r in conn.execute(f"SELECT * FROM {t}").fetchall()])
    assert "9810012345" not in dump and "98100 12345" not in dump and "123456" not in dump


def test_otp_rate_limits(client):
    for _ in range(5):
        client.post("/v1/auth/otp/send", json={"phone": "9876543210"})
    assert client.post("/v1/auth/otp/send", json={"phone": "9876543210"}).status_code == 429
    for _ in range(5):
        client.post("/v1/auth/otp/verify", json={"phone": "9876543210", "code": "111111", "role": "worker"})
    assert client.post("/v1/auth/otp/verify", json={"phone": "9876543210", "code": "123456", "role": "worker"}).status_code == 429


def seal_fixture(client):
    a = copy.deepcopy(FIXTURE["agreement"])
    a["worker"]["phoneHash"] = a["worker"]["phoneHash"]
    assert client.put("/v1/agreements/KR-7001", json=a).status_code == 200
    return a


def test_public_verify_shows_outline_only(client):
    a = seal_fixture(client)
    v = client.get(f"/v1/verify/{a['hash']}").json()
    assert v["found"] and v["valid"] and v["chainOk"] and v["kind"] == "agreement" and v["changes"] == 2
    assert v["worker"] == "Ramesh K." and v["area"] == "New Delhi"
    text = json.dumps(v, ensure_ascii=False)
    assert "18000" not in text and "xxxx" not in text and "transcript" not in text
    change = client.get(f"/v1/verify/{a['amendments'][0]['hash']}").json()
    assert change["kind"] == "change order" and change["id"] == "KR-7001"
    assert client.get(f"/v1/verify/{'0' * 64}").json() == {"found": False}
    assert client.get("/v1/verify/nothex").status_code == 400


def test_share_view_revoke_and_access_log(client):
    a = copy.deepcopy(FIXTURE["agreement"])
    a["worker"]["phoneHash"] = phone_hash(RAMESH)
    a.pop("hash")
    from app.v1.seal import hash_agreement

    a.pop("amendments")
    a["status"] = "completed"
    a["hash"] = hash_agreement(a)
    a["payments"] = [{"id": "p", "kind": "balance", "amount": 18000, "at": "2026-10-01T00:00:00.000Z", "upiRef": "U"}]
    a["ratings"] = {"byHirer": {"onTime": 5, "fair": 4, "respectful": 5, "at": "2026-10-02T00:00:00.000Z"}}
    assert client.put("/v1/agreements/KR-7001", json=a).status_code == 200

    assert client.post("/v1/profile/share", json={"recipient": "Demo NBFC", "scope": ["jobs"]}).status_code == 401
    hirer = login(client, "98990 67890", "hirer")
    assert client.post("/v1/profile/share", json={"recipient": "X", "scope": ["jobs"]}, headers=hirer).status_code == 403

    me = login(client)
    share = client.post("/v1/profile/share", json={"recipient": "Demo NBFC", "scope": ["earnings", "ratings"]}, headers=me).json()
    seen = client.get(f"/v1/shared/{share['id']}").json()
    assert seen["earnedViaUpi"] == 18000 and seen["ratings"]["fair"] == 4 and seen["verifiedJobs"] == 1
    assert "jobs" not in seen and seen["worker"] == "Ramesh K."
    log = client.get("/v1/profile/access-log", headers=me).json()
    assert log[0]["actor"] == "Demo NBFC" and "viewed" in log[0]["action"]
    assert client.delete(f"/v1/profile/share/{share['id']}", headers=me).json()["revoked"]
    assert client.get(f"/v1/shared/{share['id']}").status_code == 410
    assert client.get("/v1/profile/shares", headers=me).json()[0]["revokedAt"]
    assert client.get("/v1/profile/access-log", headers=hirer).status_code == 403


def test_ratings_cannot_be_changed(client):
    a = copy.deepcopy(FIXTURE["agreement"])
    a["status"] = "completed"
    a["ratings"] = {"byHirer": {"onTime": 5, "fair": 5, "respectful": 5, "at": "2026-10-02T00:00:00.000Z"}}
    assert client.put("/v1/agreements/KR-7001", json=a).status_code == 200
    a["ratings"]["byHirer"]["fair"] = 1
    assert client.put("/v1/agreements/KR-7001", json=a).status_code == 409
    a["ratings"]["byHirer"]["fair"] = 5
    a["ratings"]["byWorker"] = {"onTime": 4, "fair": 4, "respectful": 5, "at": "2026-10-02T01:00:00.000Z"}
    assert client.put("/v1/agreements/KR-7001", json=a).status_code == 200
