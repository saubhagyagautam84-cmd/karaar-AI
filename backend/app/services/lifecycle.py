"""Agreement lifecycle on top of the pure state machine: persistence, audit, hashing, notifications."""

from __future__ import annotations

import hashlib
import json
import secrets

from app.adapters import NotConfigured, get_adapter
from app.config import settings
from app.models import db
from app.schemas.agreement import AgreementTerms, Ambiguity, Status
from app.services import audit, store, summary
from app.services.privacy import hash_phone
from app.services.state_machine import AgreementStateMachine, InvalidTransition

ROLE_HI = {"client": "ग्राहक", "worker": "कारीगर"}


class NotFound(LookupError):
    pass


# ------------------------------------------------------------------ helpers

def _confirmations(agreement_id: str) -> list[dict]:
    with db.connect() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM confirmations WHERE agreement_id = ? ORDER BY id", (agreement_id,))]


def machine_for(agreement_id: str) -> tuple[AgreementStateMachine, AgreementTerms]:
    r = store.row(agreement_id)
    if r is None:
        raise NotFound(agreement_id)
    terms = store.terms_from_row(r)
    confirmed = {c["party_role"] for c in _confirmations(agreement_id) if c["confirmed_at"]}
    done = {role for role, p in store.party_rows(agreement_id).items() if p["done_at"]}
    return AgreementStateMachine(status=terms.status, confirmed=confirmed, done=done,
                                 has_advance=(terms.advance_inr or 0) > 0), terms


def _record(agreement_id: str, actor: str, move: tuple[Status, Status], note: str = "",
            provider: str | None = None) -> None:
    before, after = move
    audit.log(actor=actor, agreement_id=agreement_id, from_state=before.value, to_state=after.value,
              provider=provider, note=note)


# ------------------------------------------------------------------ hashing

def canonical_payload(terms: AgreementTerms, audio_hash: str, confirmations: dict[str, str]) -> dict:
    """Everything the fingerprint covers: terms (minus status/hash), audio hash, both confirmation times."""
    return {
        "terms": terms.model_dump(mode="json", exclude={"status", "hash"}),
        "audio_sha256": audio_hash,
        "confirmations": confirmations,
    }


def canonical_json(payload: dict) -> str:
    # The browser's verify page reproduces exactly this: sorted keys, no spaces, raw UTF-8.
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_hash(payload: dict) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def _confirmation_times(agreement_id: str) -> dict[str, str]:
    return {c["party_role"]: c["confirmed_at"] for c in _confirmations(agreement_id) if c["confirmed_at"]}


def verification(agreement_id: str) -> dict:
    r = store.row(agreement_id)
    if r is None:
        raise NotFound(agreement_id)
    terms = store.terms_from_row(r)
    if not r["hash"]:
        return {"agreement_id": agreement_id, "status": terms.status.value, "hashed": False,
                "stored_hash": None, "payload": None, "recomputed_hash": None, "valid": None, "erased_at": None}
    if r["erased_at"]:
        return {"agreement_id": agreement_id, "status": terms.status.value, "hashed": True,
                "stored_hash": r["hash"], "payload": None, "recomputed_hash": None, "valid": None,
                "erased_at": r["erased_at"]}
    payload = canonical_payload(terms, r["audio_hash"], _confirmation_times(agreement_id))
    recomputed = compute_hash(payload)
    return {"agreement_id": agreement_id, "status": terms.status.value, "hashed": True,
            "stored_hash": r["hash"], "payload": payload, "recomputed_hash": recomputed,
            "valid": recomputed == r["hash"], "erased_at": None}


# ------------------------------------------------------------------ editing

def save_edit(terms: AgreementTerms, actor: str, note: str) -> None:
    """Terms changed. DRAFT stays DRAFT; SENT / CONFIRMED_BY_ONE reset to DRAFT; frozen -> 409."""
    machine, _ = machine_for(terms.agreement_id)
    move = machine.edit()
    terms.status = machine.status
    if move[0] != move[1]:
        with db.connect() as conn:
            conn.execute("DELETE FROM confirmations WHERE agreement_id = ?", (terms.agreement_id,))
        _record(terms.agreement_id, actor, move, f"{note}; terms changed, both confirmations reset")
    else:
        audit.log(actor=actor, agreement_id=terms.agreement_id, note=note)
    store.save(terms)


# ------------------------------------------------------------------ sending

def _verify_phone(agreement_id: str, role: str, raw: str | None) -> str | None:
    """A raw number given at send time is used for delivery only, and must match the stored hash."""
    if not raw:
        return None
    stored = store.party_rows(agreement_id)[role]["phone_hash"]
    if stored and hash_phone(raw) != stored:
        raise InvalidTransition(f"That is not the {role}'s number recorded for this agreement.")
    return raw


