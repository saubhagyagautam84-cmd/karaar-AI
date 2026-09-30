"""AI dispute mediator (A4): the deterministic rules engine, ported line for line from
frontend/lib/mediator.ts so demo and live modes suggest the same numbers.

A suggestion based only on the record, to help both people settle; never a legal judgment.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timezone

from app.v1.amend import effective_terms, paid_total, progress_of, sealed_amendments, total_payable

REASONS = ("Scope not agreed", "Advance not adjusted", "Late payment", "Quality of work", "Deadline missed", "Other")
QUALITY_HOLDBACK = 0.1
DISCLAIMER = ("This is a suggestion based only on this record, to help both of you settle. It is not a legal judgment. "
              "Either of you can escalate to the consumer forum (e-Daakhil).")


def js_round(x: float) -> int:
    return math.floor(x + 0.5)


def rs(n: float) -> str:
    n = js_round(n)
    sign = "-" if n < 0 else ""
    s = str(abs(n))
    if len(s) > 3:  # en-IN grouping: 12,34,567
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups) + "," + tail
    return f"₹{sign}{s}"


def _short(h: str | None) -> str:
    return f"{h[:10]}…" if h else "—"


def _plural(n: int, word: str, suffix: str = "s") -> str:
    return f"{word}{suffix if n > 1 else ''}"


def mediate(a: dict, reason: str, today: date | None = None) -> dict:
    today = today or date.today()
    t = effective_terms(a)
    sealed_terms = a.get("terms") or {}
    total = total_payable(a)
    paid = paid_total(a)
    outstanding = max(total - paid, 0)
    overpaid = max(paid - total, 0)
    amendments = sealed_amendments(a)
    payments = a.get("payments") or []

    facts: list[str] = []
    agreed: list[str] = []
    contested: list[str] = []
    evidence = [f"Sealed agreement {a.get('id')} (SHA-256 {_short(a.get('hash'))})"]
    calc: list[dict] = []

    scope = ", ".join(s["en"] for s in sealed_terms.get("scope", [])) or "scope as recorded"
    facts.append(f"Sealed price {rs(sealed_terms.get('price') or 0)} for: {scope}.")
    if sealed_terms.get("excluded"):
        facts.append(f"Not included, as sealed: {', '.join(s['en'] for s in sealed_terms['excluded'])}.")
    for am in amendments:
        kind = "Settlement" if am.get("source") == "settlement" else "Change order"
        facts.append(f"{kind} {am['id']}: {am.get('description', '')}.")
        evidence.append(f"{kind} {am['id']} (SHA-256 {_short(am.get('hash'))})")
    if t.get("advance"):
        where = "on top of the total" if t.get("advanceAdjusted") is False else "deducted from the total"
        facts.append(f"Advance {rs(t['advance'])}, {where}.")
    if payments:
        facts.append(f"{rs(paid)} paid so far in {len(payments)} UPI {_plural(len(payments), 'payment')}.")
        for p in payments:
            evidence.append(f"UPI {p.get('upiRef')}: {rs(p.get('amount', 0))} ({p.get('kind')})")
    else:
        facts.append("No payment recorded yet.")
    photos = [ph for p in (a.get("progress") or {}).values() for ph in p.get("photos", [])]
    if photos:
        n = len(photos)
        facts.append(f"{n} proof-of-work {_plural(n, 'photo')} on record, each with a SHA-256 hash.")
        evidence.append(f"{n} photo {_plural(n, 'hash', 'es')}")
    if t.get("deadline"):
        late = (today - date.fromisoformat(t["deadline"])).days
        facts.append(f"Finish date {t['deadline']} passed {late} {_plural(late, 'day')} ago." if late > 0 else f"Finish date {t['deadline']}.")
    for r in ("hirer", "worker"):
        st = ((a.get("dispute") or {}).get("statements") or {}).get(r)
        if st:
            evidence.append(f"Statement from the {r} ({st.get('channel')})")

    agreed.append(f"Price and scope as sealed{' plus the confirmed changes' if amendments else ''}: {rs(t.get('price') or 0)}.")
    if t.get("advance"):
        agreed.append(f"Advance of {rs(t['advance'])}.")

    calc.append({"label": "Agreed total (sealed + confirmed changes)", "amount": total})
    calc.append({"label": "Already paid via UPI", "amount": -paid})

    pay = outstanding
    suggestion = ""
    ms = t.get("milestones") or []

    if ms:
        def sum_by(status: str) -> int:
            return sum(m["amount"] for m in ms if progress_of(a, m["id"])["status"] == status)

        approved, submitted, rejected, pending = sum_by("approved"), sum_by("submitted"), sum_by("rejected"), sum_by("pending")
        advance_due = t["advance"] if t.get("advance") and not any(p.get("kind") == "advance" for p in payments) else 0
        for m in ms:
            p = progress_of(a, m["id"])
            st = p["status"]
            if st in ("approved", "paid"):
                agreed.append(f"Milestone “{m['title']}” ({rs(m['amount'])}) {'done and paid' if st == 'paid' else 'approved by the hirer'}.")
            if st == "submitted":
                contested.append(f"Milestone “{m['title']}” ({rs(m['amount'])}) marked done by the worker, not yet approved.")
            if st == "rejected":
                contested.append(f"Milestone “{m['title']}” ({rs(m['amount'])}) rejected: {p.get('rejectReason') or 'no reason given'}.")
            evidence.append(f"Milestone “{m['title']}”: {st}")
        if advance_due:
            calc.append({"label": "Advance not yet paid", "amount": advance_due})
        calc.append({"label": "Approved milestones not yet paid", "amount": approved})
        calc.append({"label": "Milestones marked done, awaiting approval", "amount": submitted + rejected})
        calc.append({"label": "Milestones not started (not due yet)", "amount": pending})
        in_question = submitted + rejected
        if reason == "Quality of work":
            hold = js_round(in_question * QUALITY_HOLDBACK)
            calc.append({"label": f"Held back until rework ({js_round(QUALITY_HOLDBACK * 100)}% of the work in question)", "amount": -hold})
            pay = advance_due + approved + in_question - hold
            suggestion = (f"Pay {rs(pay)} now. Hold {rs(hold)} until the worker fixes the issue within 7 days, then pay it. "
                          "Milestones not started are not due yet.")
        else:
            pay = advance_due + approved + in_question
            not_due = f"{rs(pending)} for milestones not started is not due yet." if pending else ""
            suggestion = f"Pay {rs(pay)} now for the approved and completed milestones. {not_due}".strip()
    elif reason == "Quality of work":
        hold = js_round(outstanding * QUALITY_HOLDBACK)
        calc.append({"label": "Outstanding", "amount": outstanding})
        calc.append({"label": f"Held back until rework ({js_round(QUALITY_HOLDBACK * 100)}%)", "amount": -hold})
        pay = outstanding - hold
        contested.append("Whether the work meets the agreed standard.")
        suggestion = f"Pay {rs(pay)} now and {rs(hold)} after the worker fixes the issue within 7 days."
    else:
        calc.append({"label": "Outstanding", "amount": outstanding})
        pay = outstanding
        suggestion = f"Pay the outstanding {rs(outstanding)} as sealed." if outstanding else "Nothing is outstanding under the sealed terms."

    if reason == "Advance not adjusted" and t.get("advance"):
        contested.append("Whether the advance counts towards the total.")
        on_top = t.get("advanceAdjusted") is False
        suggestion += (f" The sealed record says the advance is {'on top of' if on_top else 'part of'} the total, "
                       f"so it {'does not reduce' if on_top else 'reduces'} the balance.")
    if reason == "Scope not agreed":
        contested.append("Work that is not in the sealed scope or a confirmed change order.")
        suggestion += " Work outside the sealed scope is payable only if both confirm it as a change order."
    if reason == "Deadline missed":
        contested.append("The delay and its cause.")
        suggestion += " No delay penalty was agreed in the sealed terms, so no deduction is suggested; agree a new finish date as a change order."
    if reason == "Late payment":
        contested.append("When the payment was due.")
    if reason == "Other":
        contested.append("The issue described in the statements.")

    refund = 0
    if overpaid:
        refund, pay = overpaid, 0
        calc.append({"label": "Paid more than the agreed total", "amount": overpaid})
        suggestion = f"The hirer has paid {rs(overpaid)} more than the agreed total. The worker returns {rs(overpaid)}."
    calc.append({"label": "Refund to the hirer" if refund else "Suggested payment to the worker now", "amount": refund or pay})

    return {
        "at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "engine": "rules",
        "facts": facts,
        "agreed": agreed,
        "contested": contested,
        "calculation": calc,
        "payToWorker": max(0, js_round(pay)),
        "refundToHirer": refund,
        "suggestion": suggestion.strip(),
        "evidence": evidence,
        "disclaimer": DISCLAIMER,
    }
