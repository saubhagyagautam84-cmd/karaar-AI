"use client";

import Link from "next/link";
import { ChevronRight, Plus, RotateCcw } from "lucide-react";
import { EmptyState, PageHeader, Spinner, StatusBadge } from "@/components/ui";
import { useAgreements } from "@/lib/store";
import { inr } from "@/lib/numbers";
import { fmtDate } from "@/lib/summary";

export default function Deals() {
  const { ready, agreements, reset } = useAgreements();
  if (!ready) return <Spinner label="Loading agreements…" />;

  return (
    <div>
      <PageHeader
        eyebrow="Agreements · करार"
        title="Every deal, on record"
        action={
          <div className="flex gap-2">
            <button className="btn-ghost py-2 text-sm" onClick={() => confirm("Reset demo data?") && reset()} title="Reset demo data">
              <RotateCcw size={16} /> Reset demo
            </button>
            <Link href="/new" className="btn-primary py-2 text-sm">
              <Plus size={16} /> New deal
            </Link>
          </div>
        }
      />
      {agreements.length === 0 ? (
        <EmptyState title="No agreements yet" body="Record your first deal. It takes about a minute." href="/new" cta="Start a deal" />
      ) : (
        <ul className="space-y-3">
          {agreements.map((a) => {
            const href = a.status === "review" ? `/deals/${a.id}/review` : a.status === "awaiting_confirmation" ? `/deals/${a.id}/confirm` : `/deals/${a.id}`;
            return (
              <li key={a.id}>
                <Link href={href} className="card flex items-center gap-4 transition hover:-translate-y-0.5 hover:shadow-lift">
                  <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cream font-display text-sm font-bold text-saffron-ink sm:flex">
                    {a.terms.jobType.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display font-bold">{a.terms.jobType}</p>
                      <StatusBadge status={a.status} />
                    </div>
                    <p className="truncate text-sm text-navy-body">
                      {a.worker.name} ↔ {a.hirer.name}
                      {a.terms.location ? ` · ${a.terms.location}` : ""}
                    </p>
                    <p className="text-xs text-navy-muted">
                      {a.id} · {fmtDate(a.createdAt)}
                    </p>
                  </div>
                  <p className="font-display text-lg font-bold">{inr(a.terms.price)}</p>
                  <ChevronRight className="text-navy-muted" size={20} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
