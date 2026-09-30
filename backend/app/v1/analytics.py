"""GET /v1/analytics: the governance dashboard, in the shape of frontend/lib/dashboard-data.ts.

Aggregates only. Any group (trade, district, dispute reason) with fewer than K
agreements is suppressed and listed by name only. Real sealed agreements from the
app are counted alongside the synthetic rows.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from statistics import median

from app.models import db
from app.v1 import seed
from app.v1.store import SEALED_STATUSES

K = 10
MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]
LATE_AFTER_DAYS = 7


def _real_rows(state: str, months: set[str]) -> list[dict]:
    """Sealed agreements from the app, reduced to the same anonymous fields as the synthetic rows."""
    with db.connect() as conn:
        rows = conn.execute(
            f"SELECT data_json, status, district, trade FROM v1_agreements WHERE state = ? AND trade IS NOT NULL"
            f" AND status IN ({','.join('?' * len(SEALED_STATUSES))})", (state, *SEALED_STATUSES)).fetchall()
    out = []
    for r in rows:
        a = json.loads(r["data_json"])
        terms = a.get("terms") or {}
        month = (a.get("createdAt") or "")[:7]
        if month not in months or not terms.get("price"):
            continue
        days = max(terms.get("durationDays") or 1, 1)
        completed = r["status"] == "completed"
        delay = None
        balance = next((p for p in a.get("payments", []) if p.get("kind") == "balance"), None)
        if completed and balance and terms.get("deadline"):
            paid = datetime.fromisoformat(balance["at"].replace("Z", "+00:00")).date()
            delay = max((paid - date.fromisoformat(terms["deadline"])).days, 0)
        out.append({
            "district": r["district"] or "Unmapped", "trade": r["trade"], "month": month,
            "daily_wage": round(terms["price"] / days), "completed": int(completed), "delay_days": delay,
            "on_time": None if delay is None else int(delay <= LATE_AFTER_DAYS),
            "disputed": int(r["status"] == "disputed"), "dispute_reason": None,
        })
    return out


def dashboard(state: str, trade: str, months: int) -> dict:
    seed.ensure()
    month_keys = seed.months_back(months)
    with db.connect() as conn:
        synthetic = [dict(r) for r in conn.execute(
            f"SELECT district, trade, month, daily_wage, completed, delay_days, on_time, disputed, dispute_reason"
            f" FROM v1_seed WHERE state = ? AND month IN ({','.join('?' * len(month_keys))})",
            (state, *month_keys))]
    real = _real_rows(state, set(month_keys))
    everyone = synthetic + real
    rows = everyone if trade == "All trades" else [r for r in everyone if r["trade"] == trade]
    suppressed: list[str] = []

    monthly = []
    for key in month_keys:
        monthly.append({"label": MONTH_LABELS[int(key[5:]) - 1], "value": sum(1 for r in rows if r["month"] == key)})

    by_trade: dict[str, list[int]] = {}
    for r in everyone:
        by_trade.setdefault(r["trade"], []).append(r["daily_wage"])
    wages = []
    for t, vals in by_trade.items():
        if len(vals) < K:
            suppressed.append(f"wage: {t}")
            continue
        wages.append({"label": t, "value": int(round(median(vals) / 10) * 10)})
    wages.sort(key=lambda d: -d["value"])

    by_district: dict[str, list[float]] = {}
    for r in rows:
        if r["delay_days"] is not None:
            by_district.setdefault(r["district"], []).append(r["delay_days"])
    delays = []
    for d, vals in by_district.items():
        if len(vals) < K:
            suppressed.append(f"delay: {d}")
            continue
        delays.append({"label": d, "value": round(sum(vals) / len(vals), 1)})
    delays.sort(key=lambda d: -d["value"])

    reasons: dict[str, int] = {}
    for r in rows:
        if r["disputed"] and r["dispute_reason"]:
            reasons[r["dispute_reason"]] = reasons.get(r["dispute_reason"], 0) + 1
    total_reasons = sum(reasons.values())
    disputes = []
    for reason, n in reasons.items():
        if n < K:
            suppressed.append(f"dispute reason: {reason}")
            continue
        disputes.append({"label": reason, "value": round(100 * n / total_reasons)})
    disputes.sort(key=lambda d: -d["value"])

    completed = [r for r in rows if r["on_time"] is not None]
    wages_all = [r["daily_wage"] for r in rows]
    enough = len(rows) >= K
    return {
        "monthly": monthly,
        "wages": wages,
        "delays": delays,
        "disputes": disputes,
        "kpis": {
            "agreements": len(rows),
            "medianWage": int(round(median(wages_all) / 10) * 10) if enough else 0,
            "onTime": round(100 * sum(r["on_time"] for r in completed) / len(completed), 1) if len(completed) >= K else 0,
            "disputeRate": round(100 * sum(r["disputed"] for r in rows) / len(rows), 1) if enough else 0,
            "avgDelay": round(sum(d["value"] for d in delays) / len(delays), 1) if delays else 0,
        },
        "meta": {"k": K, "synthetic": len([r for r in synthetic if trade == "All trades" or r["trade"] == trade]),
                 "real": len([r for r in real if trade == "All trades" or r["trade"] == trade]),
                 "suppressed": suppressed},
    }
