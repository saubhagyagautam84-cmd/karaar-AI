import type { Bilingual, Flag, Segment, Terms } from "./types";
import { findAmounts, findDays, inr } from "./numbers";

/**
 * Mock of the backend's extraction + ambiguity detection.
 * Live mode: FastAPI runs an LLM with a strict JSON schema, then these same deterministic
 * ambiguity rules run on top of the LLM output so flags are explainable and reproducible.
 */

const JOB_PATTERNS: [RegExp, string][] = [
  [/putai|paint|rang/i, "Painting"],
  [/nal\b|pipe|plumb|leak|tanki/i, "Plumbing"],
  [/wiring|bijli|switch|fan|electric/i, "Electrical"],
  [/furniture|darwaz|lakdi|almari|carpent/i, "Carpentry"],
  [/safai|jhadu|pocha|bartan|cleaning/i, "Domestic work"],
];

const SCOPE_PATTERNS: { re: RegExp; item: (m: RegExpMatchArray) => Bilingual }[] = [
  {
    re: /\b(ek|do|teen|char|1|2|3|4)?\s*bedroom/i,
    item: (m) => {
      const n = { ek: 1, do: 2, teen: 3, char: 4 }[(m[1] ?? "").toLowerCase() as "ek"] ?? (m[1] ? Number(m[1]) : 1);
      return { en: `${n} bedroom${n > 1 ? "s" : ""}`, hi: `${n} बेडरूम` };
    },
  },
  { re: /\bhall\b|drawing ?room|living/i, item: () => ({ en: "Hall / living room", hi: "हॉल" }) },
  { re: /kitchen|rasoi/i, item: () => ({ en: "Kitchen", hi: "किचन" }) },
  { re: /bathroom|toilet|washroom/i, item: () => ({ en: "Bathroom", hi: "बाथरूम" }) },
  { re: /balcony/i, item: () => ({ en: "Balcony", hi: "बालकनी" }) },
];

const has = (segs: Segment[], re: RegExp) => segs.find((s) => re.test(s.text));

export function detectJobType(segs: Segment[], fallback = "General work"): string {
  const all = segs.map((s) => s.text).join(" ");
  return JOB_PATTERNS.find(([re]) => re.test(all))?.[1] ?? fallback;
}

