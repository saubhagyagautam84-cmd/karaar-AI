from __future__ import annotations

import hashlib
import mimetypes
import re
from datetime import date, datetime
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.adapters import NotConfigured, get_adapter
from app.config import settings
from app.schemas.agreement import AgreementRecord, DraftResponse, Party, Status, WorkerParty
from app.services import audit, pipeline, store
from app.services.answers import AnswerError, apply_answer
from app.services.privacy import hash_phone, mask_phone
from app.services.samples import SAMPLES

router = APIRouter(prefix="/api/agreements", tags=["agreements"])

MAX_AUDIO_BYTES = 25 * 1024 * 1024
AUDIO_EXTS = {".webm", ".ogg", ".mp3", ".m4a", ".wav", ".mp4", ".aac", ".opus"}
LANGS = {"hi", "en"}


def _audio_ext(upload: UploadFile) -> str:
    ext = Path(upload.filename or "").suffix.lower()
    if ext in AUDIO_EXTS:
        return ext
    guessed = mimetypes.guess_extension((upload.content_type or "").split(";")[0].strip()) or ""
    return guessed if guessed in AUDIO_EXTS else ".webm"


def _consent(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat(timespec="seconds")
    except ValueError:
        return None


def _phone(raw: str | None, who: str) -> tuple[str | None, str | None]:
    """Returns (masked, hash). The raw number goes no further than this function."""
    if not raw or not raw.strip():
        return None, None
    if len(re.sub(r"\D", "", raw)) not in (10, 12):
        raise HTTPException(400, f"The {who}'s phone number should have 10 digits.")
    return mask_phone(raw), hash_phone(raw)


def get_record(agreement_id: str) -> AgreementRecord:
    record = store.load(agreement_id)
    if record is None:
        raise HTTPException(404, f"No agreement found with ID {agreement_id}.")
    return record


@router.get("/samples")
def list_samples() -> list[dict]:
    return [{"id": k, "title": v["title"], "text": v["text"]} for k, v in SAMPLES.items()]


@router.post("/draft", response_model=DraftResponse)
async def create_draft(
    audio: UploadFile | None = File(None),
    transcript: str | None = Form(None),
    sample: int | None = Form(None),
    client_name: str | None = Form(None),
    client_phone: str | None = Form(None),
    client_lang: str = Form("en"),
    worker_name: str | None = Form(None),
    worker_phone: str | None = Form(None),
    worker_lang: str = Form("hi"),
    worker_trade: str | None = Form(None),
    district: str | None = Form(None),
    client_consent_at: str | None = Form(None),
    worker_consent_at: str | None = Form(None),
) -> DraftResponse:
    consents = {"client": _consent(client_consent_at), "worker": _consent(worker_consent_at)}
    if not all(consents.values()):
        raise HTTPException(400, "Both people must tap 'I agree to record' before recording.")

    data = await audio.read() if audio else b""
    typed = (transcript or "").strip()
    if not data and not typed:
        raise HTTPException(400, "The recording is empty. Please record or choose the audio again.")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "The recording is too long. Please keep it under 25 MB.")
    if len(typed) > 10_000:
        raise HTTPException(413, "The conversation text is too long.")

    client_masked, client_hash = _phone(client_phone, "client")
    worker_masked, worker_hash = _phone(worker_phone, "worker")

    agreement_id = store.next_agreement_id()
    audio_ref = None
    if data:
        audio_ref = f"recordings/{agreement_id}{_audio_ext(audio)}"
        (settings.recordings_dir / Path(audio_ref).name).write_bytes(data)
        audio_hash = hashlib.sha256(data).hexdigest()
    else:
        audio_hash = hashlib.sha256(typed.encode()).hexdigest()

    if typed:
        text = typed
        audit.log(actor="system", agreement_id=agreement_id, note="conversation typed in, speech skipped")
    else:
        try:
            text = get_adapter("speech").transcribe(data, audio.filename or "", agreement_id=agreement_id,
                                                    sample=sample).text
        except NotConfigured as exc:
            raise HTTPException(503, str(exc)) from exc

    client = Party(name=(client_name or "").strip() or None, phone=client_masked,
                   preferred_lang=client_lang if client_lang in LANGS else "en")
    worker = WorkerParty(name=(worker_name or "").strip() or None, phone=worker_masked,
                         preferred_lang=worker_lang if worker_lang in LANGS else "hi",
                         trade=(worker_trade or "").strip().lower() or None)
    terms = pipeline.build_terms(agreement_id, text, client, worker, audio_ref)
    store.insert_agreement(
        terms, audio_hash, (district or settings.default_district).strip(),
        [store.PartyRow("client", client.name, client_hash, client.preferred_lang),
         store.PartyRow("worker", worker.name, worker_hash, worker.preferred_lang)],
        consents,
    )
    audit.log(actor="system", agreement_id=agreement_id, to_state=Status.DRAFT.value,
              note=f"draft created, {len(terms.ambiguities)} open questions")
    return DraftResponse(agreement=terms, transcript=text, providers=settings.providers)


@router.get("/{agreement_id}", response_model=AgreementRecord)
def get_agreement(agreement_id: str) -> AgreementRecord:
    return get_record(agreement_id)


@router.get("/{agreement_id}/audit")
def get_audit(agreement_id: str) -> list[dict]:
    get_record(agreement_id)
    return audit.for_agreement(agreement_id)


class AnswerIn(BaseModel):
    field: str
    question_en: str | None = None
    answer: str
    by: str = "client"


