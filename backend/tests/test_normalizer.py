from datetime import date

import pytest

from app.services.normalizer import find_amounts, find_dates, parse_amount, parse_date

TODAY = date(2026, 9, 29)  # a Tuesday


@pytest.mark.parametrize(
    "text, expected",
    [
        ("aath hazaar lagega", 8000),
        ("8k final", 8000),
        ("dhai hazaar advance", 2500),
        ("saadhe teen hazaar", 3500),
        ("sava do hazaar", 2250),
        ("paune paanch hazaar", 4750),
        ("dedh lakh ka kaam", 150000),
        ("ek lakh bees hazaar", 120000),
        ("do hazaar paanch sau", 2500),
        ("paanch sau rupaye", 500),
        ("Rs 4,200 final", 4200),
        ("₹1,20,000", 120000),
        ("4500 rupees", 4500),
        ("twenty five thousand", 25000),
        ("8.5k", 8500),
    ],
)
def test_amounts(text, expected):
    assert parse_amount(text) == expected


def test_bare_fraction_uses_context_multiplier():
    assert parse_amount("saadhe teen", context_multiplier=1000) == 3500
    assert parse_amount("saadhe teen") is None


def test_counts_are_not_money():
    assert parse_amount("do coat lagayenge") is None
    assert parse_amount("three cupboard doors") is None
    assert [a.value for a in find_amounts("Do coat lagayenge, aath hazaar lagega") if a.is_money] == [8000]


@pytest.mark.parametrize(
    "text, low, high",
    [
        ("Saat-aath hazaar ho jayega", 7000, 8000),
        ("saat aath hazaar", 7000, 8000),
        ("7-8 hazaar", 7000, 8000),
        ("7000 se 8000", 7000, 8000),
    ],
)
def test_ranges(text, low, high):
    [a] = [a for a in find_amounts(text) if a.is_money]
    assert a.is_range and a.value is None and (a.low, a.high) == (low, high)


@pytest.mark.parametrize(
    "text, expected",
    [
        ("aaj se shuru", date(2026, 9, 29)),
        ("kal aa jao", date(2026, 9, 30)),
        ("parso se shuru", date(2026, 10, 1)),
        ("narso tak", date(2026, 10, 2)),
        ("Tuesday tak khatam", date(2026, 10, 6)),   # a bare weekday is never today
        ("is Sunday tak", date(2026, 10, 4)),
        ("this Saturday", date(2026, 10, 3)),
        ("agle Sunday", date(2026, 10, 11)),
        ("shanivar ko", date(2026, 10, 3)),
        ("agle hafte", date(2026, 10, 5)),
        ("3 din mein", date(2026, 10, 2)),
        ("ek hafte mein", date(2026, 10, 6)),
        ("5 tarikh tak", date(2026, 10, 5)),
        ("30 tarikh", date(2026, 9, 30)),
        ("10 October", date(2026, 10, 10)),
        ("2026-10-15", date(2026, 10, 15)),
    ],
)
def test_dates(text, expected):
    assert parse_date(text, TODAY) == expected


def test_two_dates_in_one_line():
    found = find_dates("Parso se shuru, Tuesday tak khatam.", TODAY)
    assert [d.value for d in found] == [date(2026, 10, 1), date(2026, 10, 6)]


def test_short_weekday_needs_modifier():
    # "sat" is also "seven" and "mar" is a verb; they only count as days with "is"/"agle"
    assert parse_date("sat din", TODAY) is None
