/**
 * SYNTHETIC data for the governance dashboard prototype. Not real statistics.
 * Live mode: aggregated server-side from sealed agreements, k-anonymised (no cell with < 10 agreements).
 */

export const STATES = ["Delhi", "Maharashtra", "Karnataka"] as const;
export const TRADES = ["All trades", "Painter", "Plumber", "Electrician", "Carpenter", "Mason", "Driver", "Domestic worker"] as const;
export const PERIODS = [
  { id: "3m", label: "3 months", months: 3 },
  { id: "6m", label: "6 months", months: 6 },
  { id: "12m", label: "12 months", months: 12 },
] as const;

export type StateName = (typeof STATES)[number];
export type Trade = (typeof TRADES)[number];

const DISTRICTS: Record<StateName, string[]> = {
  Delhi: ["New Delhi", "South Delhi", "West Delhi", "East Delhi", "North West Delhi", "Shahdara", "North East Delhi"],
  Maharashtra: ["Mumbai City", "Mumbai Suburban", "Pune", "Thane", "Nagpur", "Nashik", "Aurangabad"],
  Karnataka: ["Bengaluru Urban", "Mysuru", "Mangaluru", "Hubballi-Dharwad", "Belagavi", "Kalaburagi", "Ballari"],
};
const BASE_DELAY = [2.4, 3.1, 4.6, 5.4, 6.8, 7.9, 8.3];
const WAGE: Record<Exclude<Trade, "All trades">, number> = {
  Painter: 780, Plumber: 850, Electrician: 900, Carpenter: 820, Mason: 760, Driver: 700, "Domestic worker": 450,
};
const STATE_F: Record<StateName, number> = { Delhi: 1, Maharashtra: 1.08, Karnataka: 1.04 };
const TRADE_F = (t: Trade) => (t === "All trades" ? 1 : 0.85 + (t.length % 5) * 0.07);

export function dashboardData(state: StateName, trade: Trade, months: number) {
  const sf = STATE_F[state];
  const tf = TRADE_F(trade);
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (11 - i));
    return {
      label: d.toLocaleDateString("en-IN", { month: "short" }),
      value: Math.round((140 + i * i * 17 + i * 40) * sf * (trade === "All trades" ? 1 : 0.18 * tf)),
    };
  }).slice(12 - months);

  const wages = (Object.keys(WAGE) as (keyof typeof WAGE)[])
    .map((t) => ({ label: t, value: Math.round((WAGE[t] * sf) / 10) * 10 }))
    .sort((a, b) => b.value - a.value);

  const delays = DISTRICTS[state]
    .map((d, i) => ({ label: d, value: Math.round(BASE_DELAY[i] * tf * (2 - sf) * 10) / 10 }))
    .sort((a, b) => b.value - a.value);

  const disputes = [
    { label: "Scope not agreed", value: 34 },
    { label: "Advance not adjusted", value: 22 },
    { label: "Late payment", value: 19 },
    { label: "Quality of work", value: 14 },
    { label: "Deadline missed", value: 11 },
  ].map((x, i) => ({ ...x, value: Math.max(4, Math.round(x.value * (i === 0 ? tf : 1))) }));

  const total = monthly.reduce((s, m) => s + m.value, 0);
  const medianWage = trade === "All trades" ? Math.round(780 * sf) : Math.round(WAGE[trade] * sf);
  return {
    monthly,
    wages,
    delays,
    disputes,
    kpis: {
      agreements: total,
      medianWage,
      onTime: Math.round(71 * (2 - tf) * 10) / 10,
      disputeRate: Math.round(6.2 * tf * 10) / 10,
      avgDelay: Math.round((delays.reduce((s, d) => s + d.value, 0) / delays.length) * 10) / 10,
    },
  };
}
