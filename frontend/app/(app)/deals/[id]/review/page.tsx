"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarDays, CheckCircle2, CircleCheck, IndianRupee, Package, TriangleAlert, Undo2 } from "lucide-react";
import { EmptyState, PageHeader, SeverityBadge, Spinner, Stepper, cn } from "@/components/ui";
import { Transcript } from "@/components/Transcript";
import { MilestoneEditor } from "@/components/MilestoneEditor";
import { useDeal } from "@/lib/useDeal";
import { applyResolution, balanceDue } from "@/lib/extract";
import { inr } from "@/lib/numbers";
import { fmtDate } from "@/lib/summary";
import { nowIso } from "@/lib/store";
import { milestoneProblem } from "@/lib/terms";
import type { Agreement, Flag, Terms } from "@/lib/types";

export default function Review() {
  const router = useRouter();
  const { ready, deal, save } = useDeal();
  const [tab, setTab] = useState<"terms" | "transcript">("terms");

  if (!ready) return <Spinner label="Loading agreement…" />;
  if (!deal) return <EmptyState title="Agreement not found" body="It may have been recorded on another device." href="/new" cta="Start a new deal" />;
  const a: Agreement = deal;

  const open = a.flags.filter((f) => !f.resolved);
  const blocking = open.filter((f) => f.severity !== "low");
  const setTerms = (terms: Terms) => save({ ...a, terms });
  const msProblem = milestoneProblem(a.terms);

  function resolve(flag: Flag, value: string, label: string) {
    const terms = applyResolution(a.terms, flag, value);
    save({
      ...a,
      terms,
      flags: a.flags.map((f) => (f.id === flag.id ? { ...f, resolved: true, resolution: label } : f)),
      events: [...a.events, { at: nowIso(), label: `Gap resolved: ${flag.title}`, detail: label }],
    });
  }
  function reopen(flag: Flag) {
    save({ ...a, flags: a.flags.map((f) => (f.id === flag.id ? { ...f, resolved: false, resolution: undefined } : f)) });
  }
  function proceed() {
    const terms = { ...a.terms, paymentMode: a.terms.paymentMode ?? "UPI" };
    save({ ...a, terms, status: "awaiting_confirmation", events: [...a.events, { at: nowIso(), label: "Sent for two-party confirmation" }] });
    router.push(`/deals/${a.id}/confirm`);
  }

  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <Stepper current={1} />
      </div>
      <PageHeader
        eyebrow={`${a.id} · Review`}
        title={open.length ? `${open.length} thing${open.length > 1 ? "s" : ""} weren't said clearly` : "Everything is clear"}
        sub="Fix these now, while both people are together. Most disputes start with exactly these gaps."
      />

      <div className="mb-4 flex gap-1 rounded-xl bg-cream p-1 lg:hidden" role="tablist">
        {(["terms", "transcript"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("flex-1 rounded-lg py-2 text-sm font-semibold capitalize", tab === t ? "bg-paper shadow-card" : "text-navy-muted")}>
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <section className={cn("card h-fit lg:sticky lg:top-24", tab !== "transcript" && "hidden lg:block")} aria-label="Transcript">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Conversation</h2>
            <span className="text-xs font-semibold text-navy-muted">{a.transcript.length} turns · {a.audioSeconds}s</span>
          </div>
          <Transcript segments={a.transcript} worker={a.worker} hirer={a.hirer} flags={a.flags} />
          <p className="mt-4 text-xs text-navy-muted">
            <mark className="rounded bg-saffron-soft px-1">Highlighted</mark> amounts were normalised from speech. Wavy lines mark sentences behind an open flag.
          </p>
        </section>

        <div className={cn("space-y-4", tab !== "terms" && "hidden lg:block")}>
          {/* Flags */}
          <section aria-label="Gaps found" className="space-y-3">
            {a.flags.map((f) => (
              <FlagCard key={f.id} flag={f} onResolve={resolve} onReopen={reopen} />
            ))}
          </section>

          {/* Terms */}
          <section className="card" aria-label="Extracted terms">
            <h2 className="mb-4 font-display text-lg font-bold">Agreement terms</h2>
            <dl className="grid grid-cols-2 gap-3">
              <Field label="Job" value={`${a.terms.jobType}${a.terms.location ? ` · ${a.terms.location}` : ""}`} wide />
              <MoneyField label="Total price" value={a.terms.price} onChange={(v) => setTerms({ ...a.terms, price: v })} />
              <MoneyField label="Advance" value={a.terms.advance} onChange={(v) => setTerms({ ...a.terms, advance: v })} />
              <Field label="Balance due" value={inr(balanceDue(a.terms))} hint={a.terms.balanceWhen ?? undefined} />
              <Field label="Finish by" value={a.terms.deadline ? fmtDate(a.terms.deadline) : "—"} hint={a.terms.durationDays ? `${a.terms.durationDays} days` : undefined} icon={<CalendarDays size={15} />} />
              <Field
                label="Material"
                icon={<Package size={15} />}
                value={a.terms.materialsBy === "worker" ? "Worker, in total" : a.terms.materialsBy === "hirer" ? "Hirer, separately" : "Not agreed"}
                warn={!a.terms.materialsBy}
              />
              <Field label="Payment" value={a.terms.paymentMode ?? "UPI (default)"} />
            </dl>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <ScopeList title="Included" items={a.terms.scope.map((s) => s.en)} tone="ok" />
              <ScopeList title="Not included" items={a.terms.excluded.map((s) => s.en)} tone="no" />
            </div>
          </section>

          <MilestoneEditor terms={a.terms} onChange={setTerms} />

          <div className="sticky bottom-20 z-20 rounded-2xl border border-line bg-paper/95 p-4 shadow-lift backdrop-blur md:bottom-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold">
                {msProblem && !blocking.length ? (
                  <span className="flex items-center gap-1.5 text-amber-ink">
                    <TriangleAlert size={16} /> Fix the milestones to continue
                  </span>
                ) : blocking.length ? (
                  <span className="flex items-center gap-1.5 text-amber-ink">
                    <TriangleAlert size={16} /> Resolve {blocking.length} more to continue
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-leaf">
                    <CircleCheck size={16} /> Ready for both to confirm
                  </span>
                )}
              </p>
              <button className="btn-accent" disabled={blocking.length > 0 || !a.terms.price || msProblem !== null} onClick={proceed}>
                Send for confirmation <ArrowRight size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FlagCard({ flag, onResolve, onReopen }: { flag: Flag; onResolve: (f: Flag, v: string, label: string) => void; onReopen: (f: Flag) => void }) {
  const [date, setDate] = useState("");
  if (flag.resolved) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-leaf/30 bg-leaf-soft px-4 py-3">
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 size={18} className="shrink-0 text-leaf" />
          <span>
            <b className="text-navy">{flag.title}</b>
            <span className="text-navy-body"> — {flag.resolution}</span>
          </span>
        </p>
        <button onClick={() => onReopen(flag)} className="shrink-0 rounded-lg p-1.5 text-navy-muted hover:bg-paper" aria-label={`Change answer for ${flag.title}`}>
          <Undo2 size={16} />
        </button>
      </div>
    );
  }
  return (
    <div className={cn("animate-rise rounded-2xl border-l-4 bg-paper p-4 shadow-card", flag.severity === "high" ? "border-alert" : flag.severity === "medium" ? "border-amber-ink" : "border-navy-line")}>
      <div className="flex flex-wrap items-center gap-2">
        <TriangleAlert size={18} className={flag.severity === "high" ? "text-alert" : "text-amber-ink"} />
        <h3 className="font-display font-bold">{flag.title}</h3>
        <SeverityBadge severity={flag.severity} />
      </div>
      <p className="mt-0.5 text-sm text-navy-muted">{flag.titleHi}</p>
      <p className="mt-2 text-navy-body">{flag.detail}</p>
      {flag.evidence && <p className="mt-2 border-l-2 border-line pl-3 text-sm italic text-navy-muted">“{flag.evidence}”</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {flag.options?.map((o) => (
          <button key={o.id} onClick={() => onResolve(flag, o.id, o.label)} className="chip border-navy/20 bg-cream text-navy hover:border-navy hover:bg-paper">
            {o.label}
          </button>
        ))}
        {flag.input === "date" && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`d-${flag.id}`}>Finish date</label>
            <input id={`d-${flag.id}`} type="date" className="input w-auto py-2" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
            <button className="btn-primary py-2 text-sm" disabled={!date} onClick={() => onResolve(flag, date, `Finish by ${fmtDate(date)}`)}>
              Set date
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, hint, icon, wide, warn }: { label: string; value: string; hint?: string; icon?: React.ReactNode; wide?: boolean; warn?: boolean }) {
  return (
    <div className={cn("rounded-xl bg-cream/70 p-3", wide && "col-span-2")}>
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-navy-muted">
        {icon}
        {label}
      </dt>
      <dd className={cn("mt-0.5 font-display text-lg font-bold", warn ? "text-amber-ink" : "text-navy")}>{value}</dd>
      {hint && <dd className="text-xs text-navy-muted">{hint}</dd>}
    </div>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const id = label.replace(/\s/g, "-").toLowerCase();
  return (
    <div className="rounded-xl bg-cream/70 p-3">
      <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-navy-muted">
        <IndianRupee size={14} />
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        className="mt-0.5 w-full bg-transparent font-display text-lg font-bold text-navy focus:outline-none focus:ring-2 focus:ring-saffron/40"
        value={value === null ? "" : value.toLocaleString("en-IN")}
        placeholder="Not said"
        onChange={(e) => {
          const n = e.target.value.replace(/\D/g, "");
          onChange(n ? parseInt(n, 10) : null);
        }}
      />
    </div>
  );
}

function ScopeList({ title, items, tone }: { title: string; items: string[]; tone: "ok" | "no" }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-navy-muted">{title}</p>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((s) => (
            <li key={s} className="flex items-center gap-2 text-sm">
              <span className={cn("h-1.5 w-1.5 rounded-full", tone === "ok" ? "bg-leaf" : "bg-alert")} />
              {s}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-navy-muted">—</p>
      )}
    </div>
  );
}