def send(agreement_id: str, actor: str = "client", phones: dict[str, str | None] | None = None) -> dict:
    machine, terms = machine_for(agreement_id)
    move = machine.send()
    terms.status = machine.status
    with db.connect() as conn:
        conn.execute("DELETE FROM confirmations WHERE agreement_id = ?", (agreement_id,))
        links = []
        for role in ("client", "worker"):
            token = secrets.token_urlsafe(16)
            conn.execute("INSERT INTO confirmations (agreement_id, party_role, token) VALUES (?, ?, ?)",
                         (agreement_id, role, token))
            links.append({"role": role, "token": token, "url": f"{settings.public_base_url}/confirm/{token}"})
    store.save(terms)
    _record(agreement_id, actor, move, "sent to both parties for confirmation")

    notifier = get_adapter("notify")
    messages = []
    for link in links:
        role = link["role"]
        party = getattr(terms.parties, role)
        lang = party.preferred_lang or ("hi" if role == "worker" else "en")
        body = summary.confirm_message(terms, role, lang, link["url"])
        raw = _verify_phone(agreement_id, role, (phones or {}).get(role))
        try:
            msg = notifier.send(party.phone, body, agreement_id=agreement_id, party_role=role, to_phone=raw)
            messages.append(msg.model_dump())
        except NotConfigured as exc:
            audit.log(actor="system", agreement_id=agreement_id, provider=notifier.name, note=f"not sent: {exc}")
    return {"status": terms.status.value, "links": links, "messages": messages}


# ------------------------------------------------------------------ confirming

def confirmation_by_token(token: str) -> dict:
    with db.connect() as conn:
        r = conn.execute("SELECT * FROM confirmations WHERE token = ?", (token,)).fetchone()
    if r is None:
        raise NotFound(token)
    return dict(r)


def confirm(token: str, decision: str, note: str | None = None) -> dict:
    conf = confirmation_by_token(token)
    agreement_id, role = conf["agreement_id"], conf["party_role"]
    machine, terms = machine_for(agreement_id)
    now = db.now_iso()

    if decision == "no":
        move = machine.edit()  # raises if already frozen
        terms.status = machine.status
        note = (note or "").strip() or "no details given"
        who = role.title()
        terms.ambiguities.append(Ambiguity(
            field="correction",
            question_en=f"{who} said something is wrong: “{note}”. What should be changed?",
            question_local=f"{ROLE_HI[role]} ने कहा कुछ ग़लत है: “{note}”। क्या बदलना है?",
        ))
        with db.connect() as conn:
            conn.execute("DELETE FROM confirmations WHERE agreement_id = ?", (agreement_id,))
        store.save(terms)
        _record(agreement_id, role, move, f"'Kuch galat hai': {note}")
        return {"status": terms.status.value, "role": role}

    if decision != "yes":
        raise InvalidTransition("Decision must be 'yes' or 'no'.")
    move = machine.confirm(role)
    terms.status = machine.status
    with db.connect() as conn:
        conn.execute("UPDATE confirmations SET confirmed_at = ? WHERE token = ?", (now, token))
    hash_value = None
    if machine.status == Status.CONFIRMED_BY_BOTH:
        payload = canonical_payload(terms, store.row(agreement_id)["audio_hash"], _confirmation_times(agreement_id))
        hash_value = compute_hash(payload)
        terms.hash = hash_value
    store.save(terms, hash_value=hash_value)
    _record(agreement_id, role, move, "'Haan, pakka'" + (f"; record frozen, {hash_value}" if hash_value else ""))

    if hash_value:
        _on_both_confirmed(terms, hash_value)
    return {"status": terms.status.value, "role": role, "hash": hash_value}


def _on_both_confirmed(terms: AgreementTerms, hash_value: str) -> None:
    worker = terms.parties.worker
    try:
        get_adapter("digilocker").issue(terms.agreement_id, hash_value, worker.phone or "")
    except NotConfigured:
        pass
    notifier = get_adapter("notify")
    url = f"{settings.public_base_url}/verify/{terms.agreement_id}"
    for role in ("client", "worker"):
        party = getattr(terms.parties, role)
        lang = party.preferred_lang or ("hi" if role == "worker" else "en")
        try:
            notifier.send(party.phone, summary.pakka_message(terms, lang, url),
                          agreement_id=terms.agreement_id, party_role=role)
        except NotConfigured:
            pass
