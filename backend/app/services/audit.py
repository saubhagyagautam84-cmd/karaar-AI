"""Append-only audit log: every state transition and every adapter call."""

from __future__ import annotations

from app.models import db


def log(
    *,
    actor: str,
    agreement_id: str | None = None,
    from_state: str | None = None,
    to_state: str | None = None,
    provider: str | None = None,
    note: str = "",
) -> None:
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO audit_log (agreement_id, actor, from_state, to_state, provider, note, at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (agreement_id, actor, from_state, to_state, provider, note, db.now_iso()),
        )


def for_agreement(agreement_id: str) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT actor, from_state, to_state, provider, note, at FROM audit_log"
            " WHERE agreement_id = ? ORDER BY id",
            (agreement_id,),
        ).fetchall()
    return [dict(r) for r in rows]
