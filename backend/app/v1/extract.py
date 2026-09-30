"""POST /v1/extract: terms + ambiguity flags in the frontend's Terms/Flag shape.

The deterministic rules are a port of frontend/lib/extract.ts, so flags are
explainable and identical in demo and live mode. Every flag is a question for
the two people; nothing is guessed.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

from app.v1.numbers import find_amounts, find_days, inr

JOB_PATTERNS: list[tuple[str, str]] = [
    (r"putai|paint|rang", "Painting"),
    (r"nal\b|pipe|plumb|leak|tanki", "Plumbing"),
    (r"wiring|bijli|switch|fan|electric", "Electrical"),
    (r"furniture|darwaz|lakdi|almari|carpent", "Carpentry"),
    (r"safai|jhadu|pocha|bartan|cleaning", "Domestic work"),
]

_BEDROOM_N = {"ek": 1, "do": 2, "teen": 3, "char": 4}


def _bedroom(m: re.Match) -> dict:
    g = (m.group(1) or "").lower()
    n = _BEDROOM_N.get(g) or (int(g) if g else 1)
    return {"en": f"{n} bedroom{'s' if n > 1 else ''}", "hi": f"{n} बेडरूम"}


SCOPE_PATTERNS = [
    (r"\b(ek|do|teen|char|1|2|3|4)?\s*bedroom", _bedroom),
    (r"\bhall\b|drawing ?room|living", lambda m: {"en": "Hall / living room", "hi": "हॉल"}),
    (r"kitchen|rasoi", lambda m: {"en": "Kitchen", "hi": "किचन"}),
    (r"bathroom|toilet|washroom", lambda m: {"en": "Bathroom", "hi": "बाथरूम"}),
    (r"balcony", lambda m: {"en": "Balcony", "hi": "बालकनी"}),
]


def _has(segs: list[dict], pattern: str) -> dict | None:
    return next((s for s in segs if re.search(pattern, s["text"], re.IGNORECASE)), None)


def detect_job_type(segs: list[dict], fallback: str = "General work") -> str:
    text = " ".join(s["text"] for s in segs)
    return next((job for pattern, job in JOB_PATTERNS if re.search(pattern, text, re.IGNORECASE)), fallback)


def extract(segs: list[dict], hints: dict | None = None, today: date | None = None) -> dict:
    hints = hints or {}
    today = today or date.today()
    job = hints.get("jobType")
    job_type = job if job and job != "Other" else detect_job_type(segs)

    # Scope
    scope: list[dict] = []
    for s in segs:
        for pattern, item in SCOPE_PATTERNS:
            m = re.search(pattern, s["text"], re.IGNORECASE)
            if m:
                it = item(m)
                if not any(x["en"] == it["en"] for x in scope):
                    scope.append(it)
    coat = _has(segs, r"coat")
    if coat:
        primer = bool(re.search(r"primer", coat["text"], re.IGNORECASE))
        scope.append({"en": f"Walls: 2 coats{', with primer' if primer else ''}",
                      "hi": f"दीवारें: 2 कोट{', प्राइमर के साथ' if primer else ''}"})

    # Money: the advance is the amount spoken closest to the word "advance"
    adv_idx: int | None = None
    advance: int | None = None
    best = float("inf")
    for idx, s in enumerate(segs):
        kw_m = re.search(r"advance|pehle de|abhi de", s["text"], re.IGNORECASE)
        if not kw_m:
            continue
        kw = kw_m.start()
        for amt in find_amounts(s["text"]):
            at = s["text"].find(amt.raw)
            dist = kw - (at + len(amt.raw)) if at <= kw else at - kw
            if dist < best:
                best, advance, adv_idx = dist, amt.value, idx
    if best > 25:
        advance, adv_idx = None, None
    price_seg = next((s for s in segs if re.search(r"poora|pura|kul|total|mein ho|ka padega|rate", s["text"], re.IGNORECASE)
                      and find_amounts(s["text"])), None)
    # Every amount except the advance itself (price and advance are often said in one breath).
    all_amounts = [a for idx, s in enumerate(segs) for a in find_amounts(s["text"]) if idx != adv_idx or a.value != advance]
    if price_seg:
        price = find_amounts(price_seg["text"])[0].value
    else:
        price = max((a.value for a in all_amounts), default=None)

    # Time
    day_seg = next((s for s in segs if find_days(s["text"]) is not None), None)
    duration = find_days(day_seg["text"]) if day_seg else None
    deadline = (today + timedelta(days=duration + 1)).isoformat() if duration else None

    # Materials, balance, payment mode
    mat_hirer = _has(segs, r"(paint|saaman|samaan|material).*(aap|aapka|aap laa)")
    mat_worker = _has(segs, r"(paint|saaman|samaan|material).*(main|mera|hum|included|shamil)")
    upi = _has(segs, r"upi|gpay|phonepe|paytm|bhim")
    cash = _has(segs, r"cash|nakad")

    terms = {
        "jobType": job_type,
        "location": hints.get("location") or "",
        "scope": scope,
        "excluded": [],
        "price": price,
        "advance": advance,
        "advanceAdjusted": None,
        "durationDays": duration,
        "deadline": deadline,
        "materialsBy": "hirer" if mat_hirer else "worker" if mat_worker else None,
        "balanceWhen": "On completion" if _has(segs, r"baaki|baki|balance|kaam ke baad|khatam hone par") else None,
        "paymentMode": "UPI" if upi else "Cash" if cash else None,
    }

    # ---- Ambiguity detector ----
    flags: list[dict] = []
    all_text = " ".join(s["text"] for s in segs)
    if job_type == "Painting" and not re.search(r"ceiling|chhat|chhath", all_text, re.IGNORECASE):
        flags.append({
            "id": "ceiling", "severity": "high", "resolved": False,
            "title": "Ceiling painting not discussed",
            "titleHi": "छत की पुताई पर बात नहीं हुई",
            "detail": "Rooms were named, but not whether ceilings are included. This is the most common painting dispute.",
            "options": [{"id": "include", "label": "Ceilings included in price"},
                        {"id": "exclude", "label": "Ceilings not included"}],
        })
    if terms["materialsBy"] is None:
        ev = _has(segs, r"saaman|samaan|material|paint")
        flag = {
            "id": "materials", "severity": "high", "resolved": False,
            "title": "Unclear who pays for paint and material",
            "titleHi": "सामान का खर्च कौन देगा, साफ़ नहीं",
            "detail": "Material was mentioned, but it is not clear whether its cost is inside the total.",
            "options": [{"id": "worker", "label": "Worker buys, included in total"},
                        {"id": "hirer", "label": "Hirer buys material separately"}],
        }
        if ev:
            flag["evidence"] = ev["text"]
        flags.append(flag)
    if advance is not None:
        balance = (price or 0) - advance
        flag = {
            "id": "advance", "severity": "medium", "resolved": False,
            "title": "Is the advance part of the total?",
            "titleHi": "क्या एडवांस कुल रकम में से कटेगा?",
            "detail": f"An advance of {inr(advance)} was agreed. Confirm whether the balance is {inr(balance)} or {inr(price)}.",
            "options": [{"id": "deducted", "label": f"Deducted — balance {inr(balance)}"},
                        {"id": "extra", "label": "Extra, on top of the total"}],
        }
        if adv_idx is not None:
            flag["evidence"] = segs[adv_idx]["text"]
        flags.append(flag)
    vague = _has(segs, r"agle hafte|jaldi|jald|kuch din|next week|soon")
    if not duration or vague:
        flag = {
            "id": "deadline", "severity": "medium", "resolved": False,
            "title": "Deadline is vague",
            "titleHi": "काम ख़त्म होने की तारीख़ साफ़ नहीं",
            "detail": (f"Both “{duration} days” and a loose phrase were used. Pin an exact finish date."
                       if duration else "No finish date was mentioned. Pin an exact date."),
            "input": "date",
        }
        evidence = (vague or day_seg or {}).get("text")
        if evidence:
            flag["evidence"] = evidence
        flags.append(flag)
    if not terms["balanceWhen"]:
        flags.append({
            "id": "balance", "severity": "medium", "resolved": False,
            "title": "When is the balance paid?",
            "titleHi": "बाक़ी पैसा कब मिलेगा?",
            "detail": "No payment schedule for the remaining amount was discussed.",
            "options": [{"id": "completion", "label": "Full balance on completion"},
                        {"id": "midway", "label": "Half midway, rest on completion"}],
        })
    if not terms["paymentMode"]:
        flags.append({
            "id": "mode", "severity": "low", "resolved": False,
            "title": "Payment mode not discussed",
            "titleHi": "भुगतान का तरीका तय नहीं",
            "detail": "UPI keeps an automatic record linked to this agreement.",
            "options": [{"id": "UPI", "label": "UPI (recommended)"}, {"id": "Cash", "label": "Cash"}],
        })
    return {"terms": terms, "flags": flags}
