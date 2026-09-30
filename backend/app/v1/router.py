"""The /v1 contract the Next.js frontend calls in live mode (NEXT_PUBLIC_API_URL set)."""

from __future__ import annotations

import re

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.adapters import NotConfigured, get_adapter
from app.config import settings
from app.services import audit
from app.v1 import analytics, milestones, store
from app.v1.amend import effective_terms, paid_total, total_payable
from app.v1.extract import extract as extract_terms
from app.v1.store import Conflict

router = APIRouter(prefix="/v1", tags=["v1"])

MAX_AUDIO_BYTES = 25 * 1024 * 1024
DEMO_SAMPLE = 5  # the frontend's demo conversation (lib/sample.ts)
DEMO_TIMES = [0, 6, 12, 15, 20, 27, 32, 35, 40, 42]
_SPEAKER = re.compile(r"^\s*(client|hirer|customer|grahak|worker|karigar|mistri)\s*[:：]\s*(.+)$", re.IGNORECASE)


def _conflict(exc: Conflict) -> HTTPException:
    return HTTPException(409, str(exc))


def to_segments(text: str) -> list[dict]:
    """'Client: …' / 'Worker: …' lines -> Segment[]; unlabelled lines alternate hirer/worker."""
    segs: list[dict] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = _SPEAKER.match(line)
        if m:
            speaker = "worker" if m.group(1).lower() in ("worker", "karigar", "mistri") else "hirer"
            body = m.group(2).strip()
        else:
            speaker = "worker" if len(segs) % 2 else "hirer"
            body = line
        segs.append({"speaker": speaker, "text": body, "t": len(segs) * 5})
    if len(segs) == len(DEMO_TIMES):
        for seg, t in zip(segs, DEMO_TIMES):
            seg["t"] = t
    return segs


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "providers": settings.providers,
            "simulated": sorted(k for k, v in settings.providers.items() if v == "mock"),
            "demoMode": settings.demo_mode}


@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...), lang: str = Form("hinglish")) -> dict:
    data = await audio.read()
    if not data:
        raise HTTPException(400, "The recording is empty. Please record again.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "The recording is too long. Please keep it under 25 MB.")
    try:
        result = get_adapter("speech").transcribe(data, audio.filename or "deal.webm", sample=DEMO_SAMPLE)
    except NotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"segments": to_segments(result.text), "lang": lang}


class Segment(BaseModel):
    speaker: str
    text: str
    t: float = 0


class ExtractIn(BaseModel):
    transcript: list[Segment]
    hints: dict = {}


@router.post("/extract")
def extract(body: ExtractIn) -> dict:
    if not body.transcript:
        raise HTTPException(400, "The conversation is empty.")
    segs = [s.model_dump() for s in body.transcript]
    for s in segs:
        s["t"] = int(s["t"]) if float(s["t"]).is_integer() else s["t"]
    result = extract_terms(segs, body.hints)
    audit.log(actor="system", provider=f"llm.{settings.providers['llm']}",
              note=f"v1 extract: {len(result['flags'])} gaps flagged")
    return result


class NotifyIn(BaseModel):
    agreementId: str
    role: str
    text: str
    phone: str | None = None  # used for this one send only; never stored


@router.post("/notify/whatsapp")
def notify(body: NotifyIn) -> dict:
    if body.role not in ("worker", "hirer"):
        raise HTTPException(400, "Role must be worker or hirer.")
    stored = store.get(body.agreementId) or {}
    masked = (stored.get(body.role) or {}).get("phone") or (store.mask_phone(body.phone) if body.phone else None)
    try:
        msg = get_adapter("notify").send(masked, body.text, agreement_id=body.agreementId, party_role=body.role,
                                         to_phone=body.phone)
    except NotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"messageId": msg.message_id}


@router.get("/agreements")
def list_agreements() -> list[dict]:
    return store.list_all()


@router.get("/agreements/{agreement_id}")
def get_agreement(agreement_id: str) -> dict:
    a = store.get(agreement_id)
    if a is None:
        raise HTTPException(404, f"No agreement {agreement_id}.")
    return a


