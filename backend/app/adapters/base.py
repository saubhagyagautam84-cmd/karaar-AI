"""Common base for every DPI adapter.

Each service has: an abstract base (the interface), a Mock (deterministic,
offline) and a Real stub (TODO until keys/approval exist). Every call is
written to the audit log with the provider name, e.g. "speech.mock".
"""

from __future__ import annotations

from app.services import audit


class NotConfigured(RuntimeError):
    """A Real adapter was selected but its credentials/approval are missing."""


class Adapter:
    kind: str = ""
    provider: str = ""

    @property
    def name(self) -> str:
        return f"{self.kind}.{self.provider}"

    def _audit(self, action: str, agreement_id: str | None = None, note: str = "") -> None:
        audit.log(
            actor="system",
            agreement_id=agreement_id,
            provider=self.name,
            note=f"{action}: {note}" if note else action,
        )

    def _todo(self, what: str) -> NotConfigured:
        return NotConfigured(f"{self.name} is not configured yet: {what}")
