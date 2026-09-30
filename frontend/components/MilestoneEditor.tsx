"use client";

import { Flag as FlagIcon, Plus, Sparkles, Trash2 } from "lucide-react";
import type { Milestone, Terms } from "@/lib/types";
import { MAX_MILESTONES, milestoneProblem, milestoneSum, milestoneTarget, suggestMilestones } from "@/lib/terms";
import { inr } from "@/lib/numbers";
import { cn } from "./ui";

/** A1: split the balance into 1–5 milestones. The review page blocks sealing until they add up. */
export function MilestoneEditor({ terms, onChange }: { terms: Terms; onChange: (t: Terms) => void }) {
  const ms = terms.milestones ?? [];
  const enabled = ms.length > 0;
  const target = milestoneTarget(terms);
  const problem = milestoneProblem(terms);
  const set = (next: Milestone[] | undefined) => onChange({ ...terms, milestones: next && next.length ? next : undefined });
  const update = (id: string, patch: Partial<Milestone>) => set(ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  return (
    <section className="card space-y-4" aria-label="Payment milestones">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <FlagIcon size={19} className="text-saffron-ink" /> Pay in milestones <span className="font-sans text-sm font-normal text-navy-muted">· किस्तों में भुगतान</span>
          </h2>
          <p className="text-sm text-navy-body">
            Optional. Split the balance of {inr(target)} into up to {MAX_MILESTONES} parts; each is paid when the hirer approves that part.
          </p>
        </div>
        {!enabled ? (
          <button type="button" className="btn-ghost py-2 text-sm" onClick={() => set(suggestMilestones(terms))} disabled={target <= 0}>
            <Sparkles size={16} /> Suggest from scope
          </button>
        ) : (
          <button type="button" className="text-sm font-semibold text-navy-muted underline-offset-2 hover:underline" onClick={() => set(undefined)}>
            Pay the balance in one go instead
          </button>
        )}
      </div>

      {enabled && (
        <>
          <ol className="space-y-2">
            {ms.map((m, i) => (
              <li key={m.id} className="grid grid-cols-[1.5rem_1fr_7.5rem_auto] items-center gap-2">
                <span className="text-sm font-bold text-navy-muted">{i + 1}</span>
                <label className="sr-only" htmlFor={`ms-t-${m.id}`}>Milestone {i + 1} name</label>
                <input id={`ms-t-${m.id}`} className="input py-2" value={m.title} onChange={(e) => update(m.id, { title: e.target.value, titleHi: undefined })} placeholder="e.g. Walls done" />
                <label className="sr-only" htmlFor={`ms-a-${m.id}`}>Milestone {i + 1} amount in rupees</label>
                <input
                  id={`ms-a-${m.id}`}
                  className="input py-2 text-right tabular-nums"
                  inputMode="numeric"
                  value={m.amount ? m.amount.toLocaleString("en-IN") : ""}
                  placeholder="₹"
                  onChange={(e) => update(m.id, { amount: parseInt(e.target.value.replace(/\D/g, "") || "0", 10) })}
                />
                <button type="button" className="rounded-lg p-2 text-navy-muted hover:bg-cream hover:text-alert" aria-label={`Remove milestone ${i + 1}`} onClick={() => set(ms.filter((x) => x.id !== m.id))}>
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              className="btn-ghost py-2 text-sm"
              disabled={ms.length >= MAX_MILESTONES}
              onClick={() => set([...ms, { id: `m${Date.now().toString(36)}`, title: "", amount: Math.max(target - milestoneSum(ms), 0) }])}
            >
              <Plus size={16} /> Add milestone
            </button>
            <p className={cn("text-sm font-semibold tabular-nums", problem ? "text-alert" : "text-leaf")} role="status">
              {inr(milestoneSum(ms))} of {inr(target)} {problem ? "" : "✓"}
            </p>
          </div>
          {problem && <p className="rounded-lg bg-alert-soft p-2.5 text-sm font-semibold text-alert">{problem}</p>}
        </>
      )}
    </section>
  );
}
