"""Phase B endpoints: phone OTP login (B7), public verification (B5), consent-based sharing and
the access log (B6).

Privacy: raw phone numbers and OTP codes are never stored or logged; only their hashes and a
masked number ("xxxxxx1234"). Aadhaar is never asked for.
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.adapters import NotConfigured, get_adapter
from app.config import settings
from app.models import db
from app.services import audit
from app.v1 import store
from app.v1.amend import hash_amendment, paid_total, verify_chain
from app.v1.seal import hash_agreement, phone_hash

router = APIRouter(prefix="/v1", tags=["v1"])

ROLES = ("worker", "hirer", "contractor", "officer")
DEMO_OTP = "123456"
OTP_TTL = timedelta(minutes=5)
OTP_WINDOW = timedelta(minutes=15)
MAX_SENDS = 5
MAX_ATTEMPTS = 5
SESSION_TTL = timedelta(days=30)
SCOPES = ("jobs", "earnings", "ratings")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(d: datetime) -> str:
    return d.isoformat(timespec="seconds")


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _digits(phone: str) -> str:
    d = re.sub(r"\D", "", phone or "")
    d = d[-10:] if len(d) > 10 and d.startswith("91") else d
    if not re.fullmatch(r"[6-9]\d{9}", d):
        raise HTTPException(400, "Enter a 10-digit Indian mobile number.")
    return d


# ---- B7: phone OTP login ----

class OtpSendIn(BaseModel):
    phone: str


@router.post("/auth/otp/send")
def otp_send(body: OtpSendIn) -> dict:
    digits = _digits(body.phone)
    ph, masked = phone_hash(digits), store.mask_phone(digits)
    now = _now()
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM v1_otps WHERE phone_hash = ?", (ph,)).fetchone()
        window_start, sent = (row["window_start"], row["sent_in_window"]) if row else (_iso(now), 0)
        if datetime.fromisoformat(window_start) + OTP_WINDOW < now:
            window_start, sent = _iso(now), 0
        if sent >= MAX_SENDS:
            raise HTTPException(429, "Too many codes sent. Please wait 15 minutes.")
        code = DEMO_OTP if settings.demo_mode else f"{secrets.randbelow(10**6):06d}"
        conn.execute(
            "INSERT INTO v1_otps (phone_hash, code_hash, expires_at, attempts, window_start, sent_in_window)"
            " VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT(phone_hash) DO UPDATE SET code_hash = excluded.code_hash,"
            " expires_at = excluded.expires_at, attempts = 0, window_start = excluded.window_start,"
            " sent_in_window = excluded.sent_in_window",
            (ph, _sha(ph + code), _iso(now + OTP_TTL), window_start, sent + 1),
        )
    try:
        # The simulated outbox is stored, so it never keeps the code itself.
        shown = "••••••" if settings.providers.get("notify") == "mock" else code
        get_adapter("notify").send(masked, f"Karaar AI code: {shown}. Valid 5 minutes. Do not share it.", to_phone=digits)
    except NotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    audit.log(actor="system", provider=f"notify.{settings.providers['notify']}", note=f"login code sent to {masked}")
    return {"sent": True, "to": masked, "demoCode": DEMO_OTP if settings.demo_mode else None}


class OtpVerifyIn(BaseModel):
    phone: str
    code: str
    role: str


@router.post("/auth/otp/verify")
def otp_verify(body: OtpVerifyIn) -> dict:
    if body.role not in ROLES:
        raise HTTPException(400, f"Role is one of: {', '.join(ROLES)}.")
    digits = _digits(body.phone)
    ph, masked = phone_hash(digits), store.mask_phone(digits)
    now = _now()
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM v1_otps WHERE phone_hash = ?", (ph,)).fetchone()
        if not row or datetime.fromisoformat(row["expires_at"]) < now:
            raise HTTPException(400, "The code has expired. Ask for a new one.")
        if row["attempts"] >= MAX_ATTEMPTS:
            raise HTTPException(429, "Too many wrong codes. Ask for a new one.")
        wrong = not secrets.compare_digest(row["code_hash"], _sha(ph + body.code.strip()))
        if wrong:
            # Count the attempt; the raise happens after this block commits.
            conn.execute("UPDATE v1_otps SET attempts = attempts + 1 WHERE phone_hash = ?", (ph,))
    if wrong:
        raise HTTPException(400, "That code is not right.")
    with db.connect() as conn:
        conn.execute("DELETE FROM v1_otps WHERE phone_hash = ?", (ph,))
        token = secrets.token_urlsafe(32)
        conn.execute(
            "INSERT INTO v1_sessions (token_hash, phone_hash, phone_masked, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            (_sha(token), ph, masked, body.role, _iso(now), _iso(now + SESSION_TTL)),
        )
    audit.log(actor=body.role, note=f"signed in as {body.role} ({masked})")
    return {"token": token, "role": body.role, "phoneHash": ph, "phone": masked}


def session_of(authorization: str | None) -> dict | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM v1_sessions WHERE token_hash = ?", (_sha(authorization[7:].strip()),)).fetchone()
    if not row or datetime.fromisoformat(row["expires_at"]) < _now():
        return None
    return {"role": row["role"], "phoneHash": row["phone_hash"], "phone": row["phone_masked"]}


def require_session(authorization: str | None, role: str | None = None) -> dict:
    s = session_of(authorization)
    if not s:
        raise HTTPException(401, "Please sign in with your phone number.")
    if role and s["role"] != role:
        raise HTTPException(403, f"Only a signed-in {role} can do this.")
    return s


@router.get("/auth/me")
def me(authorization: str | None = Header(None)) -> dict:
    return require_session(authorization)


@router.post("/auth/logout")
def logout(authorization: str | None = Header(None)) -> dict:
    if authorization and authorization.startswith("Bearer "):
        with db.connect() as conn:
            conn.execute("DELETE FROM v1_sessions WHERE token_hash = ?", (_sha(authorization[7:].strip()),))
    return {"ok": True}


# ---- B5: public verification by hash ----

def _short_name(name: str) -> str:
    parts = (name or "").split()
    return f"{parts[0]} {parts[-1][0]}." if len(parts) > 1 else (parts[0] if parts else "—")


@router.get("/verify/{seal}")
def verify_public(seal: str) -> dict:
    """What anyone holding the QR may see: that the record exists, is intact, and who/what/when in outline.
    No phone numbers, no price, no transcript."""
    if not re.fullmatch(r"[0-9a-f]{64}", seal):
        raise HTTPException(400, "A seal is a 64-character SHA-256 hex digest.")
    for a in store.list_all():
        kind = None
        if a.get("hash") == seal:
            kind, valid = "agreement", hash_agreement(a) == seal
        else:
            am = next((x for x in a.get("amendments") or [] if x.get("hash") == seal), None)
            if am:
                kind, valid = ("settlement" if am.get("source") == "settlement" else "change order"), hash_amendment(am) == seal
        if not kind:
            continue
        chain = verify_chain(a)
        terms = a.get("terms") or {}
        audit.log(actor="public", agreement_id=a["id"], note="seal verified via public link")
        return {
            "found": True, "kind": kind, "id": a["id"], "valid": valid, "chainOk": chain["ok"],
            "sealedAt": a.get("sealedAt"), "status": a.get("status"),
            "jobType": terms.get("jobType"), "area": (terms.get("location") or "").split(",")[-1].strip() or None,
            "worker": _short_name((a.get("worker") or {}).get("name", "")),
            "hirer": _short_name((a.get("hirer") or {}).get("name", "")),
            "changes": len([x for x in a.get("amendments") or [] if x.get("hash")]),
        }
    return {"found": False}


# ---- B6: consent-based sharing and the access log ----

def _log(conn, subject: str, action: str, actor: str, share_id: str | None = None) -> None:
    conn.execute("INSERT INTO v1_access_log (subject_hash, share_id, actor, action, at) VALUES (?, ?, ?, ?, ?)",
                 (subject, share_id, actor, action, _iso(_now())))


def history(subject: str, scope: list[str]) -> dict:
    """The worker's verified history, limited to what they chose to share."""
    mine = [a for a in store.list_all() if (a.get("worker") or {}).get("phoneHash") == subject and a.get("hash")]
    done = [a for a in mine if a.get("status") == "completed"]
    out: dict = {"verifiedJobs": len(done)}
    if "jobs" in scope:
        out["jobs"] = [{"id": a["id"], "jobType": (a.get("terms") or {}).get("jobType"), "month": (a.get("createdAt") or "")[:7],
                        "status": a.get("status")} for a in mine]
    if "earnings" in scope:
        out["earnedViaUpi"] = sum(paid_total(a) for a in mine)
    if "ratings" in scope:
        scores = [r for a in done for r in [((a.get("ratings") or {}).get("byHirer") or {})] if r]
        out["ratings"] = {k: round(sum(r[k] for r in scores) / len(scores), 1) for k in ("onTime", "fair", "respectful")} if scores else None
    worker = next((a["worker"] for a in mine), None)
    out["worker"] = _short_name(worker["name"]) if worker else None
    return out


