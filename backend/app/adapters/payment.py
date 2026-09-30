"""UPI: advance and final payments linked to the agreement ID."""

from __future__ import annotations

import hashlib
from abc import abstractmethod
from urllib.parse import quote

from pydantic import BaseModel

from app.adapters.base import Adapter


class PaymentIntent(BaseModel):
    agreement_id: str
    amount_inr: int
    upi_link: str
    note: str


class PaymentResult(BaseModel):
    agreement_id: str
    amount_inr: int
    status: str  # "SUCCESS" | "PENDING" | "FAILED"
    txn_ref: str


def build_upi_link(payee_vpa: str, payee_name: str, amount_inr: int, note: str) -> str:
    return (
        f"upi://pay?pa={quote(payee_vpa)}&pn={quote(payee_name)}"
        f"&am={amount_inr}.00&cu=INR&tn={quote(note)}"
    )


class PaymentAdapter(Adapter):
    kind = "payment"

    @abstractmethod
    def create_intent(self, agreement_id: str, amount_inr: int, payee_vpa: str, payee_name: str,
                      purpose: str = "advance") -> PaymentIntent: ...

    @abstractmethod
    def check_status(self, agreement_id: str, amount_inr: int) -> PaymentResult: ...


class MockPayment(PaymentAdapter):
    provider = "mock"

    def create_intent(self, agreement_id: str, amount_inr: int, payee_vpa: str, payee_name: str,
                      purpose: str = "advance") -> PaymentIntent:
        note = f"Karaar {agreement_id} {purpose}"
        self._audit("create_intent", agreement_id, f"{purpose} Rs {amount_inr}")
        return PaymentIntent(
            agreement_id=agreement_id,
            amount_inr=amount_inr,
            upi_link=build_upi_link(payee_vpa, payee_name, amount_inr, note),
            note=note,
        )

    def check_status(self, agreement_id: str, amount_inr: int) -> PaymentResult:
        ref = hashlib.sha256(f"{agreement_id}:{amount_inr}".encode()).hexdigest()[:12].upper()
        self._audit("check_status", agreement_id, f"simulated SUCCESS Rs {amount_inr}")
        return PaymentResult(agreement_id=agreement_id, amount_inr=amount_inr,
                             status="SUCCESS", txn_ref=f"MOCKUPI{ref}")


class UpiIntentPayment(PaymentAdapter):
    """Real UPI intent links need no API key; confirming payment does (PSP webhook)."""

    provider = "upi_intent"

    def create_intent(self, agreement_id: str, amount_inr: int, payee_vpa: str, payee_name: str,
                      purpose: str = "advance") -> PaymentIntent:
        note = f"Karaar {agreement_id} {purpose}"
        self._audit("create_intent", agreement_id, f"{purpose} Rs {amount_inr}")
        return PaymentIntent(agreement_id=agreement_id, amount_inr=amount_inr,
                             upi_link=build_upi_link(payee_vpa, payee_name, amount_inr, note), note=note)

    def check_status(self, agreement_id: str, amount_inr: int) -> PaymentResult:
        # TODO: confirm via a payment-aggregator webhook (Razorpay/Cashfree UPI). Needs merchant keys.
        raise self._todo("payment confirmation needs a PSP/aggregator webhook")
