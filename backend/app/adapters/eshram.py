"""e-Shram: link completed jobs to the worker's e-Shram profile (lookup by UAN)."""

from __future__ import annotations

from abc import abstractmethod

from pydantic import BaseModel

from app.adapters.base import Adapter


class EshramProfile(BaseModel):
    linked: bool
    uan_masked: str
    occupation: str | None = None
    state: str | None = None


def mask_uan(uan: str) -> str:
    digits = "".join(c for c in uan if c.isdigit())
    return "XXXX XXXX " + digits[-4:] if len(digits) >= 4 else ""


class EshramAdapter(Adapter):
    kind = "eshram"

    @abstractmethod
    def lookup(self, uan: str, agreement_id: str | None = None) -> EshramProfile: ...


class MockEshram(EshramAdapter):
    provider = "mock"

    _OCCUPATIONS = ["Painter", "Plumber", "Electrician", "Carpenter", "Domestic Worker", "Driver"]

    def lookup(self, uan: str, agreement_id: str | None = None) -> EshramProfile:
        digits = "".join(c for c in uan if c.isdigit())
        linked = len(digits) == 12
        self._audit("lookup", agreement_id, "linked" if linked else "not found")
        if not linked:
            return EshramProfile(linked=False, uan_masked=mask_uan(uan))
        return EshramProfile(
            linked=True,
            uan_masked=mask_uan(digits),
            occupation=self._OCCUPATIONS[int(digits[-1]) % len(self._OCCUPATIONS)],
            state="Delhi",
        )


class RealEshram(EshramAdapter):
    provider = "real"

    def lookup(self, uan: str, agreement_id: str | None = None) -> EshramProfile:
        # TODO: e-Shram API via Ministry of Labour & Employment. Requires official approval.
        raise self._todo("MoLE e-Shram API approval")
