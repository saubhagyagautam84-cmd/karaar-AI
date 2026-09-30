"""Server-side copy of every agreement the frontend creates.

- Raw phone numbers never reach the database: each party keeps a masked number and the
  seal's phoneHash.
- Once sealed, the terms are frozen: any later write must re-hash to the stored seal,
  otherwise it is refused (HTTP 409). Payments, status and events stay editable.
"""

from __future__ import annotations

import json
import re

from app.models import db
from app.services import audit
from app.v1.amend import hash_amendment, milestone_problem, verify_chain
from app.v1.seal import hash_agreement, phone_hash

STATUSES = ("review", "awaiting_confirmation", "sealed", "advance_paid", "completed", "disputed")
SEALED_STATUSES = ("sealed", "advance_paid", "completed", "disputed")
ID_RE = re.compile(r"^KR-\d{3,8}$")

TRADE_OF_JOB = {
    "Painting": "Painter", "Plumbing": "Plumber", "Electrical": "Electrician", "Carpentry": "Carpenter",
    "Domestic work": "Domestic worker", "Driving": "Driver",
}
STATE_HINTS = [
    ("Delhi", r"delhi|lajpat|jangpura|kalkaji|defence colony|saket|dwarka|rohini|noida"),
    ("Maharashtra", r"mumbai|pune|thane|nagpur|nashik|aurangabad"),
    ("Karnataka", r"bengaluru|bangalore|mysuru|mysore|mangaluru|hubballi|belagavi"),
]
DISTRICT_HINTS = [
    ("South Delhi", r"lajpat|kalkaji|defence colony|saket|jangpura|south delhi"),
    ("New Delhi", r"new delhi|connaught|chanakyapuri"),
    ("West Delhi", r"janakpuri|rajouri|west delhi|dwarka"),
    ("East Delhi", r"laxmi nagar|preet vihar|east delhi"),
    ("North West Delhi", r"rohini|pitampura|north west delhi"),
    ("Shahdara", r"shahdara"),
    ("North East Delhi", r"north east delhi|seelampur"),
]


class Conflict(ValueError):
    """Maps to HTTP 409."""


def _match(table: list[tuple[str, str]], text: str) -> str | None:
    return next((name for name, pattern in table if re.search(pattern, text or "", re.IGNORECASE)), None)


def mask_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    return f"xxxxxx{digits[-4:]}" if len(digits) >= 4 else "xxxx"


def _scrub_parties(a: dict) -> None:
    """Replace raw numbers by masked ones; keep the hash the seal is computed over."""
    for role in ("worker", "hirer"):
        p = a.get(role) or {}
        phone = p.get("phone") or ""
        if not p.get("phoneHash"):
            if phone.startswith("xxxx"):
                raise Conflict(f"The {role}'s phone hash is missing.")
            p["phoneHash"] = phone_hash(phone)
        if not phone.startswith("xxxx"):
            p["phone"] = mask_phone(phone)
        a[role] = p


def get(agreement_id: str) -> dict | None:
    with db.connect() as conn:
        r = conn.execute("SELECT data_json FROM v1_agreements WHERE id = ?", (agreement_id,)).fetchone()
    return json.loads(r["data_json"]) if r else None


def stored_hash(agreement_id: str) -> str | None:
    with db.connect() as conn:
        r = conn.execute("SELECT hash FROM v1_agreements WHERE id = ?", (agreement_id,)).fetchone()
    return r["hash"] if r else None


def list_all() -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute("SELECT data_json FROM v1_agreements ORDER BY created_at DESC").fetchall()
    return [json.loads(r["data_json"]) for r in rows]


