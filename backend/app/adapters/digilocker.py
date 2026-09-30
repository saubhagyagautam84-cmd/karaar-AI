"""DigiLocker: sign-in and issuing the agreement as a verifiable document."""

from __future__ import annotations

from abc import abstractmethod

from pydantic import BaseModel

from app.adapters.base import Adapter


class DigiLockerSession(BaseModel):
    authorize_url: str
    state: str


class IssuedDocument(BaseModel):
    uri: str
    doc_type: str
    issued_to_masked: str


class DigiLockerAdapter(Adapter):
    kind = "digilocker"

    @abstractmethod
    def start_login(self, state: str) -> DigiLockerSession: ...

    @abstractmethod
    def issue(self, agreement_id: str, record_hash: str, holder_masked: str) -> IssuedDocument: ...


class MockDigiLocker(DigiLockerAdapter):
    provider = "mock"

    def start_login(self, state: str) -> DigiLockerSession:
        self._audit("start_login")
        return DigiLockerSession(authorize_url=f"/mock/digilocker/authorize?state={state}", state=state)

    def issue(self, agreement_id: str, record_hash: str, holder_masked: str) -> IssuedDocument:
        self._audit("issue", agreement_id, "mock document issued")
        return IssuedDocument(
            uri=f"in.gov.digilocker.mock/KARAAR/{agreement_id}",
            doc_type="KARAAR_AGREEMENT_RECORD",
            issued_to_masked=holder_masked,
        )


class RealDigiLocker(DigiLockerAdapter):
    provider = "real"

    def start_login(self, state: str) -> DigiLockerSession:
        # TODO: DigiLocker partner OAuth 2.0. Needs DIGILOCKER_CLIENT_ID/SECRET after onboarding.
        raise self._todo("DigiLocker partner onboarding")

    def issue(self, agreement_id: str, record_hash: str, holder_masked: str) -> IssuedDocument:
        # TODO: DigiLocker Issuer API. Requires being registered as an issuer.
        raise self._todo("DigiLocker issuer registration")
