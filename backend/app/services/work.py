"""Phase 5: payments (UPI), milestones, completion, and the worker's own record."""

from __future__ import annotations

import secrets
from datetime import date, datetime, timedelta, timezone

from app.adapters import get_adapter
from app.config import settings
from app.models import db
from app.schemas.agreement import AgreementTerms, Status
from app.services import audit, store
from app.services.lifecycle import NotFound, _record, machine_for
from app.services.state_machine import InvalidTransition

IST = timezone(timedelta(hours=5, minutes=30))
SHARE_DAYS = 7


# ------------------------------------------------------------------ milestones

def add_milestone(agreement_id: str, kind: str, amount: int | None = None, proof_ref: str | None = None) -> None:
    with db.connect() as conn:
        conn.execute("INSERT INTO milestones (agreement_id, type, amount_inr, proof_ref, at) VALUES (?, ?, ?, ?, ?)",
                     (agreement_id, kind, amount, proof_ref, db.now_iso()))


def milestones(agreement_id: str) -> list[dict]:
    with db.connect() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT type, amount_inr, proof_ref, at FROM milestones WHERE agreement_id = ? ORDER BY id",
            (agreement_id,))]


def _has_milestone(agreement_id: str, kind: str) -> bool:
    return any(m["type"] == kind for m in milestones(agreement_id))


def _worker_id(agreement_id: str) -> int | None:
    worker = store.party_rows(agreement_id).get("worker")
    return worker["worker_id"] if worker else None


def _credit_worker(agreement_id: str, amount: int) -> None:
    wid = _worker_id(agreement_id)
    if wid and amount:
        with db.connect() as conn:
            conn.execute("UPDATE workers SET total_earned_inr = total_earned_inr + ? WHERE id = ?", (amount, wid))


# ------------------------------------------------------------------ payments

def _final_amount(terms: AgreementTerms) -> int:
    if terms.price_inr is None:
        raise InvalidTransition("The price was never agreed, so there is no amount to pay.")
    return max(terms.price_inr - (terms.advance_inr or 0), 0)


def payment_intent(agreement_id: str, purpose: str, payee_vpa: str) -> dict:
    machine, terms = machine_for(agreement_id)
    if purpose == "advance":
        if not machine.can(Status.ADVANCE_PAID):
            raise InvalidTransition("The advance can be paid once both have confirmed, and only once.")
        amount = terms.advance_inr or 0
    else:
        if terms.status != Status.COMPLETED or _has_milestone(agreement_id, "final_payment"):
            raise InvalidTransition("The final payment is made once, after both mark the work done.")
        amount = _final_amount(terms)
    payee_vpa = payee_vpa.strip()
    if "@" not in payee_vpa:
        raise InvalidTransition("Enter the worker's UPI ID, like ramesh@upi.")
    name = terms.parties.worker.name or "Worker"
    intent = get_adapter("payment").create_intent(agreement_id, amount, payee_vpa, name, purpose=purpose)
    return intent.model_dump()


def confirm_payment(agreement_id: str, purpose: str, actor: str = "client") -> dict:
    """Mock: 'simulate payment'. Real: the PSP webhook would call this."""
    machine, terms = machine_for(agreement_id)
    amount = (terms.advance_inr or 0) if purpose == "advance" else _final_amount(terms)
    if purpose == "advance":
        if not machine.can(Status.ADVANCE_PAID):
            raise InvalidTransition("The advance can be paid once both have confirmed, and only once.")
    elif terms.status != Status.COMPLETED or _has_milestone(agreement_id, "final_payment"):
        raise InvalidTransition("The final payment is made once, after both mark the work done.")

    result = get_adapter("payment").check_status(agreement_id, amount)
    if result.status != "SUCCESS":
        raise InvalidTransition("The payment has not gone through yet.")
    if purpose == "advance":
        move = machine.pay_advance()
        terms.status = machine.status
        store.save(terms, hash_value=terms.hash)
        add_milestone(agreement_id, "advance_paid", amount, result.txn_ref)
        _record(agreement_id, actor, move, f"advance Rs {amount} paid, UPI ref {result.txn_ref}")
    else:
        add_milestone(agreement_id, "final_payment", amount, result.txn_ref)
        audit.log(actor=actor, agreement_id=agreement_id, note=f"final payment Rs {amount}, UPI ref {result.txn_ref}")
    _credit_worker(agreement_id, amount)
    return {"status": terms.status.value, "amount_inr": amount, "txn_ref": result.txn_ref}


