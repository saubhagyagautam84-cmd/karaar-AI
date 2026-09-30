import type { Agreement } from "./types";
import { hashAgreement } from "./hash";

/** Past agreements for the demo worker (Ramesh), so the trust profile has a history. All synthetic. */
const HISTORY = [
  { job: "Painting", hirer: "Vikram Mehta", loc: "Lajpat Nagar, Delhi", scope: [["1 bedroom", "1 बेडरूम"], ["Walls: 2 coats", "दीवारें: 2 कोट"]], price: 7500, adv: 2000, days: 3, ago: 140, rating: 5, late: 0 },
  { job: "Painting", hirer: "Farah Khan", loc: "Jangpura, Delhi", scope: [["Hall / living room", "हॉल"], ["Ceilings", "छत"]], price: 9000, adv: 3000, days: 4, ago: 96, rating: 4, late: 1 },
  { job: "Painting", hirer: "Suresh Iyer", loc: "Defence Colony, Delhi", scope: [["2 bedrooms", "2 बेडरूम"], ["Kitchen", "किचन"]], price: 14000, adv: 4000, days: 5, ago: 61, rating: 5, late: 0 },
  { job: "Painting", hirer: "Harpreet Kaur", loc: "Kalkaji, Delhi", scope: [["Balcony", "बालकनी"], ["Main gate (enamel)", "मेन गेट (इनेमल)"]], price: 4500, adv: 1000, days: 2, ago: 33, rating: 5, late: 0 },
] as const;

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export async function buildSeed(): Promise<Agreement[]> {
  const out: Agreement[] = [];
  for (let i = 0; i < HISTORY.length; i++) {
    const h = HISTORY[i];
    const created = daysAgo(h.ago);
    const deadline = daysAgo(h.ago - h.days);
    const done = daysAgo(h.ago - h.days - h.late);
    const a: Agreement = {
      id: `KR-${(4821 + i * 137).toString()}`,
      createdAt: created.toISOString(),
      status: "completed",
      worker: { name: "Ramesh Kumar", phone: "98100 12345", lang: "hinglish", role: "worker" },
      hirer: { name: h.hirer, phone: `9899${i}0 1${i}${i}45`, lang: "en", role: "hirer" },
      consent: { worker: true, hirer: true, at: created.toISOString() },
      audioSeconds: 38 + i * 7,
      transcript: [],
      terms: {
        jobType: h.job, location: h.loc,
        scope: h.scope.map(([en, hi]) => ({ en, hi })), excluded: [],
        price: h.price, advance: h.adv, advanceAdjusted: true,
        durationDays: h.days, deadline: deadline.toISOString().slice(0, 10),
        materialsBy: "worker", balanceWhen: "On completion", paymentMode: "UPI",
      },
      flags: [],
      confirmations: {
        worker: { at: created.toISOString(), channel: "whatsapp", reply: "Haan, pakka", lang: "hinglish" },
        hirer: { at: created.toISOString(), channel: "whatsapp", reply: "Haan, pakka", lang: "en" },
      },
      payments: [
        { id: `p${i}a`, kind: "advance", amount: h.adv, at: created.toISOString(), upiRef: `UPI${400100 + i * 13}` },
        { id: `p${i}b`, kind: "balance", amount: h.price - h.adv, at: done.toISOString(), upiRef: `UPI${400200 + i * 17}` },
      ],
      events: [
        { at: created.toISOString(), label: "Recorded with consent" },
        { at: created.toISOString(), label: "Both confirmed on WhatsApp" },
        { at: created.toISOString(), label: "Sealed" },
        { at: done.toISOString(), label: h.late ? `Completed (${h.late} day late)` : "Completed on time" },
      ],
      rating: h.rating,
    };
    a.hash = await hashAgreement(a);
    a.sealedAt = created.toISOString();
    out.push(a);
  }
  return out.reverse();
}