export function mockExtract(segs: Segment[], opts: { jobType?: string; location?: string } = {}): { terms: Terms; flags: Flag[] } {
  const jobType = opts.jobType && opts.jobType !== "Other" ? opts.jobType : detectJobType(segs);

  // Scope
  const scope: Bilingual[] = [];
  for (const s of segs) {
    for (const p of SCOPE_PATTERNS) {
      const m = s.text.match(p.re);
      if (m) {
        const item = p.item(m);
        if (!scope.some((x) => x.en === item.en)) scope.push(item);
      }
    }
  }
  const coat = has(segs, /coat/i);
  if (coat) {
    const primer = /primer/i.test(coat.text);
    scope.push({
      en: `Walls: 2 coats${primer ? ", with primer" : ""}`,
      hi: `दीवारें: 2 कोट${primer ? ", प्राइमर के साथ" : ""}`,
    });
  }

  // Money
  // Advance: the amount spoken closest to the word "advance" (not e.g. the price in "…18 hazaar theek hai. Advance kitna?")
  let advSeg: Segment | undefined;
  let advance: number | null = null;
  let best = Infinity;
  for (const s of segs) {
    const kw = s.text.search(/advance|pehle de|abhi de/i);
    if (kw < 0) continue;
    for (const amt of findAmounts(s.text)) {
      const at = s.text.indexOf(amt.raw);
      const dist = at <= kw ? kw - (at + amt.raw.length) : at - kw;
      if (dist < best) {
        best = dist;
        advance = amt.value;
        advSeg = s;
      }
    }
  }
  if (best > 25) {
    advance = null;
    advSeg = undefined;
  }
  const priceSeg = segs.find((s) => /poora|pura|kul|total|mein ho|ka padega|rate/i.test(s.text) && findAmounts(s.text).length);
  // Every amount except the advance itself (price and advance are often said in one breath).
  const allAmounts = segs.flatMap((s) => (s === advSeg ? findAmounts(s.text).filter((a) => a.value !== advance) : findAmounts(s.text)));
  const price = priceSeg ? findAmounts(priceSeg.text)[0].value : allAmounts.length ? Math.max(...allAmounts.map((a) => a.value)) : null;

  // Time
  const daySeg = segs.find((s) => findDays(s.text) !== null);
  const durationDays = daySeg ? findDays(daySeg.text) : null;
  let deadline: string | null = null;
  if (durationDays) {
    const d = new Date();
    d.setDate(d.getDate() + durationDays + 1);
    deadline = d.toISOString().slice(0, 10);
  }

  // Materials
  const matHirer = has(segs, /(paint|saaman|samaan|material).*(aap|aapka|aap laa)/i);
  const matWorker = has(segs, /(paint|saaman|samaan|material).*(main|mera|hum|included|shamil)/i);

  const upi = has(segs, /upi|gpay|phonepe|paytm|bhim/i);
  const cash = has(segs, /cash|nakad/i);

  const terms: Terms = {
    jobType,
    location: opts.location ?? "",
    scope,
    excluded: [],
    price,
    advance,
    advanceAdjusted: null,
    durationDays,
    deadline,
    materialsBy: matHirer ? "hirer" : matWorker ? "worker" : null,
    balanceWhen: has(segs, /baaki|baki|balance|kaam ke baad|khatam hone par/i) ? "On completion" : null,
    paymentMode: upi ? "UPI" : cash ? "Cash" : null,
  };

  // ---- Ambiguity detector ----
  const flags: Flag[] = [];
  const allText = segs.map((s) => s.text).join(" ");

  if (jobType === "Painting" && !/ceiling|chhat|chhath/i.test(allText)) {
    flags.push({
      id: "ceiling", severity: "high", resolved: false,
      title: "Ceiling painting not discussed",
      titleHi: "छत की पुताई पर बात नहीं हुई",
      detail: "Rooms were named, but not whether ceilings are included. This is the most common painting dispute.",
      options: [
        { id: "include", label: "Ceilings included in price" },
        { id: "exclude", label: "Ceilings not included" },
      ],
    });
  }
  if (terms.materialsBy === null) {
    const ev = has(segs, /saaman|samaan|material|paint/i);
    flags.push({
      id: "materials", severity: "high", resolved: false,
      title: "Unclear who pays for paint and material",
      titleHi: "सामान का खर्च कौन देगा, साफ़ नहीं",
      detail: "Material was mentioned, but it is not clear whether its cost is inside the total.",
      evidence: ev?.text,
      options: [
        { id: "worker", label: "Worker buys, included in total" },
        { id: "hirer", label: "Hirer buys material separately" },
      ],
    });
  }
  if (advance !== null) {
    flags.push({
      id: "advance", severity: "medium", resolved: false,
      title: "Is the advance part of the total?",
      titleHi: "क्या एडवांस कुल रकम में से कटेगा?",
      detail: `An advance of ${inr(advance)} was agreed. Confirm whether the balance is ${inr((price ?? 0) - advance)} or ${inr(price)}.`,
      evidence: advSeg?.text,
      options: [
        { id: "deducted", label: `Deducted — balance ${inr((price ?? 0) - advance)}` },
        { id: "extra", label: "Extra, on top of the total" },
      ],
    });
  }
  const vague = has(segs, /agle hafte|jaldi|jald|kuch din|next week|soon/i);
  if (!durationDays || vague) {
    flags.push({
      id: "deadline", severity: "medium", resolved: false,
      title: "Deadline is vague",
      titleHi: "काम ख़त्म होने की तारीख़ साफ़ नहीं",
      detail: durationDays
        ? `Both “${durationDays} days” and a loose phrase were used. Pin an exact finish date.`
        : "No finish date was mentioned. Pin an exact date.",
      evidence: vague?.text ?? daySeg?.text,
      input: "date",
    });
  }
  if (!terms.balanceWhen) {
    flags.push({
      id: "balance", severity: "medium", resolved: false,
      title: "When is the balance paid?",
      titleHi: "बाक़ी पैसा कब मिलेगा?",
      detail: "No payment schedule for the remaining amount was discussed.",
      options: [
        { id: "completion", label: "Full balance on completion" },
        { id: "midway", label: "Half midway, rest on completion" },
      ],
    });
  }
  if (!terms.paymentMode) {
    flags.push({
      id: "mode", severity: "low", resolved: false,
      title: "Payment mode not discussed",
      titleHi: "भुगतान का तरीका तय नहीं",
      detail: "UPI keeps an automatic record linked to this agreement.",
      options: [
        { id: "UPI", label: "UPI (recommended)" },
        { id: "Cash", label: "Cash" },
      ],
    });
  }
  return { terms, flags };
}

/** Apply a user's resolution of a flag to the terms. */
export function applyResolution(terms: Terms, flag: Flag, value: string): Terms {
  const t: Terms = { ...terms, scope: [...terms.scope], excluded: [...terms.excluded] };
  const ceiling = { en: "Ceilings", hi: "छत" };
  switch (flag.id) {
    case "ceiling":
      t.scope = t.scope.filter((x) => x.en !== ceiling.en);
      t.excluded = t.excluded.filter((x) => x.en !== ceiling.en);
      (value === "include" ? t.scope : t.excluded).push(ceiling);
      break;
    case "materials":
      t.materialsBy = value as "worker" | "hirer";
      break;
    case "advance":
      t.advanceAdjusted = value === "deducted";
      break;
    case "deadline":
      t.deadline = value;
      if (value) {
        const days = Math.max(1, Math.round((new Date(value).getTime() - Date.now()) / 86400000));
        t.durationDays = t.durationDays ?? days;
      }
      break;
    case "balance":
      t.balanceWhen = value === "midway" ? "Half midway, rest on completion" : "On completion";
      break;
    case "mode":
      t.paymentMode = value as "UPI" | "Cash";
      break;
  }
  return t;
}

export function balanceDue(t: Terms): number | null {
  if (t.price === null) return null;
  if (!t.advance) return t.price;
  return t.advanceAdjusted === false ? t.price : t.price - t.advance;
}
