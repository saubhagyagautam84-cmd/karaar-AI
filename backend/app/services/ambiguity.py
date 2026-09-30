"""Ambiguity rules that run in code, whatever the extractor said (Phase 2).

Also enforces the evidence rule: a value without a quote that can be found in
the transcript is dropped and turned into a question. Never guess.
"""

from __future__ import annotations

import re

from app.schemas.agreement import AgreementTerms, Ambiguity
from app.services.rule_extractor import rupees

# field -> (English, Hindi) generic question when the value is missing
MISSING: dict[str, tuple[str, str]] = {
    "scope": ("What exactly is the work?", "काम ठीक-ठीक क्या है?"),
    "price_inr": ("What is the final total price?", "कुल कितने पैसे तय हुए?"),
    "advance_inr": ("Will an advance be paid? How much?", "क्या एडवांस मिलेगा? कितना?"),
    "start_date": ("When will the work start?", "काम कब शुरू होगा?"),
    "deadline": ("By which date will the work be finished?", "काम किस तारीख तक पूरा होगा?"),
    "materials_provided_by": ("Who will buy the materials: the client or the worker?", "सामान कौन लाएगा: ग्राहक या कारीगर?"),
}
DELAY = ("What happens if the work is not finished by the deadline?",
         "अगर काम तय तारीख तक पूरा नहीं हुआ तो क्या होगा?")
CEILING = ("Is ceiling painting included?", "क्या छत की पेंटिंग भी शामिल है?")

# vague word -> field it makes unclear
VAGUE: list[tuple[str, str, tuple[str, str]]] = [
    (r"\b(jaldi|jald|asap|as soon as possible|soon)\b", "deadline",
     ("“{w}” is not a date. On which date will the work be finished?",
      "“{w}” कोई तारीख नहीं है। काम किस तारीख तक पूरा होगा?")),
    (r"\b(thoda kam|thoda|kam karo|make it less|reduce)\b", "price_inr",
     ("“{w}” was said, but no new price was fixed. What is the final price?",
      "“{w}” कहा गया, पर नया दाम तय नहीं हुआ। कुल कितने पैसे तय हुए?")),
    (r"\b(dekhte hain|dekh lenge|lagbhag|takriban|around|approximately)\b", "price_inr",
     ("“{w}” means nothing was fixed. What is the final price?",
      "“{w}” से कुछ पक्का नहीं हुआ। कुल कितने पैसे तय हुए?")),
    (r"\b(sab kuch|sabkuch|everything|wagairah|etc|baaki sab)\b", "scope",
     ("“{w}” is unclear. What exactly is included in the work?",
      "“{w}” साफ़ नहीं है। काम में ठीक-ठीक क्या-क्या शामिल है?")),
]
DELAY_WORDS = r"\b(der|deri|late|delay\w*|penalty|kaat\w*|time pe nahi)\b"


def _local(pair: tuple[str, str], lang: str | None) -> str:
    return pair[1] if (lang or "hi") == "hi" else pair[0]


def _norm(text: str) -> str:
    return re.sub(r"[^\wऀ-ॿ]+", " ", text.lower()).strip()


def enforce_evidence(terms: AgreementTerms, transcript: str) -> list[Ambiguity]:
    """Drop any value whose evidence quote is not in the transcript. Returns new ambiguities."""
    haystack = _norm(transcript)
    lang = terms.parties.worker.preferred_lang
    valid = [e for e in terms.evidence if e.source == "answer" or (_norm(e.quote) and _norm(e.quote) in haystack)]
    terms.evidence = valid
    backed = {e.field for e in valid}
    added: list[Ambiguity] = []
    for field in MISSING:
        if getattr(terms, field) is not None and field not in backed:
            setattr(terms, field, None)
            if field == "scope":
                terms.scope_local = None
            en, hi = MISSING[field]
            en = f"This was not clearly said in the recording. {en}"
            hi = f"यह रिकॉर्डिंग में साफ़ नहीं कहा गया। {hi}"
            added.append(Ambiguity(field=field, question_en=en, question_local=_local((en, hi), lang)))
    return added


def detect(terms: AgreementTerms, transcript: str | None = None) -> list[Ambiguity]:
    """All open questions for these terms: the extractor's own, then the code rules.

    Specific questions win over generic ones for the same field.
    """
    lang = terms.parties.worker.preferred_lang
    out: list[Ambiguity] = []
    seen: set[tuple[str, str]] = set()

    def add(field: str, en: str, local: str) -> None:
        key = (field, en)
        if key not in seen:
            seen.add(key)
            out.append(Ambiguity(field=field, question_en=en, question_local=local))

    for a in terms.ambiguities:
        add(a.field, a.question_en, a.question_local)
    has_field = lambda f: any(a.field == f for a in out)  # noqa: E731

    # Vague words in the conversation
    if transcript:
        for pattern, field, pair in VAGUE:
            m = re.search(pattern, transcript, re.IGNORECASE)
            if not m:
                continue
            if field != "scope" and getattr(terms, field) is not None:
                continue
            if field == "price_inr" and has_field("price_inr"):
                continue
            w = m.group(0)
            add(field, pair[0].format(w=w), _local((pair[0].format(w=w), pair[1].format(w=w)), lang))

    # Missing values
    for field, pair in MISSING.items():
        if getattr(terms, field) is None and not has_field(field):
            add(field, pair[0], _local(pair, lang))

    # Contradictions
    if terms.price_inr is not None and terms.advance_inr is not None and terms.advance_inr > terms.price_inr:
        en = (f"The advance ({rupees(terms.advance_inr)}) is more than the price "
              f"({rupees(terms.price_inr)}). Which is correct?")
        hi = (f"एडवांस ({rupees(terms.advance_inr)}) कुल दाम ({rupees(terms.price_inr)}) से ज़्यादा है। "
              f"सही क्या है?")
        add("advance_inr", en, _local((en, hi), lang))
    if terms.start_date and terms.deadline and terms.deadline < terms.start_date:
        en = "The finish date is before the start date. Which dates are correct?"
        hi = "ख़त्म होने की तारीख शुरू होने से पहले है। सही तारीखें क्या हैं?"
        add("deadline", en, _local((en, hi), lang))

    # Scope boundaries for painting: ceiling
    said = " ".join(filter(None, [transcript, terms.scope, *terms.conditions]))
    is_paint = terms.parties.worker.trade == "painter" or re.search(r"\bpaint", terms.scope or "", re.I)
    if is_paint and not re.search(r"\b(chhat|ceiling|deewar\w*|walls?)\b", said, re.IGNORECASE):
        add("scope", CEILING[0], _local(CEILING, lang))

    # What happens on delay
    if not re.search(DELAY_WORDS, said, re.IGNORECASE):
        add("delay_terms", DELAY[0], _local(DELAY, lang))
    return out
