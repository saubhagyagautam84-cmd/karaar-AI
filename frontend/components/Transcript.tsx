import { findAmounts, inr } from "@/lib/numbers";
import type { Flag, Party, Segment } from "@/lib/types";
import { cn } from "./ui";

function Highlighted({ text }: { text: string }) {
  const amounts = findAmounts(text);
  if (!amounts.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let rest = text;
  amounts.forEach((a, i) => {
    const idx = rest.indexOf(a.raw);
    if (idx < 0) return;
    parts.push(rest.slice(0, idx));
    parts.push(
      <mark key={i} className="rounded bg-saffron-soft px-1 text-navy" title={`Normalised to ${inr(a.value)}`}>
        {a.raw} <span className="text-xs font-bold text-saffron-ink">= {inr(a.value)}</span>
      </mark>,
    );
    rest = rest.slice(idx + a.raw.length);
  });
  parts.push(rest);
  return <>{parts}</>;
}

export function Transcript({ segments, worker, hirer, flags = [] }: { segments: Segment[]; worker: Party; hirer: Party; flags?: Flag[] }) {
  const flagged = new Set(flags.filter((f) => !f.resolved && f.evidence).map((f) => f.evidence));
  return (
    <ol className="space-y-3">
      {segments.map((s, i) => {
        const isWorker = s.speaker === "worker";
        const who = isWorker ? worker.name : hirer.name;
        return (
          <li key={i} className={cn("flex gap-2.5", isWorker && "flex-row-reverse text-right")}>
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                isWorker ? "bg-saffron text-navy" : "bg-navy text-cream",
              )}
              aria-hidden
            >
              {who.slice(0, 1).toUpperCase()}
            </span>
            <div className={cn("max-w-[85%]", isWorker && "items-end")}>
              <p className="mb-0.5 text-xs font-semibold text-navy-muted">
                {who} · {String(Math.floor(s.t / 60)).padStart(1, "0")}:{String(s.t % 60).padStart(2, "0")}
              </p>
              <p
                className={cn(
                  "inline-block rounded-2xl px-3.5 py-2 text-left leading-relaxed",
                  isWorker ? "rounded-tr-sm bg-cream" : "rounded-tl-sm border border-line bg-paper",
                  flagged.has(s.text) && "underline decoration-amber-ink decoration-wavy decoration-2 underline-offset-4",
                )}
              >
                <Highlighted text={s.text} />
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
