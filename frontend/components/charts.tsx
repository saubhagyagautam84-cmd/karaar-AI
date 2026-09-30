"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, Table2, TriangleAlert } from "lucide-react";
import { cn } from "./ui";

type Datum = { label: string; value: number };

/** Card wrapper with a chart/table toggle, so every chart has an accessible table view. */
export function ChartCard({
  title, sub, data, format, children, className,
}: { title: string; sub?: string; data: Datum[]; format: (n: number) => string; children: React.ReactNode; className?: string }) {
  const [table, setTable] = useState(false);
  return (
    <section className={cn("card", className)} aria-label={title}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold">{title}</h2>
          {sub && <p className="text-sm text-navy-muted">{sub}</p>}
        </div>
        <button
          onClick={() => setTable((t) => !t)}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-semibold text-navy-muted hover:text-navy"
          aria-pressed={table}
        >
          {table ? <BarChart3 size={14} /> : <Table2 size={14} />} {table ? "Chart" : "Table"}
        </button>
      </div>
      {table ? (
        <table className="w-full text-sm">
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-b border-line/60">
                <td className="py-1.5 text-navy-body">{d.label}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        children
      )}
    </section>
  );
}

/** Horizontal bars, single series. Hover a row for its value; the top bar is labelled directly. */
export function HBars({
  data, format, threshold, thresholdLabel,
}: { data: Datum[]; format: (n: number) => string; threshold?: number; thresholdLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value)) * 1.08;
  return (
    <ul className="space-y-1" onMouseLeave={() => setHover(null)}>
      {data.map((d, i) => {
        const hot = threshold !== undefined && d.value >= threshold;
        const show = hover === i || (hover === null && i === 0);
        return (
          <li
            key={d.label}
            className="grid cursor-default grid-cols-[minmax(0,9.5rem)_1fr] items-center gap-3 rounded-lg px-1 py-1 hover:bg-cream/70"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            tabIndex={0}
            aria-label={`${d.label}: ${format(d.value)}${hot ? `, ${thresholdLabel}` : ""}`}
          >
            <span className="flex items-center gap-1 truncate text-sm text-navy-body">
              {hot && <TriangleAlert size={13} className="shrink-0 text-alert" aria-hidden />}
              {d.label}
            </span>
            <span className="flex items-center gap-2">
              <span
                className={cn("h-4 rounded-r-[4px] transition-opacity", hot ? "bg-alert" : "bg-saffron-ink", hover !== null && hover !== i && "opacity-40")}
                style={{ width: `${(d.value / max) * 100}%`, minWidth: 4 }}
              />
              <span className={cn("whitespace-nowrap text-xs font-bold tabular-nums text-navy", !show && "invisible")}>{format(d.value)}</span>
            </span>
          </li>
        );
      })}
      {threshold !== undefined && (
        <li className="flex items-center gap-1.5 pt-2 text-xs text-navy-muted">
          <TriangleAlert size={13} className="text-alert" /> {thresholdLabel}
        </li>
      )}
    </ul>
  );
}

/** Single-series line with area, crosshair and tooltip. */
export function TrendLine({ data, format }: { data: Datum[]; format: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 240, L = 44, R = 12, T = 16, B = 28;
  const max = Math.max(...data.map((d) => d.value)) * 1.1;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, data.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const ticks = [0, 0.5, 1].map((f) => Math.round((max * f) / 100) * 100);
  const last = data.length - 1;
  const h = hover ?? last;

  return (
    <div className="relative" ref={box}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block max-w-full"
        role="img"
        aria-label={`Trend, from ${format(data[0].value)} to ${format(data[last].value)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - L) / (W - L - R)) * (data.length - 1));
          setHover(Math.max(0, Math.min(last, i)));
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#F0D6BF" strokeWidth={1} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#5E6A7C">
              {t >= 1000 ? `${(t / 1000).toFixed(t % 1000 ? 1 : 0)}k` : t}
            </text>
          </g>
        ))}
        {data.map((d, i) => (W < 520 && data.length > 6 && i % 2 === 1 && i !== last ? null : (
          <text key={d.label + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#5E6A7C">
            {d.label}
          </text>
        )))}
        <polygon points={`${L},${y(0)} ${pts} ${x(last)},${y(0)}`} fill="#1B2A41" opacity="0.07" />
        <polyline points={pts} fill="none" stroke="#1B2A41" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <line x1={x(h)} x2={x(h)} y1={T} y2={y(0)} stroke="#5E6A7C" strokeDasharray="3 3" strokeWidth={1} />
        <circle cx={x(h)} cy={y(data[h].value)} r={5} fill="#E8762B" stroke="#FFFDF9" strokeWidth={2} />
      </svg>
      <div
        className="pointer-events-none absolute top-0 rounded-lg bg-navy px-2.5 py-1.5 text-xs text-cream shadow-lift"
        style={{ left: `${(x(h) / W) * 100}%`, transform: `translateX(${h > last / 2 ? "-105%" : "5%"})` }}
      >
        <p className="font-bold">{format(data[h].value)}</p>
        <p className="opacity-80">{data[h].label}</p>
      </div>
    </div>
  );
}
