"""Reading and writing agreements and their parties."""

from __future__ import annotations

import json
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import date

from app.config import settings
from app.models import db
from app.schemas.agreement import AgreementRecord, AgreementTerms, Status


@dataclass
class PartyRow:
    role: str
    name: str | None
    phone_hash: str | None
    lang: str | None
    worker_id: int | None = None


def next_agreement_id(today: date | None = None) -> str:
    year = (today or date.today()).year
    prefix = f"KA-{year}-{settings.id_region}-"
    with db.connect() as conn:
        row = conn.execute(
            "SELECT id FROM agreements WHERE id LIKE ? ORDER BY id DESC LIMIT 1", (prefix + "%",)
        ).fetchone()
    seq = int(row["id"].rsplit("-", 1)[1]) + 1 if row else 1
    return f"{prefix}{seq:05d}"


def find_or_create_worker(conn: sqlite3.Connection, name: str | None, trade: str | None,
                          phone_hash: str | None) -> int:
    if phone_hash:
        row = conn.execute("SELECT id FROM workers WHERE phone_hash = ?", (phone_hash,)).fetchone()
        if row:
            conn.execute("UPDATE workers SET name = COALESCE(?, name), trade = COALESCE(trade, ?) WHERE id = ?",
                         (name, trade, row["id"]))
            return row["id"]
    cur = conn.execute(
        "INSERT INTO workers (name, trade, phone_hash, owner_token) VALUES (?, ?, ?, ?)",
        (name, trade, phone_hash, secrets.token_urlsafe(16)),
    )
    return int(cur.lastrowid)


def insert_agreement(terms: AgreementTerms, audio_hash: str, district: str,
                     parties: list[PartyRow], consents: dict[str, str]) -> None:
    now = db.now_iso()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO agreements (id, terms_json, status, hash, audio_ref, audio_hash, district, trade,"
            " created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)",
            (terms.agreement_id, terms.model_dump_json(), terms.status.value, terms.audio_ref, audio_hash,
             district, terms.parties.worker.trade, now, now),
        )
        for p in parties:
            if p.role == "worker":
                p.worker_id = find_or_create_worker(conn, p.name, terms.parties.worker.trade, p.phone_hash)
            conn.execute(
                "INSERT INTO parties (agreement_id, role, name, phone_hash, lang, verified, worker_id)"
                " VALUES (?, ?, ?, ?, ?, 0, ?)",
                (terms.agreement_id, p.role, p.name, p.phone_hash, p.lang, p.worker_id),
            )
        for role, at in consents.items():
            conn.execute("INSERT INTO consents (agreement_id, party_role, consented_at) VALUES (?, ?, ?)",
                         (terms.agreement_id, role, at))


def row(agreement_id: str) -> sqlite3.Row | None:
    with db.connect() as conn:
        return conn.execute("SELECT * FROM agreements WHERE id = ? AND is_seed = 0", (agreement_id,)).fetchone()


def terms_from_row(r: sqlite3.Row) -> AgreementTerms:
    terms = AgreementTerms.model_validate(json.loads(r["terms_json"]))
    # The row's status/hash columns are authoritative over the JSON copy.
    terms.status = Status(r["status"])
    terms.hash = r["hash"]
    return terms


def load(agreement_id: str) -> AgreementRecord | None:
    r = row(agreement_id)
    if r is None:
        return None
    return AgreementRecord(agreement=terms_from_row(r), created_at=r["created_at"], updated_at=r["updated_at"])


def save(terms: AgreementTerms, *, hash_value: str | None = None, completed_at: str | None = None) -> None:
    """Write terms + status (and the hash when it is set)."""
    with db.connect() as conn:
        conn.execute(
            "UPDATE agreements SET terms_json = ?, status = ?, hash = ?, trade = ?, updated_at = ?,"
            " completed_at = COALESCE(?, completed_at) WHERE id = ?",
            (terms.model_dump_json(), terms.status.value, hash_value, terms.parties.worker.trade,
             db.now_iso(), completed_at, terms.agreement_id),
        )


def party_rows(agreement_id: str) -> dict[str, sqlite3.Row]:
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM parties WHERE agreement_id = ?", (agreement_id,)).fetchall()
    return {r["role"]: r for r in rows}
