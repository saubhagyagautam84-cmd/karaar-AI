"""Extraction engine: transcript -> ExtractionResult.

mock      -> the offline rule engine (default; the demo never needs the network)
anthropic -> Claude with structured output, validated by Pydantic, 2 retries.
             Optional: `pip install -r requirements-llm.txt` and set ANTHROPIC_API_KEY
             (or log in with `ant auth login`).
"""

from __future__ import annotations

from abc import abstractmethod
from datetime import date

from pydantic import ValidationError

from app.adapters.base import Adapter
from app.config import BACKEND_DIR, settings
from app.services import rule_extractor
from app.services.rule_extractor import ExtractionResult

EXTRACT_PROMPT = (BACKEND_DIR / "app" / "prompts" / "extract.txt").read_text(encoding="utf-8")

SCHEMA_NOTES = """
OUTPUT FIELDS
- language_detected: ISO codes of languages spoken, most used first (e.g. ["hi", "en"]).
- worker_trade: one of painter, plumber, electrician, carpenter, domestic help, driver, or null.
- scope: one clear English sentence of what IS included. scope_local: the same in the worker's language.
- price_inr, advance_inr: integers in rupees, or null.
- materials_provided_by: "client", "worker", "shared", or null.
- start_date, deadline: ISO dates (YYYY-MM-DD), or null.
- conditions: English sentences (exclusions, duties, delay terms). conditions_local: same, worker's language.
- ambiguities: one entry per unclear or missing term: field (one of scope, price_inr, advance_inr,
  materials_provided_by, start_date, deadline, delay_terms), question_en, question_local.
- evidence: one entry per non-null value: field and an EXACT quote copied from the transcript (max 12 words).
Worker's language "hi" means Hindi in Devanagari script.
"""


class ExtractionFailed(RuntimeError):
    pass


class LlmAdapter(Adapter):
    kind = "llm"

    @abstractmethod
    def extract(self, transcript: str, today: date, worker_lang: str, agreement_id: str | None = None) -> ExtractionResult: ...


class MockLlm(LlmAdapter):
    provider = "mock"

    def extract(self, transcript: str, today: date, worker_lang: str, agreement_id: str | None = None) -> ExtractionResult:
        result = rule_extractor.extract(transcript, today)
        self._audit("extract", agreement_id, f"rule engine, {len(result.ambiguities)} open questions")
        return result


class AnthropicLlm(LlmAdapter):
    provider = "anthropic"
    MAX_RETRIES = 2

    def extract(self, transcript: str, today: date, worker_lang: str, agreement_id: str | None = None) -> ExtractionResult:
        try:
            import anthropic
        except ImportError as exc:
            raise self._todo("run: pip install -r requirements-llm.txt") from exc

        client = anthropic.Anthropic()
        user = (
            f"Today's date: {today.isoformat()} ({today.strftime('%A')})\n"
            f"Worker's language: {worker_lang}\n\nTRANSCRIPT\n{transcript}"
        )
        last_error: Exception | None = None
        for attempt in range(1 + self.MAX_RETRIES):
            try:
                response = client.messages.parse(
                    model=settings.llm_model,
                    max_tokens=16000,
                    system=EXTRACT_PROMPT + SCHEMA_NOTES,
                    messages=[{"role": "user", "content": user}],
                    output_format=ExtractionResult,
                    # Server-side fallback on a policy decline, routed by category.
                    extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
                    extra_body={"fallbacks": "default"},
                )
            except (ValidationError, ValueError) as exc:  # invalid JSON / schema mismatch -> retry
                last_error = exc
                continue
            except (anthropic.RateLimitError, anthropic.InternalServerError, anthropic.APIConnectionError) as exc:
                last_error = exc
                continue
            except anthropic.APIStatusError as exc:
                self._audit("extract", agreement_id, f"failed: HTTP {exc.status_code}")
                raise ExtractionFailed(f"Claude API error {exc.status_code}") from exc

            if response.stop_reason == "refusal":
                last_error = ExtractionFailed("the model declined this request")
                break
            if response.parsed_output is None:
                last_error = ExtractionFailed("no structured output")
                continue
            self._audit("extract", agreement_id, f"{settings.llm_model}, attempt {attempt + 1}")
            return response.parsed_output

        self._audit("extract", agreement_id, f"failed after retries: {last_error}")
        raise ExtractionFailed(str(last_error))