class ShareIn(BaseModel):
    recipient: str
    scope: list[str]
    days: int = 30


@router.post("/profile/share")
def share_create(body: ShareIn, authorization: str | None = Header(None)) -> dict:
    s = require_session(authorization, "worker")
    scope = [x for x in body.scope if x in SCOPES]
    if not scope:
        raise HTTPException(400, "Choose at least one thing to share.")
    if not 1 <= body.days <= 90:
        raise HTTPException(400, "Share for 1 to 90 days.")
    recipient = body.recipient.strip()[:80] or "Unnamed recipient"
    share_id = f"KRS-{secrets.token_hex(4).upper()}"
    now = _now()
    with db.connect() as conn:
        conn.execute("INSERT INTO v1_shares (id, subject_hash, recipient, scope_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
                     (share_id, s["phoneHash"], recipient, json.dumps(scope), _iso(now), _iso(now + timedelta(days=body.days))))
        _log(conn, s["phoneHash"], f"shared {', '.join(scope)} with {recipient}", "you", share_id)
    return {"id": share_id, "recipient": recipient, "scope": scope, "createdAt": _iso(now),
            "expiresAt": _iso(now + timedelta(days=body.days)), "revokedAt": None}


@router.get("/profile/shares")
def share_list(authorization: str | None = Header(None)) -> list[dict]:
    s = require_session(authorization, "worker")
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM v1_shares WHERE subject_hash = ? ORDER BY created_at DESC", (s["phoneHash"],)).fetchall()
    return [{"id": r["id"], "recipient": r["recipient"], "scope": json.loads(r["scope_json"]), "createdAt": r["created_at"],
             "expiresAt": r["expires_at"], "revokedAt": r["revoked_at"]} for r in rows]