@router.put("/agreements/{agreement_id}")
def put_agreement(agreement_id: str, body: dict) -> dict:
    if body.get("id") != agreement_id:
        raise HTTPException(400, "The agreement ID in the body does not match the URL.")
    try:
        return store.upsert(body)
    except Conflict as exc:
        raise _conflict(exc) from exc


class SealIn(BaseModel):
    hash: str
    agreement: dict | None = None


@router.post("/agreements/{agreement_id}/seal")
def seal(agreement_id: str, body: SealIn) -> JSONResponse:
    a = body.agreement or store.get(agreement_id)
    if a is None:
        raise HTTPException(404, f"No agreement {agreement_id}.")
    if a.get("id") != agreement_id or a.get("hash") != body.hash:
        raise HTTPException(400, "The seal does not belong to this agreement.")
    try:
        saved = store.upsert(a, actor="both parties")
    except Conflict as exc:
        raise _conflict(exc) from exc
    try:
        get_adapter("digilocker").issue(agreement_id, body.hash, saved["worker"].get("phone", ""))
    except NotConfigured:
        pass
    return JSONResponse({"id": agreement_id, "hash": body.hash, "sealed": True})


@router.get("/agreements/{agreement_id}/verify")
def verify(agreement_id: str) -> dict:
    try:
        return store.verify(agreement_id)
    except KeyError as exc:
        raise HTTPException(404, f"No agreement {agreement_id}.") from exc


PAYMENT_REF = re.compile(r"^(KR-\d{3,8})-(advance|balance|settlement|milestone-([A-Za-z0-9_.-]{1,40}))$")


def _amount_due(a: dict, kind: str, milestone_id: str | None) -> int:
    """What the hirer owes for this reference, from the server's own copy of the record."""
    status = a.get("status")
    if status not in store.SEALED_STATUSES:
        raise HTTPException(409, "Payments open once both people have confirmed.")
    t = effective_terms(a)
    if kind == "settlement":
        d = a.get("dispute") or {}
        m = d.get("mediation") or {}
        if status != "disputed" or d.get("outcome") != "settled":
            raise HTTPException(409, "A settlement is paid only after both accept it.")
        return m.get("refundToHirer") or m.get("payToWorker") or 0
    if status == "disputed":
        raise HTTPException(409, "Payments pause while a dispute is open.")
    if kind == "advance":
        return t.get("advance") or 0
    if kind == "balance":
        return max(total_payable(a) - paid_total(a), 0)
    try:
        return milestones.amount_due(a, milestone_id or "")
    except milestones.FlowError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/payments/{ref}")
def payment(ref: str) -> dict:
    m = PAYMENT_REF.match(ref)
    if not m:
        raise HTTPException(400, "Payment reference looks like KR-4821-advance or KR-4821-milestone-m1.")
    agreement_id, kind, milestone_id = m.group(1), m.group(2), m.group(3)
    kind = "milestone" if milestone_id else kind
    a = store.get(agreement_id)
    if a is None:
        raise HTTPException(404, f"No agreement {agreement_id}.")
    amount = _amount_due(a, kind, milestone_id)
    try:
        result = get_adapter("payment").check_status(agreement_id, amount)
    except NotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    if result.status != "SUCCESS":
        raise HTTPException(409, "Payment not confirmed yet.")
    audit.log(actor="hirer", agreement_id=agreement_id, provider=f"payment.{settings.providers['payment']}",
              note=f"{kind}{' ' + milestone_id if milestone_id else ''} Rs {amount} confirmed, UPI ref {result.txn_ref}")
    return {"upiRef": result.txn_ref, "amount": amount}


@router.get("/analytics")
def dashboard(state: str = "Delhi", trade: str = "All trades", months: int = 12) -> dict:
    if state not in analytics.seed.STATES:
        raise HTTPException(400, f"Unknown state {state!r}.")
    if months not in (3, 6, 12):
        raise HTTPException(400, "Period is 3, 6 or 12 months.")
    return analytics.dashboard(state, trade, months)


@router.post("/demo/reset")
def reset() -> dict:
    if not settings.demo_mode:
        raise HTTPException(404, "Demo reset is only available when DEMO_MODE=true.")
    from app.v1 import phase_b
    from app.v1.phase_a import clear_photos

    clear_photos()
    phase_b.reset()
    return {"removed": store.reset()}
