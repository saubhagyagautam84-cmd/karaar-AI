"""Speech-to-text: Bhashini ASR / Whisper / mock."""

from __future__ import annotations

import hashlib
from abc import abstractmethod

from pydantic import BaseModel

from app.adapters.base import Adapter
from app.services.samples import SAMPLES


class Transcript(BaseModel):
    text: str
    languages: list[str]
    audio_sha256: str


class SpeechAdapter(Adapter):
    kind = "speech"

    @abstractmethod
    def transcribe(self, audio: bytes, filename: str, agreement_id: str | None = None,
                   sample: int | None = None) -> Transcript: ...


class MockSpeech(SpeechAdapter):
    """Returns a sample conversation. `sample` picks which one (default 1), so a
    live demo in a noisy room still produces a known transcript."""

    provider = "mock"

    def transcribe(self, audio: bytes, filename: str, agreement_id: str | None = None,
                   sample: int | None = None) -> Transcript:
        n = sample if sample in SAMPLES else 1
        digest = hashlib.sha256(audio).hexdigest()
        self._audit("transcribe", agreement_id, f"{len(audio)} bytes, returned sample {n}")
        return Transcript(text=SAMPLES[n]["text"], languages=["hi", "en"], audio_sha256=digest)


class WhisperSpeech(SpeechAdapter):
    provider = "whisper"

    def transcribe(self, audio: bytes, filename: str, agreement_id: str | None = None,
                   sample: int | None = None) -> Transcript:
        # TODO: call Whisper (OpenAI API or a local model). Needs OPENAI_API_KEY; ask before enabling (paid).
        raise self._todo("Whisper needs OPENAI_API_KEY (paid service, not enabled)")


class BhashiniSpeech(SpeechAdapter):
    provider = "bhashini"

    def transcribe(self, audio: bytes, filename: str, agreement_id: str | None = None,
                   sample: int | None = None) -> Transcript:
        # TODO: Bhashini ULCA pipeline (ASR task). Needs BHASHINI_USER_ID + BHASHINI_API_KEY.
        raise self._todo("Bhashini access approval + BHASHINI_API_KEY")
