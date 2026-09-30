CONSENT = {"client_consent_at": "2026-09-29T10:00:00Z", "worker_consent_at": "2026-09-29T10:00:05Z"}
PARTIES = {
    "client_name": "Ritu Sharma", "client_phone": "+91 98100 43210", "client_lang": "en",
    "worker_name": "Ramesh Kumar", "worker_phone": "98765 17788", "worker_lang": "hi",
}


def draft(client, transcript=None, sample=None, audio=b"fake-audio", **extra):
    data = {**CONSENT, **PARTIES, **extra}
    if transcript is not None:
        data["transcript"] = transcript
    if sample is not None:
        data["sample"] = str(sample)
    files = {"audio": ("deal.webm", audio, "audio/webm")} if audio and transcript is None else None
    res = client.post("/api/agreements/draft", data=data, files=files)
    assert res.status_code == 200, res.text
    return res.json()["agreement"]


def send(client, agreement_id):
    res = client.post(f"/api/agreements/{agreement_id}/send", json={"by": "client"})
    assert res.status_code == 200, res.text
    return {link["role"]: link["token"] for link in res.json()["links"]}


def confirm_both(client, agreement_id):
    tokens = send(client, agreement_id)
    for role in ("worker", "client"):
        res = client.post(f"/api/confirm/{tokens[role]}", json={"decision": "yes"})
        assert res.status_code == 200, res.text
    return tokens
