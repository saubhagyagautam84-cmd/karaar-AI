// Writes backend/tests/fixtures/hash_parity.json: records plus the hashes the *frontend* computes.
// pytest (test_phase_a.py) and tests/phaseA.test.ts both check against it. Re-run: npm run test:parity-fixture
import { writeFileSync } from "node:fs";
import { hashAgreement, hashAmendment } from "../lib/hash";
import type { Agreement, Amendment } from "../lib/types";

const base: Agreement = {
  id: "KR-7001",
  createdAt: "2026-09-30T10:00:00.000Z",
  status: "sealed",
  worker: { name: "Ramesh Kumar", phone: "xxxxxx2345", lang: "hinglish", role: "worker", phoneHash: "" },
  hirer: { name: "अनीता शर्मा", phone: "xxxxxx7890", lang: "hi", role: "hirer", phoneHash: "" },
  consent: { worker: true, hirer: true, at: "2026-09-30T10:00:00.000Z" },
  audioSeconds: 44,
  transcript: [
    { speaker: "hirer", text: "Do kamre aur hall, ₹18,000 — theek?", t: 0 },
    { speaker: "worker", text: "Haan ji, paanch hazaar advance. 🙏", t: 6, uncertain: true },
  ],
  terms: {
    jobType: "Painting",
    location: "Lajpat Nagar, New Delhi",
    scope: [{ en: "Two bedrooms", hi: "दो बेडरूम" }, { en: "Hall / living room", hi: "हॉल" }],
    excluded: [{ en: "Ceilings", hi: "छत" }],
    price: 18000,
    advance: 5000,
    advanceAdjusted: true,
    durationDays: 7,
    deadline: "2026-10-07",
    materialsBy: "worker",
    balanceWhen: "On completion",
    paymentMode: "UPI",
    milestones: [
      { id: "m1", title: "Bedrooms done", titleHi: "बेडरूम पूरा", amount: 6500 },
      { id: "m2", title: "Hall done", titleHi: "हॉल पूरा", amount: 6500 },
    ],
  },
  flags: [],
  confirmations: {
    worker: { at: "2026-09-30T10:05:00.000Z", channel: "ivr", reply: "हाँ, पक्का ✅", lang: "hinglish" },
    hirer: { at: "2026-09-30T10:06:00.000Z", channel: "whatsapp", reply: "हाँ, पक्का ✅", lang: "hi" },
  },
  payments: [],
  events: [],
};
// Placeholder phone hashes (64 hex chars, like the backend stores); the numbers themselves never appear.
base.worker.phoneHash = "5d0b0a4f4a1c4c6b8f0f6f0d2b6b4a7e1d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a";
base.hirer.phoneHash = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

async function main() {
  const a: Agreement = { ...base, hash: await hashAgreement(base), sealedAt: "2026-09-30T10:06:00.000Z" };
  const change: Amendment = {
    id: "KR-7001-A1",
    createdAt: "2026-10-02T09:00:00.000Z",
    source: "change",
    description: "Balcony bhi kar do, 2000 extra, ek din aur",
    transcript: [{ speaker: "hirer", text: "Balcony bhi kar do", t: 0 }, { speaker: "worker", text: "2000 extra, ek din aur", t: 4 }],
    delta: {
      addScope: [{ en: "Balcony", hi: "बालकनी" }],
      removeScope: [],
      priceChange: 2000,
      extraDays: 1,
      note: "Balcony bhi kar do 2000 extra, ek din aur",
      addMilestones: [{ id: "c1", title: "Balcony (change)", titleHi: "बालकनी (बदलाव)", amount: 2000 }],
    },
    parentHash: a.hash as string,
    confirmations: {
      worker: { at: "2026-10-02T09:01:00.000Z", channel: "in_app", reply: "Haan, pakka ✅", lang: "hinglish" },
      hirer: { at: "2026-10-02T09:02:00.000Z", channel: "whatsapp", reply: "हाँ, पक्का ✅", lang: "hi" },
    },
    sealedAt: "2026-10-02T09:02:00.000Z",
  };
  change.hash = await hashAmendment(change);
  const settlement: Amendment = {
    id: "KR-7001-S1",
    createdAt: "2026-10-09T12:00:00.000Z",
    source: "settlement",
    description: "Pay ₹12,150 now. Hold ₹1,350 until the worker fixes the issue within 7 days, then pay it.",
    transcript: [],
    delta: { addScope: [], removeScope: [], priceChange: 0, extraDays: 0, note: "Pay ₹12,150 to the worker now" },
    parentHash: change.hash,
    confirmations: {
      worker: { at: "2026-10-09T12:01:00.000Z", channel: "in_app", reply: "Haan, pakka ✅", lang: "hinglish" },
      hirer: { at: "2026-10-09T12:02:00.000Z", channel: "in_app", reply: "हाँ, पक्का ✅", lang: "hi" },
    },
    sealedAt: "2026-10-09T12:02:00.000Z",
  };
  settlement.hash = await hashAmendment(settlement);
  const record = { ...a, amendments: [change, settlement] };
  const out = new URL("../../backend/tests/fixtures/hash_parity.json", import.meta.url);
  writeFileSync(out, JSON.stringify({ agreement: record, expected: { agreement: a.hash, amendments: [change.hash, settlement.hash] } }, null, 2) + "\n", "utf8");
  console.log("wrote", out.pathname, a.hash);
}
void main();
