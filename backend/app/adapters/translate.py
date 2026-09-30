"""Translation: Bhashini NMT / LLM / mock."""

from __future__ import annotations

from abc import abstractmethod

from app.adapters.base import Adapter

# Small fixed phrasebook so the mock is deterministic and still reads naturally.
_PHRASEBOOK: dict[tuple[str, str], str] = {
    ("hi", "Is ceiling painting included?"): "क्या छत की पेंटिंग भी शामिल है?",
    ("hi", "What happens if the work is not finished by the deadline?"):
        "अगर काम तय तारीख तक पूरा नहीं हुआ तो क्या होगा?",
    ("hi", "If this is correct, press 'Haan, pakka'."): "सही है तो 'हाँ, पक्का' दबाइए।",
    ("en", "सही है तो 'हाँ, पक्का' दबाइए।"): "If this is correct, press 'Haan, pakka'.",
}


class TranslateAdapter(Adapter):
    kind = "translate"

    @abstractmethod
    def translate(self, text: str, source: str, target: str, agreement_id: str | None = None) -> str: ...


class MockTranslate(TranslateAdapter):
    provider = "mock"

    def translate(self, text: str, source: str, target: str, agreement_id: str | None = None) -> str:
        self._audit("translate", agreement_id, f"{source}->{target}")
        if source == target:
            return text
        return _PHRASEBOOK.get((target, text), f"[{target}] {text}")


class BhashiniTranslate(TranslateAdapter):
    provider = "bhashini"

    def translate(self, text: str, source: str, target: str, agreement_id: str | None = None) -> str:
        # TODO: Bhashini ULCA pipeline (translation task). Needs BHASHINI_API_KEY.
        raise self._todo("Bhashini access approval + BHASHINI_API_KEY")


class LlmTranslate(TranslateAdapter):
    provider = "llm"

    def translate(self, text: str, source: str, target: str, agreement_id: str | None = None) -> str:
        # TODO(Phase 4): translate with the extraction LLM. Needs LLM_API_KEY.
        raise self._todo("set LLM_API_KEY and implement in Phase 4")
