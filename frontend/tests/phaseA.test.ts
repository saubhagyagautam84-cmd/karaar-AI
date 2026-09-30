import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashAgreement, hashAmendment, verifyChain } from "../lib/hash";
import { chainHead, describeDelta, extractDelta, withMilestoneForChange } from "../lib/amend";
import { effectiveTerms, milestoneProblem, paidTotal, suggestMilestones, totalPayable } from "../lib/terms";
import { FlowError, addPhotos, approveMilestone, payMilestone, rejectMilestone, submitMilestone } from "../lib/milestoneFlow";
import { mediate } from "../lib/mediator";
import { confirmAmendment } from "../lib/confirm";
import { addStatement, afterSettlementSealed, applySettlementPayment, ensureSettlement, raiseDispute, withMediation } from "../lib/settle";
import type { Agreement, Photo } from "../lib/types";

const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/hash_parity.json", import.meta.url), "utf8")) as {
  agreement: Agreement;
  expected: { agreement: string; amendments: string[] };
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** Sealed record with the change order only (no settlement), no payments. */
const withChange = (): Agreement => {
  const a = clone(fixture.agreement);
  return { ...a, amendments: [a.amendments![0]] };
};
const afterPhoto: Photo = { id: "p1", kind: "after", hash: "a".repeat(64), takenAt: "2026-10-03T10:00:00.000Z", size: 1000 };
const TODAY = new Date("2026-10-05T12:00:00");

test("hash parity fixture: the frontend reproduces the stored hashes", async () => {
  const a = fixture.agreement;
  assert.equal(await hashAgreement(a), fixture.expected.agreement);
  assert.deepEqual(await Promise.all(a.amendments!.map(hashAmendment)), fixture.expected.amendments);
  assert.deepEqual(await verifyChain(a), { ok: true, checked: 3 });
});

test("the chain breaks on any edit, or a wrong link", async () => {
  const edited = clone(fixture.agreement);
  edited.amendments![0].delta.priceChange = 3000;
  assert.equal((await verifyChain(edited)).broken, "KR-7001-A1");
  const relinked = clone(fixture.agreement);
  relinked.amendments![1].parentHash = relinked.hash as string;
  assert.equal((await verifyChain(relinked)).broken, "KR-7001-S1");
  const sealedEdit = clone(fixture.agreement);
  sealedEdit.terms.price = 17000;
  assert.equal((await verifyChain(sealedEdit)).ok, false);
});

test("payments, photos and events stay outside the seal", async () => {
  const a = clone(fixture.agreement);
  a.payments.push({ id: "x", kind: "advance", amount: 5000, at: "2026-10-01T00:00:00.000Z", upiRef: "U1" });
  a.events.push({ at: "2026-10-01T00:00:00.000Z", label: "anything" });
  a.progress = { m1: { status: "submitted", photos: [afterPhoto] } };
  assert.equal(await hashAgreement(a), fixture.expected.agreement);
});

test("effective terms apply sealed changes on top of the untouched original", () => {
  const a = withChange();
  const t = effectiveTerms(a);
  assert.equal(t.price, 20000);
  assert.equal(t.deadline, "2026-10-08");
  assert.equal(t.durationDays, 8);
  assert.deepEqual(t.scope.map((s) => s.en), ["Two bedrooms", "Hall / living room", "Balcony"]);
  assert.deepEqual(t.milestones!.map((m) => m.id), ["m1", "m2", "c1"]);
  assert.equal(a.terms.price, 18000);
  assert.equal(totalPayable(a), 20000);
});

test("change-order extraction pulls out only the delta", () => {
  const d = extractDelta([
    { speaker: "hirer", text: "Balcony bhi paint kar dena.", t: 0 },
    { speaker: "worker", text: "Theek hai, 2000 rupaye extra lagenge aur ek din aur lagega.", t: 4 },
  ]);
  assert.deepEqual(d.addScope, [{ en: "Balcony", hi: "बालकनी" }]);
  assert.equal(d.priceChange, 2000);
  assert.equal(d.extraDays, 1);
  assert.equal(describeDelta(d), "+ Balcony · + ₹2,000 · + 1 day");
  const removed = extractDelta([{ speaker: "hirer", text: "Kitchen mat karo, 1500 kam kar do", t: 0 }]);
  assert.deepEqual(removed.removeScope.map((s) => s.en), ["Kitchen"]);
  assert.equal(removed.priceChange, -1500);
  const withMs = withMilestoneForChange(d, fixture.agreement.terms, 1);
  assert.equal(withMs.addMilestones![0].amount, 2000);
});

test("milestones must add up to the balance due", () => {
  const t = clone(fixture.agreement.terms);
  assert.equal(milestoneProblem(t), null);
  t.milestones![1].amount = 6000;
  assert.match(milestoneProblem(t) ?? "", /add up to ₹12,500/);
  const suggested = suggestMilestones({ ...t, milestones: undefined });
  assert.equal(suggested.reduce((s, m) => s + m.amount, 0), 13000);
});

