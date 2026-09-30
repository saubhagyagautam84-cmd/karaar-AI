import type { Segment } from "./types";

/** Demo conversation (Hinglish): a painter and a household agreeing on a job. Used in mock mode. */
export const SAMPLE_TRANSCRIPT: Segment[] = [
  { speaker: "hirer", t: 0, text: "Ramesh bhai, poore ghar ki putai karni hai — do bedroom, hall aur kitchen." },
  { speaker: "worker", t: 6, text: "Theek hai didi. Deewaron pe do coat lagaunga, primer ke saath." },
  { speaker: "hirer", t: 12, text: "Kitne ka padega poora kaam?" },
  { speaker: "worker", t: 15, text: "Poora kaam athaarah hazaar mein ho jayega." },
  { speaker: "hirer", t: 20, text: "Thoda kam karo... chalo, athaarah hazaar theek hai. Advance kitna chahiye?" },
  { speaker: "worker", t: 27, text: "Paanch hazaar advance de dijiye, saaman lana hai." },
  { speaker: "hirer", t: 32, text: "Theek hai. Kab tak khatam hoga?" },
  { speaker: "worker", t: 35, text: "Chhe din lagenge, agle hafte tak ho jayega." },
  { speaker: "hirer", t: 40, text: "Bhai, pakka?" },
  { speaker: "worker", t: 42, text: "Haan didi, pakka!" },
];

export const SAMPLE_PARTIES = {
  worker: { name: "Ramesh Kumar", phone: "98100 12345", lang: "hinglish" },
  hirer: { name: "Anita Sharma", phone: "98990 67890", lang: "en" },
};

/** Parse a typed conversation. Lines starting "W:" are the worker, "H:" the hirer. */
export function parseTypedTranscript(text: string): Segment[] {
  const out: Segment[] = [];
  let t = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(w|h|worker|hirer)\s*[:\-]\s*(.*)$/i);
    const speaker = m ? (m[1].toLowerCase().startsWith("w") ? "worker" : "hirer") : out.length % 2 ? "worker" : "hirer";
    out.push({ speaker, text: m ? m[2] : line, t });
    t += 5;
  }
  return out;
}
