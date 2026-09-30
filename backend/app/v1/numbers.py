"""Port of frontend/lib/numbers.ts, kept behaviour-for-behaviour identical so the
backend's extraction highlights and flags match what the frontend shows."""

from __future__ import annotations

import re
from dataclasses import dataclass

UNITS: dict[str, float] = {
    "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5, "chhe": 6, "chhah": 6, "cheh": 6,
    "saat": 7, "aath": 8, "nau": 9, "das": 10, "gyarah": 11, "gyaarah": 11, "barah": 12, "baarah": 12, "terah": 13,
    "chaudah": 14, "pandrah": 15, "solah": 16, "satrah": 17, "atharah": 18, "athaarah": 18, "athara": 18,
    "unnis": 19, "unees": 19, "bees": 20, "pachees": 25, "pachchees": 25, "tees": 30, "chaalees": 40, "chalees": 40,
    "pachaas": 50, "pachas": 50, "saath": 60, "sattar": 70, "assi": 80, "nabbe": 90,
}
FRACTIONS: dict[str, float] = {"dedh": 1.5, "dhai": 2.5, "dhaai": 2.5}
MULTIPLIERS: dict[str, int] = {"sau": 100, "hazaar": 1000, "hazar": 1000, "hajar": 1000, "lakh": 100000, "lac": 100000}

_DIGITS = re.compile(r"^₹?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k)?$")


@dataclass
class Amount:
    value: int
    raw: str


def _clean(w: str) -> str:
    return re.sub(r"[^a-z0-9₹,.]", "", w.lower())


def _js_round(x: float) -> int:
    # Math.round: halves go up, unlike Python's banker's rounding
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def find_amounts(text: str) -> list[Amount]:
    out: list[Amount] = []
    words = re.split(r"\s+", text)
    i = 0
    while i < len(words):
        w = _clean(words[i])
        if not w:
            i += 1
            continue
        dm = _DIGITS.match(w)
        if dm:
            v = float(dm.group(1).replace(",", ""))
            if dm.group(2):
                v *= 1000
            nxt = _clean(words[i + 1]) if i + 1 < len(words) else ""
            if nxt in MULTIPLIERS:
                v *= MULTIPLIERS[nxt]
                i += 1
            if v >= 100:
                out.append(Amount(_js_round(v), words[i].strip()))
            i += 1
            continue
        j = i
        mod = 0.0
        if w in ("saadhe", "sadhe"):
            mod, j = 0.5, j + 1
        elif w in ("sava", "savaa"):
            mod, j = 0.25, j + 1
        elif w == "paune":
            mod, j = -0.25, j + 1
        base = _clean(words[j]) if j < len(words) else ""
        n = UNITS.get(base, FRACTIONS.get(base))
        mult = MULTIPLIERS.get(_clean(words[j + 1]) if j + 1 < len(words) else "")
        if n is not None and mult:
            out.append(Amount(_js_round((n + mod) * mult), " ".join(words[i:j + 2])))
            i = j + 2
            continue
        i += 1
    return out


def find_days(text: str) -> int | None:
    m = re.search(r"(\d+|[a-z]+)\s+(din|days?)\b", text.lower())
    if not m:
        return None
    word = m.group(1)
    n = int(word) if word.isdigit() else UNITS.get(word)
    return int(n) if n is not None else None


def inr(n: int | None) -> str:
    if n is None:
        return "—"
    sign = "-" if n < 0 else ""
    s = str(abs(int(n)))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return f"₹{sign}{s}"
