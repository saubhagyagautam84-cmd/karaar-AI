import Link from "next/link";
import { Check } from "lucide-react";
import type { Severity, Status } from "@/lib/types";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Logo({ size = 36, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
        <rect width="40" height="40" rx="11" fill="#E8762B" />
        <path d="M9 12.5a4 4 0 0 1 4-4h14a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-8.5L12 31.5v-5h1a4 4 0 0 1-4-4z" fill="#1B2A41" />
        <path d="m15 17.6 3.4 3.4 6.6-6.6" fill="none" stroke="#FFF4EA" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {withText && (
        <span className="font-display text-xl font-bold tracking-tight text-navy">
          Karaar<span className="text-saffron"> AI</span>
        </span>
      )}
    </span>
  );
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  review: { label: "In review", cls: "bg-amber-soft text-amber-ink border-amber-ink/20" },
  awaiting_confirmation: { label: "Awaiting confirmation", cls: "bg-saffron-soft text-saffron-ink border-saffron/30" },
  sealed: { label: "Sealed", cls: "bg-saffron text-navy border-saffron" },
  advance_paid: { label: "Advance paid", cls: "bg-leaf-soft text-leaf border-leaf/30" },
  completed: { label: "Completed", cls: "bg-leaf text-white border-leaf" },
  disputed: { label: "Disputed", cls: "bg-alert-soft text-alert border-alert/30" },
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold", s.cls)}>{s.label}</span>;
}

const SEV: Record<Severity, { label: string; cls: string }> = {
  high: { label: "High risk", cls: "bg-alert-soft text-alert" },
  medium: { label: "Needs clarity", cls: "bg-amber-soft text-amber-ink" },
  low: { label: "Suggestion", cls: "bg-navy-line/60 text-navy-body" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEV[severity];
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", s.cls)}>{s.label}</span>;
}

const STEPS = ["Record", "Review", "Confirm", "Sealed"];

export function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="Progress">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                done && "bg-leaf text-white",
                active && "bg-navy text-cream ring-4 ring-saffron/30",
                !done && !active && "bg-cream text-navy-muted border border-line",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check size={14} strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("hidden text-sm font-semibold sm:inline", active ? "text-navy" : "text-navy-muted")}>{s}</span>
            {i < STEPS.length - 1 && <span className={cn("h-0.5 flex-1 rounded", done ? "bg-leaf" : "bg-line")} />}
          </li>
        );
      })}
    </ol>
  );
}

export function PageHeader({ eyebrow, title, sub, action }: { eyebrow?: string; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <h1 className="font-display text-2xl font-bold tracking-tight text-navy sm:text-3xl">{title}</h1>
        {sub && <p className="mt-1.5 max-w-2xl text-navy-body">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div className="card flex flex-col items-center gap-3 py-12 text-center">
      <Logo size={44} withText={false} />
      <h2 className="font-display text-lg font-bold">{title}</h2>
      <p className="max-w-sm text-navy-body">{body}</p>
      <Link href={href} className="btn-primary mt-2">{cta}</Link>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center" role="status">
      <span className="h-10 w-10 animate-spin rounded-full border-4 border-saffron/25 border-t-saffron" />
      <p className="font-semibold text-navy">{label}</p>
    </div>
  );
}
