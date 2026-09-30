"""Phase 6 acceptance: aggregates only, groups < 10 hidden, never a name, phone or single agreement."""

import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "seed"))
import generate_seed  # noqa: E402

from tests.fixtures.transcripts import T1  # noqa: E402
from tests.helpers import confirm_both, draft  # noqa: E402


@pytest.fixture
def seeded():
    generate_seed.generate(500)


def test_seed_shape(seeded):
    from app.models import db

    with db.connect() as conn:
        rows = conn.execute("SELECT district, trade, status FROM agreements WHERE is_seed = 1").fetchall()
    assert len(rows) == 500
    assert len({r["district"] for r in rows}) == 8 and len({r["trade"] for r in rows}) == 6
    dispute_rate = sum(r["status"] == "DISPUTED" for r in rows) / 500
    assert 0.02 <= dispute_rate <= 0.08


def test_summary_rates(client, seeded):
    s = client.get("/api/analytics/summary").json()
    assert s["agreements"] == 500 and s["k"] == 10
    assert 8 <= s["delayed_pct"] <= 16
    assert 3 <= s["dispute_pct"] <= 8


def test_small_groups_are_suppressed(client, seeded):
    w = client.get("/api/analytics/wages").json()
    cells = w["grid"]
    assert len(cells) == 48
    hidden = [c for c in cells if c["suppressed"]]
    shown = [c for c in cells if not c["suppressed"]]
    assert hidden and shown
    assert all(c["n"] is None and c["median_inr"] is None for c in hidden)
    assert all(c["n"] >= 10 for c in shown)
    painter = next(t for t in w["by_trade"] if t["trade"] == "painter")
    plumber = next(t for t in w["by_trade"] if t["trade"] == "plumber")
    assert painter["median_inr"] > plumber["median_inr"]

    d = client.get("/api/analytics/delays").json()["districts"]
    shahdara = next(x for x in d if x["district"] == "Shahdara")
    new_delhi = next(x for x in d if x["district"] == "New Delhi")
    assert all(x["n"] is None or x["n"] >= 10 for x in d)
    if not shahdara["suppressed"] and not new_delhi["suppressed"]:
        assert shahdara["delayed_pct"] > new_delhi["delayed_pct"]

    weeks = client.get("/api/analytics/disputes").json()["weeks"]
    assert len(weeks) == 13 and all(x["n"] is None or x["n"] >= 10 for x in weeks)


def test_everything_is_empty_and_hidden_without_data(client):
    s = client.get("/api/analytics/summary").json()
    assert s["median_price_inr"] is None and s["dispute_pct"] is None
    assert all(c["suppressed"] for c in client.get("/api/analytics/wages").json()["grid"])


def test_never_leaks_identity(client, seeded):
    aid = draft(client, transcript=T1)["agreement_id"]
    confirm_both(client, aid)
    dump = json.dumps(client.get("/api/analytics/all").json())
    for secret in ("Ritu", "Ramesh", "XXXX", "3210", "KA-", "SEED-", "sha256"):
        assert secret not in dump


def test_seed_rows_are_not_individually_reachable(client, seeded):
    assert client.get("/api/agreements/SEED-00001").status_code == 404


def test_dashboard_is_fast(client, seeded):
    t0 = time.perf_counter()
    assert client.get("/api/analytics/all").status_code == 200
    assert time.perf_counter() - t0 < 2.0
