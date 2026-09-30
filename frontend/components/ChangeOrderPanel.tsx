"use client";

import { useState } from "react";
import { CheckCircle2, FilePlus2, Link2, MessageCircle, Sparkles, UserCheck } from "lucide-react";
import { extractChange, sendSummary } from "@/lib/api";
import { toHinglish } from "@/lib/devanagari";
import { chainHead, describeDelta, nextAmendmentId, withMilestoneForChange } from "@/lib/amend";
import { confirmAmendment } from "@/lib/confirm";
import { summaryLang } from "@/lib/languages";
import { buildAmendmentSummary, fmtDateTime } from "@/lib/summary";
import { shortHash } from "@/lib/hash";
import { effectiveTerms } from "@/lib/terms";
import type { Agreement, Amendment, Role, Segment, TermsDelta } from "@/lib/types";
import { Dictate } from "./Dictate";
import { SpeakButton } from "./SpeakButton";
import { cn } from "./ui";

const SAMPLE = "Hirer: Balcony bhi paint kar dena.\nWorker: Theek hai, 2000 rupaye extra lagenge aur ek din aur lagega.";

/** "Hirer: …" / "Worker: …" lines become speaker turns; unlabeled lines belong to whoever proposed the change. */
function toSegments(text: string, proposer: Role): Segment[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const m = line.match(/^(hirer|client|malik|worker|karigar|kaarigar)\s*:\s*(.*)$/i);
      const speaker: Role = m ? (/^(worker|karigar|kaarigar)$/i.test(m[1]) ? "worker" : "hirer") : proposer;
      return { speaker, text: m ? m[2] : line, t: i * 4 };
    });
}

