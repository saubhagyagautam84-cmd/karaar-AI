// Runs the 2-minute demo end to end through the running app's /backend proxy, N times,
// exactly as the browser does in live mode. Seals with the frontend's own lib/hash.ts, so a
// pass also proves browser and server compute byte-identical SHA-256 seals.
// Usage: npm run demo:check -- [runs=3] [app=http://localhost:3000]
import { createHash } from "node:crypto";
import { hashAgreement, hashAmendment } from "../frontend/lib/hash.ts";

const runs = Number(process.argv[2] ?? 3);
const base = `${process.argv[3] ?? "http://localhost:3000"}/backend`;

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function ok(method, path, body) {
  const { status, data } = await call(method, path, body);
  if (status >= 300) throw new Error(`${method} ${path} -> ${status}: ${data.detail ?? ""}`);
  return data;
}
function check(cond, label) {
  if (!cond) throw new Error(`FAILED: ${label}`);
  console.log(`  ✓ ${label}`);
}
const now = () => new Date().toISOString();

async function demoOnce(n) {
  console.log(`\nRun ${n}`);
  const t0 = Date.now();
  const health = await ok("GET", "/v1/health");
  check(health.status === "ok", `backend live through the proxy (${health.simulated.length} DPI services simulated)`);

  // 1. Record: both consent, the conversation is transcribed
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(4096)], { type: "audio/webm" }), "deal.webm");
  form.append("lang", "hinglish");
  const tr = await fetch(`${base}/v1/transcribe`, { method: "POST", body: form }).then((r) => r.json());
  check(tr.segments.length === 10, "conversation transcribed (10 turns)");

  // 2. Review: 6 gaps
  const { terms, flags } = await ok("POST", "/v1/extract", {
    transcript: tr.segments, hints: { jobType: "Painting", location: "Lajpat Nagar, New Delhi" },
  });
  check(terms.price === 18000 && terms.advance === 5000, "₹18,000 with ₹5,000 advance extracted");
  check(flags.length === 6 && flags[0].title === "Ceiling painting not discussed", "6 gaps flagged, ceiling first");

  const id = `KR-${9000 + n}`;
  const at = now();
  let a = {
    id, createdAt: at, status: "review",
    worker: { name: "Ramesh Kumar", phone: "98100 12345", lang: "hinglish", role: "worker" },
    hirer: { name: "Anita Sharma", phone: "98990 67890", lang: "en", role: "hirer" },
    consent: { worker: true, hirer: true, at }, audioSeconds: 44, transcript: tr.segments, terms, flags,
    confirmations: {}, payments: [], events: [{ at, label: "Both parties consented to recording" }],
  };
  await ok("PUT", `/v1/agreements/${id}`, a);
  const stored = await ok("GET", `/v1/agreements/${id}`);
  check(stored.worker.phone === "xxxxxx2345" && !JSON.stringify(stored).includes("98100"), "server keeps masked numbers only");

  // Resolve every gap (what the review page's buttons do)
  const deadline = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  a.terms = { ...terms, excluded: [{ en: "Ceilings", hi: "छत" }], materialsBy: "worker", advanceAdjusted: true,
    deadline, balanceWhen: "On completion", paymentMode: "UPI" };
  a.flags = flags.map((f) => ({ ...f, resolved: true, resolution: "settled" }));
  a.status = "awaiting_confirmation";
  await ok("PUT", `/v1/agreements/${id}`, a);

  // 3. Confirm: WhatsApp to both, both say "Haan, pakka", sealed
  for (const role of ["worker", "hirer"]) {
    const m = await ok("POST", "/v1/notify/whatsapp", { agreementId: id, role, text: `Karaar ${id}`, phone: a[role].phone });
    check(Boolean(m.messageId), `WhatsApp summary sent to the ${role}`);
  }
  a.confirmations = {
    worker: { at: now(), channel: "whatsapp", reply: "हाँ, पक्का ✅", lang: "hinglish" },
    hirer: { at: now(), channel: "whatsapp", reply: "Haan, pakka ✅", lang: "en" },
  };
  a.hash = await hashAgreement(a);
  a.sealedAt = now();
  a.status = "sealed";
  await ok("POST", `/v1/agreements/${id}/seal`, { hash: a.hash, agreement: a });
  const v = await ok("GET", `/v1/agreements/${id}/verify`);
  check(v.valid && v.storedHash === a.hash, "server re-hash matches the browser's seal");

  // 4. Tamper test: the server refuses a changed price
  const tamper = await call("PUT", `/v1/agreements/${id}`, { ...a, terms: { ...a.terms, price: 12000 } });
  check(tamper.status === 409, "₹12,000 tamper refused by the server");

  // 5. Pay the advance and the balance over UPI
  const adv = await ok("GET", `/v1/payments/${id}-advance`);
  a = { ...a, status: "advance_paid", payments: [{ id: "advance-1", kind: "advance", amount: adv.amount, at: now(), upiRef: adv.upiRef }] };
  await ok("PUT", `/v1/agreements/${id}`, a);
  const bal = await ok("GET", `/v1/payments/${id}-balance`);
  a = { ...a, status: "completed", payments: [...a.payments, { id: "balance-1", kind: "balance", amount: bal.amount, at: now(), upiRef: bal.upiRef }] };
  await ok("PUT", `/v1/agreements/${id}`, a);
  check(adv.amount === 5000 && bal.amount === 13000, "UPI advance ₹5,000 and balance ₹13,000 confirmed");

  // 6. Governance view counts it, anonymously
  const dash = await ok("GET", "/v1/analytics?state=Delhi&trade=Painter&months=3");
  const text = JSON.stringify(dash);
  check(dash.meta.real >= 1 && !/Ramesh|Anita|KR-|xxxx/.test(text), "dashboard counts it, with no names or numbers");

  await phaseA(n, { ...a, id: `KR-${9100 + n}` });
  await phaseB(a);
  return { id, ms: Date.now() - t0 };
}

