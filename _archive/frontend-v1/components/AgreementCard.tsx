"use client";

import { useState } from "react";
import type { Ambiguity, AgreementTerms, Status } from "@/lib/types";
import { MATERIALS_LABEL, niceDate, rupees, STATUS_LABEL } from "@/lib/format";

const CONFIRMED: Status[] = [
  "CONFIRMED_BY_BOTH",
  "ADVANCE_PAID",
  "IN_PROGRESS",
  "COMPLETED",
  "RESOLVED",
];

export function StatusBadge({ status }: { status: Status }) {
  const tone = CONFIRMED.includes(status)
    ? "bg-leaf-soft text-leaf"
    : status === "DISPUTED" || status === "ESCALATED"
      ? "bg-danger-soft text-danger"
      : "bg-saffron-soft text-saffron-ink";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function Term({
  label,
  value,
  quotes,
  index,
}: {
  label: string;
  value: string | null;
  quotes: { quote: string; answered: boolean }[];
  index: number;
}) {
  return (
    <div
      className="fill-in border-b border-line py-3 last:border-b-0"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-0.5">
        {value ? (
          <span className="text-base font-medium">{value}</span>
        ) : (
          <span className="text-base font-medium text-saffron-ink">
            Not agreed yet
          </span>
        )}
        {quotes.map((q) => (
          <span key={q.quote} className="mt-1 block text-sm text-muted">
            {q.answered ? (
              <span className="font-semibold not-italic">Answered: </span>
            ) : null}
            <q className="italic">{q.quote}</q>
          </span>
        ))}
      </dd>
    </div>
  );
}

function Question({
  a,
  onAnswer,
}: {
  a: Ambiguity;
  onAnswer?: (a: Ambiguity, answer: string) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!onAnswer || !text.trim()) return;
    setBusy(true);
    setError(await onAnswer(a, text.trim()));
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-saffron/40 bg-saffron-soft p-3">
      <p className="font-medium">{a.question_en}</p>
      {a.question_local !== a.question_en && (
        <p lang="hi" className="mt-0.5 text-sm text-saffron-ink">
          {a.question_local}
        </p>
      )}
      {onAnswer && (
        <form onSubmit={submit} className="mt-2 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type the answer both agree on"
            aria-label={`Answer: ${a.question_en}`}
            className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-base"
          />
          <button
            disabled={busy || !text.trim()}
            className="h-11 shrink-0 rounded-lg bg-saffron px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? "…" : "Save"}
          </button>
        </form>
      )}
      {error && <p className="mt-1 text-sm font-medium text-danger">{error}</p>}
    </div>
  );
}

export default function AgreementCard({
  terms,
  onAnswer,
}: {
  terms: AgreementTerms;
  onAnswer?: (a: Ambiguity, answer: string) => Promise<string | null>;
}) {
  const quotes = (...fields: string[]) =>
    terms.evidence
      .filter((e) => fields.includes(e.field))
      .map((e) => ({ quote: e.quote, answered: e.source === "answer" }));
  const { client, worker } = terms.parties;
  const dates =
    terms.start_date || terms.deadline
      ? `${niceDate(terms.start_date) ?? "?"} → ${niceDate(terms.deadline) ?? "?"}`
      : null;
  const advance =
    terms.advance_inr === null
      ? null
      : terms.advance_inr === 0
        ? "No advance"
        : rupees(terms.advance_inr);

  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <p className="text-xs text-muted">Agreement</p>
          <p className="font-mono text-sm font-semibold">
            {terms.agreement_id}
          </p>
        </div>
        <StatusBadge status={terms.status} />
      </header>

      <div className="grid grid-cols-2 gap-3 px-4 pt-4 text-sm">
        <div className="min-w-0 rounded-xl bg-background p-3">
          <p className="text-xs text-muted">Client</p>
          <p className="truncate font-semibold">{client.name ?? "Not given"}</p>
          {client.phone && <p className="text-xs text-muted">{client.phone}</p>}
        </div>
        <div className="min-w-0 rounded-xl bg-background p-3">
          <p className="text-xs text-muted">
            Worker{worker.trade ? ` · ${worker.trade}` : ""}
          </p>
          <p className="truncate font-semibold">{worker.name ?? "Not given"}</p>
          {worker.phone && <p className="text-xs text-muted">{worker.phone}</p>}
          {worker.eshram_linked && (
            <span className="mt-1 inline-block rounded bg-leaf-soft px-1.5 py-0.5 text-[11px] font-semibold text-leaf">
              e-Shram linked
            </span>
          )}
        </div>
      </div>

      <dl className="px-4 py-2">
        <Term
          index={0}
          label="Work"
          value={terms.scope}
          quotes={quotes("scope")}
        />
        <Term
          index={1}
          label="Price"
          value={rupees(terms.price_inr)}
          quotes={quotes("price_inr")}
        />
        <Term
          index={2}
          label="Advance"
          value={advance}
          quotes={quotes("advance_inr")}
        />
        <Term
          index={3}
          label="Materials"
          value={
            terms.materials_provided_by
              ? MATERIALS_LABEL[terms.materials_provided_by]
              : null
          }
          quotes={quotes("materials_provided_by")}
        />
        <Term
          index={4}
          label="Dates"
          value={dates}
          quotes={quotes("start_date", "deadline")}
        />
        {terms.conditions.length > 0 && (
          <Term
            index={5}
            label="Conditions"
            value={terms.conditions.join(" ")}
            quotes={quotes("conditions")}
          />
        )}
      </dl>

      {terms.ambiguities.length > 0 && (
        <section className="space-y-2 border-t border-line bg-background px-4 py-4">
          <h3 className="text-sm font-semibold text-saffron-ink">
            {terms.ambiguities.length === 1
              ? "1 thing to settle"
              : `${terms.ambiguities.length} things to settle`}
          </h3>
          {terms.ambiguities.map((a) => (
            <Question key={a.field + a.question_en} a={a} onAnswer={onAnswer} />
          ))}
        </section>
      )}
    </article>
  );
}
