"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { EmptyState, Logo, Spinner } from "@/components/ui";
import { useDeal } from "@/lib/useDeal";
import { balanceDue } from "@/lib/extract";
import { maskPhone } from "@/lib/hash";
import { inr } from "@/lib/numbers";
import { fmtDate, fmtDateTime } from "@/lib/summary";
import { langName } from "@/lib/languages";
import { effectiveTerms, progressOf, sealedAmendments } from "@/lib/terms";
import { describeDelta } from "@/lib/amend";
import type { Channel, Payment } from "@/lib/types";

const CHANNEL: Record<Channel, string> = { whatsapp: "via WhatsApp", in_app: "in person", ivr: "by phone call (IVR)" };
const PAY_LABEL: Record<Payment["kind"], string> = { advance: "Advance", balance: "Balance", milestone: "Milestone", settlement: "Settlement" };

/** Printable, dispute-ready evidence record. "Save as PDF" from the print dialog. */
export default function RecordPage() {
  const { ready, deal: a } = useDeal();
  if (!ready) return <Spinner label="Preparing record…" />;
  if (!a || !a.hash) return <EmptyState title="No sealed record" body="Only sealed agreements have a dispute-ready record." href="/deals" cta="All agreements" />;

  const eff = effectiveTerms(a);
  const sealed = sealedAmendments(a);
  const photos = Object.entries(a.progress ?? {}).flatMap(([key, p]) => p.photos.map((ph) => ({ key, p: ph })));
  const rows: [string, string][] = [
    ["Job", `${a.terms.jobType}${a.terms.location ? `, ${a.terms.location}` : ""}`],
    ["Included", a.terms.scope.map((s) => s.en).join(", ") || "—"],
    ["Not included", a.terms.excluded.map((s) => s.en).join(", ") || "—"],
    ["Total price", inr(a.terms.price)],
    ["Advance", a.terms.advance ? `${inr(a.terms.advance)} (${a.terms.advanceAdjusted === false ? "on top of total" : "deducted from total"})` : "—"],
    ["Balance", `${inr(balanceDue(a.terms))} — ${a.terms.balanceWhen ?? "—"}`],
    ["Material", a.terms.materialsBy === "worker" ? "Bought by worker, included in total" : a.terms.materialsBy === "hirer" ? "Provided by hirer separately" : "—"],
    ["Duration / finish by", `${a.terms.durationDays ?? "—"} days / ${fmtDate(a.terms.deadline)}`],
    ["Payment mode", a.terms.paymentMode ?? "—"],
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <Link href={`/deals/${a.id}`} className="btn-ghost py-2 text-sm">
          <ArrowLeft size={16} /> Back
        </Link>
        <button className="btn-primary py-2 text-sm" onClick={() => window.print()}>
          <Printer size={16} /> Print / Save as PDF
        </button>
      </div>

      <article className="rounded-2xl border border-line bg-white p-8 text-[14px] leading-relaxed print:border-0 print:p-0">
        <header className="flex items-start justify-between border-b-2 border-navy pb-4">
          <div>
            <Logo size={28} />
            <h1 className="mt-3 font-display text-2xl font-bold">Agreement record {a.id}</h1>
            <p className="text-navy-muted">Dispute-ready evidence pack · generated {fmtDateTime(new Date().toISOString())}</p>
          </div>
          <p className="rounded-md bg-navy px-2 py-1 text-xs font-bold text-cream">SEALED</p>
        </header>

        <Section title="1. Parties">
          <table className="w-full">
            <tbody>
              {(["worker", "hirer"] as const).map((r) => (
                <tr key={r} className="border-b border-line/60">
                  <td className="py-1.5 pr-4 font-semibold capitalize">{r}</td>
                  <td className="py-1.5">{a[r].name}</td>
                  <td className="py-1.5">+91 {maskPhone(a[r].phone)}</td>
                  <td className="py-1.5 text-navy-muted">{langName(a[r].lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-navy-muted">Consent to record given by both parties at {fmtDateTime(a.consent.at)}.</p>
        </Section>

        <Section title="2. Agreed terms (as sealed)">
          <table className="w-full">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} className="border-b border-line/60 align-top">
                  <td className="w-48 py-1.5 pr-4 font-semibold">{k}</td>
                  <td className="py-1.5">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {a.flags.length > 0 && (
          <Section title="3. Gaps identified and how they were resolved">
            <ul className="list-disc pl-5">
              {a.flags.map((f) => (
                <li key={f.id}>
                  <b>{f.title}:</b> {f.resolved ? f.resolution : "left open"}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="4. Confirmations">
          <ul className="list-disc pl-5">
            {(["worker", "hirer"] as const).map((r) => (
              <li key={r}>
                {a[r].name}: “{a.confirmations[r]?.reply}” {CHANNEL[a.confirmations[r]?.channel ?? "in_app"]} at {fmtDateTime(a.confirmations[r]?.at)}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="5. Change orders and settlements (sealed separately, chained)">
          {sealed.length ? (
            <ol className="list-decimal space-y-2 pl-5">
              {sealed.map((am) => (
                <li key={am.id}>
                  <b>{am.id}</b> · {am.source === "settlement" ? "Settlement" : "Change order"}: {am.source === "settlement" ? am.description : describeDelta(am.delta)}
                  <span className="block text-navy-muted">
                    Confirmed by {(["worker", "hirer"] as const).map((r) => `${a[r].name} ${CHANNEL[am.confirmations[r]?.channel ?? "in_app"]}`).join(" and ")}; sealed {fmtDateTime(am.sealedAt)}
                  </span>
                  <span className="block break-all font-mono text-[11px]">parent {am.parentHash} → {am.hash}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>None. The sealed terms above apply unchanged.</p>
          )}
          {sealed.length > 0 && (
            <p className="mt-2">
              <b>Terms in effect:</b> {inr(eff.price)} · finish by {fmtDate(eff.deadline)} · {eff.scope.map((x) => x.en).join(", ")}
            </p>
          )}
        </Section>

        {(eff.milestones?.length ?? 0) > 0 && (
          <Section title="6. Milestones">
            <table className="w-full">
              <tbody>
                {(eff.milestones ?? []).map((m) => {
                  const p = progressOf(a, m.id);
                  return (
                    <tr key={m.id} className="border-b border-line/60 align-top">
                      <td className="py-1.5 pr-4 font-semibold">{m.title}</td>
                      <td className="py-1.5 pr-4">{inr(m.amount)}</td>
                      <td className="py-1.5">
                        {p.status}
                        {p.rejectReason ? ` (sent back: ${p.rejectReason})` : ""}
                        {p.upiRef ? ` · UPI ${p.upiRef}` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        )}

        {photos.length > 0 && (
          <Section title="7. Proof-of-work photos">
            <ul className="space-y-1">
              {photos.map(({ key, p }) => (
                <li key={p.id} className="break-all">
                  <b className="capitalize">{p.kind}</b> ({key === "work" ? "work" : (eff.milestones ?? []).find((m) => m.id === key)?.title ?? key}) · {fmtDateTime(p.takenAt)}
                  {p.lat !== undefined ? ` · ${p.lat}, ${p.lng}` : ""} · <span className="font-mono text-[11px]">sha256 {p.hash}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="8. Payments">
          {a.payments.length ? (
            <ul className="list-disc pl-5">
              {a.payments.map((p) => (
                <li key={p.id}>
                  {PAY_LABEL[p.kind]} {p.amount < 0 ? `refund ${inr(-p.amount)}` : inr(p.amount)} via UPI, ref {p.upiRef}, {fmtDateTime(p.at)}
                </li>
              ))}
            </ul>
          ) : (
            <p>No payments recorded yet.</p>
          )}
        </Section>

        {a.dispute && (
          <Section title="9. Dispute">
            <p>
              <b>{a.dispute.reason}</b>, raised by {a[a.dispute.raisedBy].name} on {fmtDateTime(a.dispute.raisedAt)}.{" "}
              {a.dispute.outcome === "settled" ? "Settled by both." : a.dispute.outcome === "escalated" ? "Not settled; escalated." : "Open."}
            </p>
            {(["worker", "hirer"] as const).map((r) =>
              a.dispute?.statements[r] ? (
                <p key={r} className="mt-1">
                  <b>{a[r].name}:</b> “{a.dispute.statements[r]?.text}”
                </p>
              ) : null,
            )}
            {a.dispute.mediation && (
              <div className="mt-2">
                <p>
                  <b>Mediator suggestion:</b> {a.dispute.mediation.suggestion}
                </p>
                <p className="mt-1 text-navy-muted">{a.dispute.mediation.disclaimer}</p>
              </div>
            )}
          </Section>
        )}

        <Section title="10. Integrity">
          <p>SHA-256 of the canonical record (parties with hashed phone numbers, consent, terms, transcript, confirmations):</p>
          <p className="mt-1 break-all rounded bg-cream p-2 font-mono text-xs">{a.hash}</p>
          <p className="mt-1 text-navy-muted">
            Sealed {fmtDateTime(a.sealedAt)}. Re-computing the hash over the same record must give the same value; any edit changes it. Each change order and settlement is hashed on its own and names the hash before it.
            Payments, photos and events sit outside the sealed hash.
          </p>
        </Section>

        {a.transcript.length > 0 && (
          <Section title="11. Transcript">
            <ol className="space-y-1">
              {a.transcript.map((s, i) => (
                <li key={i}>
                  <b>{s.speaker === "worker" ? a.worker.name : a.hirer.name}:</b> {s.text}
                </li>
              ))}
            </ol>
          </Section>
        )}
        <footer className="mt-8 border-t border-line pt-3 text-xs text-navy-muted">
          Karaar AI prototype · consent-first · no Aadhaar stored · aligned with DPDP Act 2023 principles. This record is strong evidence for mediation;
          whether electronic records are accepted in a particular case should be confirmed with a lawyer.
        </footer>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 font-display text-base font-bold text-navy">{title}</h2>
      {children}
    </section>
  );
}
