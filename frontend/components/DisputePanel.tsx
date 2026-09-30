"use client";

import { useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { ArrowRight, Bot, CheckCircle2, CircleCheck, FileDown, Gavel, Scale, UserCheck } from "lucide-react";
import { DEMO_VPA, confirmPayment, mediate, upiLink } from "@/lib/api";
import { DISPUTE_REASONS } from "@/lib/mediator";
import { confirmAmendment } from "@/lib/confirm";
import { addStatement, afterSettlementSealed, applySettlementPayment, ensureSettlement, escalate, markAccepted, raiseDispute, settlementOf, withMediation } from "@/lib/settle";
import { inr } from "@/lib/numbers";
import { fmtDateTime } from "@/lib/summary";
import { summaryLang } from "@/lib/languages";
import type { Agreement, DisputeReason, Role } from "@/lib/types";
import { Dictate } from "./Dictate";
import { SpeakButton } from "./SpeakButton";
import { cn } from "./ui";

const roleLabel = (r: Role) => (r === "worker" ? "worker" : "hirer");

/** A4: raise a dispute, collect both sides, get an AI suggestion, settle (sealed) or escalate. */
export function DisputePanel({ a, onChange, flush }: { a: Agreement; onChange: (a: Agreement) => void; flush?: () => Promise<void> }) {
  const d = a.dispute;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, step: () => Promise<Agreement> | Agreement) {
    setBusy(key);
    setError(null);
    try {
      onChange(await step());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const open = a.status === "disputed" && d && d.outcome !== "escalated";
  const settlement = settlementOf(a);
  const m = d?.mediation;

  async function accept(role: Role) {
    await run(`accept-${role}`, async () => {
      await flush?.();
      const { next: withSettlement, amendment } = ensureSettlement(a);
      const { next, sealed } = await confirmAmendment(markAccepted(withSettlement, role), amendment.id, role, "in_app");
      return sealed ? afterSettlementSealed(next) : next;
    });
  }

  return (
    <section className="card space-y-4" aria-label="If something goes wrong">
      <div>
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <Scale size={20} className="text-saffron-ink" /> If something goes wrong <span className="font-sans text-sm font-normal text-navy-muted">· अगर झगड़ा हो</span>
        </h2>
        <p className="mt-1 text-navy-body">
          The sealed record, both confirmations, change orders, photos and the payment trail are strong evidence for mediation, ready for a consumer forum if needed.
        </p>
      </div>
      <Link href={`/deals/${a.id}/record`} className="btn-ghost py-2 text-sm">
        <FileDown size={16} /> Dispute-ready record (PDF)
      </Link>

      {(!d || (d.outcome === "settled" && a.status !== "disputed")) && a.status !== "review" && a.status !== "awaiting_confirmation" && <RaiseForm a={a} busy={busy !== null} onRaise={(by, reason, text, ch) => run("raise", () => raiseDispute(a, by, reason, text, ch))} />}

      {d && (
        <div className={cn("space-y-4 rounded-2xl border p-4", d.outcome === "settled" ? "border-leaf/30 bg-leaf-soft/50" : "border-alert/30 bg-alert-soft/50")}>
          <div>
            <p className={cn("font-bold", d.outcome === "settled" ? "text-leaf" : "text-alert")}>
              {d.outcome === "settled" ? "Settled" : d.outcome === "escalated" ? "Escalated to consumer forum" : "Dispute open"} · {d.reason}
            </p>
            <p className="text-xs text-navy-muted">
              Raised by {a[d.raisedBy].name} · {fmtDateTime(d.raisedAt)}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(["worker", "hirer"] as const).map((r) => (
              <StatementBox key={r} a={a} role={r} editable={Boolean(open) && !settlement} busy={busy !== null} onSave={(text, ch) => run(`st-${r}`, () => addStatement(a, r, text, ch))} />
            ))}
          </div>

          {open && !settlement && (
            <button className="btn-primary w-full py-2.5 text-sm" disabled={busy !== null || !d.statements.worker || !d.statements.hirer} onClick={() => run("mediate", async () => withMediation(a, await mediate(a, d.reason)))}>
              <Bot size={17} /> {busy === "mediate" ? "Reading the record…" : m ? "Ask again with the new statements" : "Get an AI suggestion · सुझाव लें"}
            </button>
          )}
          {open && !settlement && !(d.statements.worker && d.statements.hirer) && <p className="text-xs text-navy-muted">Both people add their side first.</p>}

          {m && <MediationView a={a} />}

          {m && open && d.outcome !== "settled" && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Both accept to settle. The settlement is sealed on its own and linked to this record.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {(["worker", "hirer"] as const).map((r) => {
                  const c = settlement?.confirmations[r];
                  return c ? (
                    <p key={r} className="flex items-center gap-1.5 rounded-xl border border-leaf/40 bg-leaf-soft px-3 py-2 text-sm text-leaf">
                      <CheckCircle2 size={15} /> {a[r].name} accepted
                    </p>
                  ) : (
                    <button key={r} className="btn-success py-2 text-sm" disabled={busy !== null} onClick={() => accept(r)}>
                      <UserCheck size={15} /> {a[r].name} accepts
                    </button>
                  );
                })}
              </div>
              <button className="btn-ghost py-2 text-sm text-alert" disabled={busy !== null} onClick={() => run("escalate", () => escalate(a))}>
                <Gavel size={16} /> Not accepted: escalate
              </button>
            </div>
          )}

          {d.outcome === "settled" && m && a.status === "disputed" && <SettlementPay a={a} busy={busy !== null} onPaid={(ref) => run("pay", () => applySettlementPayment(a, ref))} flush={flush} setError={setError} />}

          {d.outcome === "escalated" && (
            <div className="space-y-2 text-sm">
              <p className="text-navy-body">
                Next step: file on e-Daakhil (consumer forum) with the evidence pack attached. <span className="italic">(Simulated in the prototype.)</span>
              </p>
              <p className="text-xs text-navy-muted">Whether electronic records are accepted as evidence in your case should be confirmed with a lawyer.</p>
              <Link href={`/deals/${a.id}/record`} className="btn-primary py-2 text-sm">
                Open the e-Daakhil evidence pack <ArrowRight size={16} />
              </Link>
            </div>
          )}
        </div>
      )}
      {error && <p className="rounded-lg bg-alert-soft p-2.5 text-sm font-semibold text-alert">{error}</p>}
    </section>
  );
}

