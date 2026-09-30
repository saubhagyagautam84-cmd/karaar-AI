export function rupees(amount: number | null): string | null {
  return amount === null ? null : `₹${amount.toLocaleString("en-IN")}`;
}

/** "2026-10-01" -> "Thu, 1 Oct 2026" (parsed as a local date, not UTC). */
export function niceDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export const MATERIALS_LABEL = {
  client: "Client brings them",
  worker: "Worker brings them",
  shared: "Shared by both",
} as const;

export const TRADES = [
  "painter",
  "plumber",
  "electrician",
  "carpenter",
  "domestic help",
  "driver",
] as const;

export const DISTRICTS = [
  "Central Delhi",
  "East Delhi",
  "New Delhi",
  "North Delhi",
  "North West Delhi",
  "Shahdara",
  "South Delhi",
  "West Delhi",
] as const;

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent for confirmation",
  CONFIRMED_BY_ONE: "Confirmed by one",
  CONFIRMED_BY_BOTH: "Pakka: confirmed by both",
  ADVANCE_PAID: "Advance paid",
  IN_PROGRESS: "Work in progress",
  COMPLETED: "Completed",
  DISPUTED: "Disputed",
  RESOLVED: "Resolved",
  ESCALATED: "Escalated",
};
