"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Download, FileCheck2, FlaskConical, IndianRupee, Scale, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { ChartCard, HBars, TrendLine } from "@/components/charts";
import { PERIODS, STATES, TRADES, dashboardData, type StateName, type Trade } from "@/lib/dashboard-data";
import { DEMO_MODE, fetchDashboard, type Dashboard as LiveDashboard } from "@/lib/api";

const num = (n: number) => n.toLocaleString("en-IN");

export default function Dashboard() {
  const [state, setState] = useState<StateName>("Delhi");
  const [trade, setTrade] = useState<Trade>("All trades");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>("12m");
  const months = PERIODS.find((p) => p.id === period)!.months;
  const local = useMemo(() => dashboardData(state, trade, months), [state, trade, months]);
  // Live mode: k-anonymised aggregates from the backend (synthetic rows + real sealed agreements).
  const [live, setLive] = useState<{ key: string; data: LiveDashboard | null } | null>(null);
  const key = `${state}|${trade}|${months}`;
  useEffect(() => {
    if (DEMO_MODE) return;
    let alive = true;
    fetchDashboard(state, trade, months)
      .then((data) => alive && setLive({ key, data }))
      .catch(() => alive && setLive({ key, data: null }));
    return () => {
      alive = false;
    };
  }, [state, trade, months, key]);
  const serverData = live?.key === key ? live.data : undefined;
  const usable = serverData && serverData.monthly.length && serverData.wages.length && serverData.delays.length && serverData.disputes.length;
  const d = usable ? serverData : local;
  const realCount = usable ? serverData.meta?.real ?? 0 : 0;
  const loading = !DEMO_MODE && live?.key !== key;

  function exportCsv() {
    const rows = [
      ["section", "label", "value"],
      ...d.monthly.map((m) => ["agreements_per_month", m.label, m.value]),
      ...d.wages.map((m) => ["median_daily_wage_inr", m.label, m.value]),
      ...d.delays.map((m) => ["avg_payment_delay_days", m.label, m.value]),
      ...d.disputes.map((m) => ["dispute_reason_pct", m.label, m.value]),
    ];
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `karaar-${state.toLowerCase()}-${period}-synthetic.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Governance layer · labour departments"
        title="Informal work, finally visible"
        sub="Anonymised aggregates from sealed agreements. No names, no phone numbers; cells under 10 agreements are suppressed."
        action={
          <button className="btn-ghost py-2 text-sm" onClick={exportCsv}>
            <Download size={16} /> Export CSV
          </button>
        }
      />

      <p className="mb-5 flex items-center gap-2 rounded-xl border border-amber-ink/20 bg-amber-soft px-4 py-2.5 text-sm font-semibold text-amber-ink">
        <FlaskConical size={16} className="shrink-0" />{" "}
        {DEMO_MODE || !usable
          ? loading
            ? "Loading aggregates from the server…"
            : `Synthetic data for the prototype. Not real statistics.${DEMO_MODE ? "" : " (Server not reachable: showing built-in data.)"}`
          : `Synthetic data for the prototype, plus ${realCount} sealed agreement${realCount === 1 ? "" : "s"} from this app. Aggregated server-side; not real statistics.`}
      </p>

      {/* Filters: one row above the charts */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Select label="State" value={state} onChange={(v) => setState(v as StateName)} options={STATES as unknown as string[]} />
        <Select label="Trade" value={trade} onChange={(v) => setTrade(v as Trade)} options={TRADES as unknown as string[]} />
        <div>
          <p className="label">Period</p>
          <div className="flex rounded-xl border border-line bg-white p-1" role="group" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                aria-pressed={period === p.id}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${period === p.id ? "bg-navy text-cream" : "text-navy-muted hover:text-navy"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Key figures">
        <Kpi icon={<FileCheck2 size={18} />} label="Agreements sealed" value={num(d.kpis.agreements)} />
        <Kpi icon={<IndianRupee size={18} />} label="Median daily wage" value={`₹${num(d.kpis.medianWage)}`} />
        <Kpi icon={<CalendarClock size={18} />} label="Paid on time" value={`${d.kpis.onTime}%`} />
        <Kpi icon={<Scale size={18} />} label="Dispute rate" value={`${d.kpis.disputeRate}%`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Agreements sealed per month" sub={`${state} · ${trade}`} data={d.monthly} format={num} className="lg:col-span-2">
          <TrendLine data={d.monthly} format={(n) => `${num(n)} agreements`} />
        </ChartCard>
        <ChartCard title="Median agreed daily wage by trade" sub={`${state}, ₹ per day`} data={d.wages} format={(n) => `₹${num(n)}`}>
          <HBars data={d.wages} format={(n) => `₹${num(n)}`} />
        </ChartCard>
        <ChartCard title="Payment-delay hotspots" sub="Average days from completion to final payment" data={d.delays} format={(n) => `${n} days`}>
          <HBars data={d.delays} format={(n) => `${n} days`} threshold={6} thresholdLabel="Hotspot: 6+ days average delay" />
        </ChartCard>
        <ChartCard title="Why disputes happen" sub="Share of raised disputes, by main reason" data={d.disputes} format={(n) => `${n}%`}>
          <HBars data={d.disputes} format={(n) => `${n}%`} />
        </ChartCard>
        <section className="card flex flex-col justify-between bg-navy text-cream" aria-label="Policy signals">
          <div>
            <h2 className="font-display text-base font-bold">Policy signals</h2>
            <ul className="mt-3 space-y-3 text-sm text-navy-line">
              <li>
                <b className="text-cream">{d.delays[0].label}</b> has the longest average payment delay ({d.delays[0].value} days). Candidate for targeted outreach.
              </li>
              <li>
                <b className="text-cream">“{d.disputes[0].label}”</b> drives {d.disputes[0].value}% of disputes. Karaar&apos;s ambiguity detector targets exactly this.
              </li>
              <li>
                Lowest median wage: <b className="text-cream">{d.wages[d.wages.length - 1].label}</b> at ₹{num(d.wages[d.wages.length - 1].value)}/day. Compare against the notified minimum wage.
              </li>
            </ul>
          </div>
          <p className="mt-4 flex items-center gap-2 text-xs text-navy-line">
            <ShieldCheck size={14} className="text-saffron" /> k-anonymised · aggregated server-side · no individual records leave the system
          </p>
        </section>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  const id = `f-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <select id={id} className="input w-auto py-2" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-navy-muted">
        <span className="text-saffron-ink">{icon}</span>
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
