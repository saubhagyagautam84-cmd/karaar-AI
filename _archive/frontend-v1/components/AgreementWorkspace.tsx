"use client";

import Link from "next/link";
import { useState } from "react";
import AgreementCard from "@/components/AgreementCard";
import PhonePreview from "@/components/PhonePreview";
import DisputePanel from "@/components/DisputePanel";
import WorkPanel from "@/components/WorkPanel";
import { api, errorText } from "@/lib/api";
import type { Ambiguity, AgreementTerms, Role } from "@/lib/types";

const PRE_CONFIRM = ["SENT", "CONFIRMED_BY_ONE"];

export default function AgreementWorkspace({
  initial,
  transcript,
}: {
  initial: AgreementTerms;
  transcript?: string;
}) {
  const [terms, setTerms] = useState(initial);
  const [links, setLinks] = useState<{ role: Role; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const id = terms.agreement_id;

  async function refresh() {
    try {
      setTerms((await api.agreement(id)).agreement);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function answer(a: Ambiguity, text: string): Promise<string | null> {
    try {
      const record = await api.answer(id, {
        field: a.field,
        question_en: a.question_en,
        answer: text,
      });
      setTerms(record.agreement);
      return null;
    } catch (e) {
      return errorText(e);
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.send(id);
      setLinks(
        result.links.map((l) => ({
          role: l.role,
          url: new URL(l.url).pathname,
        })),
      );
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const editable =
    terms.status === "DRAFT" || PRE_CONFIRM.includes(terms.status);
  const open = terms.ambiguities.length;

  return (
    <div className="space-y-4">
      <AgreementCard terms={terms} onAnswer={editable ? answer : undefined} />

      {transcript && (
        <details className="rounded-2xl border border-line bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">
            What we heard
          </summary>
          <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-muted">
            {transcript}
          </pre>
          <p className="mt-2 text-xs text-muted">
            Shown once. Karaar keeps the terms and the audio, not this text.
          </p>
        </details>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-danger-soft px-4 py-3 font-medium text-danger"
        >
          {error}
        </p>
      )}

      {terms.status === "DRAFT" && (
        <section className="space-y-2">
          {open > 0 && (
            <p className="text-sm text-saffron-ink">
              {open === 1 ? "1 question is" : `${open} questions are`} still
              open. You can settle {open === 1 ? "it" : "them"} above, or send
              now and the summary will list {open === 1 ? "it" : "them"}.
            </p>
          )}
          <button
            onClick={send}
            disabled={busy}
            className="h-14 w-full rounded-2xl bg-saffron text-lg font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send to both for confirmation"}
          </button>
        </section>
      )}

      {PRE_CONFIRM.includes(terms.status) && (
        <section className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          <p className="font-semibold">
            Waiting for both to say &ldquo;Haan, pakka&rdquo;
          </p>
          <p className="text-sm text-muted">
            Each person got their own link on WhatsApp.{" "}
            {links.length
              ? "For the demo, open them here:"
              : "For the demo, tap the links in the phone preview below."}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {links.map((l) => (
              <Link
                key={l.role}
                href={l.url}
                target="_blank"
                className="flex h-12 items-center justify-center rounded-xl border border-line font-semibold hover:border-saffron"
              >
                Open {l.role}&apos;s link ↗
              </Link>
            ))}
          </div>
          <button
            onClick={refresh}
            className="text-sm font-semibold text-saffron hover:underline"
          >
            Refresh status
          </button>
        </section>
      )}

      {[
        "CONFIRMED_BY_BOTH",
        "ADVANCE_PAID",
        "IN_PROGRESS",
        "COMPLETED",
      ].includes(terms.status) && (
        <WorkPanel terms={terms} onChange={refresh} />
      )}

      <DisputePanel terms={terms} onChange={refresh} />

      {terms.hash && (
        <Link
          href={`/verify/${id}`}
          className="flex h-12 items-center justify-center rounded-2xl bg-leaf font-semibold text-white hover:opacity-90"
        >
          Pakka ✓ Verify this record
        </Link>
      )}

      <PhonePreview agreementId={id} refreshKey={refreshKey} />
    </div>
  );
}
