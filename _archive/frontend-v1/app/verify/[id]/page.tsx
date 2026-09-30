"use client";

import { use, useEffect, useMemo, useState } from "react";
import { api, errorText } from "@/lib/api";
import { rupees, niceDate } from "@/lib/format";
import { fingerprint } from "@/lib/hash";
import type { Verification } from "@/lib/types";

function short(hash: string) {
  const hex = hash.replace("sha256:", "");
  return `${hex.slice(0, 10)}…${hex.slice(-10)}`;
}

export default function VerifyPage({ params }: PageProps<"/verify/[id]">) {
  const { id } = use(params);
  const [data, setData] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tamper, setTamper] = useState(false);
  const [fakePrice, setFakePrice] = useState(6000);

  useEffect(() => {
    api
      .verify(id)
      .then((v) => {
        setData(v);
        const price = v.payload?.terms.price_inr;
        if (price) setFakePrice(price === 6000 ? 5000 : 6000);
      })
      .catch((e) => setError(errorText(e)));
  }, [id]);

  // Re-hash in the browser, from the terms as shown (tampered or not).
  const live = useMemo(() => {
    if (!data?.payload) return null;
    const payload = tamper
      ? {
          ...data.payload,
          terms: { ...data.payload.terms, price_inr: fakePrice },
        }
      : data.payload;
    return { payload, hash: fingerprint(payload) };
  }, [data, tamper, fakePrice]);

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-xl bg-danger-soft px-4 py-3 font-medium text-danger"
      >
        {error}
      </p>
    );
  }
  if (!data) return <p className="text-muted">Loading…</p>;

  if (data.erased_at) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h1 className="text-2xl font-bold">Personal data erased</h1>
        <p className="mt-2 text-muted">
          On {new Date(data.erased_at).toLocaleDateString("en-IN")} a party to
          agreement {id} asked for their personal data and the recording to be
          deleted. Only anonymised numbers remain, so this record can no longer
          be re-checked against its fingerprint.
        </p>
      </section>
    );
  }

  if (!data.hashed || !live || !data.stored_hash) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h1 className="text-2xl font-bold">Not confirmed yet</h1>
        <p className="mt-2 text-muted">
          Agreement {id} gets its fingerprint when both people say &ldquo;Haan,
          pakka&rdquo;. Status: {data.status}.
        </p>
      </section>
    );
  }

  const ok = live.hash === data.stored_hash;
  const terms = live.payload.terms;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Verify a record</h1>
        <p className="font-mono text-xs text-muted">{id}</p>
      </div>

      <section
        className={`rounded-2xl border-2 p-5 transition-colors ${
          ok
            ? "border-leaf bg-leaf-soft text-leaf"
            : "border-danger bg-danger-soft text-danger"
        }`}
        aria-live="polite"
      >
        <p className="text-2xl font-bold">
          {ok ? "✓ Record is intact" : "✗ Record has been changed"}
        </p>
        <p className="mt-1 text-sm">
          {ok
            ? "The terms below are exactly what both people confirmed."
            : "These terms do not match what both people confirmed. Do not trust them."}
        </p>
        <dl className="mt-3 grid gap-1 font-mono text-xs">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-sans font-semibold">Stored:</dt>
            <dd className="break-all">{short(data.stored_hash)}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-sans font-semibold">Re-computed now:</dt>
            <dd className="break-all">{short(live.hash)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Work</dt>
          <dd className="font-medium">{terms.scope ?? "—"}</dd>
          <dt className="text-muted">Price</dt>
          <dd className={`font-semibold ${tamper ? "text-danger" : ""}`}>
            {rupees(terms.price_inr) ?? "—"}
          </dd>
          <dt className="text-muted">Advance</dt>
          <dd className="font-medium">{rupees(terms.advance_inr) ?? "—"}</dd>
          <dt className="text-muted">Dates</dt>
          <dd className="font-medium">
            {niceDate(terms.start_date) ?? "?"} →{" "}
            {niceDate(terms.deadline) ?? "?"}
          </dd>
          <dt className="text-muted">Confirmed</dt>
          <dd className="font-medium">
            {Object.entries(live.payload.confirmations)
              .map(
                ([role, at]) =>
                  `${role} ${new Date(at).toLocaleString("en-IN")}`,
              )
              .join(" · ")}
          </dd>
        </dl>
      </section>

      <section className="rounded-2xl border border-dashed border-line bg-surface p-4">
        <label className="flex items-center justify-between gap-3 font-semibold">
          <span>Tamper test</span>
          <input
            type="checkbox"
            checked={tamper}
            onChange={(e) => setTamper(e.target.checked)}
            className="size-6 accent-[var(--danger)]"
          />
        </label>
        <p className="mt-1 text-sm text-muted">
          Changes the price in this browser only, then re-computes the
          fingerprint.
        </p>
        {tamper && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            Fake price ₹
            <input
              type="number"
              value={fakePrice}
              onChange={(e) => setFakePrice(Number(e.target.value))}
              className="h-11 w-32 rounded-lg border border-line bg-background px-3 text-base"
            />
          </label>
        )}
      </section>

      <p className="text-center text-xs text-muted">
        A confirmed record of your agreement: terms, both confirmation times and
        the recording&apos;s fingerprint, sealed with SHA-256.
      </p>
    </div>
  );
}
