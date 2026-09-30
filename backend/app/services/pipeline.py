"""Transcript -> draft AgreementTerms: extract, localise, enforce evidence, flag ambiguities."""

from __future__ import annotations

from datetime import date

from app.adapters import NotConfigured, get_adapter
from app.adapters.llm import ExtractionFailed
from app.schemas.agreement import AgreementTerms, Evidence, Parties, Party, Status, WorkerParty
from app.services import ambiguity, audit, rule_extractor
from app.services.rule_extractor import ExtractionResult

TRADES = {"painter", "plumber", "electrician", "carpenter", "domestic help", "driver"}


def _iso(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def extract(transcript: str, today: date, worker_lang: str, agreement_id: str) -> ExtractionResult:
    llm = get_adapter("llm")
    try:
        return llm.extract(transcript, today, worker_lang, agreement_id=agreement_id)
    except (ExtractionFailed, NotConfigured) as exc:
        # Demo reliability: never fail a draft because the network or a key is missing.
        audit.log(actor="system", agreement_id=agreement_id, provider="llm.mock",
                  note=f"fell back to rule engine: {exc}")
        return rule_extractor.extract(transcript, today)


def localise(terms: AgreementTerms) -> None:
    """Local-language fields follow the worker's language (Hindi, else English)."""
    if (terms.parties.worker.preferred_lang or "hi") == "hi":
        return
    terms.scope_local = terms.scope
    terms.conditions_local = list(terms.conditions)
    for a in terms.ambiguities:
        a.question_local = a.question_en


def build_terms(
    agreement_id: str,
    transcript: str,
    client: Party,
    worker: WorkerParty,
    audio_ref: str | None,
    today: date | None = None,
) -> AgreementTerms:
    today = today or date.today()
    result = extract(transcript, today, worker.preferred_lang or "hi", agreement_id)
    if not worker.trade and result.worker_trade in TRADES:
        worker.trade = result.worker_trade
    materials = result.materials_provided_by if result.materials_provided_by in ("client", "worker", "shared") else None
    terms = AgreementTerms(
        agreement_id=agreement_id,
        language_detected=result.language_detected or ["hi"],
        parties=Parties(client=client, worker=worker),
        scope=result.scope,
        scope_local=result.scope_local,
        price_inr=result.price_inr if (result.price_inr or 0) >= 0 else None,
        advance_inr=result.advance_inr if (result.advance_inr or 0) >= 0 else None,
        materials_provided_by=materials,
        start_date=_iso(result.start_date),
        deadline=_iso(result.deadline),
        conditions=result.conditions,
        conditions_local=result.conditions_local,
        ambiguities=result.ambiguities,
        evidence=[Evidence(field=e.field, quote=e.quote[:200]) for e in result.evidence],
        status=Status.DRAFT,
        audio_ref=audio_ref,
    )
    terms.ambiguities += ambiguity.enforce_evidence(terms, transcript)
    terms.ambiguities = ambiguity.detect(terms, transcript)
    localise(terms)
    return terms
