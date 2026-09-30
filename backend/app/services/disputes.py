"""Phase 7: disputes (raise, resolve, escalate) and the ready-to-file dispute PDF."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.adapters import get_adapter
from app.schemas.agreement import AgreementTerms
from app.services import audit, lifecycle, store, work
from app.services.lifecycle import _record, machine_for
from app.services.pdf import PdfDoc
from app.services.rule_extractor import rupees
from app.services.state_machine import InvalidTransition

IST = timezone(timedelta(hours=5, minutes=30))


def raise_dispute(agreement_id: str, party: str, reason: str) -> dict:
    reason = (reason or "").strip()
    if not reason:
        raise InvalidTransition("Please say what went wrong.")
    machine, terms = machine_for(agreement_id)
    move = machine.dispute()
    terms.status = machine.status
    store.save(terms, hash_value=terms.hash)
    work.add_milestone(agreement_id, "dispute_raised", proof_ref=f"{party}: {reason[:300]}")
    _record(agreement_id, party, move, f"dispute raised by {party}: {reason[:300]}")
    return {"status": terms.status.value}


def settle(agreement_id: str, outcome: str, actor: str, note: str = "") -> dict:
    machine, terms = machine_for(agreement_id)
    move = machine.resolve() if outcome == "resolve" else machine.escalate()
    terms.status = machine.status
    store.save(terms, hash_value=terms.hash)
    _record(agreement_id, actor, move, note or ("resolved between the parties" if outcome == "resolve"
                                                  else "escalated for a consumer complaint"))
    return {"status": terms.status.value}


def _when(iso: str) -> str:
    return datetime.fromisoformat(iso).astimezone(IST).strftime("%d %b %Y, %I:%M %p IST")


def dispute_pdf(agreement_id: str) -> tuple[bytes, str]:
    r = store.row(agreement_id)
    if r is None:
        raise lifecycle.NotFound(agreement_id)
    terms: AgreementTerms = store.terms_from_row(r)
    trail = audit.for_agreement(agreement_id)
    stones = work.milestones(agreement_id)
    verification = lifecycle.verification(agreement_id)
    packet = get_adapter("edaakhil").prepare(agreement_id, terms.model_dump(mode="json"), trail, r["hash"])

    doc = PdfDoc()
    doc.text("Dispute summary: confirmed agreement record", "h1")
    doc.text(f"Agreement {agreement_id}  |  status {terms.status.value}  |  "
             f"prepared {datetime.now(IST).strftime('%d %b %Y')}", "small")
    doc.text("Prepared by Karaar AI for filing a consumer complaint (e-Daakhil, edaakhil.nic.in). "
             "This is a confirmed record of the agreement between the two people named below, "
             "not a legal contract.", "small", gap_before=4)
    doc.rule()

    doc.text("1. The parties", "h2", gap_before=4)
    c, w = terms.parties.client, terms.parties.worker
    doc.row("Client", f"{c.name or 'Not given'} ({c.phone or 'phone not given'})")
    doc.row("Worker", f"{w.name or 'Not given'} ({w.phone or 'phone not given'})"
                      + (f", {w.trade}" if w.trade else ""))

    doc.text("2. What both agreed", "h2", gap_before=10)
    doc.row("Work", terms.scope or "Not recorded")
    doc.row("Price", rupees(terms.price_inr) if terms.price_inr is not None else "Not agreed")
    doc.row("Advance", rupees(terms.advance_inr) if terms.advance_inr else "None")
    doc.row("Start date", terms.start_date.strftime("%d %b %Y") if terms.start_date else "Not agreed")
    doc.row("Finish by", terms.deadline.strftime("%d %b %Y") if terms.deadline else "Not agreed")
    doc.row("Materials", {"client": "Client brings them", "worker": "Worker brings them",
                          "shared": "Shared"}.get(terms.materials_provided_by or "", "Not agreed"))
    for i, cond in enumerate(terms.conditions):
        doc.row("Conditions" if i == 0 else "", cond)
    if terms.ambiguities:
        doc.row("Left open", "; ".join(a.question_en for a in terms.ambiguities))
    quotes = [f'{e.field}: "{e.quote}"' for e in terms.evidence if e.source == "transcript"]
    if quotes:
        doc.text("Words from the recording that support these terms:", "small", gap_before=4)
        for q in quotes:
            doc.text(f"  - {q}", "small")

    doc.text("3. What happened", "h2", gap_before=10)
    if not stones:
        doc.text("No payments or work milestones were recorded.")
    for m in stones:
        label = m["type"].replace("_", " ")
        extra = f" - {rupees(m['amount_inr'])}" if m["amount_inr"] else ""
        extra += f" - {m['proof_ref']}" if m["type"] == "dispute_raised" and m["proof_ref"] else ""
        extra += f" (UPI ref {m['proof_ref']})" if m["type"] in ("advance_paid", "final_payment") and m["proof_ref"] else ""
        doc.row(_when(m["at"]), f"{label}{extra}")

    doc.text("4. Tamper check", "h2", gap_before=10)
    doc.row("Record fingerprint", r["hash"] or "Not confirmed by both parties")
    if verification.get("hashed"):
        doc.row("Checked now", "Intact: the terms match what both people confirmed" if verification["valid"]
                else "CHANGED: the stored terms no longer match the fingerprint")
    doc.row("Audio fingerprint", (r["audio_hash"] or "-")[:32] + "...")
    doc.text("Anyone can re-check this record at the Karaar AI verify page for this agreement ID.", "small")

    doc.text("5. Full audit log", "h2", gap_before=10)
    for row in trail:
        move = f"{row['from_state'] or ''} -> {row['to_state']}" if row["to_state"] else ""
        who = row["actor"] + (f" via {row['provider']}" if row["provider"] else "")
        doc.text(f"{_when(row['at'])}  {who}  {move}  {row['note'] or ''}".strip(), "mono")

    doc.text("6. For the complaint form", "h2", gap_before=10)
    for k, v in packet.sections.items():
        doc.row(k, v)
    doc.row("File at", packet.filing_url)

    audit.log(actor="system", agreement_id=agreement_id, provider=get_adapter("edaakhil").name,
              note="dispute PDF generated")
    return doc.render(footer=f"Karaar AI dispute summary {agreement_id}"), f"karaar-dispute-{agreement_id}.pdf"
