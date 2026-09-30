"""e-Daakhil: ready-to-file dispute summary for consumer complaints.

There is no public filing API, so even the "real" path only produces a
document the person files themselves. The PDF itself arrives in Phase 7.
"""

from __future__ import annotations

from abc import abstractmethod

from pydantic import BaseModel

from app.adapters.base import Adapter


class DisputePacket(BaseModel):
    agreement_id: str
    title: str
    sections: dict[str, str]
    filing_url: str = "https://edaakhil.nic.in"


class EDaakhilAdapter(Adapter):
    kind = "edaakhil"

    @abstractmethod
    def prepare(self, agreement_id: str, terms: dict, audit_trail: list[dict], record_hash: str | None) -> DisputePacket: ...


class MockEDaakhil(EDaakhilAdapter):
    provider = "mock"

    def prepare(self, agreement_id: str, terms: dict, audit_trail: list[dict], record_hash: str | None) -> DisputePacket:
        self._audit("prepare", agreement_id, "dispute packet generated")
        return DisputePacket(
            agreement_id=agreement_id,
            title=f"Dispute summary for agreement {agreement_id}",
            sections={
                "Agreed work": terms.get("scope") or "Not recorded",
                "Agreed price": f"Rs {terms['price_inr']}" if terms.get("price_inr") is not None else "Not recorded",
                "Timeline entries": str(len(audit_trail)),
                "Record hash": record_hash or "Not yet confirmed by both parties",
            },
        )