# ------------------------------------------------------------------ work

def start_work(agreement_id: str, actor: str) -> dict:
    machine, terms = machine_for(agreement_id)
    move = machine.start()
    terms.status = machine.status
    store.save(terms, hash_value=terms.hash)
    add_milestone(agreement_id, "work_started")
    _record(agreement_id, actor, move, "work started")
    return {"status": terms.status.value}


def mark_done(agreement_id: str, party: str, proof_ref: str | None = None) -> dict:
    machine, terms = machine_for(agreement_id)
    move = machine.mark_done(party)
    now = db.now_iso()
    with db.connect() as conn:
        conn.execute("UPDATE parties SET done_at = ? WHERE agreement_id = ? AND role = ?", (now, agreement_id, party))
    add_milestone(agreement_id, f"work_done_{party}", proof_ref=proof_ref)
    terms.status = machine.status
    completed = machine.status == Status.COMPLETED
    store.save(terms, hash_value=terms.hash, completed_at=now if completed else None)
    _record(agreement_id, party, move, f"{party} marked the work done" + (" (photo attached)" if proof_ref else ""))
    if completed:
        add_milestone(agreement_id, "work_completed")
        _update_worker_record(agreement_id, terms)
    return {"status": terms.status.value, "completed": completed}


def _update_worker_record(agreement_id: str, terms: AgreementTerms) -> None:
    wid = _worker_id(agreement_id)
    if not wid:
        return
    jobs = completed_jobs(wid)
    on_time = [j["on_time"] for j in jobs if j["on_time"] is not None]
    with db.connect() as conn:
        conn.execute("UPDATE workers SET jobs_completed = ?, on_time_rate = ?, trade = COALESCE(trade, ?) WHERE id = ?",
                     (len(jobs), (sum(on_time) / len(on_time)) if on_time else None, terms.parties.worker.trade, wid))
    audit.log(actor="system", agreement_id=agreement_id, note="worker record updated: job completed")
    # Tell the worker their record grew, with their private link.
    worker = worker_row(wid)
    link = f"{settings.public_base_url}/worker/{wid}?key={worker['owner_token']}"
    lang = terms.parties.worker.preferred_lang or "hi"
    body = (f"करार AI: शाबाश! काम {agreement_id} पूरा हुआ। आपके रिकॉर्ड में {len(jobs)} पूरे काम हैं।\n"
            f"अपना रिकॉर्ड देखें: {link}") if lang == "hi" else (
            f"Karaar AI: Well done! Job {agreement_id} is complete. Your record now has {len(jobs)} completed jobs.\n"
            f"See your record: {link}")
    try:
        get_adapter("notify").send(terms.parties.worker.phone, body, agreement_id=agreement_id, party_role="worker")
    except Exception:  # noqa: BLE001 - a failed notification must not undo a completed job
        pass


# ------------------------------------------------------------------ worker record

def worker_row(worker_id: int):
    with db.connect() as conn:
        return conn.execute("SELECT * FROM workers WHERE id = ?", (worker_id,)).fetchone()


