"""Notifications: Twilio WhatsApp sandbox / mock.

The mock writes to the `messages` table, which the demo "phone preview" panel
reads. Only masked numbers ever reach logs or the outbox; a raw number, when a
real channel needs one, is passed in for that one send and never stored.
"""

from __future__ import annotations

import hashlib
from abc import abstractmethod

from pydantic import BaseModel

from app.adapters.base import Adapter
from app.models import db


class OutboundMessage(BaseModel):
    message_id: str
    agreement_id: str | None = None
    party_role: str | None = None
    to_masked: str
    body: str
    channel: str
    sent_at: str


class NotifyAdapter(Adapter):
    kind = "notify"

    @abstractmethod
    def send(self, to_masked: str | None, body: str, agreement_id: str | None = None,
             party_role: str | None = None, to_phone: str | None = None) -> OutboundMessage: ...


def outbox(agreement_id: str | None = None, limit: int = 50) -> list[OutboundMessage]:
    with db.connect() as conn:
        if agreement_id:
            rows = conn.execute("SELECT * FROM messages WHERE agreement_id = ? ORDER BY id DESC LIMIT ?",
                                (agreement_id, limit)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM messages ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [OutboundMessage(**{k: r[k] for k in OutboundMessage.model_fields}) for r in rows]


class MockNotify(NotifyAdapter):
    provider = "mock"

    def send(self, to_masked: str | None, body: str, agreement_id: str | None = None,
             party_role: str | None = None, to_phone: str | None = None) -> OutboundMessage:
        masked = to_masked or "number not given"
        msg = OutboundMessage(
            message_id="MOCK" + hashlib.sha256(f"{agreement_id}:{party_role}:{body}".encode()).hexdigest()[:10],
            agreement_id=agreement_id,
            party_role=party_role,
            to_masked=masked,
            body=body,
            channel="whatsapp",
            sent_at=db.now_iso(),
        )
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO messages (message_id, agreement_id, party_role, to_masked, channel, body, sent_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (msg.message_id, agreement_id, party_role, masked, msg.channel, body, msg.sent_at),
            )
        self._audit("send", agreement_id, f"whatsapp to {party_role or 'party'} {masked}")
        return msg


class TwilioWhatsappNotify(NotifyAdapter):
    provider = "twilio_whatsapp"

    def send(self, to_masked: str | None, body: str, agreement_id: str | None = None,
             party_role: str | None = None, to_phone: str | None = None) -> OutboundMessage:
        # TODO: Twilio WhatsApp sandbox (needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM,
        # and the raw `to_phone` supplied at send time). Paid service: ask before enabling.
        raise self._todo("set TWILIO_* env vars (paid service, not enabled)")
