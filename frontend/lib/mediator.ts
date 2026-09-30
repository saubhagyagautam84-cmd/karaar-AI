/**
 * AI dispute mediator (A4), deterministic rules engine.
 * Demo mode runs this in the browser; live mode calls POST /v1/mediate, which runs the same
 * rules in Python (an LLM, when configured, only rewrites the wording, never the numbers).
 *
 * Every line cites the evidence it used. It is a suggestion to help both people settle,
 * not a legal judgment.
 */
import type { Agreement, CalcLine, DisputeReason, Mediation } from "./types";
import { effectiveTerms, paidTotal, progressOf, sealedAmendments, totalPayable } from "./terms";

export const DISPUTE_REASONS: { id: DisputeReason; hi: string }[] = [
  { id: "Scope not agreed", hi: "काम का दायरा तय नहीं था" },
  { id: "Advance not adjusted", hi: "एडवांस नहीं कटा" },
  { id: "Late payment", hi: "पैसा देर से मिला" },
  { id: "Quality of work", hi: "काम की क्वालिटी" },
  { id: "Deadline missed", hi: "तारीख़ पर काम पूरा नहीं हुआ" },
  { id: "Other", hi: "कुछ और" },
];

export const QUALITY_HOLDBACK = 0.1; // 10% held back until rework is done
export const DISCLAIMER =
  "This is a suggestion based only on this record, to help both of you settle. It is not a legal judgment. Either of you can escalate to the consumer forum (e-Daakhil).";

const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const short = (h?: string) => (h ? `${h.slice(0, 10)}…` : "—");

function daysBetween(fromIso: string, to: Date): number {
  const from = new Date(fromIso + "T00:00:00");
  const start = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((start.getTime() - from.getTime()) / 86400000);
}

