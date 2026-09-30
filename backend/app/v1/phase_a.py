"""Phase A endpoints: change orders, proof photos, milestones, the AI mediator and the IVR demo."""

from __future__ import annotations

import hashlib
import re
import secrets
import shutil

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import settings
from app.models import db
from app.services import audit
from app.v1 import milestones, store
from app.v1.amend import extract_delta, hash_amendment, verify_chain
from app.v1.mediator import REASONS, mediate as run_mediator
from app.v1.milestones import FlowError
from app.v1.seal import hash_agreement
from app.v1.store import Conflict

router = APIRouter(prefix="/v1", tags=["v1"])

MAX_PHOTO_BYTES = 5 * 1024 * 1024
SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def photos_dir():
    return settings.db_path.parent / "photos"


def _load(agreement_id: str) -> dict:
    a = store.get(agreement_id)
    if a is None:
        raise HTTPException(404, f"No agreement {agreement_id}.")
    return a


def _save(a: dict, actor: str) -> dict:
    try:
        return store.upsert(a, actor=actor)
    except Conflict as exc:
        raise HTTPException(409, str(exc)) from exc


# ---- A3: change orders and settlements ----

class ChangeExtractIn(BaseModel):
    transcript: list[dict]
    terms: dict = {}


@router.post("/amendments/extract")
def amendments_extract(body: ChangeExtractIn) -> dict:
    if not body.transcript:
        raise HTTPException(400, "Say what changed first.")
    return extract_delta(body.transcript)


class AmendmentIn(BaseModel):
    agreementId: str
    amendment: dict


@router.post("/amendments")
def amendments_store(body: AmendmentIn) -> dict:
    """Stores a sealed change order / settlement. The server re-hashes it and checks the chain."""
    a = _load(body.agreementId)
    am = body.amendment
    if not am.get("hash"):
        raise HTTPException(400, "Only a sealed change (both confirmed) is stored here.")
    if hash_amendment(am) != am["hash"]:
        raise HTTPException(409, "The change does not match its seal.")
    current = a.get("amendments") or []
    if any(x.get("id") == am.get("id") and x.get("hash") for x in current):
        if next(x for x in current if x.get("id") == am.get("id"))["hash"] == am["hash"]:
            return {"id": am["id"], "hash": am["hash"], "chain": verify_chain(a)}
        raise HTTPException(409, "A sealed change can never be edited.")
    a["amendments"] = ([x for x in current if x.get("hash")] + [am]
                       + [x for x in current if not x.get("hash") and x.get("id") != am.get("id")])
    saved = _save(a, actor="both parties")
    audit.log(actor="both parties", agreement_id=a["id"],
              note=f"{am.get('source', 'change')} {am['id']} sealed, chained to {str(am.get('parentHash'))[:12]}")
    return {"id": am["id"], "hash": am["hash"], "chain": verify_chain(saved)}


# ---- A2: proof-of-work photos ----