test("milestone flow: submit needs an after photo, then approve / reject / pay", () => {
  let a = withChange();
  assert.throws(() => submitMilestone(a, "m1"), FlowError);
  a = submitMilestone(addPhotos(a, "m1", [afterPhoto]), "m1");
  assert.throws(() => submitMilestone(a, "m1"), /already marked done/);
  a = rejectMilestone(a, "m1", "Patches near the window");
  assert.equal(a.progress!.m1.rejectReason, "Patches near the window");
  a = approveMilestone(submitMilestone(a, "m1"), "m1");
  assert.throws(() => payMilestone(a, "m1", "U1"), /advance first/);
  a = { ...a, payments: [{ id: "adv", kind: "advance", amount: 5000, at: "2026-10-01T00:00:00.000Z", upiRef: "U0" }] };
  a = payMilestone(a, "m1", "U1");
  assert.equal(a.progress!.m1.status, "paid");
  assert.equal(paidTotal(a), 11500);
  assert.equal(a.status, "advance_paid");
});

test("mediator: quality dispute with milestones holds back 10% of the work in question", () => {
  const a: Agreement = {
    ...withChange(),
    payments: [
      { id: "adv", kind: "advance", amount: 5000, at: "2026-10-01T00:00:00.000Z", upiRef: "U0" },
      { id: "m1", kind: "milestone", milestoneId: "m1", amount: 6500, at: "2026-10-03T00:00:00.000Z", upiRef: "U1" },
    ],
    progress: {
      m1: { status: "paid", photos: [afterPhoto] },
      m2: { status: "submitted", photos: [afterPhoto] },
      c1: { status: "rejected", photos: [], rejectReason: "Uneven coat" },
    },
  };
  const m = mediate(a, "Quality of work", TODAY);
  assert.equal(m.payToWorker, 7650);
  assert.equal(m.refundToHirer, 0);
  assert.equal(m.calculation.at(-1)!.amount, 7650);
  assert.ok(m.contested.some((c) => c.includes("Uneven coat")));
  assert.ok(m.evidence[0].startsWith("Sealed agreement KR-7001"));
});

test("mediator: no milestones, overpaid, and an unpaid advance", () => {
  const plain = withChange();
  plain.terms = { ...plain.terms, milestones: undefined };
  plain.amendments![0] = { ...plain.amendments![0], delta: { ...plain.amendments![0].delta, addMilestones: undefined } };
  plain.payments = [{ id: "adv", kind: "advance", amount: 5000, at: "2026-10-01T00:00:00.000Z", upiRef: "U0" }];
  assert.equal(mediate(plain, "Quality of work", TODAY).payToWorker, 13500);
  assert.equal(mediate(plain, "Late payment", TODAY).payToWorker, 15000);
  const over: Agreement = { ...plain, payments: [{ id: "x", kind: "balance", amount: 21000, at: "2026-10-01T00:00:00.000Z", upiRef: "U9" }] };
  const m = mediate(over, "Other", TODAY);
  assert.equal(m.refundToHirer, 1000);
  assert.equal(m.payToWorker, 0);
  const ms = withChange();
  ms.progress = { m1: { status: "approved", photos: [afterPhoto] } };
  assert.equal(mediate(ms, "Late payment", TODAY).payToWorker, 11500); // advance 5,000 + approved 6,500
});

test("dispute → both accept → sealed settlement → payment; the hold stays payable", async () => {
  let a: Agreement = {
    ...withChange(),
    status: "advance_paid",
    payments: [
      { id: "adv", kind: "advance", amount: 5000, at: "2026-10-01T00:00:00.000Z", upiRef: "U0" },
      { id: "m1", kind: "milestone", milestoneId: "m1", amount: 6500, at: "2026-10-03T00:00:00.000Z", upiRef: "U1" },
    ],
    progress: {
      m1: { status: "paid", photos: [afterPhoto] },
      m2: { status: "submitted", photos: [afterPhoto] },
      c1: { status: "submitted", photos: [afterPhoto] },
    },
  };
  a = raiseDispute(a, "hirer", "Quality of work", "Hall has patches", "text");
  assert.equal(a.status, "disputed");
  a = addStatement(a, "worker", "I will fix the patches", "voice");
  a = withMediation(a, mediate(a, "Quality of work", TODAY));
  const { next, amendment } = ensureSettlement(a);
  assert.equal(amendment.parentHash, chainHead(a));
  a = (await confirmAmendment(next, amendment.id, "worker", "in_app")).next;
  const done = await confirmAmendment(a, amendment.id, "hirer", "in_app");
  assert.equal(done.sealed, true);
  a = afterSettlementSealed(done.next);
  assert.equal(a.dispute!.outcome, "settled");
  assert.equal((await verifyChain(a)).ok, true);
  a = applySettlementPayment(a, "USETTLE");
  assert.equal(a.progress!.m2.status, "paid");
  assert.equal(a.progress!.c1.status, "paid");
  assert.equal(totalPayable(a) - paidTotal(a), 850); // 10% of ₹8,500 held back until rework
  assert.equal(a.status, "advance_paid");
});
