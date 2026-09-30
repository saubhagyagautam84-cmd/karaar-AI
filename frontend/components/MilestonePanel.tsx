"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, CircleCheck, ExternalLink, Hammer, ThumbsDown, ThumbsUp } from "lucide-react";
import { DEMO_MODE, DEMO_VPA, confirmPayment, milestoneOnServer, upiLink, uploadPhoto } from "@/lib/api";
import { FlowError, addPhotos, approveMilestone, payMilestone, rejectMilestone, submitMilestone } from "@/lib/milestoneFlow";
import { effectiveTerms, progressOf } from "@/lib/terms";
import { inr } from "@/lib/numbers";
import { fmtDateTime } from "@/lib/summary";
import type { Agreement, Milestone, MilestoneStatus, Photo } from "@/lib/types";
import { PhotoProof } from "./PhotoProof";
import { cn } from "./ui";

const STATUS: Record<MilestoneStatus, { label: string; cls: string }> = {
  pending: { label: "Not started", cls: "bg-cream text-navy-muted border-line" },
  submitted: { label: "Done · awaiting approval", cls: "bg-amber-soft text-amber-ink border-amber-ink/20" },
  approved: { label: "Approved · pay now", cls: "bg-saffron-soft text-saffron-ink border-saffron/30" },
  rejected: { label: "Sent back", cls: "bg-alert-soft text-alert border-alert/30" },
  paid: { label: "Paid", cls: "bg-leaf text-white border-leaf" },
};

/** A1 + A2: each milestone moves pending → submitted (with photos) → approved → paid, or gets sent back. */
export function MilestonePanel({ a, onChange, flush }: { a: Agreement; onChange: (a: Agreement) => void; flush?: () => Promise<void> }) {
  const ms = effectiveTerms(a).milestones ?? [];
  const advanceDue = (a.terms.advance ?? 0) > 0 && !a.payments.some((p) => p.kind === "advance");
  return (
    <div className="space-y-3 border-t border-line/70 pt-4">
      <h3 className="font-display font-bold">
        Milestones <span className="font-sans text-sm font-normal text-navy-muted">· किस्तें</span>
      </h3>
      {advanceDue && <p className="text-sm text-navy-muted">Milestone payments open once the advance is paid.</p>}
      <ol className="space-y-3">
        {ms.map((m, i) => (
          <MilestoneCard key={m.id} a={a} m={m} index={i} onChange={onChange} flush={flush} advanceDue={advanceDue} />
        ))}
      </ol>
    </div>
  );
}

