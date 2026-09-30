"""Plain-language agreement summaries (Appendix A2), at most 8 short lines.

Deterministic templates (no LLM), so they work offline and never add anything
that is not in the terms. Amounts are always digits with the rupee symbol.
"""

from __future__ import annotations

from datetime import date

from app.schemas.agreement import AgreementTerms
from app.services.rule_extractor import rupees

HI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"]
HI_DAYS = ["सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार", "रविवार"]
MATERIALS = {
    "en": {"client": "the client brings them", "worker": "the worker brings them", "shared": "shared by both"},
    "hi": {"client": "ग्राहक लाएँगे", "worker": "कारीगर लाएँगे", "shared": "दोनों मिलकर लाएँगे"},
}
LABELS = {
    "en": {"work": "Work", "price": "Total price", "advance": "Advance", "dates": "Dates", "materials": "Materials",
           "conditions": "Conditions", "open": "Some questions are still open:", "unset": "not decided",
           "no_advance": "none", "from": "from", "to": "to", "end": "If this is correct, press 'Haan, pakka'.",
           "more": "more"},
    "hi": {"work": "काम", "price": "कुल दाम", "advance": "एडवांस", "dates": "तारीख", "materials": "सामान",
           "conditions": "शर्तें", "open": "कुछ सवाल बाकी हैं:", "unset": "तय नहीं",
           "no_advance": "कोई नहीं", "from": "से", "to": "तक", "end": "सही है तो 'हाँ, पक्का' दबाइए।",
           "more": "और"},
}


def fmt_date(d: date | None, lang: str) -> str | None:
    if d is None:
        return None
    if lang == "hi":
        return f"{d.day} {HI_MONTHS[d.month - 1]} ({HI_DAYS[d.weekday()]})"
    return d.strftime("%a %d %b").replace(" 0", " ")


def summary_lines(terms: AgreementTerms, lang: str) -> list[str]:
    lang = "hi" if lang == "hi" else "en"
    L = LABELS[lang]
    lines: list[str] = []
    scope = terms.scope_local if lang == "hi" and terms.scope_local else terms.scope
    lines.append(f"{L['work']}: {scope or L['unset']}")
    lines.append(f"{L['price']}: {rupees(terms.price_inr) if terms.price_inr is not None else L['unset']}")
    if terms.advance_inr is None:
        advance = L["unset"]
    else:
        advance = rupees(terms.advance_inr) if terms.advance_inr > 0 else L["no_advance"]
    lines.append(f"{L['advance']}: {advance}")
    start, end = fmt_date(terms.start_date, lang), fmt_date(terms.deadline, lang)
    if lang == "hi":
        dates = f"{start or L['unset']} {L['from']} {end or L['unset']} {L['to']}"
    else:
        dates = f"{L['from']} {start or L['unset']} {L['to']} {end or L['unset']}"
    lines.append(f"{L['dates']}: {dates}")
    materials = MATERIALS[lang].get(terms.materials_provided_by or "", L["unset"])
    lines.append(f"{L['materials']}: {materials}")
    conditions = terms.conditions_local if lang == "hi" and terms.conditions_local else terms.conditions
    if conditions:
        lines.append(f"{L['conditions']}: {' '.join(conditions)}")
    if terms.ambiguities:
        qs = [a.question_local if lang == "hi" else a.question_en for a in terms.ambiguities]
        shown = " • ".join(qs[:2])
        extra = f" (+{len(qs) - 2} {L['more']})" if len(qs) > 2 else ""
        lines.append(f"{L['open']} {shown}{extra}")
    lines.append(L["end"])
    return lines[:8]


def summary_text(terms: AgreementTerms, lang: str) -> str:
    return "\n".join(summary_lines(terms, lang))


def confirm_message(terms: AgreementTerms, role: str, lang: str, url: str) -> str:
    party = getattr(terms.parties, role)
    name = party.name or ("ग्राहक" if lang == "hi" and role == "client" else "कारीगर" if lang == "hi" else role.title())
    if lang == "hi":
        head = f"करार AI: {name} जी, आपका करार {terms.agreement_id} पक्का करने के लिए तैयार है।"
        tail = f"देखें और पक्का करें: {url}"
    else:
        head = f"Karaar AI: {name}, your agreement {terms.agreement_id} is ready to confirm."
        tail = f"Review and confirm: {url}"
    return f"{head}\n\n{summary_text(terms, lang)}\n\n{tail}"


def pakka_message(terms: AgreementTerms, lang: str, url: str) -> str:
    if lang == "hi":
        return (f"करार AI: करार {terms.agreement_id} दोनों ने पक्का कर दिया ✅\n"
                f"यह आपके समझौते का पक्का रिकॉर्ड है।\nजाँचें: {url}")
    return (f"Karaar AI: agreement {terms.agreement_id} is now pakka, confirmed by both ✅\n"
            f"This is a confirmed record of your agreement.\nVerify: {url}")
