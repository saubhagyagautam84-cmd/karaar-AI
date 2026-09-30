"""Governance aggregates (Phase 6). Aggregates only, with k-anonymity:
any group with fewer than K agreements is suppressed (its numbers are never sent).

Never returns a name, phone, agreement ID or single agreement.
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import median

from app.models import db

K = 10
IST = timezone(timedelta(hours=5, minutes=30))
LATE_AFTER_DAYS = 7     # final payment more than a week after the work was done
UNPAID_AFTER_DAYS = 7   # no final payment a week after the work was done
AGREED = ("CONFIRMED_BY_BOTH", "ADVANCE_PAID", "IN_PROGRESS", "COMPLETED", "DISPUTED", "RESOLVED", "ESCALATED")

DISTRICT_CENTRES = {
    "Central Delhi": (28.6519, 77.2315),
    "East Delhi": (28.6280, 77.2950),
    "New Delhi": (28.6010, 77.2020),
    "North Delhi": (28.7120, 77.2010),
    "North West Delhi": (28.7300, 77.0850),
    "Shahdara": (28.6850, 77.2890),
    "South Delhi": (28.5250, 77.2100),
    "West Delhi": (28.6400, 77.0700),
}
TRADES = ["painter", "plumber", "electrician", "carpenter", "domestic help", "driver"]


def _rows() -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT a.id, a.terms_json, a.status, a.district, a.trade, a.completed_at, a.created_at,"
            " (SELECT MIN(m.at) FROM milestones m WHERE m.agreement_id = a.id AND m.type = 'final_payment') AS paid_at"
            f" FROM agreements a WHERE a.status IN ({','.join('?' * len(AGREED))})",
            AGREED,
        ).fetchall()
    out = []
    for r in rows:
        price = json.loads(r["terms_json"]).get("price_inr")
        out.append({
            "status": r["status"], "district": r["district"], "trade": r["trade"], "price": price,
            "completed_at": r["completed_at"], "created_at": r["created_at"], "paid_at": r["paid_at"],
        })
    return out


def _day(iso: str) -> date:
    return datetime.fromisoformat(iso).astimezone(IST).date()


def _delayed(row: dict, today: date) -> bool | None:
    """True/False once a payment was due; None while the work is not done."""
    if not row["completed_at"] or row["status"] != "COMPLETED":
        return None
    done = _day(row["completed_at"])
    if row["paid_at"]:
        return (_day(row["paid_at"]) - done).days > LATE_AFTER_DAYS
    return (today - done).days > UNPAID_AFTER_DAYS


def _median(values: list[int]) -> int | None:
    return int(median(values)) if values else None


def summary(today: date | None = None) -> dict:
    today = today or datetime.now(IST).date()
    rows = _rows()
    delays = [d for d in (_delayed(r, today) for r in rows) if d is not None]
    n = len(rows)
    return {
        "k": K,
        "agreements": n,
        "median_price_inr": _median([r["price"] for r in rows if r["price"]]) if n >= K else None,
        "delayed_pct": round(100 * sum(delays) / len(delays), 1) if len(delays) >= K else None,
        "dispute_pct": round(100 * sum(r["status"] == "DISPUTED" for r in rows) / n, 1) if n >= K else None,
        "districts": len({r["district"] for r in rows}),
        "trades": len({r["trade"] for r in rows if r["trade"]}),
        "window_days": 90,
    }


def wages() -> dict:
    rows = [r for r in _rows() if r["price"] and r["trade"] and r["district"]]
    by_trade: dict[str, list[int]] = defaultdict(list)
    by_cell: dict[tuple[str, str], list[int]] = defaultdict(list)
    for r in rows:
        by_trade[r["trade"]].append(r["price"])
        by_cell[(r["trade"], r["district"])].append(r["price"])
    trades = [t for t in TRADES if t in by_trade] + sorted(set(by_trade) - set(TRADES))
    return {
        "k": K,
        "by_trade": [
            {"trade": t, "n": len(by_trade[t]) if len(by_trade[t]) >= K else None,
             "median_inr": _median(by_trade[t]) if len(by_trade[t]) >= K else None,
             "suppressed": len(by_trade[t]) < K}
            for t in trades
        ],
        "grid": [
            {"trade": t, "district": d,
             "n": len(by_cell[(t, d)]) if len(by_cell[(t, d)]) >= K else None,
             "median_inr": _median(by_cell[(t, d)]) if len(by_cell[(t, d)]) >= K else None,
             "suppressed": len(by_cell[(t, d)]) < K}
            for t in trades for d in DISTRICT_CENTRES
        ],
        "districts": list(DISTRICT_CENTRES),
        "trades": trades,
    }


def delays(today: date | None = None) -> dict:
    today = today or datetime.now(IST).date()
    per: dict[str, list[bool]] = defaultdict(list)
    for r in _rows():
        d = _delayed(r, today)
        if d is not None and r["district"]:
            per[r["district"]].append(d)
    out = []
    for district, (lat, lng) in DISTRICT_CENTRES.items():
        vals = per.get(district, [])
        ok = len(vals) >= K
        out.append({"district": district, "lat": lat, "lng": lng, "suppressed": not ok,
                    "n": len(vals) if ok else None,
                    "delayed_pct": round(100 * sum(vals) / len(vals), 1) if ok else None})
    return {"k": K, "late_after_days": LATE_AFTER_DAYS, "districts": out}


def disputes(today: date | None = None, weeks: int = 13) -> dict:
    today = today or datetime.now(IST).date()
    monday = today - timedelta(days=today.weekday())
    starts = [monday - timedelta(weeks=w) for w in range(weeks - 1, -1, -1)]
    buckets: dict[date, list[bool]] = {s: [] for s in starts}
    for r in _rows():
        created = _day(r["created_at"])
        week = created - timedelta(days=created.weekday())
        if week in buckets:
            buckets[week].append(r["status"] == "DISPUTED")
    out = []
    for s in starts:
        vals = buckets[s]
        ok = len(vals) >= K
        out.append({"week_start": s.isoformat(), "suppressed": not ok,
                    "n": len(vals) if ok else None,
                    "dispute_pct": round(100 * sum(vals) / len(vals), 1) if ok else None})
    return {"k": K, "weeks": out}
