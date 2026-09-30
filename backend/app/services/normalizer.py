"""Hindi / Hinglish / English number and date normaliser.

Amounts: "aath hazaar" -> 8000, "8k" -> 8000, "dhai hazaar" -> 2500,
"saadhe teen" -> 3.5 (x1000 when the context is thousands), "saat-aath hazaar"
-> a range 7000-8000, "Rs 4,200" -> 4200.

Dates (relative to today): aaj, kal, parso, narso, weekday names in English and
Hindi ("is Sunday", "agle Mangalvar"), "agle hafte", "3 din mein", "5 tarikh".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta

# ---------------------------------------------------------------- numbers

HINDI_NUMBERS: dict[str, float] = {
    "ek": 1, "ik": 1, "do": 2, "doh": 2, "teen": 3, "tin": 3, "char": 4, "chaar": 4,
    "paanch": 5, "panch": 5, "chhe": 6, "chhah": 6, "chheh": 6, "che": 6, "saat": 7, "sat": 7,
    "aath": 8, "aat": 8, "nau": 9, "das": 10, "dus": 10, "gyarah": 11, "gyaarah": 11,
    "barah": 12, "baarah": 12, "terah": 13, "chaudah": 14, "pandrah": 15, "pandrah": 15,
    "solah": 16, "satrah": 17, "atharah": 18, "unnis": 19, "bees": 20, "bis": 20,
    "pachchis": 25, "pachees": 25, "pachis": 25, "tees": 30, "tis": 30, "paintees": 35,
    "chalis": 40, "chalees": 40, "chaalis": 40, "pachas": 50, "pachaas": 50, "pachaas": 50,
    "saath": 60, "sattar": 70, "assi": 80, "nabbe": 90, "nabbey": 90,
    "dedh": 1.5, "derh": 1.5, "dhai": 2.5, "dhaai": 2.5, "adhai": 2.5,
}
ENGLISH_UNITS: dict[str, float] = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
ENGLISH_TENS: dict[str, float] = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90,
}
MULTIPLIERS: dict[str, int] = {
    "sau": 100, "hundred": 100,
    "hazaar": 1000, "hazar": 1000, "hajar": 1000, "hajaar": 1000, "thousand": 1000,
    "lakh": 100_000, "lac": 100_000, "laakh": 100_000, "lakhs": 100_000,
}
FRACTION_PREFIX: dict[str, float] = {
    "saadhe": 0.5, "sadhe": 0.5, "saade": 0.5, "sava": 0.25, "savaa": 0.25, "sawa": 0.25,
    "paune": -0.25, "pone": -0.25,
}
CURRENCY = {"rs", "rupees", "rupee", "rupaye", "rupay", "rupaiye", "inr", "₹", "rupiya"}
# Words that are numbers only when followed by a multiplier ("do coat" is not money).
_AMBIGUOUS_WORDS = {"do", "sat", "saath", "che", "tin", "bis", "tis", "aat"}

_RANGE_WORDS = {"-", "–", "se", "to", "ya", "or", "/"}
_TOKEN = re.compile(r"₹|\d+(?:[.,]\d+)*\s?k\b|\d+(?:,\d+)*(?:\.\d+)?|[a-z]+|[-–]|/")


@dataclass
class Amount:
    value: int | None          # None for a range
    low: int
    high: int
    is_range: bool
    is_money: bool
    text: str
    start: int
    end: int


def _digits(tok: str) -> float:
    tok = tok.replace(" ", "")
    mult = 1000 if tok.endswith("k") else 1
    tok = tok.rstrip("k")
    # "4,200" and "1,20,000" are grouping commas; "8.5" is a decimal.
    return float(tok.replace(",", "")) * mult


def _tokens(text: str) -> list[tuple[str, int, int]]:
    return [(m.group(0), m.start(), m.end()) for m in _TOKEN.finditer(text.lower())]


def _base_value(tok: str) -> float | None:
    if tok[0].isdigit():
        return _digits(tok)
    return HINDI_NUMBERS.get(tok, ENGLISH_UNITS.get(tok, ENGLISH_TENS.get(tok)))


def _read_quantity(toks: list[tuple[str, int, int]], i: int) -> tuple[float, int, bool, bool] | None:
    """Read one number phrase starting at i. Returns (value, next_i, had_multiplier, had_currency)."""
    n = len(toks)
    frac = 0.0
    if toks[i][0] in FRACTION_PREFIX and i + 1 < n and _base_value(toks[i + 1][0]) is not None:
        frac = FRACTION_PREFIX[toks[i][0]]
        i += 1
    base = _base_value(toks[i][0])
    if base is None:
        return None
    had_digit_k = toks[i][0][0].isdigit() and toks[i][0].endswith("k")
    total, current, j, had_mult = 0.0, base + frac, i + 1, had_digit_k
    # English compounds: "twenty five"
    if toks[i][0] in ENGLISH_TENS and j < n and toks[j][0] in ENGLISH_UNITS:
        current += ENGLISH_UNITS[toks[j][0]]
        j += 1
    while j < n:
        tok = toks[j][0]
        if tok in MULTIPLIERS:
            mult = MULTIPLIERS[tok]
            if mult == 100:
                current *= 100
            else:
                total += current * mult
                current = 0
            had_mult = True
            j += 1
            continue
        # "do hazaar paanch sau" -> keep adding after a multiplier
        nxt = _base_value(tok) if had_mult and current == 0 else None
        if nxt is not None and j + 1 < n and toks[j + 1][0] in MULTIPLIERS:
            current = nxt
            j += 1
            continue
        break
    had_currency = (i > 0 and toks[i - 1][0] in CURRENCY) or (j < n and toks[j][0] in CURRENCY)
    return total + current, j, had_mult, had_currency


def find_amounts(text: str, context_multiplier: int | None = None) -> list[Amount]:
    """All numeric quantities in `text`, with money detection and ranges."""
    toks = _tokens(text)
    out: list[Amount] = []
    i = 0
    while i < len(toks):
        q = _read_quantity(toks, i)
        if q is None:
            i += 1
            continue
        value, j, had_mult, had_cur = q
        first_tok = toks[i][0]
        low = high = value
        is_range = False
        # Range: "saat-aath hazaar", "7-8 hazaar", "saat aath hazaar", "7000 se 8000", "7000 to 8000"
        k = j
        if k < len(toks) and toks[k][0] in _RANGE_WORDS:
            k += 1
        if k < len(toks) and (k > j or not had_mult):
            q2 = _read_quantity(toks, k)
            if q2 is not None and (k > j or q2[2]):
                v2, j2, mult2, cur2 = q2
                if not had_mult and mult2 and value < 100:
                    # "saat-aath hazaar": the second number's multiplier applies to both
                    scale = v2 / _base_value(toks[k][0]) if _base_value(toks[k][0]) else 1
                    low, high = value * scale, v2
                    is_range, j, had_mult, had_cur = True, j2, True, had_cur or cur2
                elif had_mult and mult2 and toks[j][0] in _RANGE_WORDS:
                    low, high = value, v2
                    is_range, j, had_cur = True, j2, had_cur or cur2
                elif not had_mult and not mult2 and toks[j][0] in _RANGE_WORDS and value >= 100 and v2 >= 100:
                    low, high = value, v2
                    is_range, j = True, j2
        if first_tok in _AMBIGUOUS_WORDS and not had_mult and not is_range:
            i = j
            continue
        if not had_mult and not is_range and context_multiplier and value < 100:
            value = low = high = value * context_multiplier
            had_mult = True
        is_money = had_mult or had_cur or (first_tok[0].isdigit() and value >= 100)
        start, end = toks[i][1], toks[j - 1][2]
        out.append(Amount(
            value=None if is_range else int(round(value)),
            low=int(round(low)), high=int(round(high)),
            is_range=is_range, is_money=is_money,
            text=text[start:end], start=start, end=end,
        ))
        i = j
    return out


def parse_amount(text: str, context_multiplier: int | None = None) -> int | None:
    """The first single money amount in `text`, or None."""
    for a in find_amounts(text, context_multiplier):
        if a.is_money and not a.is_range:
            return a.value
    return None


# ---------------------------------------------------------------- dates

WEEKDAYS: dict[str, int] = {
    "monday": 0, "mon": 0, "somvar": 0, "somwar": 0, "som": 0,
    "tuesday": 1, "tue": 1, "tues": 1, "mangalvar": 1, "mangalwar": 1, "mangal": 1,
    "wednesday": 2, "wed": 2, "budhvar": 2, "budhwar": 2, "budh": 2,
    "thursday": 3, "thu": 3, "thurs": 3, "guruvar": 3, "guruwar": 3, "brihaspativar": 3, "veervar": 3,
    "friday": 4, "fri": 4, "shukravar": 4, "shukrawar": 4, "shukra": 4,
    "saturday": 5, "sat": 5, "shanivar": 5, "shaniwar": 5, "shani": 5,
    "sunday": 6, "sun": 6, "ravivar": 6, "raviwar": 6, "itvaar": 6, "itwar": 6, "etwar": 6,
}
MONTHS: dict[str, int] = {
    m: i + 1 for i, names in enumerate([
        ("january", "jan"), ("february", "feb"), ("march", "mar"), ("april", "apr"), ("may",),
        ("june", "jun"), ("july", "jul"), ("august", "aug"), ("september", "sep", "sept"),
        ("october", "oct"), ("november", "nov"), ("december", "dec"),
    ]) for m in names
}
_NEXT_WORDS = {"agle", "agla", "agli", "next", "aane", "coming"}
_THIS_WORDS = {"is", "this", "isi"}

_RELATIVE = [
    (re.compile(r"\b(aaj|aj|today)\b"), 0),
    (re.compile(r"\b(day after tomorrow)\b"), 2),
    (re.compile(r"\b(kal|kl|tomorrow)\b"), 1),
    (re.compile(r"\b(parso|parson|parsoon)\b"), 2),
    (re.compile(r"\b(narso|narson)\b"), 3),
]
_WEEK = re.compile(r"\b(agle|next|aane wale)\s+(hafte|week|haftey)\b")
_IN_DAYS = re.compile(r"\b(\d+|ek|do|teen|char|chaar|paanch|das|one|two|three|four|five|ten)\s+(din|dino|days?)\s*(mein|me|main|mai|in|baad|later)?\b")
_IN_DAYS_EN = re.compile(r"\bin\s+(\d+|one|two|three|four|five|ten)\s+days?\b")
_A_WEEK = re.compile(r"\b(ek hafte|ek hafta|a week|one week)\s*(mein|me|main|mai|in)?\b")
_WEEKDAY = re.compile(r"\b(?:(agle|agla|agli|next|aane wale|coming|is|this|isi)\s+)?(" + "|".join(sorted(WEEKDAYS, key=len, reverse=True)) + r")\b")
_TARIKH = re.compile(r"\b(\d{1,2})\s*(tarikh|tareekh|taarikh|date)\b")
_DAY_MONTH = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(" + "|".join(MONTHS) + r")\b")
_MONTH_DAY = re.compile(r"\b(" + "|".join(MONTHS) + r")\s+(\d{1,2})(?:st|nd|rd|th)?\b")
_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


@dataclass
class DateMatch:
    value: date
    text: str
    start: int
    end: int


def _weekday_date(today: date, weekday: int, modifier: str | None) -> date:
    days = (weekday - today.weekday()) % 7 or 7  # a bare weekday is never today
    if modifier in _NEXT_WORDS or modifier == "aane wale":
        # "agle Sunday": the one in next week when this week's is still ahead
        if days <= 6 - today.weekday():
            days += 7
    return today + timedelta(days=days)


def _day_of_month(today: date, day: int, month: int | None = None) -> date | None:
    """'5 tarikh' -> the next 5th; '10 October' -> this year's, or next year's if passed."""
    try:
        if month is None:
            d = date(today.year, today.month, day)
            if d < today:
                m = today.month % 12 + 1
                d = date(today.year + (m == 1), m, day)
        else:
            d = date(today.year, month, day)
            if d < today:
                d = date(today.year + 1, month, day)
    except ValueError:
        return None
    return d


_SMALL = {"ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "das": 10,
          "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "ten": 10}


def find_dates(text: str, today: date) -> list[DateMatch]:
    low = text.lower()
    found: list[DateMatch] = []
    taken: list[tuple[int, int]] = []

    def add(m: re.Match, value: date | None) -> None:
        if value is None:
            return
        s, e = m.span()
        if any(s < te and e > ts for ts, te in taken):
            return
        taken.append((s, e))
        found.append(DateMatch(value, text[s:e], s, e))

    for m in _ISO.finditer(low):
        try:
            add(m, date(int(m.group(1)), int(m.group(2)), int(m.group(3))))
        except ValueError:
            pass
    for m in _DAY_MONTH.finditer(low):
        add(m, _day_of_month(today, int(m.group(1)), MONTHS[m.group(2)]))
    for m in _MONTH_DAY.finditer(low):
        add(m, _day_of_month(today, int(m.group(2)), MONTHS[m.group(1)]))
    for m in _TARIKH.finditer(low):
        add(m, _day_of_month(today, int(m.group(1))))
    for m in _WEEK.finditer(low):
        add(m, today + timedelta(days=7 - today.weekday()))  # next Monday
    for m in _A_WEEK.finditer(low):
        add(m, today + timedelta(days=7))
    for pattern in (_IN_DAYS_EN, _IN_DAYS):
        for m in pattern.finditer(low):
            n = m.group(1)
            add(m, today + timedelta(days=int(n) if n.isdigit() else _SMALL[n]))
    for m in _WEEKDAY.finditer(low):
        word = m.group(2)
        # "sat"/"sun"/"mar"/"som" are also common words; accept short forms only with a modifier
        if len(word) <= 4 and word not in {"tues", "thurs"} and not m.group(1):
            continue
        add(m, _weekday_date(today, WEEKDAYS[word], m.group(1)))
    for pattern, offset in _RELATIVE:
        for m in pattern.finditer(low):
            add(m, today + timedelta(days=offset))
    found.sort(key=lambda d: d.start)
    return found


def parse_date(text: str, today: date) -> date | None:
    matches = find_dates(text, today)
    return matches[0].value if matches else None
