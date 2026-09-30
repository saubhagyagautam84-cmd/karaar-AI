"""Settling an open question with a typed answer ("inline answer field")."""

from __future__ import annotations

import re
from datetime import date

from app.schemas.agreement import AgreementTerms, Evidence
from app.services import ambiguity
from app.services.normalizer import find_amounts, parse_amount, parse_date

YES = r"^\s*(haan|han|ha|haa|yes|ji|ji haan|hoga|shamil|included|y)\b"
NO = r"^\s*(nahi|nahin|na|no|nope|shamil nahi|not included|n)\b"


class AnswerError(ValueError):
    """The answer could not be understood; the message is shown to the person."""


def _amount(answer: str) -> int:
    value = parse_amount(answer)
    if value is None:
        bare = [a for a in find_amounts(answer) if not a.is_range]
        if bare and bare[0].value is not None:
            # "8" in a price answer means thousands; "800" is taken as is
            value = bare[0].value * (1000 if bare[0].value < 100 else 1)
    if value is None:
        raise AnswerError("Please write the amount, for example 8000 or 'aath hazaar'.")
    return value


def apply_answer(terms: AgreementTerms, field: str, question_en: str | None, answer: str, today: date) -> None:
    answer = answer.strip()
    if not answer:
        raise AnswerError("Please type an answer first.")
    stored_field = field

    if field in ("price_inr", "advance_inr"):
        if field == "advance_inr" and re.search(NO + r"|^\s*(0|zero|koi nahi|no advance)\b", answer, re.I):
            terms.advance_inr = 0
        else:
            setattr(terms, field, _amount(answer))
    elif field in ("start_date", "deadline"):
        iso = re.fullmatch(r"\d{4}-\d{2}-\d{2}", answer)
        value = date.fromisoformat(answer) if iso else parse_date(answer, today)
        if value is None:
            raise AnswerError("Please give a date, for example 'Sunday', 'parso' or '5 October'.")
        setattr(terms, field, value)
    elif field == "materials_provided_by":
        low = answer.lower()
        if re.search(r"\b(dono|both|shared|milke|half)\b", low):
            terms.materials_provided_by = "shared"
        elif re.search(r"\b(worker|karigar|kaarigar|mistri|painter|plumber|bhaiya)\b", low):
            terms.materials_provided_by = "worker"
        elif re.search(r"\b(client|grahak|customer|malik|ghar|owner|didi|madam)\b", low):
            terms.materials_provided_by = "client"
        else:
            raise AnswerError("Please say who brings the materials: client, worker or both.")
    elif field == "delay_terms":
        terms.conditions.append(f"If the work is late: {answer}")
        terms.conditions_local.append(f"देर होने पर: {answer}")
        stored_field = "conditions"
    elif field == "scope" and question_en == ambiguity.CEILING[0]:
        if re.search(YES, answer, re.I):
            terms.scope = (terms.scope or "").rstrip(".") + ", including the ceiling."
            terms.scope_local = (terms.scope_local or "").rstrip("।") + ", छत भी शामिल।"
        elif re.search(NO, answer, re.I):
            terms.conditions.append("Ceiling painting is not included.")
            terms.conditions_local.append("छत की पेंटिंग शामिल नहीं है।")
            stored_field = "conditions"
        else:
            raise AnswerError("Please answer yes (haan) or no (nahi).")
    elif field == "scope" and terms.scope is None:
        terms.scope = answer
        terms.scope_local = answer
    else:
        terms.conditions.append(f"{question_en or field}: {answer}")
        terms.conditions_local.append(f"{question_en or field}: {answer}")
        stored_field = "conditions"

    terms.evidence.append(Evidence(field=stored_field, quote=answer[:200], source="answer"))
    # Drop every question about this field, then re-check what is still open.
    terms.ambiguities = [a for a in terms.ambiguities
                         if not (a.field == field and (question_en is None or a.question_en == question_en))
                         and not (a.field == field and field != "scope")]
    terms.ambiguities = ambiguity.detect(terms)
