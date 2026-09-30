"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { fmtDateTime } from "@/lib/summary";
import type { Agreement, RatingSet } from "@/lib/types";
import { cn } from "./ui";

type Key = "onTime" | "fair" | "respectful";
const ASPECTS: { key: Key; en: string; hi: string }[] = [
  { key: "onTime", en: "On time", hi: "समय पर" },
  { key: "fair", en: "Fair with money", hi: "पैसे में ईमानदार" },
  { key: "respectful", en: "Respectful", hi: "इज़्ज़त से बात" },
];

/** B4: after the job, each person rates the other. Ratings live outside the sealed record. */
export function RatingPanel({ a, onChange }: { a: Agreement; onChange: (a: Agreement) => void }) {
  if (a.status !== "completed") return null;
  const rate = (by: "byHirer" | "byWorker", r: RatingSet) => {
    const who = by === "byHirer" ? a.hirer.name : a.worker.name;
    const avg = Math.round(((r.onTime + r.fair + r.respectful) / 3) * 10) / 10;
    onChange({
      ...a,
      ratings: { ...a.ratings, [by]: r },
      rating: by === "byHirer" ? Math.round(avg) : a.rating,
      events: [...a.events, { at: r.at, label: `${who} left a rating`, detail: `${avg} / 5` }],
    });
  };
  return (
    <section className="card space-y-4" aria-label="Ratings">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <Star size={20} className="text-saffron-ink" /> Rate each other <span className="font-sans text-sm font-normal text-navy-muted">· रेटिंग</span>
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <RateBox title={`${a.hirer.name} rates ${a.worker.name}`} value={a.ratings?.byHirer} onSubmit={(r) => rate("byHirer", r)} />
        <RateBox title={`${a.worker.name} rates ${a.hirer.name}`} value={a.ratings?.byWorker} onSubmit={(r) => rate("byWorker", r)} />
      </div>
      <p className="text-xs text-navy-muted">Ratings are kept next to the sealed record, never inside it, and cannot be edited once given.</p>
    </section>
  );
}

function RateBox({ title, value, onSubmit }: { title: string; value?: RatingSet; onSubmit: (r: RatingSet) => void }) {
  const [draft, setDraft] = useState<Record<Key, number>>({ onTime: 0, fair: 0, respectful: 0 });
  const done = Boolean(value);
  const shown = value ?? draft;
  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      {ASPECTS.map(({ key, en, hi }) => (
        <div key={key} className="flex items-center justify-between gap-2 py-1">
          <span className="text-sm">
            {en} <span className="text-navy-muted">· {hi}</span>
          </span>
          <div className="flex" role="radiogroup" aria-label={`${title}: ${en}`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={shown[key] === n}
                aria-label={`${n} of 5`}
                disabled={done}
                onClick={() => setDraft((d) => ({ ...d, [key]: n }))}
                className="p-0.5 disabled:cursor-default"
              >
                <Star size={20} className={n <= shown[key] ? "fill-saffron text-saffron" : "text-line"} />
              </button>
            ))}
          </div>
        </div>
      ))}
      {done ? (
        <p className="mt-2 text-xs text-leaf">Rated {fmtDateTime(value?.at)}</p>
      ) : (
        <button
          type="button"
          className={cn("btn-primary mt-2 w-full py-2 text-sm")}
          disabled={!draft.onTime || !draft.fair || !draft.respectful}
          onClick={() => onSubmit({ ...draft, at: new Date().toISOString() })}
        >
          Save rating
        </button>
      )}
    </div>
  );
}
