"""Synthetic rows behind the governance dashboard. SYNTHETIC: not real statistics.

Mirrors the curve and proportions of frontend/lib/dashboard-data.ts (Delhi totals
12,922 agreements over 12 months), but as individual rows so the backend can
aggregate them honestly with k-anonymity and mix in real sealed agreements.
"""

from __future__ import annotations

import random
from datetime import date

from app.models import db

STATES = {"Delhi": 1.0, "Maharashtra": 1.08, "Karnataka": 1.04}
DISTRICTS = {
    "Delhi": ["New Delhi", "South Delhi", "West Delhi", "East Delhi", "North West Delhi", "Shahdara", "North East Delhi"],
    "Maharashtra": ["Mumbai City", "Mumbai Suburban", "Pune", "Thane", "Nagpur", "Nashik", "Aurangabad"],
    "Karnataka": ["Bengaluru Urban", "Mysuru", "Mangaluru", "Hubballi-Dharwad", "Belagavi", "Kalaburagi", "Ballari"],
}
DISTRICT_WEIGHTS = [0.12, 0.2, 0.18, 0.15, 0.15, 0.1, 0.1]
BASE_DELAY = [2.4, 3.1, 4.6, 5.4, 6.8, 7.9, 8.3]
WAGE = {"Painter": 780, "Plumber": 850, "Electrician": 900, "Carpenter": 820, "Mason": 760, "Driver": 700,
        "Domestic worker": 450}
TRADE_WEIGHTS = {"Painter": 0.2, "Plumber": 0.16, "Electrician": 0.15, "Carpenter": 0.13, "Mason": 0.12,
                 "Driver": 0.1, "Domestic worker": 0.14}
DISPUTE_REASONS = {"Scope not agreed": 34, "Advance not adjusted": 22, "Late payment": 19, "Quality of work": 14,
                   "Deadline missed": 11}
DISPUTE_RATE = 0.062


def months_back(n: int, today: date | None = None) -> list[str]:
    """The last n months, oldest first, as YYYY-MM."""
    today = today or date.today()
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out[::-1]


def count() -> int:
    with db.connect() as conn:
        return conn.execute("SELECT COUNT(*) FROM v1_seed").fetchone()[0]


def generate(seed: int = 7, today: date | None = None) -> int:
    rng = random.Random(seed)
    months = months_back(12, today)
    rows = []
    trades, t_weights = list(TRADE_WEIGHTS), list(TRADE_WEIGHTS.values())
    reasons, r_weights = list(DISPUTE_REASONS), list(DISPUTE_REASONS.values())
    for state, sf in STATES.items():
        districts = DISTRICTS[state]
        for i, month in enumerate(months):
            n = round((140 + i * i * 17 + i * 40) * sf)
            completed_share = 0.7 if i == len(months) - 1 else 0.97
            for _ in range(n):
                trade = rng.choices(trades, t_weights)[0]
                d_idx = rng.choices(range(len(districts)), DISTRICT_WEIGHTS)[0]
                wage = round(WAGE[trade] * sf * rng.lognormvariate(0, 0.12) / 10) * 10
                completed = rng.random() < completed_share
                delay = round(rng.expovariate(1 / (BASE_DELAY[d_idx] * (2 - sf))), 1) if completed else None
                disputed = rng.random() < DISPUTE_RATE
                rows.append((state, districts[d_idx], trade, month, wage, int(completed), delay,
                             None if delay is None else int(delay <= 7), int(disputed),
                             rng.choices(reasons, r_weights)[0] if disputed else None))
    with db.connect() as conn:
        conn.execute("DELETE FROM v1_seed")
        conn.executemany(
            "INSERT INTO v1_seed (state, district, trade, month, daily_wage, completed, delay_days, on_time, disputed,"
            " dispute_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    return len(rows)


def ensure(today: date | None = None) -> None:
    """Generate once, and again when the newest synthetic month falls behind the calendar."""
    with db.connect() as conn:
        newest = conn.execute("SELECT MAX(month) FROM v1_seed").fetchone()[0]
    if newest != months_back(1, today)[0]:
        generate(today=today)


def clear() -> None:
    with db.connect() as conn:
        conn.execute("DELETE FROM v1_seed")