function RaiseForm({ a, busy, onRaise }: { a: Agreement; busy: boolean; onRaise: (by: Role, reason: DisputeReason, text: string, channel: "text" | "voice") => void }) {
  const [shown, setShown] = useState(false);
  const [by, setBy] = useState<Role>("hirer");
  const [reason, setReason] = useState<DisputeReason>("Quality of work");
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(false);
  if (!shown) {
    return (
      <button className="btn-ghost py-2 text-sm text-alert" onClick={() => setShown(true)}>
        <Gavel size={16} /> Raise a dispute
      </button>
    );
  }
  return (
    <div className="space-y-3 rounded-2xl border border-alert/30 p-4">
      <fieldset className="flex flex-wrap items-center gap-3 text-sm">
        <legend className="sr-only">Who is raising it?</legend>
        <span className="font-semibold">Raised by</span>
        {(["hirer", "worker"] as const).map((r) => (
          <label key={r} className="flex items-center gap-1.5">
            <input type="radio" name="raised-by" className="accent-[#B42318]" checked={by === r} onChange={() => setBy(r)} />
            {a[r].name}
          </label>
        ))}
      </fieldset>
      <div>
        <label className="label" htmlFor="dispute-reason">What is the problem? · क्या दिक्कत है?</label>
        <select id="dispute-reason" className="input py-2" value={reason} onChange={(e) => setReason(e.target.value as DisputeReason)}>
          {DISPUTE_REASONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id} · {r.hi}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="dispute-text">Your side, in your words</label>
        <textarea id="dispute-text" className="input min-h-20" value={text} onChange={(e) => { setText(e.target.value); setVoice(false); }} />
        <Dictate className="mt-2" lang={summaryLang(a[by].lang)} onText={(s) => { setText((v) => (v ? `${v} ${s}` : s)); setVoice(true); }} />
      </div>
      <button className="btn-primary py-2 text-sm" disabled={busy} onClick={() => onRaise(by, reason, text, voice ? "voice" : "text")}>
        Raise dispute · work pauses
      </button>
    </div>
  );
}

