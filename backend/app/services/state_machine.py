"""Agreement state machine (Step 5). Pure Python: no database, no I/O.

DRAFT -> SENT -> CONFIRMED_BY_ONE -> CONFIRMED_BY_BOTH -> ADVANCE_PAID -> IN_PROGRESS -> COMPLETED
Any state from ADVANCE_PAID onward can move to DISPUTED; DISPUTED -> RESOLVED | ESCALATED.
Editing (or a "Kuch galat hai") while SENT / CONFIRMED_BY_ONE resets confirmations and returns to DRAFT.
From CONFIRMED_BY_BOTH the terms are frozen.
An agreement with no advance goes CONFIRMED_BY_BOTH -> IN_PROGRESS directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas.agreement import Status as S

PARTIES = ("client", "worker")

EDGES: dict[S, set[S]] = {
    S.DRAFT: {S.SENT},
    S.SENT: {S.CONFIRMED_BY_ONE, S.DRAFT},
    S.CONFIRMED_BY_ONE: {S.CONFIRMED_BY_BOTH, S.DRAFT},
    S.CONFIRMED_BY_BOTH: {S.ADVANCE_PAID, S.IN_PROGRESS},
    S.ADVANCE_PAID: {S.IN_PROGRESS, S.DISPUTED},
    S.IN_PROGRESS: {S.COMPLETED, S.DISPUTED},
    S.COMPLETED: {S.DISPUTED},
    S.DISPUTED: {S.RESOLVED, S.ESCALATED},
    S.RESOLVED: set(),
    S.ESCALATED: set(),
}
EDITABLE = {S.DRAFT, S.SENT, S.CONFIRMED_BY_ONE}
FROZEN = set(S) - EDITABLE


class InvalidTransition(Exception):
    """Maps to HTTP 409."""


@dataclass
class AgreementStateMachine:
    status: S = S.DRAFT
    confirmed: set[str] = field(default_factory=set)
    done: set[str] = field(default_factory=set)
    has_advance: bool = True

    # -------------------------------------------------------------- core
    def can(self, to: S) -> bool:
        if to not in EDGES[self.status]:
            return False
        if self.status == S.CONFIRMED_BY_BOTH and to == S.IN_PROGRESS:
            return not self.has_advance
        if self.status == S.CONFIRMED_BY_BOTH and to == S.ADVANCE_PAID:
            return self.has_advance
        return True

    def _go(self, to: S) -> tuple[S, S]:
        if not self.can(to):
            raise InvalidTransition(f"Cannot move from {self.status.value} to {to.value}.")
        before, self.status = self.status, to
        return before, to

    @staticmethod
    def _party(party: str) -> str:
        if party not in PARTIES:
            raise InvalidTransition(f"Unknown party {party!r}.")
        return party

    # -------------------------------------------------------------- events
    def send(self) -> tuple[S, S]:
        return self._go(S.SENT)

    def confirm(self, party: str) -> tuple[S, S]:
        party = self._party(party)
        if self.status not in (S.SENT, S.CONFIRMED_BY_ONE):
            raise InvalidTransition(f"Nothing to confirm while {self.status.value}.")
        if party in self.confirmed:
            raise InvalidTransition(f"The {party} has already confirmed.")
        self.confirmed.add(party)
        return self._go(S.CONFIRMED_BY_BOTH if len(self.confirmed) == 2 else S.CONFIRMED_BY_ONE)

    def edit(self) -> tuple[S, S]:
        """Terms changed or a party said "Kuch galat hai": confirmations reset, back to DRAFT."""
        if self.status in FROZEN:
            raise InvalidTransition(f"The terms are frozen once confirmed ({self.status.value}).")
        self.confirmed.clear()
        if self.status == S.DRAFT:
            return S.DRAFT, S.DRAFT
        return self._go(S.DRAFT)

    def pay_advance(self) -> tuple[S, S]:
        return self._go(S.ADVANCE_PAID)

    def start(self) -> tuple[S, S]:
        return self._go(S.IN_PROGRESS)

    def mark_done(self, party: str) -> tuple[S, S]:
        party = self._party(party)
        if self.status != S.IN_PROGRESS:
            raise InvalidTransition(f"Work can only be marked done while IN_PROGRESS, not {self.status.value}.")
        if party in self.done:
            raise InvalidTransition(f"The {party} has already marked the work done.")
        self.done.add(party)
        if len(self.done) == 2:
            return self._go(S.COMPLETED)
        return S.IN_PROGRESS, S.IN_PROGRESS

    def dispute(self) -> tuple[S, S]:
        return self._go(S.DISPUTED)

    def resolve(self) -> tuple[S, S]:
        return self._go(S.RESOLVED)

    def escalate(self) -> tuple[S, S]:
        return self._go(S.ESCALATED)