// Phase B: public verification, OTP login, consent-based sharing and the access log.
async function phaseB(a) {
  const pub = await ok("GET", `/v1/verify/${a.hash}`);
  check(pub.found && pub.valid && pub.worker === "Ramesh K." && !JSON.stringify(pub).includes("18000"), "public QR check: genuine, first names only, no price");

  const sent = await ok("POST", "/v1/auth/otp/send", { phone: "98100 12345" });
  const bad = await call("POST", "/v1/auth/otp/verify", { phone: "98100 12345", code: "000000", role: "worker" });
  const session = await ok("POST", "/v1/auth/otp/verify", { phone: "98100 12345", code: sent.demoCode, role: "worker" });
  check(bad.status === 400 && session.role === "worker" && session.phone === "xxxxxx2345", "OTP login: wrong code refused, worker signed in (masked number)");

  const auth = { Authorization: `Bearer ${session.token}` };
  const share = await fetch(`${base}/v1/profile/share`, {
    method: "POST", headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: "Demo NBFC", scope: ["jobs", "earnings"] }),
  }).then((r) => r.json());
  const seen = await ok("GET", `/v1/shared/${share.id}`);
  const log = await fetch(`${base}/v1/profile/access-log`, { headers: auth }).then((r) => r.json());
  check(seen.earnedViaUpi >= 18000 && seen.ratings === undefined && log[0].actor === "Demo NBFC", "share link shows only what was chosen; the view is in the worker's log");
  await fetch(`${base}/v1/profile/share/${share.id}`, { method: "DELETE", headers: auth });
  const gone = await call("GET", `/v1/shared/${share.id}`);
  check(gone.status === 410, "withdrawn share link stops working");
}