/** A3: change orders. The sealed agreement never changes; each change is sealed on its own and chained. */
export function ChangeOrderPanel({ a, onChange, flush }: { a: Agreement; onChange: (a: Agreement) => void; flush?: () => Promise<void> }) {
  const open = (a.amendments ?? []).find((am) => !am.hash && am.source === "change");
  const sealed = (a.amendments ?? []).filter((am) => am.hash);
  const [text, setText] = useState("");
  const [proposer, setProposer] = useState<Role>("hirer");
  const [delta, setDelta] = useState<TermsDelta | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canChange = a.status !== "completed" && a.status !== "disputed";

  async function detect() {
    setBusy("detect");
    setError(null);
    try {
      const d = await extractChange(toSegments(toHinglish(text), proposer), effectiveTerms(a));
      setDelta(withMilestoneForChange(d, effectiveTerms(a), (a.amendments?.length ?? 0) + 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the change.");
    } finally {
      setBusy(null);
    }
  }

  function propose() {
    if (!delta) return;
    const at = new Date().toISOString();
    const am: Amendment = {
      id: nextAmendmentId(a),
      createdAt: at,
      source: "change",
      description: text.trim().replace(/\s*\n\s*/g, " "),
      transcript: toSegments(text, proposer),
      delta,
      parentHash: chainHead(a),
      confirmations: {},
    };
    onChange({ ...a, amendments: [...(a.amendments ?? []), am], events: [...a.events, { at, label: "Change proposed", detail: `${am.id} · ${describeDelta(delta)}` }] });
    setText("");
    setDelta(null);
  }

  async function confirm(am: Amendment, role: Role, channel: "in_app" | "whatsapp") {
    setBusy(`${role}-${channel}`);
    setError(null);
    try {
      await flush?.();
      if (channel === "whatsapp") await sendSummary(a, role, buildAmendmentSummary(a, am, summaryLang(a[role].lang)));
      const { next } = await confirmAmendment(a, am.id, role, channel);
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the confirmation.");
    } finally {
      setBusy(null);
    }
  }

  function discard(am: Amendment) {
    onChange({ ...a, amendments: (a.amendments ?? []).filter((x) => x.id !== am.id), events: [...a.events, { at: new Date().toISOString(), label: "Change withdrawn", detail: am.id }] });
  }

  return (
    <section className="card space-y-4" aria-label="Changes to the work">
      <div>
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <FilePlus2 size={20} className="text-saffron-ink" /> Changes to the work <span className="font-sans text-sm font-normal text-navy-muted">· काम में बदलाव</span>
        </h2>
        <p className="text-sm text-navy-body">The sealed agreement never changes. Extra work becomes a change order that both confirm again, sealed on its own and linked to the record.</p>
      </div>

      {sealed.length > 0 && (
        <ol className="space-y-2">
          {sealed.map((am) => (
            <li key={am.id} className="rounded-xl border border-leaf/30 bg-leaf-soft/60 px-3 py-2.5 text-sm">
              <p className="flex flex-wrap items-center gap-x-2 font-semibold">
                <CheckCircle2 size={15} className="text-leaf" /> {am.id} · {am.source === "settlement" ? "Settlement" : describeDelta(am.delta)}
              </p>
              <p className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-navy-muted">
                <Link2 size={11} /> {shortHash(am.parentHash)} → {shortHash(am.hash)} · sealed {fmtDateTime(am.sealedAt)}
              </p>
            </li>
          ))}
        </ol>
      )}

      {open && (
        <div className="space-y-3 rounded-2xl border border-saffron/40 bg-saffron-soft/40 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-saffron-ink">{open.source === "settlement" ? "Settlement" : "Change order"} {open.id} · waiting for both</p>
          <p className="font-display text-lg font-bold">{describeDelta(open.delta)}</p>
          <p className="text-sm text-navy-muted">{describeDelta(open.delta, "hi")}</p>
          {open.description && <p className="text-sm text-navy-body">“{open.description}”</p>}
          <div className="flex flex-wrap gap-2">
            <SpeakButton text={buildAmendmentSummary(a, open, "hi")} lang="hi" />
            <SpeakButton text={buildAmendmentSummary(a, open, "en")} lang="en" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["worker", "hirer"] as const).map((r) => {
              const c = open.confirmations[r];
              return (
                <div key={r} className={cn("rounded-xl border p-3", c ? "border-leaf/40 bg-leaf-soft" : "border-line bg-paper")}>
                  <p className="font-semibold">
                    {a[r].name} <span className="text-xs font-normal text-navy-muted">({r === "worker" ? "worker" : "hirer"})</span>
                  </p>
                  {c ? (
                    <p className="mt-1 flex items-center gap-1 text-sm text-leaf">
                      <CheckCircle2 size={15} /> {c.reply} · {fmtDateTime(c.at)}
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className="btn-success py-1.5 text-sm" disabled={busy !== null} onClick={() => confirm(open, r, "in_app")}>
                        <UserCheck size={15} /> Haan, pakka
                      </button>
                      <button className="btn-ghost py-1.5 text-sm" disabled={busy !== null} onClick={() => confirm(open, r, "whatsapp")}>
                        <MessageCircle size={15} /> {busy === `${r}-whatsapp` ? "Sending…" : "Via WhatsApp"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {!open.confirmations.worker && !open.confirmations.hirer && open.source === "change" && (
            <button className="text-sm font-semibold text-navy-muted underline-offset-2 hover:underline" onClick={() => discard(open)}>
              Withdraw this change
            </button>
          )}
        </div>
      )}

      {!open && canChange && (
        <div className="space-y-3">
          <fieldset className="flex flex-wrap items-center gap-3 text-sm">
            <legend className="sr-only">Who is asking for the change?</legend>
            <span className="font-semibold">Asked by</span>
            {(["hirer", "worker"] as const).map((r) => (
              <label key={r} className="flex items-center gap-1.5">
                <input type="radio" name="proposer" className="accent-[#E8762B]" checked={proposer === r} onChange={() => setProposer(r)} />
                {a[r].name}
              </label>
            ))}
          </fieldset>
          <label className="label" htmlFor="change-text">
            What changed? Type or speak it · क्या बदला?
          </label>
          <textarea
            id="change-text"
            className="input min-h-24"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDelta(null);
            }}
            placeholder="e.g. Balcony bhi kar do, 2000 extra, ek din aur"
          />
          <div className="flex flex-wrap gap-2">
            <Dictate lang="hi" onText={(s) => setText((v) => (v ? `${v}\n${s}` : s))} />
            <button type="button" className="btn-ghost py-2 text-sm" onClick={() => { setText(SAMPLE); setDelta(null); }}>
              <Sparkles size={16} /> Sample change
            </button>
            <button type="button" className="btn-primary py-2 text-sm" disabled={!text.trim() || busy !== null} onClick={detect}>
              {busy === "detect" ? "Reading the change…" : "What changed?"}
            </button>
          </div>
          {delta && (
            <div className="space-y-2 rounded-xl bg-cream p-3">
              <p className="text-sm font-semibold">Only these changes will be added:</p>
              <p className="font-display text-lg font-bold">{describeDelta(delta)}</p>
              {delta.addMilestones?.map((m) => (
                <p key={m.id} className="text-sm text-navy-muted">
                  New milestone: {m.title} · ₹{m.amount.toLocaleString("en-IN")}
                </p>
              ))}
              {describeDelta(delta) === "No change detected" ? (
                <p className="text-sm text-alert">Nothing clear was said about scope, money or days. Please say it more exactly.</p>
              ) : (
                <button type="button" className="btn-primary py-2 text-sm" onClick={propose}>
                  Send to both to confirm
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p className="rounded-lg bg-alert-soft p-2.5 text-sm font-semibold text-alert">{error}</p>}
    </section>
  );
}