@router.delete("/profile/share/{share_id}")
def share_revoke(share_id: str, authorization: str | None = Header(None)) -> dict:
    s = require_session(authorization, "worker")
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM v1_shares WHERE id = ? AND subject_hash = ?", (share_id, s["phoneHash"])).fetchone()
        if not row:
            raise HTTPException(404, "No such share.")
        conn.execute("UPDATE v1_shares SET revoked_at = ? WHERE id = ?", (_iso(_now()), share_id))
        _log(conn, s["phoneHash"], f"revoked access for {row['recipient']}", "you", share_id)
    return {"id": share_id, "revoked": True}


@router.get("/profile/access-log")
def access_log(authorization: str | None = Header(None)) -> list[dict]:
    s = require_session(authorization, "worker")
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM v1_access_log WHERE subject_hash = ? ORDER BY id DESC LIMIT 100", (s["phoneHash"],)).fetchall()
    return [{"at": r["at"], "actor": r["actor"], "action": r["action"], "shareId": r["share_id"]} for r in rows]


@router.get("/shared/{share_id}")
def shared_view(share_id: str) -> dict:
    """What the recipient sees. Every view is written to the worker's access log."""
    with db.connect() as conn:
        row = conn.execute("SELECT * FROM v1_shares WHERE id = ?", (share_id,)).fetchone()
        if not row:
            raise HTTPException(404, "This link does not exist.")
        if row["revoked_at"]:
            raise HTTPException(410, "The worker has withdrawn this access.")
        if datetime.fromisoformat(row["expires_at"]) < _now():
            raise HTTPException(410, "This link has expired.")
        _log(conn, row["subject_hash"], "viewed your shared history", row["recipient"], share_id)
    scope = json.loads(row["scope_json"])
    return {"id": share_id, "recipient": row["recipient"], "scope": scope, "expiresAt": row["expires_at"],
            **history(row["subject_hash"], scope)}


def reset() -> None:
    with db.connect() as conn:
        for table in ("v1_shares", "v1_access_log", "v1_sessions", "v1_otps"):
            conn.execute(f"DELETE FROM {table}")
