"""Right to erasure (Step 7 rule 5) and the demo reset.

Erasure removes personal fields and audio but keeps the anonymised numbers the
dashboard counts (trade, district, price, status, dates).
"""

from __future__ import annotations

from pathlib import Path

from app.config import settings
from app.models import db
from app.services import audit, store


def erase_party(agreement_id: str, role: str) -> None:
    r = store.row(agreement_id)
    if r is None:
        return
    terms = store.terms_from_row(r)
    party = getattr(terms.parties, role)
    party.name = None
    party.phone = None
    # Audio holds both voices, so either person's request removes it.
    if terms.audio_ref:
        (settings.recordings_dir / Path(terms.audio_ref).name).unlink(missing_ok=True)
        terms.audio_ref = None
    # Evidence quotes are the people's own words: remove them too.
    terms.evidence = []
    with db.connect() as conn:
        conn.execute("UPDATE parties SET name = NULL, phone_hash = NULL WHERE agreement_id = ? AND role = ?",
                     (agreement_id, role))
        conn.execute("UPDATE messages SET body = '[erased on request]', to_masked = '' WHERE agreement_id = ?"
                     " AND party_role = ?", (agreement_id, role))
        # erased_at retires the fingerprint: the stored terms no longer match it, by design.
        conn.execute("UPDATE agreements SET terms_json = ?, erased_at = ?, updated_at = ? WHERE id = ?",
                     (terms.model_dump_json(), db.now_iso(), db.now_iso(), agreement_id))
    for f in settings.recordings_dir.glob(f"{agreement_id}-done-{role}.*"):
        f.unlink(missing_ok=True)
    audit.log(actor=role, agreement_id=agreement_id,
              note=f"{role} erased their personal data; audio removed; anonymised counts kept")


def erase_worker(worker_id: int) -> None:
    with db.connect() as conn:
        conn.execute("UPDATE workers SET name = NULL, phone_hash = NULL, eshram_uan_masked = NULL,"
                     " owner_token = NULL WHERE id = ?", (worker_id,))
        conn.execute("DELETE FROM share_links WHERE worker_id = ?", (worker_id,))
        conn.execute("UPDATE parties SET name = NULL, phone_hash = NULL WHERE worker_id = ?", (worker_id,))
    audit.log(actor="worker", note=f"worker {worker_id} erased their record; anonymised counts kept")


def reset_demo() -> dict:
    """Delete everything except the synthetic dashboard rows."""
    with db.connect() as conn:
        ids = [r["id"] for r in conn.execute("SELECT id FROM agreements WHERE is_seed = 0")]
        conn.execute("DELETE FROM confirmations")
        conn.execute("DELETE FROM consents")
        conn.execute("DELETE FROM messages")
        conn.execute("DELETE FROM share_links")
        conn.execute("DELETE FROM milestones WHERE agreement_id IN (SELECT id FROM agreements WHERE is_seed = 0)")
        conn.execute("DELETE FROM parties")
        conn.execute("DELETE FROM workers")
        conn.execute("DELETE FROM audit_log")
        conn.execute("DELETE FROM agreements WHERE is_seed = 0")
    for f in settings.recordings_dir.glob("*"):
        if f.name != ".gitkeep":
            f.unlink(missing_ok=True)
    return {"removed_agreements": len(ids)}
