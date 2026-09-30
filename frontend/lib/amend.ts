/**
 * Change orders (A3): extract only what changed from a short conversation.
 * Deterministic rules (demo mode); the backend's POST /v1/amendments/extract runs the same rules
 * (and, when an LLM is configured, validates its output against them).
 */
import type { Agreement, Amendment, Bilingual, Milestone, Segment, Terms, TermsDelta } from "./types";
import { findAmounts, findDays } from "./numbers";

const SCOPE_WORDS: { re: RegExp; item: Bilingual }[] = [
  { re: /balcony|balkani/i, item: { en: "Balcony", hi: "बालकनी" } },
  { re: /ceiling|chhat|chhath/i, item: { en: "Ceilings", hi: "छत" } },
  { re: /\bgate\b/i, item: { en: "Main gate", hi: "मेन गेट" } },
  { re: /grill|jaali/i, item: { en: "Window grills", hi: "खिड़की की ग्रिल" } },
  { re: /door|darwaz/i, item: { en: "Doors", hi: "दरवाज़े" } },
  { re: /kitchen|rasoi/i, item: { en: "Kitchen", hi: "किचन" } },
  { re: /bathroom|toilet|washroom/i, item: { en: "Bathroom", hi: "बाथरूम" } },
  { re: /\bhall\b|living/i, item: { en: "Hall / living room", hi: "हॉल" } },
  { re: /(ek|do|teen|1|2|3)?\s*(aur|extra|more)?\s*bedroom/i, item: { en: "Extra bedroom", hi: "एक और बेडरूम" } },
  { re: /pipe|tap|\bnal\b/i, item: { en: "Extra plumbing point", hi: "एक और नल/पाइप" } },
  { re: /switch|socket|fan|pankha/i, item: { en: "Extra electrical point", hi: "एक और बिजली पॉइंट" } },
];
const REMOVE = /\b(nahi|nahin|mat|hata|remove|cancel|chhod|skip|no longer|drop)\b/i;
const LESS = /\b(kam|less|minus|ghata|discount|chhoot)\b/i;

export function extractDelta(segments: Segment[]): TermsDelta {
  const text = segments.map((s) => s.text).join(" ");
  const removing = REMOVE.test(text);
  const items = SCOPE_WORDS.filter((w) => w.re.test(text)).map((w) => w.item);
  const amount = segments.flatMap((s) => findAmounts(s.text))[0]?.value ?? 0;
  const days = segments.map((s) => findDays(s.text)).find((d) => d !== null) ?? 0;
  const priceChange = amount ? (LESS.test(text) || removing ? -amount : amount) : 0;
  return {
    addScope: removing ? [] : items,
    removeScope: removing ? items : [],
    priceChange,
    extraDays: removing && days ? -days : days,
    note: text.length > 160 ? text.slice(0, 157) + "…" : text,
  };
}

/** When the agreement pays by milestones, a price increase becomes its own milestone. */
export function withMilestoneForChange(delta: TermsDelta, terms: Terms, index: number): TermsDelta {
  if (!terms.milestones?.length || delta.priceChange <= 0) return delta;
  const label = delta.addScope.map((s) => s.en).join(", ") || "Change";
  const labelHi = delta.addScope.map((s) => s.hi).join(", ") || "बदलाव";
  const m: Milestone = { id: `c${index}`, title: `${label} (change)`, titleHi: `${labelHi} (बदलाव)`, amount: delta.priceChange };
  return { ...delta, addMilestones: [m] };
}

/** One-line human summary, e.g. "+ Balcony · + ₹2,000 · + 1 day". */
export function describeDelta(d: TermsDelta, lang: "en" | "hi" = "en"): string {
  const parts: string[] = [];
  d.addScope.forEach((s) => parts.push(`+ ${lang === "hi" ? s.hi : s.en}`));
  d.removeScope.forEach((s) => parts.push(`− ${lang === "hi" ? s.hi : s.en}`));
  if (d.priceChange) parts.push(`${d.priceChange > 0 ? "+" : "−"} ₹${Math.abs(d.priceChange).toLocaleString("en-IN")}`);
  if (d.extraDays) {
    const n = Math.abs(d.extraDays);
    parts.push(`${d.extraDays > 0 ? "+" : "−"} ${n} ${lang === "hi" ? "दिन" : n === 1 ? "day" : "days"}`);
  }
  return parts.join(" · ") || (lang === "hi" ? "कोई बदलाव नहीं" : "No change detected");
}

/** The hash the next amendment must chain to. */
export function chainHead(a: Agreement): string {
  const sealed = (a.amendments ?? []).filter((am) => am.hash);
  return sealed.length ? (sealed[sealed.length - 1].hash as string) : (a.hash as string);
}

export function nextAmendmentId(a: Agreement): string {
  return `${a.id}-A${(a.amendments?.length ?? 0) + 1}`;
}

export function openAmendment(a: Agreement): Amendment | undefined {
  return (a.amendments ?? []).find((am) => !am.hash);
}