// Phase A: milestones with photo proof, a sealed change order, and the mediator.
async function phaseA(n, template) {
  const id = template.id;
  const at = now();
  let a = {
    ...template, createdAt: at, status: "awaiting_confirmation", confirmations: {}, payments: [], hash: undefined, sealedAt: undefined,
    terms: { ...template.terms, milestones: [
      { id: "m1", title: "Bedrooms done", titleHi: "बेडरूम पूरा", amount: 6500 },
      { id: "m2", title: "Hall done", titleHi: "हॉल पूरा", amount: 6500 },
    ] },
    events: [{ at, label: "Both parties consented to recording" }],
  };
  delete a.hash;
  delete a.sealedAt;
  await ok("PUT", `/v1/agreements/${id}`, a);
  a.confirmations = {
    worker: { at: now(), channel: "ivr", reply: "हाँ, पक्का ✅", lang: "hinglish" },
    hirer: { at: now(), channel: "in_app", reply: "Haan, pakka ✅", lang: "en" },
  };
  a.hash = await hashAgreement(a);
  a.status = "sealed";
  await ok("POST", `/v1/agreements/${id}/seal`, { hash: a.hash, agreement: a });
  check(true, "milestone agreement sealed (worker confirmed by IVR)");

  const ivr = await ok("POST", "/v1/ivr/call", { agreementId: id, role: "worker" });
  const key = await ok("POST", "/v1/ivr/webhook", { callId: ivr.callId, agreementId: id, role: "worker", digits: "1" });
  check(key.action === "confirm", "IVR keypress 1 = confirm");

  // Photo proof: the server re-hashes the bytes
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`after photo ${id} ${Date.now()}`)]);
  const hash = createHash("sha256").update(jpeg).digest("hex");
  const form = new FormData();
  form.append("image", new Blob([jpeg], { type: "image/jpeg" }), "after.jpg");
  for (const [k, v] of Object.entries({ photoId: `ph-${id}`, agreementId: id, milestoneId: "m1", kind: "after", hash })) form.append(k, v);
  const up = await fetch(`${base}/v1/photos`, { method: "POST", body: form }).then((r) => r.json());
  check(up.hash === hash, "photo SHA-256 identical on phone and server");
  const photo = { id: `ph-${id}`, kind: "after", hash, takenAt: now(), size: jpeg.length, url: up.url };

  a = await ok("POST", "/v1/milestones/m1/submit", { agreementId: id, photos: [photo] });
  a = await ok("POST", "/v1/milestones/m1/approve", { agreementId: id });
  const adv = await ok("GET", `/v1/payments/${id}-advance`);
  a = { ...a, status: "advance_paid", payments: [{ id: "adv", kind: "advance", amount: adv.amount, at: now(), upiRef: adv.upiRef }] };
  await ok("PUT", `/v1/agreements/${id}`, a);
  const m1 = await ok("GET", `/v1/payments/${id}-milestone-m1`);
  check(m1.amount === 6500, "milestone 1 done with photo, approved, ₹6,500 released over UPI");
  a = { ...a, payments: [...a.payments, { id: "m1", kind: "milestone", milestoneId: "m1", amount: 6500, at: now(), upiRef: m1.upiRef }],
    progress: { ...a.progress, m1: { ...a.progress.m1, status: "paid", paidAt: now(), upiRef: m1.upiRef } } };
  await ok("PUT", `/v1/agreements/${id}`, a);

  // Change order: sealed on its own, chained to the agreement
  const delta = await ok("POST", "/v1/amendments/extract", { transcript: [
    { speaker: "hirer", text: "Balcony bhi paint kar dena.", t: 0 },
    { speaker: "worker", text: "Theek hai, 2000 rupaye extra aur ek din aur lagega.", t: 4 },
  ], terms: a.terms });
  const change = {
    id: `${id}-A1`, createdAt: now(), source: "change", description: "Balcony, 2000 extra, one more day", transcript: [],
    delta: { ...delta, addMilestones: [{ id: "c1", title: "Balcony (change)", titleHi: "बालकनी (बदलाव)", amount: delta.priceChange }] },
    parentHash: a.hash,
    confirmations: { worker: { at: now(), channel: "in_app", reply: "Haan, pakka ✅", lang: "hinglish" }, hirer: { at: now(), channel: "whatsapp", reply: "Haan, pakka ✅", lang: "en" } },
  };
  change.hash = await hashAmendment(change);
  const stored = await ok("POST", "/v1/amendments", { agreementId: id, amendment: change });
  check(delta.priceChange === 2000 && stored.chain.ok && stored.chain.checked === 2, "change order +₹2,000 sealed and chained (browser hash = server hash)");
  const bad = await call("POST", "/v1/amendments", { agreementId: id, amendment: { ...change, delta: { ...change.delta, priceChange: 9000 } } });
  check(bad.status === 409, "edited change order refused");

  // Mediator on the server's copy
  const record = await ok("GET", `/v1/agreements/${id}`);
  const med = await ok("POST", "/v1/mediate", { agreement: record, reason: "Late payment" });
  check(med.payToWorker === 0 && /not a legal judgment/.test(med.disclaimer), "mediator: nothing due yet (m2 and the balcony not done), with disclaimer");
}

let failed = false;
for (let i = 1; i <= runs; i++) {
  try {
    const { id, ms } = await demoOnce(i);
    console.log(`  run ${i} ok (${id}, ${ms} ms)`);
  } catch (e) {
    failed = true;
    console.error(`  ${e.message}`);
    break;
  }
}
// Leave the app clean: the next page load re-seeds Ramesh's history.
await call("POST", "/v1/demo/reset", {}).catch(() => {});
console.log(failed ? "\nDemo check FAILED" : `\nDemo check passed ${runs}/${runs}`);
process.exit(failed ? 1 : 0);