function MilestoneCard({
  a, m, index, onChange, flush, advanceDue,
}: { a: Agreement; m: Milestone; index: number; onChange: (a: Agreement) => void; flush?: () => Promise<void>; advanceDue: boolean }) {
  const p = progressOf(a, m.id);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = a.status !== "disputed" && a.status !== "completed";
  const ref = `${a.id}-milestone-${m.id}`;
  const link = upiLink({ vpa: DEMO_VPA, name: a.worker.name, amount: m.amount, note: `Karaar ${a.id} ${m.title}`, ref });
  const afterPhotos = p.photos.filter((x) => x.kind === "after").length;

  async function run(step: () => Promise<Agreement>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await step());
      setRejecting(false);
      setReason("");
    } catch (e) {
      setError(e instanceof FlowError || e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // Demo mode applies the transition here; live mode asks the server, which applies the same rules.
  const transition = (action: "submit" | "approve" | "reject") =>
    run(async () => {
      if (DEMO_MODE) {
        return action === "submit" ? submitMilestone(a, m.id) : action === "approve" ? approveMilestone(a, m.id) : rejectMilestone(a, m.id, reason);
      }
      await flush?.();
      return milestoneOnServer(a, m.id, action, action === "reject" ? { reason } : { photos: p.photos });
    });

  async function addPhoto(photo: Photo, blob: Blob) {
    const saved = await uploadPhoto(blob, photo, a.id, m.id);
    onChange(addPhotos(a, m.id, [saved]));
  }

  return (
    <li className="rounded-2xl border border-line/80 bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-navy-muted">Milestone {index + 1}</p>
          <p className="font-display text-base font-bold">
            {m.title}
            {m.titleHi && <span className="font-sans text-sm font-normal text-navy-muted"> · {m.titleHi}</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-bold">{inr(m.amount)}</p>
          <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-bold", STATUS[p.status].cls)}>{STATUS[p.status].label}</span>
        </div>
      </div>

      {p.status === "rejected" && p.rejectReason && (
        <p className="mt-2 rounded-lg bg-alert-soft p-2 text-sm text-alert">
          <b>What to fix:</b> {p.rejectReason}
        </p>
      )}
      {p.status === "paid" && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-leaf">
          <CheckCircle2 size={15} /> Paid {fmtDateTime(p.paidAt)} · {p.upiRef}
        </p>
      )}

      <div className="mt-3">
        <PhotoProof photos={p.photos} canAdd={active && (p.status === "pending" || p.status === "rejected")} onAdd={addPhoto} />
      </div>

      {active && (
        <div className="mt-3 space-y-2">
          {(p.status === "pending" || p.status === "rejected") && (
            <>
              <button className="btn-primary w-full py-2.5 text-sm" disabled={busy || afterPhotos === 0} onClick={() => transition("submit")}>
                <Hammer size={16} /> Worker: mark this done · काम पूरा
              </button>
              {afterPhotos === 0 && <p className="text-xs text-navy-muted">Add at least one “after” photo as proof first.</p>}
            </>
          )}
          {p.status === "submitted" && !rejecting && (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-success py-2.5 text-sm" disabled={busy} onClick={() => transition("approve")}>
                <ThumbsUp size={16} /> Approve · मंज़ूर
              </button>
              <button className="btn-ghost py-2.5 text-sm text-alert" disabled={busy} onClick={() => setRejecting(true)}>
                <ThumbsDown size={16} /> Send back
              </button>
            </div>
          )}
          {p.status === "submitted" && rejecting && (
            <div className="space-y-2">
              <label className="label" htmlFor={`rej-${m.id}`}>What needs fixing? · क्या ठीक करना है?</label>
              <input id={`rej-${m.id}`} className="input py-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Patches visible near the window" />
              <div className="flex gap-2">
                <button className="btn-primary py-2 text-sm" disabled={busy || !reason.trim()} onClick={() => transition("reject")}>
                  Send back to worker
                </button>
                <button className="btn-ghost py-2 text-sm" onClick={() => setRejecting(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {p.status === "approved" && (
            <div className="grid items-center gap-3 rounded-xl bg-cream p-3 sm:grid-cols-[auto_1fr]">
              <div className="mx-auto rounded-lg bg-white p-2">
                <QRCodeSVG value={link} size={112} fgColor="#1B2A41" bgColor="#FFFFFF" />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-navy-body">
                  {a.hirer.name} pays <b className="text-navy">{inr(m.amount)}</b> for “{m.title}”.
                </p>
                {advanceDue && <p className="text-xs font-semibold text-amber-ink">Pay the advance above first.</p>}
                <div className="flex flex-wrap gap-2">
                  <a href={link} className="btn-primary py-2 text-sm">
                    <ExternalLink size={16} /> Open UPI app
                  </a>
                  <button
                    className="btn-success py-2 text-sm"
                    disabled={busy || advanceDue}
                    onClick={() =>
                      run(async () => {
                        await flush?.();
                        const { upiRef } = await confirmPayment(ref);
                        return payMilestone(a, m.id, upiRef);
                      })
                    }
                  >
                    <CircleCheck size={16} /> {busy ? "Confirming with bank…" : "Milestone paid"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-2 rounded-lg bg-alert-soft p-2 text-sm font-semibold text-alert">{error}</p>}
    </li>
  );
}
