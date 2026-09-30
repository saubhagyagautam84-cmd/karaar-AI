"""Aadhaar e-KYC (optional). Returns only verified + masked name.

The Aadhaar number passes through in memory and is never stored or logged.
"""

from __future__ import annotations

from abc import abstractmethod

from pydantic import BaseModel

from app.adapters.base import Adapter


class IdentityResult(BaseModel):
    verified: bool
    masked_name: str


def mask_name(name: str) -> str:
    """'Ramesh Kumar' -> 'R***** K****'."""
    return " ".join(part[0] + "*" * (len(part) - 1) for part in name.split() if part)


class IdentityAdapter(Adapter):
    kind = "identity"

    @abstractmethod
    def verify(self, aadhaar_number: str, name: str, agreement_id: str | None = None) -> IdentityResult: ...


class MockIdentity(IdentityAdapter):
    provider = "mock"

    def verify(self, aadhaar_number: str, name: str, agreement_id: str | None = None) -> IdentityResult:
        digits = "".join(c for c in aadhaar_number if c.isdigit())
        ok = len(digits) == 12
        self._audit("verify", agreement_id, "verified" if ok else "rejected: needs 12 digits")
        return IdentityResult(verified=ok, masked_name=mask_name(name) if ok else "")


class RealIdentity(IdentityAdapter):
    provider = "real"

    def verify(self, aadhaar_number: str, name: str, agreement_id: str | None = None) -> IdentityResult:
        # TODO: UIDAI e-KYC via a licensed KUA/AUA. Requires official approval.
        raise self._todo("UIDAI AUA/KUA licence")
