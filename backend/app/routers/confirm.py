"""Per-party confirmation links: /confirm/{token}."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.services import lifecycle, store, summary, work

router = APIRouter(prefix="/api/confirm", tags=["confirm"])


def _view(token: str) -> dict:
    conf = lifecycle.confirmation_by_token(token)
    agreement_id, role = conf["agreement_id"], conf["party_role"]
    record = store.load(agreement_id)
    terms = record.agreement
    party = getattr(terms.parties, role)
    lang = party.preferred_lang or ("hi" if role == "worker" else "en")
    others = [c for c in lifecycle._confirmations(agreement_id) if c["party_role"] != role]
    return {
        "agreement_id": agreement_id,
        "role": role,
        "lang": lang,
        "name": party.name,
        "status": terms.status.value,
        "summary": summary.summary_lines(terms, lang),
        "summary_en": summary.summary_lines(terms, "en") if lang != "en" else None,
        "agreement": terms.model_dump(mode="json"),
        "confirmed_at": conf["confirmed_at"],
        "other_confirmed": any(c["confirmed_at"] for c in others),
        "hash": terms.hash,
        # The worker's private link to their own record, shown only on their own confirm page.
        "worker_link": work.owner_link(agreement_id) if role == "worker" and conf["confirmed_at"] else None,
    }


@router.get("/{token}")
def get_confirmation(token: str) -> dict:
    return _view(token)


class DecisionIn(BaseModel):
    decision: str  # "yes" = Haan, pakka; "no" = Kuch galat hai
    note: str | None = None


@router.post("/{token}")
def decide(token: str, body: DecisionIn) -> dict:
    result = lifecycle.confirm(token, body.decision, body.note)
    if body.decision == "no":
        return {**result, "view": None}
    return {**result, "view": _view(token)}


@router.post("/{token}/erase")
def erase_my_data(token: str) -> dict:
    """ "Delete my data": the link is the person's own key to their part of the agreement."""
    from app.services import privacy_actions

    conf = lifecycle.confirmation_by_token(token)
    privacy_actions.erase_party(conf["agreement_id"], conf["party_role"])
    return {"erased": True}
