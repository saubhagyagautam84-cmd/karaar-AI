"""SQLite storage (mock mode). Tables follow Step 6 of the build doc.

Plain sqlite3 from the standard library: one short-lived connection per unit
of work. Swapping to Supabase/Postgres later only touches this module.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

from app.config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS agreements (
    id           TEXT PRIMARY KEY,
    terms_json   TEXT NOT NULL,
    status       TEXT NOT NULL,
    hash         TEXT,
    audio_ref    TEXT,
    audio_hash   TEXT,          -- SHA-256 of the recording, part of the final hash (Step 5)
    district     TEXT,
    trade        TEXT,
    is_seed      INTEGER NOT NULL DEFAULT 0,  -- synthetic rows for the dashboard (Phase 6)
    completed_at TEXT,
    erased_at    TEXT,          -- personal data removed on request (Step 7)
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parties (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    agreement_id       TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    role               TEXT NOT NULL CHECK (role IN ('client', 'worker')),
    name               TEXT,
    phone_hash         TEXT,    -- never the raw number
    lang               TEXT,
    verified           INTEGER NOT NULL DEFAULT 0,
    eshram_uan_masked  TEXT,
    worker_id          INTEGER,
    done_at            TEXT     -- when this party marked the work done
);

CREATE TABLE IF NOT EXISTS consents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    agreement_id  TEXT,
    party_role    TEXT NOT NULL CHECK (party_role IN ('client', 'worker')),
    consented_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS confirmations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    agreement_id  TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    party_role    TEXT NOT NULL CHECK (party_role IN ('client', 'worker')),
    token         TEXT NOT NULL UNIQUE,
    confirmed_at  TEXT,
    rejected_at   TEXT,
    note          TEXT
);

CREATE TABLE IF NOT EXISTS milestones (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    agreement_id  TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
    type          TEXT NOT NULL,
    amount_inr    INTEGER,
    proof_ref     TEXT,
    at            TEXT NOT NULL
);

-- No foreign key: audit rows outlive erased agreements (Step 7, right to erasure).
CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    agreement_id  TEXT,
    actor         TEXT NOT NULL,
    from_state    TEXT,
    to_state      TEXT,
    provider      TEXT,
    note          TEXT,
    at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT,
    trade             TEXT,
    phone_hash        TEXT UNIQUE,
    jobs_completed    INTEGER NOT NULL DEFAULT 0,
    on_time_rate      REAL,
    total_earned_inr  INTEGER NOT NULL DEFAULT 0,
    owner_token       TEXT UNIQUE,  -- the worker's private key to their own record
    eshram_uan_masked TEXT
);

CREATE TABLE IF NOT EXISTS share_links (
    token       TEXT PRIMARY KEY,
    worker_id   INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
);

-- Outgoing WhatsApp/SMS messages (the mock adapter's outbox, shown in the phone preview).
CREATE TABLE IF NOT EXISTS messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id    TEXT NOT NULL,
    agreement_id  TEXT,
    party_role    TEXT,
    to_masked     TEXT,
    channel       TEXT NOT NULL,
    body          TEXT NOT NULL,
    sent_at       TEXT NOT NULL
);

-- /v1 API (the Next.js frontend): agreements in the frontend's own shape.
-- data_json never holds a raw phone number: phones are masked, with the seal's phoneHash kept.
CREATE TABLE IF NOT EXISTS v1_agreements (
    id           TEXT PRIMARY KEY,
    data_json    TEXT NOT NULL,
    status       TEXT NOT NULL,
    hash         TEXT,          -- SHA-256 seal, set once both parties confirm; never changes after
    job_type     TEXT,
    state        TEXT,
    district     TEXT,
    trade        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

-- Proof-of-work photos (A2). The server re-computes each photo's SHA-256; bytes live on disk.
CREATE TABLE IF NOT EXISTS v1_photos (
    id              TEXT PRIMARY KEY,
    agreement_id    TEXT NOT NULL,
    milestone_id    TEXT NOT NULL,
    kind            TEXT NOT NULL,   -- before | after
    hash            TEXT NOT NULL,
    path            TEXT NOT NULL,
    size            INTEGER NOT NULL,
    created_at      TEXT NOT NULL
);

-- Phase B: phone OTP login. Only hashes of phone numbers and codes are stored.
CREATE TABLE IF NOT EXISTS v1_otps (
    phone_hash      TEXT PRIMARY KEY,
    code_hash       TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    window_start    TEXT NOT NULL,
    sent_in_window  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS v1_sessions (
    token_hash      TEXT PRIMARY KEY,
    phone_hash      TEXT NOT NULL,
    phone_masked    TEXT NOT NULL,
    role            TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL
);
-- Consent-based sharing of a worker's verified history, and every access to it.
CREATE TABLE IF NOT EXISTS v1_shares (
    id              TEXT PRIMARY KEY,
    subject_hash    TEXT NOT NULL,
    recipient       TEXT NOT NULL,
    scope_json      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    revoked_at      TEXT
);
CREATE TABLE IF NOT EXISTS v1_access_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_hash    TEXT NOT NULL,
    share_id        TEXT,
    actor           TEXT NOT NULL,
    action          TEXT NOT NULL,
    at              TEXT NOT NULL
);

-- Synthetic rows behind the governance dashboard (clearly labelled synthetic in the UI).
CREATE TABLE IF NOT EXISTS v1_seed (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    state           TEXT NOT NULL,
    district        TEXT NOT NULL,
    trade           TEXT NOT NULL,
    month           TEXT NOT NULL,   -- YYYY-MM
    daily_wage      INTEGER NOT NULL,
    completed       INTEGER NOT NULL,
    delay_days      REAL,
    on_time         INTEGER,
    disputed        INTEGER NOT NULL,
    dispute_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_v1_seed ON v1_seed(state, month);

CREATE INDEX IF NOT EXISTS idx_audit_agreement ON audit_log(agreement_id);
CREATE INDEX IF NOT EXISTS idx_parties_agreement ON parties(agreement_id);
"""

# Columns added after a table first shipped: (table, column, type). Older dev DBs get them on startup.
MIGRATIONS = [
    ("agreements", "audio_hash", "TEXT"),
    ("agreements", "is_seed", "INTEGER NOT NULL DEFAULT 0"),
    ("agreements", "completed_at", "TEXT"),
    ("agreements", "erased_at", "TEXT"),
    ("parties", "worker_id", "INTEGER"),
    ("parties", "done_at", "TEXT"),
    ("confirmations", "rejected_at", "TEXT"),
    ("confirmations", "note", "TEXT"),
    ("workers", "owner_token", "TEXT"),
    ("workers", "eshram_uan_masked", "TEXT"),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init_db() -> None:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    settings.recordings_dir.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA)
        for table, column, ctype in MIGRATIONS:
            existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ctype}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_agreements_seed ON agreements(is_seed)")


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
