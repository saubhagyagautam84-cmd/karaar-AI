"""Adapter registry: pick the implementation for each DPI service from env vars."""

from __future__ import annotations

from app.adapters.base import Adapter, NotConfigured
from app.adapters.digilocker import MockDigiLocker, RealDigiLocker
from app.adapters.edaakhil import MockEDaakhil
from app.adapters.eshram import MockEshram, RealEshram
from app.adapters.llm import AnthropicLlm, MockLlm
from app.adapters.identity import MockIdentity, RealIdentity
from app.adapters.notify import MockNotify, TwilioWhatsappNotify
from app.adapters.payment import MockPayment, UpiIntentPayment
from app.adapters.speech import BhashiniSpeech, MockSpeech, WhisperSpeech
from app.adapters.translate import BhashiniTranslate, LlmTranslate, MockTranslate
from app.config import PROVIDER_ENV, settings

REGISTRY: dict[str, dict[str, type[Adapter]]] = {
    "speech": {"mock": MockSpeech, "whisper": WhisperSpeech, "bhashini": BhashiniSpeech},
    "translate": {"mock": MockTranslate, "bhashini": BhashiniTranslate, "llm": LlmTranslate},
    "payment": {"mock": MockPayment, "upi_intent": UpiIntentPayment},
    "identity": {"mock": MockIdentity, "real": RealIdentity},
    "eshram": {"mock": MockEshram, "real": RealEshram},
    "notify": {"mock": MockNotify, "twilio_whatsapp": TwilioWhatsappNotify},
    "digilocker": {"mock": MockDigiLocker, "real": RealDigiLocker},
    "edaakhil": {"mock": MockEDaakhil},
    "llm": {"mock": MockLlm, "anthropic": AnthropicLlm},
}


def validate_providers() -> None:
    """Fail at startup, not mid-demo, if an env var names an unknown provider."""
    for kind, provider in settings.providers.items():
        options = REGISTRY[kind]
        if provider not in options:
            raise ValueError(
                f"{PROVIDER_ENV[kind]}={provider!r} is not valid; choose one of {sorted(options)}"
            )


def get_adapter(kind: str) -> Adapter:
    return REGISTRY[kind][settings.providers[kind]]()


__all__ = ["Adapter", "NotConfigured", "REGISTRY", "get_adapter", "validate_providers"]
