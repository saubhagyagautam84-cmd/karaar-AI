/**
 * Effective terms, milestones and money helpers.
 * The sealed terms never change; sealed amendments are applied on top, in order.
 */
import type { Agreement, Bilingual, Milestone, MilestoneProgress, Terms } from "./types";
import { balanceDue } from "./extract";

export const MAX_MILESTONES = 5;

/** Only sealed amendments count. */
export function sealedAmendments(a: Agreement) {
  return (a.amendments ?? []).filter((am) => am.hash);
}

/** The agreement's terms with every sealed change order and settlement applied. */
export function effectiveTerms(a: Agreement): Terms {
  let t: Terms = { ...a.terms, scope: [...a.terms.scope], excluded: [...a.terms.excluded], milestones: a.terms.milestones ? [...a.terms.milestones] : undefined };
  for (const am of sealedAmendments(a)) {
    const d = am.delta;
    const removed = new Set(d.removeScope.map((s) => s.en));
    t = {
      ...t,
      scope: [...t.scope.filter((s) => !removed.has(s.en)), ...d.addScope.filter((s) => !t.scope.some((x) => x.en === s.en))],
      excluded: [...t.excluded, ...d.removeScope.filter((s) => !t.excluded.some((x) => x.en === s.en))],
      price: t.price === null ? t.price : t.price + d.priceChange,
      durationDays: t.durationDays === null ? t.durationDays : t.durationDays + d.extraDays,
      deadline: t.deadline && d.extraDays ? addDays(t.deadline, d.extraDays) : t.deadline,
      milestones: d.addMilestones?.length ? [...(t.milestones ?? []), ...d.addMilestones] : t.milestones,
    };
  }
  return t;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** What the milestones must add up to: the balance due (price minus an adjusted advance). */
export function milestoneTarget(t: Terms): number {
  return balanceDue(t) ?? 0;
}

export function milestoneSum(ms: Milestone[] | undefined): number {
  return (ms ?? []).reduce((s, m) => s + (m.amount || 0), 0);
}

/** Null when valid; otherwise a plain-language reason (the review page blocks sealing on it). */
export function milestoneProblem(t: Terms): string | null {
  const ms = t.milestones;
  if (!ms || ms.length === 0) return null;
  if (ms.length > MAX_MILESTONES) return `Use at most ${MAX_MILESTONES} milestones.`;
  if (ms.some((m) => !m.title.trim())) return "Every milestone needs a name.";
  if (ms.some((m) => !(m.amount > 0))) return "Every milestone needs an amount above ₹0.";
  const target = milestoneTarget(t);
  const sum = milestoneSum(ms);
  if (sum !== target) {
    return `Milestones add up to ₹${sum.toLocaleString("en-IN")}, but the balance due is ₹${target.toLocaleString("en-IN")}.`;
  }
  return null;
}

const titleFor = (s: Bilingual): Bilingual => ({ en: `${s.en} done`, hi: `${s.hi} पूरा` });

/**
 * Suggest 2–5 milestones from the scope: one per scope item (the last one absorbs rounding),
 * amounts rounded to ₹500. Deterministic, so demo and live agree.
 */
export function suggestMilestones(t: Terms): Milestone[] {
  const target = milestoneTarget(t);
  if (target <= 0) return [];
  let items: Bilingual[] = t.scope.slice(0, MAX_MILESTONES);
  if (items.length < 2) items = [{ en: "First half of the work", hi: "आधा काम" }, { en: "Work finished", hi: "पूरा काम" }];
  const titles = items.length >= 2 && t.scope.length >= 2 ? items.map(titleFor) : items;
  const each = Math.floor(target / titles.length / 500) * 500 || Math.floor(target / titles.length);
  return titles.map((title, i) => ({
    id: `m${i + 1}`,
    title: title.en,
    titleHi: title.hi,
    amount: i === titles.length - 1 ? target - each * (titles.length - 1) : each,
  }));
}

export function progressOf(a: Agreement, id: string): MilestoneProgress {
  return a.progress?.[id] ?? { status: "pending", photos: [] };
}

export function paidTotal(a: Agreement): number {
  return a.payments.reduce((s, p) => s + p.amount, 0);
}

/** Total the hirer owes over the life of the agreement (effective price, plus an advance paid on top). */
export function totalPayable(a: Agreement): number {
  const t = effectiveTerms(a);
  if (t.price === null) return 0;
  return t.advance && t.advanceAdjusted === false ? t.price + t.advance : t.price;
}
