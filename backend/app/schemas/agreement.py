"""AgreementTerms and friends (Step 6). Pydantic v2 is the single source of truth."""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class Status(str, Enum):
    DRAFT = "DRAFT"
    SENT = "SENT"
    CONFIRMED_BY_ONE = "CONFIRMED_BY_ONE"
    CONFIRMED_BY_BOTH = "CONFIRMED_BY_BOTH"
    ADVANCE_PAID = "ADVANCE_PAID"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    DISPUTED = "DISPUTED"
    RESOLVED = "RESOLVED"
    ESCALATED = "ESCALATED"


class Party(BaseModel):
    name: str | None = None
    # Always masked ("+91XXXXXX3210"). The raw number is only ever hashed.
    phone: str | None = None
    preferred_lang: str | None = None


class WorkerParty(Party):
    trade: str | None = None
    eshram_linked: bool = False


class Parties(BaseModel):
    client: Party = Field(default_factory=Party)
    worker: WorkerParty = Field(default_factory=WorkerParty)


class Ambiguity(BaseModel):
    field: str
    question_en: str
    question_local: str


class Evidence(BaseModel):
    field: str
    quote: str = Field(max_length=200)
    # "transcript" = said in the recording; "answer" = typed in to settle an open question
    source: Literal["transcript", "answer"] = "transcript"


class AgreementTerms(BaseModel):
    agreement_id: str
    language_detected: list[str] = Field(default_factory=list)
    parties: Parties = Field(default_factory=Parties)
    scope: str | None = None
    # The same scope/conditions in the worker's language, for their summary.
    scope_local: str | None = None
    price_inr: int | None = Field(default=None, ge=0)
    advance_inr: int | None = Field(default=None, ge=0)
    materials_provided_by: Literal["client", "worker", "shared"] | None = None
    start_date: date | None = None
    deadline: date | None = None
    conditions: list[str] = Field(default_factory=list)
    conditions_local: list[str] = Field(default_factory=list)
    ambiguities: list[Ambiguity] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    status: Status = Status.DRAFT
    hash: str | None = None
    audio_ref: str | None = None


class DraftResponse(BaseModel):
    agreement: AgreementTerms
    # Returned once for display; not stored (data minimisation, Step 7).
    transcript: str
    providers: dict[str, str]


class AgreementRecord(BaseModel):
    agreement: AgreementTerms
    created_at: str
    updated_at: str
