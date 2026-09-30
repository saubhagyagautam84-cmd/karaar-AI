/**
 * Number normalizer for spoken Hindi / Hinglish amounts.
 * "athaarah hazaar" -> 18000, "saadhe teen hazaar" -> 3500, "dedh lakh" -> 150000, "₹5,000" / "5k" -> 5000.
 * The live backend runs a fuller version of this on the transcript before LLM extraction.
 */

const UNITS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, cheh: 6,
  saat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, gyaarah: 11, barah: 12, baarah: 12, terah: 13,
  chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, athaarah: 18, athara: 18,
  unnis: 19, unees: 19, bees: 20, pachees: 25, pachchees: 25, tees: 30, chaalees: 40, chalees: 40,
  pachaas: 50, pachas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
};
const FRACTIONS: Record<string, number> = { dedh: 1.5, dhai: 2.5, dhaai: 2.5 };
const MULTIPLIERS: Record<string, number> = { sau: 100, hazaar: 1000, hazar: 1000, hajar: 1000, lakh: 100000, lac: 100000 };

export interface Amount {
  value: number;
  raw: string;
}

function clean(w: string) {
  return w.toLowerCase().replace(/[^a-z0-9₹,.]/g, "");
}

/** Find all money-like amounts in a sentence, in order of appearance. */
export function findAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = clean(words[i]);
    if (!w) continue;

    // Digits: 18000, 18,000, ₹5000, 5k
    const dm = w.match(/^₹?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k)?$/);
    if (dm) {
      let v = parseFloat(dm[1].replace(/,/g, ""));
      if (dm[2]) v *= 1000;
      const next = clean(words[i + 1] ?? "");
      if (MULTIPLIERS[next]) { v *= MULTIPLIERS[next]; i++; }
      if (v >= 100) out.push({ value: Math.round(v), raw: words[i].trim() });
      continue;
    }

    // Words: [saadhe|sava|paune] <unit|fraction> <multiplier>
    let j = i;
    let mod = 0; // 0 none, +0.5 saadhe, +0.25 sava, -0.25 paune
    if (w === "saadhe" || w === "sadhe") { mod = 0.5; j++; }
    else if (w === "sava" || w === "savaa") { mod = 0.25; j++; }
    else if (w === "paune") { mod = -0.25; j++; }
    const base = clean(words[j] ?? "");
    const n = UNITS[base] ?? FRACTIONS[base];
    const mult = MULTIPLIERS[clean(words[j + 1] ?? "")];
    if (n !== undefined && mult) {
      const value = Math.round((n + mod) * mult);
      out.push({ value, raw: words.slice(i, j + 2).join(" ") });
      i = j + 1;
    }
  }
  return out;
}

/** Parse "chhe din" / "6 din" / "6 days" into a day count. */
export function findDays(text: string): number | null {
  const m = text.toLowerCase().match(/(\d+|[a-z]+)\s+(din|days?)\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : UNITS[m[1]];
  return n ?? null;
}

export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return "₹" + n.toLocaleString("en-IN");
}