function StatementBox({ a, role, editable, busy, onSave }: { a: Agreement; role: Role; editable: boolean; busy: boolean; onSave: (text: string, channel: "text" | "voice") => void }) {
  const st = a.dispute?.statements[role];
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(false);
  const id = `statement-${role}`;
  return (
    <div className="rounded-xl border border-line bg-paper p-3 text-sm">
      <p className="font-semibold">
        {a[role].name} <span className="text-xs font-normal text-navy-muted">({roleLabel(role)})</span>
      </p>
      {st ? (
        <p className="mt-1 text-navy-body">
          “{st.text}” <span className="block text-xs text-navy-muted">{st.channel === "voice" ? "Spoken" : "Typed"} · {fmtDateTime(st.at)}</span>
        </p>
      ) : editable ? (
        <div className="mt-2 space-y-2">
          <label className="sr-only" htmlFor={id}>{a[role].name}&apos;s side</label>
          <textarea id={id} className="input min-h-16 py-2" placeholder="Their side of it" value={text} onChange={(e) => { setText(e.target.value); setVoice(false); }} />
          <div className="flex flex-wrap gap-2">
            <Dictate lang={summaryLang(a[role].lang)} onText={(s) => { setText((v) => (v ? `${v} ${s}` : s)); setVoice(true); }} />
            <button className="btn-primary py-1.5 text-sm" disabled={busy || !text.trim()} onClick={() => onSave(text, voice ? "voice" : "text")}>
              Add statement
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-navy-muted">No statement.</p>
      )}
    </div>
  );
}

function MediationView({ a }: { a: Agreement }) {
  const m = a.dispute?.mediation;
  if (!m) return null;
  return (
    <div className="space-y-3 rounded-xl border border-navy/15 bg-paper p-4 text-sm">
      <p className="flex items-center gap-2 font-display text-base font-bold">
        <Bot size={18} className="text-saffron-ink" /> AI mediator suggestion
        <span className="rounded-full bg-cream px-2 py-0.5 font-sans text-[11px] font-bold text-navy-muted">{m.engine === "llm" ? "AI wording, rule-checked numbers" : "rules engine"}</span>
      </p>
      <List title="Facts from the record" items={m.facts} />
      <List title="Both agree" items={m.agreed} />
      <List title="In question" items={m.contested} />
      <div>
        <p className="mb-1 font-semibold">Calculation</p>
        <table className="w-full text-left tabular-nums">
          <tbody>
            {m.calculation.map((c, i) => (
              <tr key={i} className={cn("border-t border-line/60", i === m.calculation.length - 1 && "font-bold")}>
                <td className="py-1 pr-2">{c.label}</td>
                <td className="py-1 text-right">{c.amount < 0 ? `− ${inr(-c.amount)}` : inr(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="rounded-lg bg-saffron-soft p-3 font-semibold text-navy">{m.suggestion}</p>
      <SpeakButton text={m.suggestion} lang="en" />
      <List title="Evidence used" items={m.evidence} small />
      <p className="text-xs italic text-navy-muted">{m.disclaimer}</p>
    </div>
  );
}

function List({ title, items, small }: { title: string; items: string[]; small?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="mb-1 font-semibold">{title}</p>
      <ul className={cn("list-disc space-y-0.5 pl-5", small ? "text-xs text-navy-muted" : "text-navy-body")}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

function SettlementPay({ a, busy, onPaid, flush, setError }: { a: Agreement; busy: boolean; onPaid: (ref: string) => void; flush?: () => Promise<void>; setError: (e: string | null) => void }) {
  const m = a.dispute?.mediation;
  const [paying, setPaying] = useState(false);
  if (!m) return null;
  const refund = m.refundToHirer > 0;
  const amount = refund ? m.refundToHirer : m.payToWorker;
  const payee = refund ? a.hirer.name : a.worker.name;
  const ref = `${a.id}-settlement`;
  const link = upiLink({ vpa: DEMO_VPA, name: payee, amount, note: `Karaar ${a.id} settlement`, ref });
  return (
    <div className="grid items-center gap-3 rounded-xl bg-cream p-3 sm:grid-cols-[auto_1fr]">
      <div className="mx-auto rounded-lg bg-white p-2">
        <QRCodeSVG value={link} size={112} fgColor="#1B2A41" bgColor="#FFFFFF" />
      </div>
      <div className="space-y-2 text-sm">
        <p>
          {refund ? a.worker.name : a.hirer.name} pays <b>{inr(amount)}</b> to {payee}, as settled.
        </p>
        <button
          className="btn-success py-2 text-sm"
          disabled={busy || paying}
          onClick={async () => {
            setPaying(true);
            setError(null);
            try {
              await flush?.();
              const { upiRef } = await confirmPayment(ref);
              onPaid(upiRef);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Payment not confirmed yet.");
            } finally {
              setPaying(false);
            }
          }}
        >
          <CircleCheck size={16} /> {paying ? "Confirming with bank…" : "Settlement paid"}
        </button>
      </div>
    </div>
  );
}
