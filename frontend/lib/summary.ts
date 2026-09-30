import type { Agreement, Amendment } from "./types";
import { describeDelta } from "./amend";
import { inr } from "./numbers";
import { balanceDue } from "./extract";

const JOB_HI: Record<string, string> = {
  Painting: "पुताई", Plumbing: "प्लंबिंग", Electrical: "बिजली का काम", Carpentry: "बढ़ई का काम",
  "Domestic work": "घरेलू काम", Driving: "ड्राइविंग", "General work": "काम",
};

export function fmtDate(iso: string | null | undefined, lang: "en" | "hi" = "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** The bilingual WhatsApp summary each party receives and confirms. */
export function buildSummary(a: Agreement, lang: "en" | "hi"): string {
  const t = a.terms;
  const bal = balanceDue(t);
  if (lang === "hi") {
    const lines = [
      `🧾 *करार ${a.id}*`,
      `${a.worker.name} (कारीगर) ↔ ${a.hirer.name}`,
      ``,
      `*काम:* ${JOB_HI[t.jobType] ?? t.jobType}${t.location ? `, ${t.location}` : ""}`,
      t.scope.length ? `*शामिल:* ${t.scope.map((s) => s.hi).join(", ")}` : null,
      t.excluded.length ? `*शामिल नहीं:* ${t.excluded.map((s) => s.hi).join(", ")}` : null,
      `*कुल रकम:* ${inr(t.price)}`,
      t.advance ? `*एडवांस:* ${inr(t.advance)}${t.advanceAdjusted === false ? " (कुल के अलावा)" : " (कुल में से कटेगा)"}` : null,
      bal !== null ? `*बाक़ी:* ${inr(bal)} — ${t.balanceWhen === "On completion" ? "काम पूरा होने पर" : t.balanceWhen ? "आधा बीच में, बाक़ी काम पूरा होने पर" : "—"}` : null,
      t.milestones?.length ? `*किस्तें:* ${t.milestones.map((m, i) => `${i + 1}) ${m.titleHi ?? m.title} — ${inr(m.amount)}`).join("; ")}` : null,
      t.materialsBy ? `*सामान:* ${t.materialsBy === "worker" ? "कारीगर लाएगा (कुल में शामिल)" : "मालिक अलग से देगा"}` : null,
      `*समय:* ${t.durationDays ?? "—"} दिन, ${fmtDate(t.deadline, "hi")} तक`,
      `*भुगतान:* ${t.paymentMode ?? "—"}`,
      ``,
      `सही है तो जवाब दें: *हाँ, पक्का* ✅`,
      `बदलाव चाहिए तो: *बदलाव* ✏️`,
    ];
    return lines.filter((l): l is string => l !== null).join("\n");
  }
  const lines = [
    `🧾 *Karaar ${a.id}*`,
    `${a.worker.name} (worker) ↔ ${a.hirer.name}`,
    ``,
    `*Job:* ${t.jobType}${t.location ? `, ${t.location}` : ""}`,
    t.scope.length ? `*Included:* ${t.scope.map((s) => s.en).join(", ")}` : null,
    t.excluded.length ? `*Not included:* ${t.excluded.map((s) => s.en).join(", ")}` : null,
    `*Total:* ${inr(t.price)}`,
    t.advance ? `*Advance:* ${inr(t.advance)}${t.advanceAdjusted === false ? " (on top of total)" : " (deducted from total)"}` : null,
    bal !== null ? `*Balance:* ${inr(bal)} — ${t.balanceWhen ?? "—"}` : null,
    t.milestones?.length ? `*Milestones:* ${t.milestones.map((m, i) => `${i + 1}) ${m.title} — ${inr(m.amount)}`).join("; ")}` : null,
    t.materialsBy ? `*Material:* ${t.materialsBy === "worker" ? "Worker buys (included)" : "Hirer provides separately"}` : null,
    `*Time:* ${t.durationDays ?? "—"} days, by ${fmtDate(t.deadline)}`,
    `*Payment:* ${t.paymentMode ?? "—"}`,
    ``,
    `Reply *Haan, pakka* ✅ to confirm`,
    `or *Change* ✏️ to request an edit`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/** WhatsApp summary of a change order or settlement, for both people to confirm again. */
export function buildAmendmentSummary(a: Agreement, am: Amendment, lang: "en" | "hi"): string {
  const isSettlement = am.source === "settlement";
  if (lang === "hi") {
    return [
      `🧾 *${isSettlement ? "समझौता" : "बदलाव"} ${am.id}* (करार ${a.id})`,
      `${a.worker.name} (कारीगर) ↔ ${a.hirer.name}`,
      ``,
      `*बदलाव:* ${describeDelta(am.delta, "hi")}`,
      am.description ? `*विवरण:* ${am.description}` : null,
      `पुराना करार वैसा ही रहेगा; यह बदलाव अलग से पक्का होगा।`,
      ``,
      `सही है तो जवाब दें: *हाँ, पक्का* ✅`,
    ].filter((l): l is string => l !== null).join("\n");
  }
  return [
    `🧾 *${isSettlement ? "Settlement" : "Change order"} ${am.id}* (agreement ${a.id})`,
    `${a.worker.name} (worker) ↔ ${a.hirer.name}`,
    ``,
    `*Change:* ${describeDelta(am.delta, "en")}`,
    am.description ? `*Details:* ${am.description}` : null,
    `The original agreement stays as sealed; this change is sealed separately.`,
    ``,
    `Reply *Haan, pakka* ✅ to confirm`,
  ].filter((l): l is string => l !== null).join("\n");
}
