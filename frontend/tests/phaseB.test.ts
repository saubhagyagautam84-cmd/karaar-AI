import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { historyOf, phoneHashOf, shortName, tenDigits } from "../lib/account";
import type { Agreement } from "../lib/types";

const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/hash_parity.json", import.meta.url), "utf8")) as { agreement: Agreement };

test("phone numbers: 10-digit Indian mobiles only, +91 accepted", () => {
  assert.equal(tenDigits("+91 98100 12345"), "9810012345");
  assert.equal(tenDigits("98100 12345"), "9810012345");
  assert.equal(tenDigits("12345"), null);
  assert.equal(tenDigits("5810012345"), null);
});

test("phone hash matches the backend's karaar: prefix scheme", async () => {
  // Same value the backend's phone_hash("98100 12345") produces (see backend/tests/test_phase_b.py).
  assert.equal(await phoneHashOf("98100 12345"), await phoneHashOf("9810012345"));
  assert.match(await phoneHashOf("9810012345"), /^[0-9a-f]{64}$/);
});

test("shared history includes only what the worker chose", async () => {
  const subject = await phoneHashOf("98100 12345");
  const a: Agreement = {
    ...fixture.agreement,
    amendments: undefined,
    status: "completed",
    worker: { ...fixture.agreement.worker, phoneHash: subject },
    payments: [{ id: "p", kind: "balance", amount: 18000, at: "2026-10-01T00:00:00.000Z", upiRef: "U" }],
    ratings: { byHirer: { onTime: 5, fair: 4, respectful: 5, at: "2026-10-02T00:00:00.000Z" } },
  };
  const other: Agreement = { ...a, id: "KR-7002", worker: { ...a.worker, phoneHash: "f".repeat(64) } };
  const earningsOnly = await historyOf([a, other], subject, ["earnings"]);
  assert.equal(earningsOnly.earnedViaUpi, 18000);
  assert.equal(earningsOnly.jobs, undefined);
  assert.equal(earningsOnly.ratings, undefined);
  assert.equal(earningsOnly.worker, "Ramesh K.");
  const all = await historyOf([a, other], subject, ["jobs", "ratings"]);
  assert.equal(all.jobs?.length, 1);
  assert.deepEqual(all.ratings, { onTime: 5, fair: 4, respectful: 5 });
  assert.equal(shortName("अनीता शर्मा"), "अनीता श.");
});
