/**
 * Dispute lifecycle (A4): raise → statements → AI suggestion → both accept → sealed settlement → pay.
 * Pure functions, shared by the dispute panel and the tests. The settlement is a separately sealed
 * amendment chained to the record; it never edits the sealed agreement.
 */
import type { Agreement, Amendment, DisputeReason, Mediation, Payment, Role } from "./types";
import { chainHead } from "./amend";
import { effectiveTerms, paidTotal, progressOf, totalPayable } from "./terms";

const now = () => new Date().toISOString();
const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function raiseDispute(a: Agreement, by: Role, reason: DisputeReason, text: string, channel: "text" | "voice"): Agreement {
  if (!a.hash) throw new Error("Only a sealed agreement can be disputed.");
  if (a.status === "disputed") throw new Error("A dispute is already open.");
  const at = now();
  return {
    ...a,
    status: "disputed",
    dispute: {
      raisedBy: by,
      raisedAt: at,
      reason,
      statements: text.trim() ? { [by]: { text: text.trim(), at, channel } } : {},
      previousStatus: a.status,
    },
    events: [...a.events, { at, label: "Dispute raised", detail: `${a[by].name} · ${reason}` }],
  };
}

export function addStatement(a: Agreement, role: Role, text: string, channel: "text" | "voice"): Agreement {
  if (!a.dispute) return a;
  const at = now();
  return {
    ...a,
    dispute: { ...a.dispute, statements: { ...a.dispute.statements, [role]: { text: text.trim(), at, channel } }, mediation: undefined, accepted: undefined },
    events: [...a.events, { at, label: `Statement from ${a[role].name}`, detail: channel === "voice" ? "spoken" : "typed" }],
  };
}

export function withMediation(a: Agreement, m: Mediation): Agreement {
  if (!a.dispute) return a;
  return {
    ...a,
    dispute: { ...a.dispute, mediation: m, accepted: undefined },
    events: [...a.events, { at: m.at, label: "AI mediator suggestion ready", detail: m.refundToHirer ? `Refund ${rs(m.refundToHirer)}` : `Pay ${rs(m.payToWorker)}` }],
  };
}

/** The settlement amendment (sealed or waiting for confirmations), if one exists for the open dispute. */
export function settlementOf(a: Agreement): Amendment | undefined {
  if (!a.dispute) return undefined;
  const raised = a.dispute.raisedAt;
  return (a.amendments ?? []).find((am) => am.source === "settlement" && am.createdAt >= raised);
}

/** First acceptance creates the (unsealed) settlement; both confirmations seal it via confirmAmendment. */
export function ensureSettlement(a: Agreement): { next: Agreement; amendment: Amendment } {
  const existing = settlementOf(a);
  if (existing) return { next: a, amendment: existing };
  const m = a.dispute?.mediation;
  if (!m) throw new Error("Get the mediator's suggestion first.");
  const amendment: Amendment = {
    id: `${a.id}-S${(a.amendments ?? []).filter((x) => x.source === "settlement").length + 1}`,
    createdAt: now(),
    source: "settlement",
    description: m.suggestion,
    transcript: [],
    delta: { addScope: [], removeScope: [], priceChange: 0, extraDays: 0, note: m.refundToHirer ? `Refund ${rs(m.refundToHirer)} to the hirer` : `Pay ${rs(m.payToWorker)} to the worker now` },
    parentHash: chainHead(a),
    confirmations: {},
  };
  return { next: { ...a, amendments: [...(a.amendments ?? []), amendment] }, amendment };
}

/** Mark who accepted (for display); the seal itself comes from confirmAmendment. */
export function markAccepted(a: Agreement, role: Role): Agreement {
  if (!a.dispute) return a;
  return { ...a, dispute: { ...a.dispute, accepted: { ...a.dispute.accepted, [role]: now() } } };
}

/** Once the settlement is sealed: close the dispute. With nothing to pay, work resumes right away. */
export function afterSettlementSealed(a: Agreement): Agreement {
  if (!a.dispute) return a;
  const m = a.dispute.mediation;
  const nothingToPay = !m || (m.payToWorker === 0 && m.refundToHirer === 0);
  return finish({ ...a, dispute: { ...a.dispute, outcome: "settled" } }, nothingToPay);
}

function finish(a: Agreement, resume: boolean): Agreement {
  if (!resume || !a.dispute) return a;
  const ms = effectiveTerms(a).milestones ?? [];
  const allMilestonesPaid = ms.every((m) => progressOf(a, m.id).status === "paid");
  const done = paidTotal(a) >= totalPayable(a) && allMilestonesPaid;
  const at = now();
  return {
    ...a,
    status: done ? "completed" : a.dispute.previousStatus === "sealed" && a.payments.length ? "advance_paid" : a.dispute.previousStatus,
    events: [...a.events, { at, label: done ? "Settled and completed" : "Settled · work continues" }],
  };
}

/**
 * The settlement payment (or refund) was confirmed by UPI. An unpaid advance is recorded as the
 * advance; milestones in question are marked paid (any amount held back stays payable as balance).
 */
export function applySettlementPayment(a: Agreement, upiRef: string): Agreement {
  const m = a.dispute?.mediation;
  if (!a.dispute || !m || a.dispute.outcome !== "settled") throw new Error("Both people must accept the settlement first.");
  const at = now();
  const payments: Payment[] = [];
  if (m.refundToHirer > 0) {
    payments.push({ id: `settlement-${Date.now()}`, kind: "settlement", amount: -m.refundToHirer, at, upiRef });
  } else {
    let rest = m.payToWorker;
    const t = effectiveTerms(a);
    if (t.advance && !a.payments.some((p) => p.kind === "advance") && rest >= t.advance) {
      payments.push({ id: `advance-${Date.now()}`, kind: "advance", amount: t.advance, at, upiRef });
      rest -= t.advance;
    }
    if (rest > 0) payments.push({ id: `settlement-${Date.now()}`, kind: "settlement", amount: rest, at, upiRef });
  }
  const progress = { ...(a.progress ?? {}) };
  for (const ms of effectiveTerms(a).milestones ?? []) {
    const p = progressOf(a, ms.id);
    if (m.payToWorker > 0 && (p.status === "approved" || p.status === "submitted" || p.status === "rejected")) {
      progress[ms.id] = { ...p, status: "paid", paidAt: at, upiRef };
    }
  }
  const next: Agreement = {
    ...a,
    progress,
    payments: [...a.payments, ...payments],
    events: [...a.events, { at, label: m.refundToHirer ? "Settlement refund via UPI" : "Settlement paid via UPI", detail: `${rs(m.refundToHirer || m.payToWorker)} · ${upiRef}` }],
  };
  return finish(next, true);
}

export function escalate(a: Agreement): Agreement {
  if (!a.dispute) return a;
  return {
    ...a,
    dispute: { ...a.dispute, outcome: "escalated" },
    events: [...a.events, { at: now(), label: "Escalated to consumer forum", detail: "e-Daakhil evidence pack prepared" }],
  };
}
