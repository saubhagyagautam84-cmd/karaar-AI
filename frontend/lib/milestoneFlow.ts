/**
 * Milestone transitions (A1): pending → submitted → approved → paid (or rejected → submitted again).
 * Pure functions: the browser applies them in demo mode; the backend applies the same rules in live mode.
 */
import type { Agreement, MilestoneProgress, Photo } from "./types";
import { effectiveTerms, paidTotal, progressOf, totalPayable } from "./terms";

const now = () => new Date().toISOString();
export class FlowError extends Error {}

function setProgress(a: Agreement, id: string, p: MilestoneProgress): Agreement {
  return { ...a, progress: { ...(a.progress ?? {}), [id]: p } };
}

function milestone(a: Agreement, id: string) {
  const m = (effectiveTerms(a).milestones ?? []).find((x) => x.id === id);
  if (!m) throw new FlowError("That milestone is not part of this agreement.");
  return m;
}

function assertActive(a: Agreement) {
  if (!a.hash) throw new FlowError("Milestones start once both people have confirmed.");
  if (a.status === "disputed") throw new FlowError("Paused while the dispute is open.");
  if (a.status === "completed") throw new FlowError("This agreement is already completed.");
}

/** Worker adds before/after photos to a milestone (or to "work" when there are no milestones). */
export function addPhotos(a: Agreement, id: string, photos: Photo[]): Agreement {
  const p = progressOf(a, id);
  return setProgress(a, id, { ...p, photos: [...p.photos, ...photos] });
}

export function submitMilestone(a: Agreement, id: string): Agreement {
  assertActive(a);
  const m = milestone(a, id);
  const p = progressOf(a, id);
  if (p.status !== "pending" && p.status !== "rejected") throw new FlowError("This milestone was already marked done.");
  if (!p.photos.some((x) => x.kind === "after")) throw new FlowError("Add at least one 'after' photo as proof first.");
  const next = setProgress(a, id, { ...p, status: "submitted", submittedAt: now(), rejectReason: undefined });
  return { ...next, events: [...a.events, { at: now(), label: `Milestone done: ${m.title}`, detail: `${p.photos.length} photo${p.photos.length === 1 ? "" : "s"} · awaiting ${a.hirer.name}'s approval` }] };
}

export function approveMilestone(a: Agreement, id: string): Agreement {
  assertActive(a);
  const m = milestone(a, id);
  const p = progressOf(a, id);
  if (p.status !== "submitted") throw new FlowError("Only a milestone marked done can be approved.");
  const next = setProgress(a, id, { ...p, status: "approved", approvedAt: now() });
  return { ...next, events: [...a.events, { at: now(), label: `Milestone approved: ${m.title}`, detail: `by ${a.hirer.name}` }] };
}

export function rejectMilestone(a: Agreement, id: string, reason: string): Agreement {
  assertActive(a);
  const m = milestone(a, id);
  const p = progressOf(a, id);
  if (p.status !== "submitted") throw new FlowError("Only a milestone marked done can be rejected.");
  if (!reason.trim()) throw new FlowError("Please say what needs fixing.");
  const next = setProgress(a, id, { ...p, status: "rejected", rejectedAt: now(), rejectReason: reason.trim() });
  return { ...next, events: [...a.events, { at: now(), label: `Milestone sent back: ${m.title}`, detail: reason.trim() }] };
}

/** After the UPI payment for an approved milestone is confirmed. Completes the agreement when nothing is left. */
export function payMilestone(a: Agreement, id: string, upiRef: string): Agreement {
  assertActive(a);
  const m = milestone(a, id);
  const p = progressOf(a, id);
  if (p.status !== "approved") throw new FlowError("Approve the milestone before paying it.");
  if ((a.terms.advance ?? 0) > 0 && !a.payments.some((x) => x.kind === "advance")) throw new FlowError("Pay the advance first.");
  const at = now();
  let next = setProgress(a, id, { ...p, status: "paid", paidAt: at, upiRef });
  next = {
    ...next,
    payments: [...a.payments, { id: `milestone-${id}-${Date.now()}`, kind: "milestone", milestoneId: id, amount: m.amount, at, upiRef }],
    events: [...a.events, { at, label: `Milestone paid via UPI: ${m.title}`, detail: `₹${m.amount.toLocaleString("en-IN")} · ${upiRef}` }],
    status: a.status === "sealed" ? "advance_paid" : a.status,
  };
  const allPaid = (effectiveTerms(next).milestones ?? []).every((x) => progressOf(next, x.id).status === "paid");
  if (allPaid && paidTotal(next) >= totalPayable(next)) {
    next = { ...next, status: "completed", events: [...next.events, { at, label: "Work completed", detail: "All milestones approved and paid" }] };
  }
  return next;
}
