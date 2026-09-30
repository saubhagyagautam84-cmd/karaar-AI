"use client";

import { useState } from "react";
import { api, errorText } from "@/lib/api";
import type { AgreementTerms, Role } from "@/lib/types";

const CAN_DISPUTE = ["ADVANCE_PAID", "IN_PROGRESS", "COMPLETED"];

/** Phase 7: raise a dispute, download the ready-to-file summary, resolve or escalate. */
export default function DisputePanel({
  terms,
  onChange,
}: {
  terms: AgreementTerms;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [party, setParty] = useState<Role>("client");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = terms.agreement_id;
  const pdf = `/api/agreements/${id}/dispute.pdf`;

  async function run(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api.post(path, body);
      setOpen(false);
      await onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (CAN_DISPUTE.includes(terms.status)) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-4">
        {!open ? (
          <button
            onClick={() => setOpen(true)}
            className="text-sm font-semibold text-danger hover:underline"
          >
            Something went wrong? Raise a dispute
          </button>
        ) : (
          <div className="space-y-2">
            <h2 className="font-semibold">Raise a dispute</h2>
            <div className="grid grid-cols-2 gap-2">
              {(["client", "worker"] as Role[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setParty(r)}
                  className={`h-11 rounded-xl border-2 font-semibold ${party === r ? "border-danger text-danger" : "border-line"}`}
                >
                  {r === "client" ? "I am the client" : "I am the worker"}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="What went wrong? e.g. only one coat was done"
              className="w-full rounded-xl border border-line bg-background p-3 text-base"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setOpen(false)}
                className="h-12 rounded-xl border border-line font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  run(`/api/agreements/${id}/dispute`, { party, reason })
                }
                disabled={busy || !reason.trim()}
                className="h-12 rounded-xl bg-danger font-semibold text-white disabled:opacity-50"
              >
                Raise dispute
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="mt-2 text-sm font-medium text-danger">{error}</p>
        )}
      </section>
    );
  }

  if (!["DISPUTED", "RESOLVED", "ESCALATED"].includes(terms.status))
    return null;

  return (
    <section className="space-y-3 rounded-2xl border-2 border-danger/40 bg-danger-soft p-4">
      <h2 className="font-semibold text-danger">
        {terms.status === "DISPUTED"
          ? "This agreement is in dispute"
          : terms.status === "RESOLVED"
            ? "Dispute resolved"
            : "Escalated to a consumer complaint"}
      </h2>
      <p className="text-sm">
        The summary has the agreed terms, every payment and step with times, the
        full audit log and the record&apos;s fingerprint, ready for an e-Daakhil
        consumer complaint.
      </p>
      <a
        href={pdf}
        target="_blank"
        className="flex h-12 items-center justify-center rounded-xl bg-foreground font-semibold text-background"
      >
        Download dispute summary (PDF)
      </a>
      {terms.status === "DISPUTED" && (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => run(`/api/agreements/${id}/dispute/resolve`, {})}
            disabled={busy}
            className="h-12 rounded-xl border-2 border-leaf bg-surface font-semibold text-leaf"
          >
            We sorted it out
          </button>
          <button
            onClick={() => run(`/api/agreements/${id}/dispute/escalate`, {})}
            disabled={busy}
            className="h-12 rounded-xl border-2 border-danger bg-surface font-semibold text-danger"
          >
            File a complaint
          </button>
        </div>
      )}
      {terms.status === "ESCALATED" && (
        <a
          href="https://edaakhil.nic.in"
          target="_blank"
          rel="noreferrer"
          className="block text-center text-sm font-semibold underline"
        >
          Open e-Daakhil to file ↗
        </a>
      )}
      {error && <p className="text-sm font-medium text-danger">{error}</p>}
    </section>
  );
}
