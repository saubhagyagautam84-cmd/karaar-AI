"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BadgeCheck, Eye, Lock } from "lucide-react";
import { Logo, Spinner } from "@/components/ui";
import { sharedView, type SharedHistory } from "@/lib/account";
import { inr } from "@/lib/numbers";
import { fmtDate } from "@/lib/summary";

/** B6: what a lender or employer sees through a worker's share link. Every view is logged for the worker. */
export default function SharedPage() {
  const { id } = useParams<{ id: string }>();
  const [h, setH] = useState<SharedHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sharedView(decodeURIComponent(id))
      .then(setH)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "This link cannot be opened."));
  }, [id]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-4 py-10">
      <Link href="/" aria-label="Karaar AI home">
        <Logo size={32} />
      </Link>
      {!h && !error && <Spinner label="Opening the shared history…" />}
      {error && (
        <section className="card flex gap-3">
          <Lock className="shrink-0 text-alert" size={28} />
          <p className="font-semibold text-alert">{error}</p>
        </section>
      )}
      {h && (
        <>
          <div>
            <p className="eyebrow">Shared with {h.recipient}</p>
            <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
              {h.worker ?? "Worker"} <BadgeCheck className="text-leaf" size={22} aria-label="Verified" />
            </h1>
            <p className="text-sm text-navy-body">Verified work history, built only from agreements both people sealed and payments made over UPI.</p>
          </div>
          <section className="grid grid-cols-2 gap-3">
            <Stat k="Verified jobs" v={String(h.verifiedJobs)} />
            {h.earnedViaUpi !== undefined && <Stat k="Paid via UPI" v={inr(h.earnedViaUpi)} />}
            {h.ratings !== undefined && (
              <Stat k="Ratings by hirers" v={h.ratings ? `${((h.ratings.onTime + h.ratings.fair + h.ratings.respectful) / 3).toFixed(1)} / 5` : "None yet"} />
            )}
          </section>
          {h.ratings && (
            <p className="text-sm text-navy-body">
              On time {h.ratings.onTime} · Fair with money {h.ratings.fair} · Respectful {h.ratings.respectful}
            </p>
          )}
          {h.jobs && (
            <section className="card">
              <h2 className="mb-2 font-display font-bold">Jobs</h2>
              <ul className="divide-y divide-line/70 text-sm">
                {h.jobs.map((j) => (
                  <li key={j.id} className="flex justify-between py-2">
                    <span>
                      {j.jobType} · {j.month}
                    </span>
                    <span className="capitalize text-navy-muted">{j.status.replace("_", " ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="flex items-start gap-1.5 text-xs text-navy-muted">
            <Eye size={14} className="mt-0.5 shrink-0" /> The worker chose what to share and can see every time this page is opened. Access ends {fmtDate(h.expiresAt)} or
            when the worker withdraws it.
          </p>
        </>
      )}
    </main>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-muted">{k}</p>
      <p className="mt-1 font-display text-xl font-bold">{v}</p>
    </div>
  );
}
