"""Change orders, settlements and money helpers (A1/A3). Port of frontend/lib/amend.ts and lib/terms.ts.

The sealed agreement never changes. Each change order / settlement is sealed on its own, over
canonical JSON exactly like the frontend's hashAmendment(), and names the hash before it.
"""

from __future__ import annotations

import copy
import re
from datetime import date, timedelta

from app.v1.numbers import find_amounts, find_days
from app.v1.seal import canonical, hash_agreement, sha256_hex

SCOPE_WORDS = [
    (r"balcony|balkani", {"en": "Balcony", "hi": "बालकनी"}),
    (r"ceiling|chhat|chhath", {"en": "Ceilings", "hi": "छत"}),
    (r"\bgate\b", {"en": "Main gate", "hi": "मेन गेट"}),
    (r"grill|jaali", {"en": "Window grills", "hi": "खिड़की की ग्रिल"}),
    (r"door|darwaz", {"en": "Doors", "hi": "दरवाज़े"}),
    (r"kitchen|rasoi", {"en": "Kitchen", "hi": "किचन"}),
    (r"bathroom|toilet|washroom", {"en": "Bathroom", "hi": "बाथरूम"}),
    (r"\bhall\b|living", {"en": "Hall / living room", "hi": "हॉल"}),
    (r"(ek|do|teen|1|2|3)?\s*(aur|extra|more)?\s*bedroom", {"en": "Extra bedroom", "hi": "एक और बेडरूम"}),
    (r"pipe|tap|\bnal\b", {"en": "Extra plumbing point", "hi": "एक और नल/पाइप"}),
    (r"switch|socket|fan|pankha", {"en": "Extra electrical point", "hi": "एक और बिजली पॉइंट"}),
]
REMOVE = re.compile(r"\b(nahi|nahin|mat|hata|remove|cancel|chhod|skip|no longer|drop)\b", re.IGNORECASE)
LESS = re.compile(r"\b(kam|less|minus|ghata|discount|chhoot)\b", re.IGNORECASE)


def extract_delta(segments: list[dict]) -> dict:
    """Only what changed: added/removed scope, price change, extra days. Mirrors extractDelta()."""
    text = " ".join(s.get("text", "") for s in segments)
    removing = bool(REMOVE.search(text))
    items = [item for pattern, item in SCOPE_WORDS if re.search(pattern, text, re.IGNORECASE)]
    amounts = [a for s in segments for a in find_amounts(s.get("text", ""))]
    amount = amounts[0].value if amounts else 0
    days = next((d for d in (find_days(s.get("text", "")) for s in segments) if d is not None), 0)
    price_change = (-amount if (LESS.search(text) or removing) else amount) if amount else 0
    return {
        "addScope": [] if removing else items,
        "removeScope": items if removing else [],
        "priceChange": price_change,
        "extraDays": -days if (removing and days) else days,
        "note": text[:157] + "…" if len(text) > 160 else text,
    }


def with_milestone_for_change(delta: dict, terms: dict, index: int) -> dict:
    if not terms.get("milestones") or delta["priceChange"] <= 0:
        return delta
    label = ", ".join(s["en"] for s in delta["addScope"]) or "Change"
    label_hi = ", ".join(s["hi"] for s in delta["addScope"]) or "बदलाव"
    m = {"id": f"c{index}", "title": f"{label} (change)", "titleHi": f"{label_hi} (बदलाव)", "amount": delta["priceChange"]}
    return {**delta, "addMilestones": [m]}


# ---- sealing ----

AMENDMENT_KEYS = ("id", "createdAt", "source", "description", "transcript", "delta", "parentHash", "confirmations")


def amendment_payload(am: dict) -> dict:
    return {k: am[k] for k in AMENDMENT_KEYS if k in am and am[k] is not None}


def hash_amendment(am: dict) -> str:
    return sha256_hex(canonical(amendment_payload(am)))


def sealed_amendments(a: dict) -> list[dict]:
    return [am for am in (a.get("amendments") or []) if am.get("hash")]


def chain_head(a: dict) -> str | None:
    sealed = sealed_amendments(a)
    return sealed[-1]["hash"] if sealed else a.get("hash")


def verify_chain(a: dict) -> dict:
    """Agreement seal, then each sealed amendment's own hash and its link to the one before."""
    if not a.get("hash") or hash_agreement(a) != a["hash"]:
        return {"ok": False, "checked": 0, "broken": a.get("id")}
    head, checked = a["hash"], 1
    for am in sealed_amendments(a):
        if am.get("parentHash") != head or hash_amendment(am) != am["hash"]:
            return {"ok": False, "checked": checked, "broken": am.get("id")}
        head, checked = am["hash"], checked + 1
    return {"ok": True, "checked": checked}


# ---- effective terms and money ----

def add_days(iso: str, days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=days)).isoformat()


def effective_terms(a: dict) -> dict:
    t = copy.deepcopy(a.get("terms") or {})
    for am in sealed_amendments(a):
        d = am.get("delta") or {}
        removed = {s["en"] for s in d.get("removeScope", [])}
        scope = [s for s in t.get("scope", []) if s["en"] not in removed]
        scope += [s for s in d.get("addScope", []) if not any(x["en"] == s["en"] for x in t.get("scope", []))]
        excluded = t.get("excluded", []) + [s for s in d.get("removeScope", []) if not any(x["en"] == s["en"] for x in t.get("excluded", []))]
        extra = d.get("extraDays", 0)
        t["scope"], t["excluded"] = scope, excluded
        if t.get("price") is not None:
            t["price"] = t["price"] + d.get("priceChange", 0)
        if t.get("durationDays") is not None:
            t["durationDays"] = t["durationDays"] + extra
        if t.get("deadline") and extra:
            t["deadline"] = add_days(t["deadline"], extra)
        if d.get("addMilestones"):
            t["milestones"] = (t.get("milestones") or []) + d["addMilestones"]
    return t


def balance_due(t: dict) -> int | None:
    price, advance = t.get("price"), t.get("advance")
    if price is None:
        return None
    if not advance:
        return price
    return price if t.get("advanceAdjusted") is False else price - advance


def progress_of(a: dict, mid: str) -> dict:
    return (a.get("progress") or {}).get(mid) or {"status": "pending", "photos": []}


def paid_total(a: dict) -> int:
    return sum(p.get("amount", 0) for p in a.get("payments") or [])


def total_payable(a: dict) -> int:
    t = effective_terms(a)
    if t.get("price") is None:
        return 0
    return t["price"] + t["advance"] if t.get("advance") and t.get("advanceAdjusted") is False else t["price"]


def milestone_problem(t: dict) -> str | None:
    ms = t.get("milestones")
    if not ms:
        return None
    if len(ms) > 5:
        return "Use at most 5 milestones."
    if any(not (m.get("title") or "").strip() for m in ms):
        return "Every milestone needs a name."
    if any(not (m.get("amount") or 0) > 0 for m in ms):
        return "Every milestone needs an amount above ₹0."
    target, total = balance_due(t) or 0, sum(m["amount"] for m in ms)
    if total != target:
        return f"Milestones add up to ₹{total:,}, but the balance due is ₹{target:,}."
    return None