def completed_jobs(worker_id: int) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT a.id, a.terms_json, a.completed_at, a.trade, a.district FROM agreements a"
            " JOIN parties p ON p.agreement_id = a.id AND p.role = 'worker'"
            " WHERE p.worker_id = ? AND a.completed_at IS NOT NULL ORDER BY a.completed_at DESC",
            (worker_id,),
        ).fetchall()
    jobs = []
    for r in rows:
        terms = AgreementTerms.model_validate_json(r["terms_json"])
        done_on = datetime.fromisoformat(r["completed_at"]).astimezone(IST).date()
        jobs.append({
            "agreement_id": r["id"],
            "trade": r["trade"],
            "district": r["district"],
            "price_inr": terms.price_inr,
            "completed_on": done_on.isoformat(),
            "on_time": (done_on <= terms.deadline) if terms.deadline else None,
        })
    return jobs


def authorize(worker_id: int, key: str | None, share: str | None) -> str:
    """Returns 'owner' or 'viewer'. Private by default: anything else is NotFound."""
    w = worker_row(worker_id)
    if w is None:
        raise NotFound(str(worker_id))
    if key and w["owner_token"] and secrets.compare_digest(key, w["owner_token"]):
        return "owner"
    if share:
        with db.connect() as conn:
            link = conn.execute("SELECT * FROM share_links WHERE token = ? AND worker_id = ?",
                                (share, worker_id)).fetchone()
        if link and datetime.fromisoformat(link["expires_at"]) > datetime.now(timezone.utc):
            return "viewer"
    raise NotFound(str(worker_id))


def profile(worker_id: int, access: str) -> dict:
    w = worker_row(worker_id)
    jobs = completed_jobs(worker_id)
    trades = sorted({j["trade"] for j in jobs if j["trade"]} | ({w["trade"]} if w["trade"] else set()))
    earned_from_jobs = w["total_earned_inr"]
    out = {
        "worker_id": worker_id,
        "access": access,
        "name": w["name"],
        "trades": trades,
        "jobs_completed": w["jobs_completed"],
        "on_time_rate": w["on_time_rate"],
        "total_earned_inr": earned_from_jobs,
        "eshram_linked": bool(w["eshram_uan_masked"]),
        "eshram_uan_masked": w["eshram_uan_masked"] if access == "owner" else None,
        # Viewers see the work history, not which households it was for.
        "jobs": [{k: v for k, v in j.items() if access == "owner" or k != "agreement_id"} for j in jobs[:20]],
    }
    if access == "owner":
        with db.connect() as conn:
            out["share_links"] = [dict(r) for r in conn.execute(
                "SELECT token, created_at, expires_at FROM share_links WHERE worker_id = ? AND expires_at > ?"
                " ORDER BY created_at DESC", (worker_id, datetime.now(timezone.utc).isoformat()))]
    return out


def create_share_link(worker_id: int) -> dict:
    token = secrets.token_urlsafe(12)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=SHARE_DAYS)
    with db.connect() as conn:
        conn.execute("INSERT INTO share_links (token, worker_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                     (token, worker_id, now.isoformat(timespec="seconds"), expires.isoformat(timespec="seconds")))
    audit.log(actor="worker", note=f"worker {worker_id} created a share link, expires {expires.date()}")
    return {"token": token, "expires_at": expires.isoformat(timespec="seconds"),
            "url": f"{settings.public_base_url}/worker/{worker_id}?share={token}"}


def revoke_share_links(worker_id: int) -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM share_links WHERE worker_id = ?", (worker_id,))


def link_eshram(worker_id: int, uan: str) -> dict:
    result = get_adapter("eshram").lookup(uan)
    if not result.linked:
        raise InvalidTransition("That e-Shram UAN was not found. It has 12 digits.")
    with db.connect() as conn:
        conn.execute("UPDATE workers SET eshram_uan_masked = ? WHERE id = ?", (result.uan_masked, worker_id))
    return result.model_dump()


def owner_link(agreement_id: str) -> str | None:
    wid = _worker_id(agreement_id)
    if not wid:
        return None
    return f"/worker/{wid}?key={worker_row(wid)['owner_token']}"


def today_ist() -> date:
    return datetime.now(IST).date()
