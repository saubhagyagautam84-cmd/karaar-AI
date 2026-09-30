"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Camera, CircleCheck, ExternalLink, IndianRupee, Star } from "lucide-react";
import { DEMO_VPA, confirmPayment, upiLink, uploadPhoto } from "@/lib/api";
import { balanceDue } from "@/lib/extract";
import { inr } from "@/lib/numbers";
import { fmtDateTime } from "@/lib/summary";
import { nowIso } from "@/lib/store";
import { effectiveTerms, paidTotal, progressOf, totalPayable } from "@/lib/terms";
import { addPhotos } from "@/lib/milestoneFlow";
import type { Agreement, Photo } from "@/lib/types";
import { MilestonePanel } from "./MilestonePanel";
import { PhotoProof } from "./PhotoProof";
import { cn } from "./ui";

export function PaymentPanel({ a, onChange, flush }: { a: Agreement; onChange: (a: Agreement) => void; flush?: () => Promise<void> }) {
  const [paying, setPaying] = useState(false);
  const [rating, setRating] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const t = effectiveTerms(a);
  const hasMilestones = Boolean(t.milestones?.length);
  const advancePaid = a.payments.some((p) => p.kind === "advance");
  const remaining = Math.max(totalPayable(a) - paidTotal(a), 0);
  // With milestones, a balance is only left over after a settlement held some money back for rework.
  const milestonesDone = (t.milestones ?? []).every((m) => progressOf(a, m.id).status === "paid");
  const nextKind: "advance" | "balance" | null = t.advance && !advancePaid ? "advance" : milestonesDone && remaining > 0 ? "balance" : null;
  const amount = nextKind === "advance" ? t.advance ?? 0 : remaining;
  const canPay = a.status !== "disputed" && a.status !== "completed" && nextKind !== null && amount > 0;
  const link = upiLink({ vpa: DEMO_VPA, name: a.worker.name, amount, note: `Karaar ${a.id} ${nextKind}`, ref: `${a.id}-${nextKind}` });
  const balancePaid = a.payments.filter((p) => p.kind === "balance" || p.kind === "settlement");

  async function paid() {
    if (!nextKind) return;
    setPaying(true);
    setError(null);
    let upiRef: string;
    try {
      await flush?.();
      ({ upiRef } = await confirmPayment(`${a.id}-${nextKind}`));
    } catch (e) {
      setPaying(false);
      setError(e instanceof Error ? e.message : "Payment not confirmed yet.");
      return;
    }
    const at = nowIso();
    const done = nextKind === "balance";
    onChange({
      ...a,
      status: done ? "completed" : "advance_paid",
      payments: [...a.payments, { id: `${nextKind}-${Date.now()}`, kind: nextKind, amount, at, upiRef }],
      events: [
        ...a.events,
        { at, label: `${nextKind === "advance" ? "Advance" : "Balance"} paid via UPI`, detail: `${inr(amount)} · ${upiRef}` },
        ...(done ? [{ at, label: "Work completed", detail: rating ? `Rated ${rating}/5 by ${a.hirer.name}` : undefined }] : []),
      ],
      rating: done && rating ? rating : a.rating,
      ratings: done && rating ? { ...a.ratings, byHirer: { onTime: rating, fair: rating, respectful: rating, at } } : a.ratings,
    });
    setPaying(false);
  }

  async function addWorkPhoto(photo: Photo, blob: Blob) {
    const saved = await uploadPhoto(blob, photo, a.id, "work");
    onChange(addPhotos(a, "work", [saved]));
  }

  return (
    <section className="card space-y-4" aria-label="Payments">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <IndianRupee size={20} className="text-saffron-ink" /> Payments linked to this agreement
      </h2>

      <ul className="space-y-2">
        {t.advance ? <PayRow label="Advance" amount={t.advance} paid={a.payments.find((p) => p.kind === "advance")} /> : null}
        {!hasMilestones && <PayRow label="Balance" amount={balanceDue(t) ?? 0} paid={remaining === 0 ? balancePaid[balancePaid.length - 1] : undefined} />}
        {hasMilestones && milestonesDone && remaining > 0 && <PayRow label="Held back until rework" amount={remaining} />}
      </ul>

      {canPay && (
        <div className="grid items-center gap-4 rounded-2xl bg-cream p-4 sm:grid-cols-[auto_1fr]">
          <div className="mx-auto rounded-xl bg-white p-2.5">
            <QRCodeSVG value={link} size={132} fgColor="#1B2A41" bgColor="#FFFFFF" />
          </div>
          <div className="space-y-3">
            <p className="text-sm text-navy-body">
              {a.hirer.name} pays <b className="text-navy">{inr(amount)}</b> {nextKind === "advance" ? "advance" : "balance"} to {a.worker.name}. Scan with any UPI app; the
              transaction note carries the agreement ID.
            </p>
            {nextKind === "balance" && (
              <div>
                <p className="mb-1 text-sm font-semibold">Rate the work (optional)</p>
                <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n} star${n > 1 ? "s" : ""}`} onClick={() => setRating(n)}>
                      <Star size={24} className={n <= rating ? "fill-saffron text-saffron" : "text-line"} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <a href={link} className="btn-primary py-2 text-sm">
                <ExternalLink size={16} /> Open UPI app
              </a>
              <button className="btn-success py-2 text-sm" disabled={paying} onClick={paid}>
                <CircleCheck size={16} /> {paying ? "Confirming with bank…" : nextKind === "balance" ? "Work done, balance paid" : "Advance paid"}
              </button>
            </div>
          </div>
        </div>
      )}
      {error && <p className="rounded-xl bg-alert-soft p-3 text-sm font-semibold text-alert">{error}</p>}

      {hasMilestones && <MilestonePanel a={a} onChange={onChange} flush={flush} />}

      {!hasMilestones && a.status !== "review" && a.status !== "awaiting_confirmation" && (canPay || a.status === "sealed" || a.status === "advance_paid" || progressOf(a, "work").photos.length > 0) && (
        <div className="space-y-2 border-t border-line/70 pt-4">
          <h3 className="flex items-center gap-2 font-display font-bold">
            <Camera size={17} className="text-saffron-ink" /> Proof of work <span className="font-sans text-sm font-normal text-navy-muted">· काम का सबूत</span>
          </h3>
          <PhotoProof photos={progressOf(a, "work").photos} canAdd={a.status !== "completed" && a.status !== "disputed"} onAdd={addWorkPhoto} />
        </div>
      )}

      {a.status === "completed" && (
        <p className="rounded-xl bg-leaf-soft p-3 text-sm font-semibold text-leaf">
          Fully paid. This job is now part of {a.worker.name}&apos;s verified work history.
        </p>
      )}
    </section>
  );
}

function PayRow({ label, amount, paid }: { label: string; amount: number; paid?: { at: string; upiRef: string } }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-line/70 px-3 py-2.5">
      <div>
        <p className="font-semibold">{label}</p>
        <p className="text-xs text-navy-muted">{paid ? `${fmtDateTime(paid.at)} · ${paid.upiRef}` : "Not paid yet"}</p>
      </div>
      <div className="text-right">
        <p className="font-display font-bold">{inr(amount)}</p>
        <p className={cn("text-xs font-bold", paid ? "text-leaf" : "text-navy-muted")}>{paid ? "Paid" : "Due"}</p>
      </div>
    </li>
  );
}
