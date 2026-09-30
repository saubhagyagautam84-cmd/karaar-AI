"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Fingerprint, Languages, Pencil, PhoneCall, Send, Smartphone } from "lucide-react";
import { EmptyState, PageHeader, Spinner, Stepper, cn } from "@/components/ui";
import { WhatsAppPreview } from "@/components/WhatsAppPreview";
import { SpeakButton } from "@/components/SpeakButton";
import { useDeal } from "@/lib/useDeal";
import { buildSummary } from "@/lib/summary";
import { langName, summaryLang } from "@/lib/languages";
import { DEMO_MODE, backendHealth, sendSummary } from "@/lib/api";
import { confirmAgreement } from "@/lib/confirm";
import { nowIso } from "@/lib/store";
import type { Agreement, Role } from "@/lib/types";

export default function Confirm() {
  const router = useRouter();
  const { ready, deal, save } = useDeal();
  const [sending, setSending] = useState<Partial<Record<Role, "sending" | "sent">>>({});
  const [sealing, setSealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(DEMO_MODE);
  useEffect(() => {
    backendHealth().then((h) => h && setSimulated(h.providers.notify === "mock"));
  }, []);

  if (!ready) return <Spinner label="Loading agreement…" />;
  if (!deal) return <EmptyState title="Agreement not found" body="It may have been recorded on another device." href="/new" cta="Start a new deal" />;
  if (sealing) return <Spinner label="Sealing the agreement with SHA-256…" />;
  const a: Agreement = deal;

  async function send(role: Role) {
    setSending((s) => ({ ...s, [role]: "sending" }));
    setError(null);
    const party = a[role];
    try {
      await sendSummary(a, role, buildSummary(a, summaryLang(party.lang)));
      setSending((s) => ({ ...s, [role]: "sent" }));
    } catch (e) {
      setSending((s) => ({ ...s, [role]: undefined }));
      setError(e instanceof Error ? e.message : "The message could not be sent.");
    }
  }

  async function confirm(role: Role, channel: "whatsapp" | "in_app") {
    setError(null);
    const both = Boolean(a.confirmations[role === "worker" ? "hirer" : "worker"]);
    if (both) setSealing(true);
    try {
      const { next, sealed } = await confirmAgreement(a, role, channel);
      save(next);
      if (sealed) router.push(`/deals/${a.id}`);
    } catch (e) {
      setSealing(false);
      setError(e instanceof Error ? e.message : "The server could not store the seal.");
    }
  }

  function requestChange(role: Role) {
    save({
      ...a,
      status: "review",
      confirmations: {},
      events: [...a.events, { at: nowIso(), label: `${a[role].name} asked for a change` }],
    });
    router.push(`/deals/${a.id}/review`);
  }

  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <Stepper current={2} />
      </div>
      <PageHeader
        eyebrow={`${a.id} · Two-party confirmation`}
        title="Each person confirms in their own language"
        sub="The agreement is sealed only when both reply “Haan, pakka”. Either person can ask for a change."
      />
      <div className="grid gap-6 md:grid-cols-2">
        {(["worker", "hirer"] as const).map((role) => {
          const party = a[role];
          const lang = summaryLang(party.lang);
          const conf = a.confirmations[role];
          const st = sending[role];
          return (
            <section key={role} className={cn("card space-y-4", conf && "border-leaf/50")} aria-label={`${party.name} confirmation`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">{role === "worker" ? "Worker · कारीगर" : "Hirer · काम देने वाले"}</p>
                  <h2 className="font-display text-xl font-bold">{party.name}</h2>
                  <p className="flex items-center gap-1.5 text-sm text-navy-muted">
                    <Languages size={14} /> {langName(party.lang)}
                    {!["hi", "hinglish", "en"].includes(party.lang) && <span>(shown in Hindi here; Bhashini translates in live mode)</span>}
                  </p>
                </div>
                {conf && (
                  <span className="flex items-center gap-1 rounded-full bg-leaf px-2.5 py-1 text-xs font-bold text-white">
                    <CheckCircle2 size={14} /> Confirmed
                  </span>
                )}
              </div>

              <WhatsAppPreview to={party.name} text={buildSummary(a, lang)} state={conf ? "sent" : st ?? "draft"} reply={conf?.reply} />
              <SpeakButton text={buildSummary(a, lang)} lang={lang} label={lang === "hi" ? "सुनकर पक्का करें · Listen" : "Listen before confirming · सुनिए"} />

              {!conf && (
                <div className="flex flex-wrap gap-2">
                  {st !== "sent" ? (
                    <button className="btn-primary flex-1" disabled={st === "sending"} onClick={() => send(role)}>
                      <Send size={17} /> {st === "sending" ? "Sending…" : "Send on WhatsApp"}
                    </button>
                  ) : (
                    <>
                      <button className="btn-success flex-1" onClick={() => confirm(role, "whatsapp")}>
                        <CheckCircle2 size={18} /> {lang === "hi" ? "हाँ, पक्का" : "Haan, pakka"}
                        {simulated && <span className="text-xs font-normal opacity-80">(simulate reply)</span>}
                      </button>
                      <button className="btn-ghost" onClick={() => requestChange(role)}>
                        <Pencil size={16} /> {lang === "hi" ? "बदलाव" : "Change"}
                      </button>
                    </>
                  )}
                  <button className="btn-ghost w-full text-sm" onClick={() => confirm(role, "in_app")}>
                    <Smartphone size={16} /> Confirm in person on this phone
                  </button>
                  <Link href={`/ivr-demo?id=${encodeURIComponent(a.id)}&role=${role}`} className="btn-ghost w-full text-sm">
                    <PhoneCall size={16} /> No smartphone? Confirm by phone call (IVR)
                  </Link>
                </div>
              )}
            </section>
          );
        })}
      </div>
      {error && <p className="mt-4 rounded-lg bg-alert-soft p-3 text-sm font-semibold text-alert">{error}</p>}
      <p className="mt-6 flex items-center justify-center gap-2 text-sm text-navy-muted">
        <Fingerprint size={16} /> After both confirm, the record is hashed. Any later edit changes the hash and is detectable.
      </p>
    </div>
  );
}