export function mediate(a: Agreement, reason: DisputeReason, today: Date = new Date()): Mediation {
  const t = effectiveTerms(a);
  const total = totalPayable(a);
  const paid = paidTotal(a);
  const outstanding = Math.max(total - paid, 0);
  const overpaid = Math.max(paid - total, 0);
  const amendments = sealedAmendments(a);

  const facts: string[] = [];
  const agreed: string[] = [];
  const contested: string[] = [];
  const evidence: string[] = [`Sealed agreement ${a.id} (SHA-256 ${short(a.hash)})`];
  const calculation: CalcLine[] = [];

  // --- Facts from the record ---
  facts.push(`Sealed price ${rs(a.terms.price ?? 0)} for: ${a.terms.scope.map((s) => s.en).join(", ") || "scope as recorded"}.`);
  if (a.terms.excluded.length) facts.push(`Not included, as sealed: ${a.terms.excluded.map((s) => s.en).join(", ")}.`);
  amendments.forEach((am) => {
    facts.push(`${am.source === "settlement" ? "Settlement" : "Change order"} ${am.id}: ${am.description}.`);
    evidence.push(`${am.source === "settlement" ? "Settlement" : "Change order"} ${am.id} (SHA-256 ${short(am.hash)})`);
  });
  if (t.advance) {
    facts.push(`Advance ${rs(t.advance)}, ${t.advanceAdjusted === false ? "on top of the total" : "deducted from the total"}.`);
  }
  if (a.payments.length) {
    facts.push(`${rs(paid)} paid so far in ${a.payments.length} UPI payment${a.payments.length > 1 ? "s" : ""}.`);
    a.payments.forEach((p) => evidence.push(`UPI ${p.upiRef}: ${rs(p.amount)} (${p.kind})`));
  } else {
    facts.push("No payment recorded yet.");
  }
  const photos = Object.values(a.progress ?? {}).flatMap((p) => p.photos);
  if (photos.length) {
    facts.push(`${photos.length} proof-of-work photo${photos.length > 1 ? "s" : ""} on record, each with a SHA-256 hash.`);
    evidence.push(`${photos.length} photo hash${photos.length > 1 ? "es" : ""}`);
  }
  if (t.deadline) {
    const late = daysBetween(t.deadline, today);
    facts.push(late > 0 ? `Finish date ${t.deadline} passed ${late} day${late > 1 ? "s" : ""} ago.` : `Finish date ${t.deadline}.`);
  }
  (["hirer", "worker"] as const).forEach((r) => {
    const st = a.dispute?.statements[r];
    if (st) evidence.push(`Statement from the ${r === "hirer" ? "hirer" : "worker"} (${st.channel})`);
  });

  agreed.push(`Price and scope as sealed${amendments.length ? " plus the confirmed changes" : ""}: ${rs(t.price ?? 0)}.`);
  if (t.advance) agreed.push(`Advance of ${rs(t.advance)}.`);

  // --- Money ---
  calculation.push({ label: "Agreed total (sealed + confirmed changes)", amount: total });
  calculation.push({ label: "Already paid via UPI", amount: -paid });

  let payToWorker = outstanding;
  let suggestion = "";
  const ms = t.milestones ?? [];

  if (ms.length) {
    const sumBy = (status: string) => ms.filter((m) => progressOf(a, m.id).status === status).reduce((s, m) => s + m.amount, 0);
    const approved = sumBy("approved");
    const submitted = sumBy("submitted");
    const rejected = sumBy("rejected");
    const pending = sumBy("pending");
    const advanceDue = t.advance && !a.payments.some((p) => p.kind === "advance") ? t.advance : 0;
    ms.forEach((m) => {
      const st = progressOf(a, m.id).status;
      if (st === "approved" || st === "paid") agreed.push(`Milestone “${m.title}” (${rs(m.amount)}) ${st === "paid" ? "done and paid" : "approved by the hirer"}.`);
      if (st === "submitted") contested.push(`Milestone “${m.title}” (${rs(m.amount)}) marked done by the worker, not yet approved.`);
      if (st === "rejected") contested.push(`Milestone “${m.title}” (${rs(m.amount)}) rejected: ${progressOf(a, m.id).rejectReason ?? "no reason given"}.`);
      evidence.push(`Milestone “${m.title}”: ${st}`);
    });
    if (advanceDue) calculation.push({ label: "Advance not yet paid", amount: advanceDue });
    calculation.push({ label: "Approved milestones not yet paid", amount: approved });
    calculation.push({ label: "Milestones marked done, awaiting approval", amount: submitted + rejected });
    calculation.push({ label: "Milestones not started (not due yet)", amount: pending });

    const inQuestion = submitted + rejected;
    if (reason === "Quality of work") {
      const hold = Math.round(inQuestion * QUALITY_HOLDBACK);
      calculation.push({ label: `Held back until rework (${QUALITY_HOLDBACK * 100}% of the work in question)`, amount: -hold });
      payToWorker = advanceDue + approved + inQuestion - hold;
      suggestion = `Pay ${rs(payToWorker)} now. Hold ${rs(hold)} until the worker fixes the issue within 7 days, then pay it. Milestones not started are not due yet.`;
    } else {
      payToWorker = advanceDue + approved + inQuestion;
      suggestion = `Pay ${rs(payToWorker)} now for the approved and completed milestones. ${pending ? `${rs(pending)} for milestones not started is not due yet.` : ""}`.trim();
    }
  } else if (reason === "Quality of work") {
    const hold = Math.round(outstanding * QUALITY_HOLDBACK);
    calculation.push({ label: "Outstanding", amount: outstanding });
    calculation.push({ label: `Held back until rework (${QUALITY_HOLDBACK * 100}%)`, amount: -hold });
    payToWorker = outstanding - hold;
    contested.push("Whether the work meets the agreed standard.");
    suggestion = `Pay ${rs(payToWorker)} now and ${rs(hold)} after the worker fixes the issue within 7 days.`;
  } else {
    calculation.push({ label: "Outstanding", amount: outstanding });
    payToWorker = outstanding;
    suggestion = outstanding ? `Pay the outstanding ${rs(outstanding)} as sealed.` : "Nothing is outstanding under the sealed terms.";
  }

  // --- Reason-specific notes (never new money rules the two people did not agree) ---
  if (reason === "Advance not adjusted" && t.advance) {
    contested.push("Whether the advance counts towards the total.");
    suggestion += ` The sealed record says the advance is ${t.advanceAdjusted === false ? "on top of" : "part of"} the total, so it ${t.advanceAdjusted === false ? "does not reduce" : "reduces"} the balance.`;
  }
  if (reason === "Scope not agreed") {
    contested.push("Work that is not in the sealed scope or a confirmed change order.");
    suggestion += " Work outside the sealed scope is payable only if both confirm it as a change order.";
  }
  if (reason === "Deadline missed") {
    contested.push("The delay and its cause.");
    suggestion += " No delay penalty was agreed in the sealed terms, so no deduction is suggested; agree a new finish date as a change order.";
  }
  if (reason === "Late payment") contested.push("When the payment was due.");
  if (reason === "Other") contested.push("The issue described in the statements.");

  let refundToHirer = 0;
  if (overpaid) {
    refundToHirer = overpaid;
    payToWorker = 0;
    calculation.push({ label: "Paid more than the agreed total", amount: overpaid });
    suggestion = `The hirer has paid ${rs(overpaid)} more than the agreed total. The worker returns ${rs(overpaid)}.`;
  }
  calculation.push({ label: refundToHirer ? "Refund to the hirer" : "Suggested payment to the worker now", amount: refundToHirer || payToWorker });

  return {
    at: today.toISOString(),
    engine: "rules",
    facts,
    agreed,
    contested,
    calculation,
    payToWorker: Math.max(0, Math.round(payToWorker)),
    refundToHirer,
    suggestion: suggestion.trim(),
    evidence,
    disclaimer: DISCLAIMER,
  };
}
