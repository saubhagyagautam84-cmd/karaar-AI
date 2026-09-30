"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DELAY_BINS, type DistrictDelay } from "@/lib/delay";
import { api, errorText } from "@/lib/api";
import { rupees } from "@/lib/format";

const DelayMap = dynamic(() => import("@/components/DelayMap"), {
  ssr: false,
  loading: () => (
    <div className="h-80 animate-pulse rounded-xl bg-background" />
  ),
});

interface Cell {
  trade: string;
  district: string;
  n: number | null;
  median_inr: number | null;
  suppressed: boolean;
}

interface Analytics {
  summary: {
    k: number;
    agreements: number;
    median_price_inr: number | null;
    delayed_pct: number | null;
    dispute_pct: number | null;
    districts: number;
    trades: number;
  };
  wages: {
    by_trade: {
      trade: string;
      n: number | null;
      median_inr: number | null;
      suppressed: boolean;
    }[];
    grid: Cell[];
    districts: string[];
    trades: string[];
  };
  delays: { late_after_days: number; districts: DistrictDelay[] };
  disputes: {
    weeks: {
      week_start: string;
      n: number | null;
      dispute_pct: number | null;
      suppressed: boolean;
    }[];
  };
}

const HIDDEN = "Hidden: fewer than 10 agreements";
const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  color: "var(--foreground)",
  fontSize: 13,
};
const axisTick = { fill: "var(--muted)", fontSize: 12 };

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function TableView({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-muted">
        Show as table
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left tabular-nums">
          <thead>
            <tr className="border-b border-line text-muted">
              {head.map((h) => (
                <th key={h} className="py-1 pr-3 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line/60">
                {r.map((c, j) => (
                  <td key={j} className="py-1 pr-3">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const shortWeek = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });

function heatStep(value: number, min: number, max: number): number {
  if (max <= min) return 3;
  return 1 + Math.min(5, Math.floor(((value - min) / (max - min)) * 6));
}

function DisputeChart({ weeks }: { weeks: Analytics["disputes"]["weeks"] }) {
  const pct = (v: number | null) => (v === null ? "Hidden" : `${v}%`);
  return (
    <>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={weeks}
            margin={{ left: 0, right: 16, top: 8, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="week_start"
              tickFormatter={shortWeek}
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              tickFormatter={(v) => `${v}%`}
              tick={axisTick}
              axisLine={false}
              tickLine={false}
              width={40}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
              contentStyle={tooltipStyle}
              labelFormatter={(l) => `Week of ${shortWeek(String(l))}`}
              formatter={(v, _n, item) =>
                item.payload.suppressed
                  ? ["Hidden (<10)", "Disputes"]
                  : [`${v}% of ${item.payload.n}`, "Disputes"]
              }
            />
            <Line
              type="linear"
              dataKey="dispute_pct"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={{
                r: 4,
                fill: "var(--series-1)",
                stroke: "var(--surface)",
                strokeWidth: 2,
              }}
              activeDot={{ r: 6 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <TableView
        head={["Week of", "Dispute rate", "Agreements"]}
        rows={weeks.map((w) => [
          shortWeek(w.week_start),
          pct(w.dispute_pct),
          w.n ?? "<10",
        ])}
      />
    </>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);

  useEffect(() => {
    api
      .get<Analytics>("/api/analytics/all")
      .then(setData)
      .catch((e) => setError(errorText(e)));
  }, []);

  if (error) {
    return (
      <p className="rounded-xl bg-danger-soft px-4 py-3 font-medium text-danger">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface" />
        ))}
      </div>
    );
  }

  const { summary, wages, delays, disputes } = data;
  const shownTrades = wages.by_trade.filter((t) => !t.suppressed);
  // Each trade's grid row is shaded against its own range: a painter and a plumber are not the same scale.
  const rangeByTrade = Object.fromEntries(
    wages.trades.map((t) => {
      const vals = wages.grid
        .filter((c) => c.trade === t && c.median_inr)
        .map((c) => c.median_inr as number);
      return [t, [Math.min(...vals), Math.max(...vals)]];
    }),
  );
  const pct = (v: number | null) => (v === null ? "Hidden" : `${v}%`);

  return (
    <div className="relative left-1/2 w-screen max-w-5xl -translate-x-1/2 space-y-5 px-4">
      <header>
        <p className="text-xs font-semibold tracking-wide text-leaf uppercase">
          Governance view · Delhi · last 90 days
        </p>
        <h1 className="text-2xl font-bold">Informal work, in real numbers</h1>
        <p className="mt-1 text-sm text-muted">
          Anonymised aggregates only. Any group with fewer than {summary.k}{" "}
          agreements is hidden, so no person or household can be picked out.
          Demo data is synthetic.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Agreements"
          value={summary.agreements.toLocaleString("en-IN")}
          note={`${summary.districts} districts · ${summary.trades} trades`}
        />
        <Tile
          label="Median agreed price"
          value={rupees(summary.median_price_inr) ?? "Hidden"}
          note="all trades"
        />
        <Tile
          label="Payments late"
          value={pct(summary.delayed_pct)}
          note={`paid over ${delays.late_after_days} days after the work`}
        />
        <Tile
          label="Disputes"
          value={pct(summary.dispute_pct)}
          note="of agreed jobs"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Median agreed price by trade"
          subtitle="What households actually agreed to pay, per job or per month"
        >
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={shownTrades}
                layout="vertical"
                margin={{ left: 8, right: 72, top: 4, bottom: 4 }}
              >
                <CartesianGrid horizontal={false} stroke="var(--grid)" />
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="trade"
                  width={104}
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--line)", opacity: 0.4 }}
                  contentStyle={tooltipStyle}
                  formatter={(v, _n, item) => [
                    `${rupees(Number(v))} · ${item.payload.n} agreements`,
                    "Median",
                  ]}
                />
                <Bar
                  dataKey="median_inr"
                  fill="var(--series-1)"
                  radius={[0, 4, 4, 0]}
                  barSize={18}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="median_inr"
                    position="right"
                    formatter={(v) => rupees(Number(v)) ?? ""}
                    style={{
                      fill: "var(--foreground)",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <TableView
            head={["Trade", "Median", "Agreements"]}
            rows={wages.by_trade.map((t) => [
              t.trade,
              rupees(t.median_inr) ?? "Hidden",
              t.n ?? "<10",
            ])}
          />
        </Card>

        <Card
          title="Dispute trend"
          subtitle="Share of agreements disputed, by the week they were made"
        >
          <DisputeChart weeks={disputes.weeks} />
        </Card>
      </div>

      <Card
        title="Median price by trade and district"
        subtitle="Darker = higher within that trade. Hatched cells have fewer than 10 agreements and are hidden."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-xs tabular-nums">
            <thead>
              <tr>
                <th />
                {wages.districts.map((d) => (
                  <th
                    key={d}
                    className="px-1 pb-1 text-left font-semibold text-muted"
                  >
                    {d === "New Delhi" ? d : d.replace(" Delhi", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wages.trades.map((t) => (
                <tr key={t}>
                  <th className="pr-2 text-left font-semibold whitespace-nowrap text-muted capitalize">
                    {t}
                  </th>
                  {wages.districts.map((d) => {
                    const c = wages.grid.find(
                      (g) => g.trade === t && g.district === d,
                    )!;
                    const step = c.median_inr
                      ? heatStep(
                          c.median_inr,
                          rangeByTrade[t][0],
                          rangeByTrade[t][1],
                        )
                      : 0;
                    return (
                      <td
                        key={d}
                        tabIndex={0}
                        onMouseEnter={() => setHover(c)}
                        onFocus={() => setHover(c)}
                        onMouseLeave={() => setHover(null)}
                        title={
                          c.suppressed
                            ? HIDDEN
                            : `${t}, ${d}: ${rupees(c.median_inr)} (${c.n} agreements)`
                        }
                        className={`h-10 rounded px-1.5 text-center font-semibold ${c.suppressed ? "suppressed text-muted" : ""}`}
                        style={
                          c.suppressed
                            ? undefined
                            : {
                                background: `var(--seq-${step})`,
                                color: step >= 4 ? "#fff" : "var(--foreground)",
                              }
                        }
                      >
                        {c.suppressed ? "–" : rupees(c.median_inr)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="min-h-5 text-sm text-muted" aria-live="polite">
          {hover
            ? hover.suppressed
              ? `${hover.trade}, ${hover.district}: ${HIDDEN.toLowerCase()}`
              : `${hover.trade}, ${hover.district}: median ${rupees(hover.median_inr)} from ${hover.n} agreements`
            : "Hover or tab to a cell for details."}
        </p>
      </Card>

      <Card
        title="Where payments run late"
        subtitle={`Share of completed jobs paid more than ${delays.late_after_days} days after the work was done`}
      >
        <DelayMap districts={delays.districts} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {DELAY_BINS.map((b) => (
            <span key={b.token} className="flex items-center gap-1.5">
              <span
                className="size-3 rounded-full"
                style={{ background: `var(${b.token})` }}
              />
              {b.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="suppressed size-3 rounded-full border border-line" />
            hidden (&lt;10)
          </span>
        </div>
        <TableView
          head={["District", "Late payments", "Completed jobs"]}
          rows={[...delays.districts]
            .sort((a, b) => (b.delayed_pct ?? -1) - (a.delayed_pct ?? -1))
            .map((d) => [d.district, pct(d.delayed_pct), d.n ?? "<10"])}
        />
      </Card>
    </div>
  );
}
