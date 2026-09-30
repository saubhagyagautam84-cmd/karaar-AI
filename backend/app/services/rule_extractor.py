"""Offline, deterministic agreement extractor (the LLM adapter's mock).

It follows the same rules as the LLM prompt (Appendix A1): never guess, quote
evidence for every value, and turn anything unsettled into an ambiguity.
It understands speaker-labelled transcripts ("Client: ...", "Worker: ...").
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from pydantic import BaseModel, Field

from app.schemas.agreement import Ambiguity
from app.services.normalizer import HINDI_NUMBERS, ENGLISH_UNITS, WEEKDAYS, find_amounts, find_dates


class ExtractedEvidence(BaseModel):
    field: str
    quote: str


class ExtractionResult(BaseModel):
    """What an extractor returns. Shared by the rule engine and the LLM (structured output)."""

    language_detected: list[str] = Field(default_factory=list)
    worker_trade: str | None = None
    scope: str | None = None
    scope_local: str | None = None
    price_inr: int | None = None
    advance_inr: int | None = None
    materials_provided_by: str | None = None  # client | worker | shared
    start_date: str | None = None             # ISO date
    deadline: str | None = None               # ISO date
    conditions: list[str] = Field(default_factory=list)
    conditions_local: list[str] = Field(default_factory=list)
    ambiguities: list[Ambiguity] = Field(default_factory=list)
    evidence: list[ExtractedEvidence] = Field(default_factory=list)


# ------------------------------------------------------------------ helpers

ROLE_WORDS = {
    "client": ("client", "customer", "grahak", "malik", "owner", "homeowner", "didi", "madam", "sir"),
    "worker": ("worker", "karigar", "kaarigar", "mistri", "painter", "plumber", "electrician",
               "carpenter", "driver", "bai", "maid", "labour", "mazdoor"),
}
_SPEAKER = re.compile(r"^\s*([A-Za-zऀ-ॿ ]{2,20}?)\s*[:：]\s*(.+)$")
OTHER = {"client": "worker", "worker": "client"}
ROLE_HI = {"client": "ग्राहक", "worker": "कारीगर"}
ROLE_EN = {"client": "Client", "worker": "Worker"}


@dataclass
class Utterance:
    idx: int
    role: str | None
    text: str
    clauses: list[str] = field(default_factory=list)


def split_utterances(transcript: str) -> list[Utterance]:
    out: list[Utterance] = []
    for raw in transcript.splitlines():
        line = raw.strip()
        if not line:
            continue
        role, text = None, line
        m = _SPEAKER.match(line)
        if m:
            label = m.group(1).strip().lower()
            for r, words in ROLE_WORDS.items():
                if any(label == w or label.startswith(w) for w in words):
                    role, text = r, m.group(2).strip()
                    break
        clauses = [c.strip() for c in re.split(r"[,.;!?।]+", text) if c.strip()]
        out.append(Utterance(len(out), role, text, clauses))
    return out


def quote(text: str, max_words: int = 12) -> str:
    words = text.strip().strip(",.;").split()
    return " ".join(words[:max_words])


def _has(pattern: str, text: str) -> re.Match | None:
    return re.search(pattern, text, re.IGNORECASE)


def rupees(n: int) -> str:
    return f"₹{n:,}" if n < 100_000 else "₹" + _indian_group(n)


def _indian_group(n: int) -> str:
    s = str(n)
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return ",".join(parts + [tail])


# ------------------------------------------------------------------ language

_HI_MARKERS = re.compile(
    r"\b(hai|hain|karna|karne|kitna|theek|thik|aap|main|hazaar|kal|parso|dena|lagega|lagayenge|tak|"
    r"se|bhaiya|ji|kar|dunga|dungi|hoga|jayega|chalo|haan|nahi|kya|ka|ki|ke|aur)\b",
    re.IGNORECASE,
)
_EN_MARKERS = re.compile(
    r"\b(the|need|i|i'll|make|deal|work|and|rupees|fix|will|done|this|pay|now|okay|bring|final)\b",
    re.IGNORECASE,
)


def detect_languages(text: str) -> list[str]:
    hi = len(_HI_MARKERS.findall(text)) + (5 if re.search(r"[ऀ-ॿ]", text) else 0)
    en = len(_EN_MARKERS.findall(text))
    langs = sorted(((hi, "hi"), (en, "en")), reverse=True)
    return [lang for count, lang in langs if count >= 2] or ["hi"]


# ------------------------------------------------------------------ trade + scope

TRADES = [
    ("painter", r"\b(paint\w*|rang|putty|pent)\b"),
    ("plumber", r"\b(tap|nal|sink|pipe|leak\w*|flush|geyser|tanki|plumb\w*)\b"),
    ("electrician", r"\b(wiring|switch|fan|pankha|bijli ka|light|mcb|socket|electric\w*)\b"),
    ("carpenter", r"\b(carpenter|cupboard|almari|almaari|darwaza|darwaze|door|doors|bed|furniture ban|hinge\w*|lakdi|wood)\b"),
    ("domestic help", r"\b(safai|jhadu|pocha|bartan|khana banana|cook\w*|cleaning|maid)\b"),
    ("driver", r"\b(driver|drive|gaadi chala|car chala|driving)\b"),
]


def detect_trade(text: str) -> str | None:
    for trade, pattern in TRADES:
        if _has(pattern, text):
            return trade
    return None


# Hinglish verb phrases -> (English verb, Hindi verb)
VERBS = [
    (r"paint (?:karne|karna|karwana|karwane|karani|karwani|kar)(?: (?:hain|hai|he|dena|do))?", ("Paint", "पेंट करना")),
    (r"(?:theek|thik|sahi|repair|marammat) (?:karna|karne|karwana|karwane|kar)(?: (?:hain|hai|he|dena|do))?", ("Fix", "ठीक करना")),
    (r"(?:lagana|lagane|lagwana|lagwane|fit karna|install karna)(?: (?:hain|hai))?", ("Install", "लगाना")),
    (r"(?:saaf|safai|clean) (?:karna|karni|karwana|karwani|kar)(?: (?:hain|hai))?", ("Clean", "साफ़ करना")),
    (r"(?:badalna|badalne|change karna|replace karna)(?: (?:hain|hai))?", ("Replace", "बदलना")),
    (r"(?:banana|banane|banwana)(?: (?:hain|hai))?", ("Make", "बनाना")),
]
EN_REQUEST = re.compile(
    r"\b(?:i|we)\s+(?:need|want|would like)\s+(?:(?:a|an)\s+[a-z]+\s+)?(?:to\s+)?(?:get\s+)?"
    r"(fix|paint|repair|install|clean|replace|build|make)\s+(.+)",
    re.IGNORECASE,
)
EN_VERB_HI = {"fix": "ठीक करना", "repair": "ठीक करना", "paint": "पेंट करना", "install": "लगाना",
              "clean": "साफ़ करना", "replace": "बदलना", "build": "बनाना", "make": "बनाना"}
FILLERS = r"\b(bhaiya|bhaiyya|bhai|ji|mujhe|humein|hamein|hume|please|zara|aapko|ek baat)\b"

# word -> (English, Hindi). None English = drop the word in English.
NOUNS: dict[str, tuple[str | None, str]] = {
    "bedroom": ("bedroom", "बेडरूम"), "bedrooms": ("bedroom", "बेडरूम"),
    "kamra": ("room", "कमरा"), "kamre": ("room", "कमरे"), "room": ("room", "कमरा"), "rooms": ("room", "कमरे"),
    "kitchen": ("kitchen", "किचन"), "bathroom": ("bathroom", "बाथरूम"), "toilet": ("toilet", "टॉयलेट"),
    "sink": ("sink", "सिंक"), "tap": ("tap", "नल"), "nal": ("tap", "नल"),
    "pankha": ("fan", "पंखा"), "pankhe": ("fan", "पंखे"), "fan": ("fan", "पंखा"),
    "switch": ("switch", "स्विच"), "wiring": ("wiring", "वायरिंग"), "pipe": ("pipe", "पाइप"),
    "darwaza": ("door", "दरवाज़ा"), "darwaze": ("door", "दरवाज़े"), "door": ("door", "दरवाज़ा"), "doors": ("door", "दरवाज़े"),
    "khidki": ("window", "खिड़की"), "almari": ("cupboard", "अलमारी"), "almaari": ("cupboard", "अलमारी"),
    "cupboard": ("cupboard", "अलमारी"), "bed": ("bed", "बेड"), "geyser": ("geyser", "गीज़र"),
    "deewar": ("wall", "दीवार"), "deewarein": ("walls", "दीवारें"), "deewaren": ("walls", "दीवारें"),
    "walls": ("walls", "दीवारें"), "wall": ("wall", "दीवार"), "chhat": ("ceiling", "छत"), "ceiling": ("ceiling", "छत"),
    "ghar": ("house", "घर"), "sirf": ("only", "सिर्फ़"), "only": ("only", "सिर्फ़"),
    "aur": ("and", "और"), "and": ("and", "और"), "ka": (None, "का"), "ki": (None, "की"), "ke": (None, "के"),
    "hinges": ("hinges", "कब्ज़े"), "screws": ("screws", "पेंच"), "the": ("the", ""), "one": ("one", "1"),
}
_NUM = {**{k: v for k, v in HINDI_NUMBERS.items() if v == int(v)}, **ENGLISH_UNITS}


def _translate_object(text: str) -> tuple[str, str]:
    en: list[str] = []
    hi: list[str] = []
    count: int | None = None
    for tok in re.findall(r"[A-Za-z]+|\d+", text):
        low = tok.lower()
        if low.isdigit() or (low in _NUM and low not in {"one"}):
            count = int(low) if low.isdigit() else int(_NUM[low])
            en.append(str(count))
            hi.append(str(count))
            continue
        if low in NOUNS:
            e, h = NOUNS[low]
            if e is not None:
                if count and count > 1 and not e.endswith("s") and e not in {"only", "and", "the"}:
                    e += "s"
                en.append(e)
            if h:
                hi.append(h)
        else:
            en.append(low)
            hi.append(low)
        if low not in _NUM:
            count = None if low not in {"ka", "ki", "ke"} else count
    return " ".join(en), " ".join(hi)


def build_scope(utts: list[Utterance]) -> tuple[str | None, str | None, str | None]:
    """Returns (scope_en, scope_hi, evidence_quote)."""
    ordered = [u for u in utts if u.role == "client"] + [u for u in utts if u.role != "client"]
    en_scope = hi_scope = ev = None
    for u in ordered:
        m = EN_REQUEST.search(u.text)
        if m:
            verb, obj = m.group(1).lower(), m.group(2).strip().rstrip(".!?")
            en_scope = f"{verb.capitalize()} {obj}"
            obj_en, obj_hi = _translate_object(obj)
            hi_scope = f"{obj_hi} {EN_VERB_HI[verb]}"
            ev = quote(m.group(0))
            break
        cleaned = re.sub(FILLERS, "", u.text, flags=re.IGNORECASE).strip()
        for pattern, (v_en, v_hi) in VERBS:
            vm = re.search(pattern, cleaned, re.IGNORECASE)
            if not vm:
                continue
            before = cleaned[: vm.start()].strip(" ,")
            after = cleaned[vm.end():].strip(" ,.!?")
            b_en, b_hi = _translate_object(before)
            en_scope = f"{v_en} {b_en}".strip()
            hi_scope = f"{b_hi} {v_hi}".strip()
            if after:
                a_en, a_hi = _translate_object(after)
                en_scope += f", {a_en}"
                hi_scope += f", {a_hi}"
            ev = quote(u.text)
            break
        if en_scope:
            break
    if not en_scope:
        return None, None, None
    # Extra detail said later: number of coats
    for u in utts:
        cm = re.search(r"\b(\w+) (coat|coats)\b", u.text, re.IGNORECASE)
        if cm:
            n = cm.group(1).lower()
            n = int(n) if n.isdigit() else int(_NUM.get(n, 0))
            if n:
                en_scope += f", {n} coat{'s' if n > 1 else ''}"
                hi_scope += f", {n} कोट"
        if cm:
            break
    return en_scope.rstrip(" ,") + ".", hi_scope.rstrip(" ,") + "।", ev


# ------------------------------------------------------------------ money

ADV_CUE = r"\b(advance|adv|advans|upfront|token|bayana|peshgi|pehle|pahle|abhi|now)\b"
SETTLE = r"\b(final|fix|fixed|pakka|deal|done|confirm\w*|agreed)\b"
HEDGE = r"\b(dekhte hain|dekh lenge|dekhenge|lagbhag|takriban|around|approx\w*|about|shayad|maybe|ho jayega)\b"
ACCEPT = r"\b(theek|thik|ok|okay|done|deal|haan|han|chalo|sahi|agreed|fine|pakka)\b"


@dataclass
class MoneyMention:
    utt: Utterance
    value: int | None
    low: int
    high: int
    is_range: bool
    settle: bool
    hedge: bool
    text: str


def _money(utts: list[Utterance]) -> tuple[list[MoneyMention], list[MoneyMention]]:
    prices: list[MoneyMention] = []
    advances: list[MoneyMention] = []
    for u in utts:
        # A question about the advance ("Advance kitna?") in the previous turn,
        # with no amount of its own, makes this turn's first amount the advance.
        prev = utts[u.idx - 1] if u.idx > 0 else None
        prev_last = prev.clauses[-1] if prev and prev.clauses else ""
        prev_asked = bool(_has(r"\b(advance|adv)\b|pehle kitna|how much.*(now|upfront)", prev_last)
                          and not [a for a in find_amounts(prev_last) if a.is_money])
        per_clause = [(c, [a for a in find_amounts(c) if a.is_money]) for c in u.clauses]
        n_amounts = sum(len(a) for _, a in per_clause)
        first = True
        for clause, amounts in per_clause:
            cues = [m.start() for m in re.finditer(ADV_CUE, clause, re.IGNORECASE)]
            adv_index = None
            if cues and amounts:
                adv_index = min(range(len(amounts)),
                                key=lambda i: min(abs(amounts[i].start - c) for c in cues))
            elif prev_asked and first and amounts and n_amounts == 1:
                adv_index = 0
            for i, a in enumerate(amounts):
                mention = MoneyMention(
                    utt=u, value=a.value, low=a.low, high=a.high, is_range=a.is_range,
                    # settling words count in the same clause, or anywhere in a one-amount turn
                    settle=bool(_has(SETTLE, clause) or (n_amounts == 1 and _has(SETTLE, u.text))),
                    hedge=bool(_has(HEDGE, u.text)), text=quote(clause),
                )
                (advances if i == adv_index else prices).append(mention)
            if amounts:
                first = False
    return prices, advances


def _decide_price(prices: list[MoneyMention], utts: list[Utterance]):
    """Returns (value, evidence_quote, ambiguity)."""
    if not prices:
        return None, None, None
    settled = [p for p in prices if p.settle and not p.is_range and not p.hedge]
    if settled:
        last = settled[-1]
        later = [p for p in prices if p.utt.idx > last.utt.idx and p.value != last.value]
        if not later:
            return last.value, last.text, None
    ranges = [p for p in prices if p.is_range]
    if ranges and not settled:
        r = ranges[-1]
        span = f"{rupees(r.low)}–{rupees(r.high)}"
        return None, None, Ambiguity(
            field="price_inr",
            question_en=f"Only a range was said ({span}) and no final price was agreed. What is the final price?",
            question_local=f"{span} की बात हुई, पर पक्का दाम तय नहीं हुआ। कुल कितने पैसे तय हुए?",
        )
    values = sorted({p.value for p in prices if p.value is not None})
    if len(values) == 1 and not any(p.hedge for p in prices):
        p = prices[-1]
        nxt = utts[p.utt.idx + 1] if p.utt.idx + 1 < len(utts) else None
        accepted = nxt and nxt.role != p.utt.role and _has(ACCEPT, nxt.text) \
            and not [a for a in find_amounts(nxt.text) if a.is_money]
        if accepted:
            return p.value, p.text, None
        return None, None, Ambiguity(
            field="price_inr",
            question_en=f"{rupees(values[0])} was mentioned but not clearly agreed. Is {rupees(values[0])} the final price?",
            question_local=f"{rupees(values[0])} की बात हुई, पर पक्का नहीं हुआ। क्या {rupees(values[0])} ही पक्का दाम है?",
        )
    listed = ", ".join(rupees(v) for v in values)
    if any(p.hedge for p in prices):
        return None, None, Ambiguity(
            field="price_inr",
            question_en=f"The price ({listed}) was said loosely, not fixed. What is the final price?",
            question_local=f"दाम ({listed}) पक्का नहीं हुआ। कुल कितने पैसे तय हुए?",
        )
    return None, None, Ambiguity(
        field="price_inr",
        question_en=f"Different prices were said ({listed}) and none was clearly agreed. What is the final price?",
        question_local=f"अलग-अलग दाम बोले गए ({listed})। आख़िर में कितने पैसे तय हुए?",
    )


def _decide_advance(advances: list[MoneyMention]):
    if not advances:
        return None, None, None
    values = sorted({a.value for a in advances if a.value is not None})
    if len(values) == 1 and not any(a.is_range or a.hedge for a in advances):
        return values[0], advances[-1].text, None
    listed = ", ".join(rupees(v) for v in values) or f"{rupees(advances[-1].low)}–{rupees(advances[-1].high)}"
    return None, None, Ambiguity(
        field="advance_inr",
        question_en=f"The advance was not clear ({listed}). How much advance will be paid?",
        question_local=f"एडवांस साफ़ नहीं है ({listed})। कितना एडवांस मिलेगा?",
    )


# ------------------------------------------------------------------ materials

MAT_SECOND = (r"\b(aap|aapko|tum|you)\b.*\b(laa|la|laana|lana|laaye|laiye|le aana|le aao|lao|lekar aana|"
              r"bring|buy|arrange|provide|kharid\w*)\b")
MAT_FIRST = (r"\b(i|i'll|ill|main|mai|hum|we|we'll)\b.*\b(bring|laaunga|launga|laaungi|laungi|layenge|"
             r"laayenge|laa dunga|la dunga|le aaunga|arrange|provide|buy|kharid\w*|laa|la)\b")
MAT_OWN = r"\b(material|saamaan|samaan|maal)\b.*\b(mera|meri|hamara|mine|ours)\b"
MAT_YOURS = r"\b(material|saamaan|samaan|maal)\b.*\b(aapka|aapki|tumhara|yours)\b"


def _materials(utts: list[Utterance]):
    roles: set[str] = set()
    ev: str | None = None
    for u in utts:
        if u.role is None:
            continue
        for clause in u.clauses:
            role = None
            if _has(MAT_SECOND, clause) or _has(MAT_YOURS, clause):
                role = OTHER[u.role]
            elif _has(MAT_FIRST, clause) or _has(MAT_OWN, clause):
                role = u.role
            if role:
                roles.add(role)
                ev = ev or quote(clause)
    if not roles:
        return None, None
    return ("shared" if len(roles) > 1 else roles.pop()), ev


# ------------------------------------------------------------------ dates

DEADLINE_CUE = r"\b(tak|by|khatam|khatm|done|finish\w*|complete\w*|poora|pura|deadline|before|ho jayega)\b"
START_CUE = r"\b(se|shuru|start\w*|begin|aa jao|aa jaana|aaunga|aaungi|aa jaunga|aa jaungi|from|chalu|aana|aaiye|come)\b"


def _dates(utts: list[Utterance], today: date):
    start = deadline = None
    start_q = deadline_q = None
    deadline_is_weekday = False
    for u in utts:
        for clause in u.clauses:
            found = find_dates(clause, today)
            if not found:
                continue
            d = found[-1]
            if _has(DEADLINE_CUE, clause):
                deadline, deadline_q = d.value, quote(clause)
                deadline_is_weekday = any(w in d.text.lower().split() for w in WEEKDAYS)
            elif _has(START_CUE, clause):
                start, start_q = d.value, quote(clause)
    # "Parso se shuru, Tuesday tak" - a weekday deadline means the one after the start
    if start and deadline and deadline < start and deadline_is_weekday:
        while deadline < start:
            deadline += timedelta(days=7)
    return start, start_q, deadline, deadline_q


# ------------------------------------------------------------------ conditions

def _doer(clause: str, speaker: str | None) -> str:
    if _has(r"\b(dunga|dungi|karunga|karungi|i'll|i will|main|mai|hum)\b", clause) and speaker:
        return speaker
    if _has(r"\b(aap|you|tum|dena|dijiye)\b", clause) and speaker:
        return OTHER[speaker]
    return "client"


def _conditions(utts: list[Utterance]):
    en: list[str] = []
    hi: list[str] = []
    ev: list[str] = []
    for u in utts:
        for clause in u.clauses:
            if _has(r"\b(furniture|saamaan|samaan)\b.*\b(hata\w*|remove|shift|khali)\b", clause):
                who = _doer(clause, u.role)
                en.append(f"{ROLE_EN[who]} removes furniture before work starts.")
                hi.append(f"काम से पहले {ROLE_HI[who]} फ़र्नीचर हटाएँगे।")
                ev.append(quote(clause))
            elif _has(r"\b(safai|saaf|clean\w*)\b.*\b(baad|after)\b|\b(after|baad)\b.*\b(safai|saaf|clean\w*)\b", clause):
                who = _doer(clause, u.role)
                en.append(f"{ROLE_EN[who]} cleans up after the work.")
                hi.append(f"काम के बाद {ROLE_HI[who]} सफ़ाई करेंगे।")
                ev.append(quote(clause))
            elif _has(r"\b(der|deri|late|delay\w*|penalty|kaat\w*)\b", clause):
                en.append(f"If the work is late: {quote(clause, 20)}")
                hi.append(f"देर होने पर: {quote(clause, 20)}")
                ev.append(quote(clause))
    return en, hi, ev


# ------------------------------------------------------------------ main

def extract(transcript: str, today: date) -> ExtractionResult:
    utts = split_utterances(transcript)
    full = " ".join(u.text for u in utts)
    result = ExtractionResult(language_detected=detect_languages(full), worker_trade=detect_trade(full))
    evidence: list[ExtractedEvidence] = []
    ambiguities: list[Ambiguity] = []

    scope, scope_hi, scope_q = build_scope(utts)
    if scope:
        result.scope, result.scope_local = scope, scope_hi
        evidence.append(ExtractedEvidence(field="scope", quote=scope_q))

    prices, advances = _money(utts)
    price, price_q, price_amb = _decide_price(prices, utts)
    advance, adv_q, adv_amb = _decide_advance(advances)
    result.price_inr, result.advance_inr = price, advance
    if price is not None:
        evidence.append(ExtractedEvidence(field="price_inr", quote=price_q))
    if advance is not None:
        evidence.append(ExtractedEvidence(field="advance_inr", quote=adv_q))
    ambiguities += [a for a in (price_amb, adv_amb) if a]

    materials, mat_q = _materials(utts)
    if materials:
        result.materials_provided_by = materials
        evidence.append(ExtractedEvidence(field="materials_provided_by", quote=mat_q))

    start, start_q, deadline, deadline_q = _dates(utts, today)
    if start:
        result.start_date = start.isoformat()
        evidence.append(ExtractedEvidence(field="start_date", quote=start_q))
    if deadline:
        result.deadline = deadline.isoformat()
        evidence.append(ExtractedEvidence(field="deadline", quote=deadline_q))

    result.conditions, result.conditions_local, cond_q = _conditions(utts)
    evidence += [ExtractedEvidence(field="conditions", quote=q) for q in cond_q]

    result.evidence = evidence
    result.ambiguities = ambiguities
    return result
