"use client";

import { useEffect, useRef, useState } from "react";
import QrCode from "@/components/QrCode";
import { api, errorText } from "@/lib/api";
import { rupees } from "@/lib/format";
import type { AgreementTerms, Milestone, Role } from "@/lib/types";

const MILESTONE_LABEL: Record<string, string> = {
  advance_paid: "Advance paid",
  work_started: "Work started",
  work_done_worker: "Worker marked the work done",
  work_done_client: "Client marked the work done",
  work_completed: "Completed by both",
  final_payment: "Final payment made",
};

const button = "h-12 rounded-xl font-semibold disabled:opacity-50";

/** Phase 5: UPI advance, work milestones, completion and final payment. */
export default function WorkPanel({
  terms,
  onChange,
}: {
  terms: AgreementTerms;
  onChange: () => Promise<void>;
}) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [vpa, setVpa] = useState("");
  const [intent, setIntent] = useState<{
    purpose: string;
    upi_link: string;
    amount_inr: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const [doneBy, setDoneBy] = useState<Role | null>(null);
  const id = terms.agreement_id;

  useEffect(() => {
    api
      .milestones(id)
      .then(setMilestones)
      .catch(() => {});
  }, [id, terms.status]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setIntent(null);
      await onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function createIntent(purpose: "advance" | "final") {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ upi_link: string; amount_inr: number }>(
        `/api/agreements/${id}/payments/${purpose}/intent`,
        { payee_vpa: vpa },
      );
      setIntent({
        purpose,
        upi_link: res.upi_link,
        amount_inr: res.amount_inr,
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function markDone(party: Role) {
    const form = new FormData();
    form.append("party", party);
    const file = photo.current?.files?.[0];
    if (file) form.append("photo", file);
    await run(() => api.markDone(id, form));
    if (photo.current) photo.current.value = "";
    setDoneBy(party);
  }

  const has = (t: string) => milestones.some((m) => m.type === t);
  const finalAmount =
    terms.price_inr !== null
      ? Math.max(terms.price_inr - (terms.advance_inr ?? 0), 0)
      : null;
  const needsAdvance =
    terms.status === "CONFIRMED_BY_BOTH" && (terms.advance_inr ?? 0) > 0;
  const canStart =
    terms.status === "ADVANCE_PAID" ||
    (terms.status === "CONFIRMED_BY_BOTH" && !(terms.advance_inr ?? 0));
  const needsFinal =
    terms.status === "COMPLETED" &&
    !has("final_payment") &&
    (finalAmount ?? 0) > 0;

  function payBox(purpose: "advance" | "final", amount: number | null) {
    return (
      <div className="space-y-3">
        <p className="font-semibold">
          Pay {purpose === "advance" ? "the advance" : "the rest"}:{" "}
          {rupees(amount)}
        </p>
        {!intent || intent.purpose !== purpose ? (
          <div className="flex gap-2">
            <input
              value={vpa}
              onChange={(e) => setVpa(e.target.value)}
              placeholder="Worker's UPI ID, e.g. ramesh@upi"
              aria-label="Worker's UPI ID"
              className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-background px-3 text-base"
            />
            <button
              onClick={() => createIntent(purpose)}
              disabled={busy || !vpa.includes("@")}
              className={`${button} shrink-0 bg-saffron px-4 text-white`}
            >
              Get QR
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-xl bg-background p-4 text-center">
            <QrCode
              text={intent.upi_link}
              label={`UPI QR for ${rupees(intent.amount_inr)}`}
            />
            <p className="text-sm text-muted">
              Scan with any UPI app. The note carries agreement {id}.
            </p>
            <div className="grid w-full gap-2 sm:grid-cols-2">
              <a
                href={intent.upi_link}
                className={`${button} flex items-center justify-center border border-line`}
              >
                Open UPI app
              </a>
              <button
                onClick={() =>
                  run(() =>
                    api.post(
                      `/api/agreements/${id}/payments/${purpose}/confirm`,
                    ),
                  )
                }
                disabled={busy}
                className={`${button} bg-leaf text-white`}
              >
                Simulate payment (demo)
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-semibold">Work and payments</h2>

      {needsAdvance && payBox("advance", terms.advance_inr)}

      {canStart && (
        <button
          onClick={() =>
            run(() => api.post(`/api/agreements/${id}/start`, { by: "worker" }))
          }
          disabled={busy}
          className={`${button} w-full bg-saffron text-white`}
        >
          Work has started
        </button>
      )}

      {terms.status === "IN_PROGRESS" && (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            The job is complete when both people mark it done. A photo of the
            finished work is optional.
          </p>
          <input
            ref={photo}
            type="file"
            accept="image/*"
            capture="environment"
            className="block w-full text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            {(["worker", "client"] as Role[]).map((party) => (
              <button
                key={party}
                onClick={() => markDone(party)}
                disabled={busy || has(`work_done_${party}`)}
                className={`${button} border-2 border-leaf text-leaf`}
              >
                {has(`work_done_${party}`)
                  ? `${party === "worker" ? "Worker" : "Client"} ✓`
                  : `${party === "worker" ? "Worker" : "Client"}: done`}
              </button>
            ))}
          </div>
          {doneBy && (
            <p className="text-sm text-leaf">Marked done by the {doneBy}.</p>
          )}
        </div>
      )}

      {needsFinal && payBox("final", finalAmount)}

      {error && (
        <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {milestones.length > 0 && (
        <ol className="space-y-2 border-t border-line pt-3">
          {milestones.map((m) => (
            <li
              key={m.type + m.at}
              className="flex items-start justify-between gap-3 text-sm"
            >
              <span>
                <span className="text-leaf">●</span>{" "}
                {MILESTONE_LABEL[m.type] ?? m.type}
                {m.amount_inr ? ` · ${rupees(m.amount_inr)}` : ""}
                {m.proof_ref && m.type.startsWith("work_done")
                  ? " · photo"
                  : ""}
              </span>
              <time className="shrink-0 text-xs text-muted">
                {new Date(m.at).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
