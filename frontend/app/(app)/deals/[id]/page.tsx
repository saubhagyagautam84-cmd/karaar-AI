"use client";

import { useState } from "react";
import { Handshake, ScrollText } from "lucide-react";
import { EmptyState, Spinner, StatusBadge, Stepper, cn } from "@/components/ui";
import { HashPanel } from "@/components/HashPanel";
import { PaymentPanel } from "@/components/PaymentPanel";
import { ChangeOrderPanel } from "@/components/ChangeOrderPanel";
import { DisputePanel } from "@/components/DisputePanel";
import { RatingPanel } from "@/components/RatingPanel";
import { SpeakButton } from "@/components/SpeakButton";
import { Transcript } from "@/components/Transcript";
import { useDeal } from "@/lib/useDeal";
import { buildSummary, fmtDate, fmtDateTime } from "@/lib/summary";
import { inr } from "@/lib/numbers";
import { effectiveTerms, sealedAmendments } from "@/lib/terms";
import type { Agreement } from "@/lib/types";

export default function DealPage() {
  const { ready, deal, save, flush } = useDeal();
  const [lang, setLang] = useState<"en" | "hi">("en");
  const [showTranscript, setShowTranscript] = useState(false);

  if (!ready) return <Spinner label="Loading agreement…" />;
  if (!deal) return <EmptyState title="Agreement not found" body="It may have been recorded on another device." href="/deals" cta="All agreements" />;
  const a: Agreement = deal;

  if (a.status === "review" || a.status === "awaiting_confirmation") {
    const href = `/deals/${a.id}/${a.status === "review" ? "review" : "confirm"}`;
    return (
      <EmptyState
        title={`${a.id} isn't sealed yet`}
        body={a.status === "review" ? "Some gaps still need an answer before both people confirm." : "Waiting for both people to confirm."}
        href={href}
        cta="Continue"
      />
    );
  }

  const eff = effectiveTerms(a);
  const changed = sealedAmendments(a).length > 0;

  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <Stepper current={4} />
      </div>

      <div className="mb-6 overflow-hidden rounded-3xl bg-navy p-6 text-cream sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-saffron">{a.id} · sealed {fmtDateTime(a.sealedAt)}</p>
            <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Pakka ho gaya. <Handshake className="inline text-saffron" size={34} />
            </h1>
            <p className="mt-1 text-navy-line">
              {a.worker.name} and {a.hirer.name} · {a.terms.jobType} · {inr(eff.price)}{changed ? " with changes" : ""}
            </p>
          </div>
          <StatusBadge status={a.status} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <section className="card" aria-label="Agreement">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-display text-lg font-bold">
                <ScrollText size={20} className="text-saffron-ink" /> The agreement
              </h2>
              <div className="flex rounded-lg bg-cream p-0.5 text-sm font-semibold" role="group" aria-label="Language">
                {(["en", "hi"] as const).map((l) => (
                  <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={cn("rounded-md px-3 py-1", lang === l ? "bg-paper shadow-card" : "text-navy-muted")}>
                    {l === "en" ? "English" : "हिन्दी"}
                  </button>
                ))}
              </div>
            </div>
            <pre className="whitespace-pre-wrap rounded-xl bg-cream/70 p-4 font-sans text-[15px] leading-relaxed text-navy">
              {buildSummary(a, lang).replace(/\*/g, "").split("\n").slice(0, -3).join("\n")}
            </pre>
            <div className="mt-2">
              <SpeakButton text={buildSummary(a, lang).split("\n").slice(0, -3).join("\n")} lang={lang} />
            </div>
            {changed && (
              <p className="mt-3 rounded-xl border border-saffron/30 bg-saffron-soft/50 p-3 text-sm">
                <b>With {sealedAmendments(a).length} confirmed change{sealedAmendments(a).length > 1 ? "s" : ""}:</b> price {inr(eff.price)} · finish by {fmtDate(eff.deadline, lang)}
                {eff.scope.length ? ` · ${eff.scope.map((x) => (lang === "hi" ? x.hi : x.en)).join(", ")}` : ""}
              </p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              {(["worker", "hirer"] as const).map((r) => (
                <p key={r} className="rounded-lg border border-leaf/30 bg-leaf-soft px-3 py-2">
                  <b>{a[r].name}</b> confirmed
                  <span className="block text-xs text-navy-muted">
                    {a.confirmations[r]?.channel === "whatsapp" ? "WhatsApp" : a.confirmations[r]?.channel === "ivr" ? "Phone call (IVR)" : "In person"} · {fmtDateTime(a.confirmations[r]?.at)}
                  </span>
                </p>
              ))}
            </div>
            {a.transcript.length > 0 && (
              <>
                <button className="mt-4 text-sm font-semibold text-saffron-ink underline-offset-4 hover:underline" onClick={() => setShowTranscript((v) => !v)} aria-expanded={showTranscript}>
                  {showTranscript ? "Hide" : "Show"} original conversation
                </button>
                {showTranscript && (
                  <div className="mt-4">
                    <Transcript segments={a.transcript} worker={a.worker} hirer={a.hirer} />
                  </div>
                )}
              </>
            )}
          </section>

          <PaymentPanel a={a} onChange={save} flush={flush} />

          <RatingPanel a={a} onChange={save} />

          <ChangeOrderPanel a={a} onChange={save} flush={flush} />

          <DisputePanel a={a} onChange={save} flush={flush} />
        </div>

        <div className="space-y-6">
          <HashPanel a={a} />
          <section className="card" aria-label="Timeline">
            <h2 className="mb-4 font-display text-lg font-bold">Timeline</h2>
            <ol className="relative space-y-4 border-l-2 border-line pl-5">
              {a.events.map((e, i) => (
                <li key={i} className="relative">
                  <span className={cn("absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-paper", i === a.events.length - 1 ? "bg-saffron" : "bg-navy")} />
                  <p className="font-semibold leading-tight">{e.label}</p>
                  <p className="text-xs text-navy-muted">
                    {fmtDateTime(e.at)}
                    {e.detail ? ` · ${e.detail}` : ""}
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-navy-muted">Finish by {fmtDate(eff.deadline)}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