@router.post("/{agreement_id}/answers", response_model=AgreementRecord)
def answer_question(agreement_id: str, body: AnswerIn) -> AgreementRecord:
    from app.services import lifecycle  # Phase 3: editing after SENT resets to DRAFT

    terms = get_record(agreement_id).agreement
    try:
        apply_answer(terms, body.field, body.question_en, body.answer, date.today())
    except AnswerError as exc:
        raise HTTPException(422, str(exc)) from exc
    pipeline.localise(terms)
    lifecycle.save_edit(terms, actor=body.by if body.by in ("client", "worker") else "client",
                        note=f"answered: {body.field}")
    return get_record(agreement_id)


class SendIn(BaseModel):
    by: str = "client"
    # Optional, for real WhatsApp delivery: used once, checked against the stored hash, never stored.
    client_phone: str | None = None
    worker_phone: str | None = None


@router.post("/{agreement_id}/send")
def send_for_confirmation(agreement_id: str, body: SendIn | None = None) -> dict:
    from app.services import lifecycle

    body = body or SendIn()
    get_record(agreement_id)
    return lifecycle.send(agreement_id, actor=body.by,
                          phones={"client": body.client_phone, "worker": body.worker_phone})


@router.get("/{agreement_id}/verify")
def verify(agreement_id: str) -> dict:
    from app.services import lifecycle

    get_record(agreement_id)
    return lifecycle.verification(agreement_id)


@router.get("/{agreement_id}/messages")
def messages(agreement_id: str) -> list[dict]:
    from app.adapters.notify import outbox

    # Demo phone preview only: a real deployment delivers messages and does not expose them.
    if settings.providers["notify"] != "mock":
        raise HTTPException(404, "Message preview is only available in mock mode.")
    get_record(agreement_id)
    return [m.model_dump() for m in outbox(agreement_id)]


# ------------------------------------------------------------------ Phase 5: payments and work

class PayIn(BaseModel):
    payee_vpa: str = ""
    by: str = "client"


@router.post("/{agreement_id}/payments/{purpose}/intent")
def payment_intent(agreement_id: str, purpose: str, body: PayIn) -> dict:
    from app.services import work

    get_record(agreement_id)
    if purpose not in ("advance", "final"):
        raise HTTPException(404, "Unknown payment.")
    return work.payment_intent(agreement_id, purpose, body.payee_vpa)


@router.post("/{agreement_id}/payments/{purpose}/confirm")
def payment_confirm(agreement_id: str, purpose: str, body: PayIn | None = None) -> dict:
    """In mock mode this is the "Simulate payment" button."""
    from app.services import work

    get_record(agreement_id)
    if purpose not in ("advance", "final"):
        raise HTTPException(404, "Unknown payment.")
    return work.confirm_payment(agreement_id, purpose, actor=(body.by if body else "client"))


class ActorIn(BaseModel):
    by: str = "worker"


@router.post("/{agreement_id}/start")
def start_work(agreement_id: str, body: ActorIn | None = None) -> dict:
    from app.services import work

    get_record(agreement_id)
    return work.start_work(agreement_id, actor=(body.by if body else "worker"))


MAX_PHOTO_BYTES = 8 * 1024 * 1024


@router.post("/{agreement_id}/done")
async def mark_done(agreement_id: str, party: str = Form(...), photo: UploadFile | None = File(None)) -> dict:
    from app.services import work

    get_record(agreement_id)
    if party not in ("client", "worker"):
        raise HTTPException(400, "Party must be client or worker.")
    proof_ref = None
    if photo is not None:
        data = await photo.read()
        if len(data) > MAX_PHOTO_BYTES:
            raise HTTPException(413, "The photo is too large. Please keep it under 8 MB.")
        if data:
            ext = Path(photo.filename or "").suffix.lower() if Path(photo.filename or "").suffix.lower() in (
                ".jpg", ".jpeg", ".png", ".webp", ".heic") else ".jpg"
            proof_ref = f"recordings/{agreement_id}-done-{party}{ext}"
            (settings.recordings_dir / Path(proof_ref).name).write_bytes(data)
    return work.mark_done(agreement_id, party, proof_ref)


@router.get("/{agreement_id}/milestones")
def get_milestones(agreement_id: str) -> list[dict]:
    from app.services import work

    get_record(agreement_id)
    return work.milestones(agreement_id)


# ------------------------------------------------------------------ Phase 7: disputes

class DisputeIn(BaseModel):
    party: str
    reason: str


@router.post("/{agreement_id}/dispute")
def raise_dispute(agreement_id: str, body: DisputeIn) -> dict:
    from app.services import disputes

    get_record(agreement_id)
    if body.party not in ("client", "worker"):
        raise HTTPException(400, "Party must be client or worker.")
    return disputes.raise_dispute(agreement_id, body.party, body.reason)


class SettleIn(BaseModel):
    by: str = "client"
    note: str = ""


@router.post("/{agreement_id}/dispute/{outcome}")
def settle_dispute(agreement_id: str, outcome: str, body: SettleIn | None = None) -> dict:
    from app.services import disputes

    get_record(agreement_id)
    if outcome not in ("resolve", "escalate"):
        raise HTTPException(404, "Unknown outcome.")
    body = body or SettleIn()
    return disputes.settle(agreement_id, outcome, body.by, body.note)


@router.get("/{agreement_id}/dispute.pdf")
def dispute_pdf(agreement_id: str) -> Response:
    from app.services import disputes

    get_record(agreement_id)
    data, filename = disputes.dispute_pdf(agreement_id)
    return Response(data, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{filename}"'})
