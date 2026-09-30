"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Link2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Logo, Spinner } from "@/components/ui";
import { verifyPublic, type PublicVerification } from "@/lib/account";
import { fmtDateTime } from "@/lib/summary";

/** B5: public check of a sealed record, from the QR code. Outline only: no price, no phone numbers. */
export default function VerifyPage() {
  const { hash } = useParams<{ hash: string }>();
  const [v, setV] = useState<PublicVerification | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    verifyPublic(decodeURIComponent(hash).toLowerCase())
      .then(setV)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not check this seal."));
  }, [hash]);

  const ok = v?.found && v.valid && v.chainOk;
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 px-4 py-10">
      <Link href="/" aria-label="Karaar AI home">
        <Logo size={32} />
      </Link>
      <h1 className="font-display text-2xl font-bold">Seal verification · सत्यापन</h1>
      {!v && !error && <Spinner label="Checking the seal…" />}
      {error && <p className="rounded-xl bg-alert-soft p-4 font-semibold text-alert">{error}</p>}
      {v && !v.found && (
        <section className="card flex gap-3">
          <ShieldQuestion className="shrink-0 text-amber-ink" size={32} />
          <div>
            <p className="font-display text-lg font-bold">No record with this seal</p>
            <p className="text-navy-body">This seal is not known here. It may be mistyped, or the record was never sealed with Karaar.</p>
          </div>
        </section>
      )}
      {v?.found && (
        <section className={ok ? "card border-leaf/40" : "card border-alert/40"} aria-live="polite">
          <div className="flex items-start gap-3">
            {ok ? <ShieldCheck className="shrink-0 text-leaf" size={36} /> : <ShieldAlert className="shrink-0 text-alert" size={36} />}
            <div>
              <p className={ok ? "font-display text-xl font-bold text-leaf" : "font-display text-xl font-bold text-alert"}>
                {ok ? "Genuine and unchanged" : "This record does not match its seal"}
              </p>
              <p className="text-navy-body">
                {v.kind === "agreement" ? "Agreement" : v.kind === "settlement" ? "Settlement" : "Change order"} {v.id}, sealed by both people
                {v.sealedAt ? ` on ${fmtDateTime(v.sealedAt)}` : ""}.
              </p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Row k="Worker" v={v.worker} />
            <Row k="Hirer" v={v.hirer} />
            <Row k="Work" v={v.jobType} />
            <Row k="Area" v={v.area ?? "—"} />
            <Row k="Status" v={v.status?.replace("_", " ")} />
            <Row k="Confirmed changes" v={String(v.changes ?? 0)} />
          </dl>
          {(v.changes ?? 0) > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-navy-body">
              <Link2 size={15} /> {v.chainOk ? "Every later change links back to this record without a break." : "The chain of later changes is broken."}
            </p>
          )}
          <p className="mt-4 break-all rounded-lg bg-cream p-2 font-mono text-[11px] text-navy-muted">SHA-256 {decodeURIComponent(hash)}</p>
        </section>
      )}
      <p className="text-xs text-navy-muted">
        Karaar records are strong evidence for mediation. Prices, phone numbers and the conversation are not shown here; the people in the agreement can share
        the full record. Whether electronic records are accepted in a particular case should be confirmed with a lawyer.
      </p>
    </main>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-muted">{k}</dt>
      <dd className="font-semibold capitalize">{v || "—"}</dd>
    </div>
  );
}