@router.post("/photos")
async def photos_upload(
    image: UploadFile = File(...),
    photoId: str = Form(...),
    agreementId: str = Form(...),
    milestoneId: str = Form(...),
    kind: str = Form(...),
    hash: str = Form(...),
) -> dict:
    if not SAFE_ID.match(photoId) or not SAFE_ID.match(milestoneId):
        raise HTTPException(400, "Bad photo or milestone id.")
    if kind not in ("before", "after"):
        raise HTTPException(400, "Kind is before or after.")
    if not HEX64.match(hash):
        raise HTTPException(400, "The photo hash must be a SHA-256 hex digest.")
    a = _load(agreementId)
    if not a.get("hash"):
        raise HTTPException(409, "Photos are added after both people have confirmed.")
    data = await image.read()
    if not data:
        raise HTTPException(400, "The photo is empty.")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "The photo is too large (5 MB max).")
    if not (data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n" or data[8:12] == b"WEBP"):
        raise HTTPException(415, "Only JPEG, PNG or WebP photos.")
    server_hash = hashlib.sha256(data).hexdigest()
    if server_hash != hash:
        raise HTTPException(409, "The photo's bytes do not match the hash the phone computed.")
    folder = photos_dir() / agreementId
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{photoId}.img"
    path.write_bytes(data)
    with db.connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO v1_photos (id, agreement_id, milestone_id, kind, hash, path, size, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (photoId, agreementId, milestoneId, kind, server_hash, str(path), len(data), db.now_iso()),
        )
    audit.log(actor="worker", agreement_id=agreementId, note=f"{kind} photo for {milestoneId}, sha256 {server_hash[:12]}")
    return {"id": photoId, "hash": server_hash, "url": f"/v1/photos/{photoId}"}


@router.get("/photos/{photo_id}")
def photos_get(photo_id: str) -> FileResponse:
    with db.connect() as conn:
        r = conn.execute("SELECT path FROM v1_photos WHERE id = ?", (photo_id,)).fetchone()
    if not r:
        raise HTTPException(404, "No such photo.")
    return FileResponse(r["path"], media_type="image/jpeg")


def clear_photos() -> None:
    shutil.rmtree(photos_dir(), ignore_errors=True)


# ---- A1: milestones ----

class MilestoneIn(BaseModel):
    agreementId: str
    photos: list[dict] = []
    reason: str = ""


@router.post("/milestones/{milestone_id}/{action}")
def milestone_action(milestone_id: str, action: str, body: MilestoneIn) -> dict:
    if action not in ("submit", "approve", "reject"):
        raise HTTPException(404, "Action is submit, approve or reject.")
    a = _load(body.agreementId)
    try:
        if action == "submit":
            if body.photos:
                a = milestones.add_photos(a, milestone_id, body.photos)
            a = milestones.submit(a, milestone_id)
        elif action == "approve":
            a = milestones.approve(a, milestone_id)
        else:
            a = milestones.reject(a, milestone_id, body.reason)
    except FlowError as exc:
        raise HTTPException(409, str(exc)) from exc
    return _save(a, actor="worker" if action == "submit" else "hirer")


# ---- A4: AI dispute mediator ----

class MediateIn(BaseModel):
    agreement: dict
    reason: str


@router.post("/mediate")
def mediate(body: MediateIn) -> dict:
    if body.reason not in REASONS:
        raise HTTPException(400, f"Reason is one of: {', '.join(REASONS)}.")
    a = body.agreement
    stored = store.stored_hash(a.get("id", ""))
    if not a.get("hash") or hash_agreement(a) != a["hash"] or (stored and stored != a["hash"]):
        raise HTTPException(409, "The mediator only reads a sealed, untouched record.")
    chain = verify_chain(a)
    if not chain["ok"]:
        raise HTTPException(409, f"The record's chain is broken at {chain['broken']}.")
    result = run_mediator(a, body.reason)
    audit.log(actor="system", agreement_id=a["id"], provider="mediator.rules",
              note=f"{body.reason}: pay {result['payToWorker']}, refund {result['refundToHirer']}")
    return result


# ---- A5: IVR (simulated call; Exotel / Twilio Voice would post the same webhook) ----

_CALLS: dict[str, dict] = {}
DIGIT_ACTIONS = {"1": "confirm", "2": "change", "9": "repeat"}


class IvrCallIn(BaseModel):
    agreementId: str
    role: str


@router.post("/ivr/call")
def ivr_call(body: IvrCallIn) -> dict:
    if body.role not in ("worker", "hirer"):
        raise HTTPException(400, "Role must be worker or hirer.")
    _load(body.agreementId)
    call_id = f"call-{secrets.token_hex(6)}"
    _CALLS[call_id] = {"agreementId": body.agreementId, "role": body.role}
    audit.log(actor="system", agreement_id=body.agreementId, provider="ivr.mock", note=f"IVR call to the {body.role} started")
    return {"callId": call_id}


class IvrWebhookIn(BaseModel):
    callId: str
    agreementId: str
    role: str
    digits: str


@router.post("/ivr/webhook")
def ivr_webhook(body: IvrWebhookIn) -> dict:
    call = _CALLS.get(body.callId)
    if not call or call["agreementId"] != body.agreementId or call["role"] != body.role:
        raise HTTPException(404, "Unknown call.")
    action = DIGIT_ACTIONS.get(body.digits.strip()[:1], "unknown")
    audit.log(actor=body.role, agreement_id=body.agreementId, provider="ivr.mock", note=f"IVR key {body.digits[:1]} -> {action}")
    return {"action": action}
