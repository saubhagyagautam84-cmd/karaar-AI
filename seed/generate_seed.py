"""Synthetic agreements for the governance dashboard (Phase 6).

500 agreements across 8 Delhi districts and 6 trades, realistic prices,
~12% delayed payments, ~5% disputes, dates over the last 90 days.
Deterministic (fixed random seed). Rows are marked is_seed=1 and hold no names
or phone numbers. Re-running replaces the previous seed rows.

    npm run seed            (or: backend/.venv/Scripts/python seed/generate_seed.py [--count 500] [--clear])
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.models import db  # noqa: E402
from app.schemas.agreement import AgreementTerms, Parties, Status, WorkerParty  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))

# district -> (weight, price multiplier, chance of a delayed payment)
DISTRICTS = {
    "South Delhi": (0.18, 1.20, 0.09),
    "West Delhi": (0.16, 1.00, 0.10),
    "North West Delhi": (0.14, 0.90, 0.19),
    "East Delhi": (0.13, 0.90, 0.15),
    "North Delhi": (0.11, 0.95, 0.11),
    "Central Delhi": (0.10, 1.10, 0.10),
    "Shahdara": (0.10, 0.85, 0.28),
    "New Delhi": (0.08, 1.25, 0.06),
}
# trade -> (weight, typical price, spread, typical job length in days, scope)
TRADES = {
    "painter": (0.22, 9000, 0.45, 4, "Paint rooms"),
    "plumber": (0.20, 1500, 0.55, 1, "Fix plumbing"),
    "electrician": (0.18, 1800, 0.55, 1, "Fix wiring and switches"),
    "carpenter": (0.15, 4500, 0.50, 3, "Repair furniture"),
    "domestic help": (0.15, 9000, 0.25, 30, "Household help for a month"),
    "driver": (0.10, 15000, 0.20, 30, "Driving for a month"),
}
DISPUTE_RATE = 0.05


def _pick(rng: random.Random, table: dict) -> str:
    names = list(table)
    return rng.choices(names, weights=[table[n][0] for n in names])[0]


def _round_price(value: float) -> int:
    step = 100 if value < 5000 else 500
    return max(step, int(round(value / step) * step))


def clear() -> None:
    db.init_db()
    with db.connect() as conn:
        conn.execute("DELETE FROM milestones WHERE agreement_id IN (SELECT id FROM agreements WHERE is_seed = 1)")
        conn.execute("DELETE FROM agreements WHERE is_seed = 1")


def generate(count: int = 500, seed: int = 42, today: date | None = None) -> int:
    rng = random.Random(seed)
    today = today or datetime.now(IST).date()
    clear()

    def at(d: date) -> str:
        return datetime.combine(d, time(rng.randint(8, 19), rng.randint(0, 59)), IST).isoformat()

    with db.connect() as conn:
        for i in range(1, count + 1):
            district = _pick(rng, DISTRICTS)
            trade = _pick(rng, TRADES)
            _, dist_mult, delay_p = DISTRICTS[district]
            _, typical, spread, days, scope = TRADES[trade]
            price = _round_price(rng.lognormvariate(0, spread / 2) * typical * dist_mult)
            advance = _round_price(price * rng.choice([0.2, 0.25, 0.3])) if price > 1000 and rng.random() < 0.7 else 0
            created = today - timedelta(days=rng.randint(0, 89))
            start = created + timedelta(days=rng.randint(0, 3))
            deadline = start + timedelta(days=max(1, int(days * rng.uniform(0.8, 1.3))))
            finished = deadline + timedelta(days=rng.choice([0, 0, 0, 0, -1, 1, 2]))

            if rng.random() < DISPUTE_RATE:
                status = Status.DISPUTED
            elif finished > today:
                status = Status.IN_PROGRESS
            else:
                status = Status.COMPLETED

            agreement_id = f"SEED-{i:05d}"
            terms = AgreementTerms(
                agreement_id=agreement_id,
                language_detected=["hi"],
                parties=Parties(worker=WorkerParty(trade=trade)),
                scope=scope,
                price_inr=price,
                advance_inr=advance,
                materials_provided_by="client" if trade in ("painter", "carpenter") else None,
                start_date=start,
                deadline=deadline,
                status=status,
            )
            completed_at = at(finished) if status != Status.IN_PROGRESS and finished <= today else None
            conn.execute(
                "INSERT INTO agreements (id, terms_json, status, hash, audio_ref, audio_hash, district, trade,"
                " is_seed, completed_at, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, 1, ?, ?, ?)",
                (agreement_id, json.dumps(terms.model_dump(mode="json")), status.value, district, trade,
                 completed_at, at(created), at(created)),
            )
            if advance:
                conn.execute("INSERT INTO milestones (agreement_id, type, amount_inr, at) VALUES (?, 'advance_paid', ?, ?)",
                             (agreement_id, advance, at(start)))
            if completed_at and status == Status.COMPLETED:
                late = rng.random() < delay_p
                paid_on = finished + timedelta(days=rng.randint(8, 30) if late else rng.randint(0, 2))
                if paid_on <= today:
                    conn.execute(
                        "INSERT INTO milestones (agreement_id, type, amount_inr, at) VALUES (?, 'final_payment', ?, ?)",
                        (agreement_id, price - advance, at(paid_on)))
    return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed synthetic agreements for the dashboard.")
    parser.add_argument("--count", type=int, default=500)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--clear", action="store_true", help="remove seed rows and exit")
    args = parser.parse_args()
    if args.clear:
        clear()
        print("Seed rows removed.")
    else:
        n = generate(args.count, args.seed)
        print(f"Seeded {n} synthetic agreements into {db.settings.db_path}")
