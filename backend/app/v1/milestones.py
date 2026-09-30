"""Milestone transitions (A1), port of frontend/lib/milestoneFlow.ts:
pending -> submitted -> approved -> paid, or submitted -> rejected -> submitted again.
"""

from __future__ import annotations

import copy

from app.models import db
from app.v1.amend import effective_terms, paid_total, progress_of, total_payable


class FlowError(ValueError):
    """Maps to HTTP 409."""


def _milestone(a: dict, mid: str) -> dict:
    m = next((x for x in effective_terms(a).get("milestones") or [] if x["id"] == mid), None)
    if m is None:
        raise FlowError("That milestone is not part of this agreement.")
    return m


def _assert_active(a: dict) -> None:
    if not a.get("hash"):
        raise FlowError("Milestones start once both people have confirmed.")
    if a.get("status") == "disputed":
        raise FlowError("Paused while the dispute is open.")
    if a.get("status") == "completed":
        raise FlowError("This agreement is already completed.")


def _set(a: dict, mid: str, p: dict, label: str, detail: str) -> dict:
    a = copy.deepcopy(a)
    a.setdefault("progress", {})[mid] = p
    a.setdefault("events", []).append({"at": db.now_iso(), "label": label, "detail": detail})
    return a


def add_photos(a: dict, mid: str, photos: list[dict]) -> dict:
    a = copy.deepcopy(a)
    p = progress_of(a, mid)
    known = {ph["id"] for ph in p.get("photos", [])}
    p = {**p, "photos": p.get("photos", []) + [ph for ph in photos if ph.get("id") not in known]}
    a.setdefault("progress", {})[mid] = p
    return a


def submit(a: dict, mid: str) -> dict:
    _assert_active(a)
    m = _milestone(a, mid)
    p = progress_of(a, mid)
    if p["status"] not in ("pending", "rejected"):
        raise FlowError("This milestone was already marked done.")
    if not any(ph.get("kind") == "after" for ph in p.get("photos", [])):
        raise FlowError("Add at least one 'after' photo as proof first.")
    n = len(p.get("photos", []))
    p = {k: v for k, v in p.items() if k != "rejectReason"} | {"status": "submitted", "submittedAt": db.now_iso()}
    return _set(a, mid, p, f"Milestone done: {m['title']}",
                f"{n} photo{'' if n == 1 else 's'} · awaiting {a['hirer']['name']}'s approval")


def approve(a: dict, mid: str) -> dict:
    _assert_active(a)
    m = _milestone(a, mid)
    p = progress_of(a, mid)
    if p["status"] != "submitted":
        raise FlowError("Only a milestone marked done can be approved.")
    return _set(a, mid, {**p, "status": "approved", "approvedAt": db.now_iso()}, f"Milestone approved: {m['title']}",
                f"by {a['hirer']['name']}")


def reject(a: dict, mid: str, reason: str) -> dict:
    _assert_active(a)
    m = _milestone(a, mid)
    p = progress_of(a, mid)
    if p["status"] != "submitted":
        raise FlowError("Only a milestone marked done can be rejected.")
    if not (reason or "").strip():
        raise FlowError("Please say what needs fixing.")
    return _set(a, mid, {**p, "status": "rejected", "rejectedAt": db.now_iso(), "rejectReason": reason.strip()},
                f"Milestone sent back: {m['title']}", reason.strip())


def amount_due(a: dict, mid: str) -> int:
    """For GET /v1/payments/<id>-milestone-<mid>: only an approved milestone can be paid."""
    _assert_active(a)
    m = _milestone(a, mid)
    if progress_of(a, mid)["status"] != "approved":
        raise FlowError("Approve the milestone before paying it.")
    if (a.get("terms") or {}).get("advance") and not any(p.get("kind") == "advance" for p in a.get("payments") or []):
        raise FlowError("Pay the advance first.")
    return m["amount"]


def all_paid(a: dict) -> bool:
    ms = effective_terms(a).get("milestones") or []
    return all(progress_of(a, m["id"])["status"] == "paid" for m in ms) and paid_total(a) >= total_payable(a)