def upsert(a: dict, actor: str = "app") -> dict:
    agreement_id = a.get("id", "")
    if not ID_RE.match(agreement_id):
        raise Conflict("Agreement IDs look like KR-4821.")
    if a.get("status") not in STATUSES:
        raise Conflict(f"Unknown status {a.get('status')!r}.")
    if not (a.get("consent") or {}).get("worker") or not (a.get("consent") or {}).get("hirer"):
        raise Conflict("Both people must consent before an agreement is recorded.")

    a = json.loads(json.dumps(a))  # private copy
    _scrub_parties(a)
    previous_hash = stored_hash(agreement_id)
    previous = get(agreement_id)

    if previous_hash:
        if hash_agreement(a) != previous_hash:
            raise Conflict("This agreement is sealed. Its terms, parties and confirmations can no longer change.")
        if a["status"] not in SEALED_STATUSES:
            raise Conflict("A sealed agreement cannot go back to review.")
        a["hash"] = previous_hash
    elif a.get("hash"):
        if a["status"] not in SEALED_STATUSES:
            raise Conflict("Only a sealed agreement carries a hash.")
        if hash_agreement(a) != a["hash"]:
            raise Conflict("The seal does not match the agreement. It may have been changed after both confirmed.")
    elif a["status"] in SEALED_STATUSES:
        raise Conflict("A sealed agreement needs its SHA-256 seal.")
    if a.get("hash") and not previous_hash:
        problem = milestone_problem(a.get("terms") or {})
        if problem:
            raise Conflict(problem)
    check_amendments(a, previous)
    for side in ("byHirer", "byWorker"):
        before_rating = ((previous or {}).get("ratings") or {}).get(side)
        if before_rating and ((a.get("ratings") or {}).get(side)) != before_rating:
            raise Conflict("A rating cannot be changed once given.")

    terms = a.get("terms") or {}
    location = terms.get("location") or ""
    now = db.now_iso()
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO v1_agreements (id, data_json, status, hash, job_type, state, district, trade, created_at,"
            " updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json,"
            " status = excluded.status, hash = excluded.hash, job_type = excluded.job_type, state = excluded.state,"
            " district = excluded.district, trade = excluded.trade, updated_at = excluded.updated_at",
            (agreement_id, json.dumps(a, ensure_ascii=False), a["status"], a.get("hash"), terms.get("jobType"),
             _match(STATE_HINTS, location), _match(DISTRICT_HINTS, location), TRADE_OF_JOB.get(terms.get("jobType", "")),
             a.get("createdAt") or now, now),
        )
    before = (previous or {}).get("status")
    if before != a["status"]:
        audit.log(actor=actor, agreement_id=agreement_id, from_state=before, to_state=a["status"],
                  note="sealed with SHA-256" if a["status"] == "sealed" else "")
    return a


def check_amendments(a: dict, previous: dict | None) -> None:
    """Sealed change orders / settlements: each re-hashes to its seal, chains to the one before,
    and none that was already stored may change or disappear."""
    amendments = a.get("amendments") or []
    if amendments and not a.get("hash"):
        raise Conflict("Changes can only be added to a sealed agreement.")
    sealed = [am for am in amendments if am.get("hash")]
    if any(am.get("hash") for am in amendments[len(sealed):]):
        raise Conflict("Sealed changes must come before open ones, in the order they were sealed.")
    head = a.get("hash")
    for am in sealed:
        if am.get("parentHash") != head:
            raise Conflict(f"Change {am.get('id')} does not link to the record before it.")
        if hash_amendment(am) != am["hash"]:
            raise Conflict(f"Change {am.get('id')} does not match its seal.")
        if not ((am.get("confirmations") or {}).get("worker") and (am.get("confirmations") or {}).get("hirer")):
            raise Conflict(f"Change {am.get('id')} needs both confirmations before it is sealed.")
        head = am["hash"]
    before = [am["hash"] for am in (previous or {}).get("amendments") or [] if am.get("hash")]
    if [am["hash"] for am in sealed[: len(before)]] != before:
        raise Conflict("A sealed change can never be edited or removed. Add a new change instead.")


def verify(agreement_id: str) -> dict:
    a = get(agreement_id)
    if a is None:
        raise KeyError(agreement_id)
    sealed = stored_hash(agreement_id)
    recomputed = hash_agreement(a) if sealed else None
    chain = verify_chain(a) if sealed else None
    return {"id": agreement_id, "sealed": bool(sealed), "storedHash": sealed, "recomputedHash": recomputed,
            "valid": (recomputed == sealed) if sealed else None, "chain": chain}


def reset() -> int:
    with db.connect() as conn:
        ids = [r["id"] for r in conn.execute("SELECT id FROM v1_agreements")]
        conn.execute("DELETE FROM v1_agreements")
        if ids:
            conn.execute(f"DELETE FROM audit_log WHERE agreement_id IN ({','.join('?' * len(ids))})", ids)
            conn.execute(f"DELETE FROM messages WHERE agreement_id IN ({','.join('?' * len(ids))})", ids)
        conn.execute("DELETE FROM v1_photos")
    return len(ids)
