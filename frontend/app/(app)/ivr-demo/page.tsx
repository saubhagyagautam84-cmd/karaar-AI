"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Phone, PhoneCall, PhoneOff, Volume2 } from "lucide-react";
import { PageHeader, Spinner, cn } from "@/components/ui";
import { speak } from "@/components/SpeakButton";
import { useAgreements, nowIso } from "@/lib/store";
import { ivrCall, ivrKey } from "@/lib/api";
import { confirmAgreement, confirmAmendment } from "@/lib/confirm";
import { buildAmendmentSummary, buildSummary } from "@/lib/summary";
import { summaryLang } from "@/lib/languages";
import type { Agreement, Amendment, Role } from "@/lib/types";

type Phase = "idle" | "ringing" | "connecting" | "speaking" | "menu" | "done";

const MENU = {
  hi: "सही है तो 1 दबाइए। बदलाव के लिए 2 दबाइए। फिर से सुनने के लिए 9 दबाइए।",
  en: "Press 1 to confirm. Press 2 to ask for a change. Press 9 to hear it again.",
};

/** A5: a worker without a smartphone confirms on a simple phone call (simulated IVR, Exotel/Twilio in live mode). */
export default function IvrDemoPage() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <IvrDemo />
    </Suspense>
  );
}

function IvrDemo() {
  const params = useSearchParams();
  const router = useRouter();
  const { ready, agreements, get, save, flush } = useAgreements();
  const [id, setId] = useState(params.get("id") ?? "");
  const [role, setRole] = useState<Role>(params.get("role") === "hirer" ? "hirer" : "worker");
  const [phase, setPhase] = useState<Phase>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  if (!ready) return <Spinner label="Loading agreements…" />;

  // Anything waiting for this person's "Haan, pakka": an agreement, or a change order / settlement.
  const pending = agreements.flatMap((a) => {
    const rows: { a: Agreement; am?: Amendment }[] = [];
    if (a.status === "awaiting_confirmation") rows.push({ a });
    (a.amendments ?? []).filter((am) => !am.hash).forEach((am) => rows.push({ a, am }));
    return rows;
  });
  const a = id ? get(id) : undefined;
  const am = a ? (a.amendments ?? []).find((x) => !x.hash && x.id === params.get("am")) ?? (a.status === "awaiting_confirmation" ? undefined : (a.amendments ?? []).find((x) => !x.hash)) : undefined;
  const lang = a ? summaryLang(a[role].lang) : "hi";
  const script = a ? (am ? buildAmendmentSummary(a, am, lang) : buildSummary(a, lang)).split("\n").filter((l) => !/Haan, pakka|हाँ, पक्का|Change|बदलाव ✏️/.test(l)).join("\n") : "";
  const already = a ? (am ? am.confirmations[role] : a.confirmations[role]) : undefined;

  const say = (text: string, then?: () => void) => {
    setLog((l) => [...l, text]);
    if (!speak(text, lang, () => alive.current && then?.())) then?.();
  };

  async function answer() {
    if (!a) return;
    setPhase("connecting");
    setError(null);
    try {
      await flush(a.id);
      const { callId: cid } = await ivrCall(a, role);
      setCallId(cid);
      playSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The call could not start.");
      setPhase("idle");
    }
  }

  function playSummary() {
    setPhase("speaking");
    const hello = lang === "hi" ? `नमस्ते ${a?.[role].name}। करार ए आई से बोल रहे हैं।` : `Hello ${a?.[role].name}. This is Karaar AI.`;
    say(hello, () => say(script, () => say(MENU[lang], () => setPhase("menu"))));
  }

  async function press(digit: string) {
    if (!a || !callId || (phase !== "menu" && phase !== "speaking")) return;
    window.speechSynthesis?.cancel();
    setLog((l) => [...l, `☎ ${digit}`]);
    try {
      const { action } = await ivrKey(callId, a, role, digit);
      if (action === "repeat") return playSummary();
      if (action === "confirm") {
        const { next, sealed } = am ? await confirmAmendment(a, am.id, role, "ivr") : await confirmAgreement(a, role, "ivr");
        save(next);
        const msg = sealed ? (lang === "hi" ? "धन्यवाद। दोनों ने हाँ कहा, करार पक्का हो गया।" : "Thank you. Both have said yes. It is sealed.") : lang === "hi" ? "धन्यवाद। आपकी हाँ दर्ज हो गई।" : "Thank you. Your yes is recorded.";
        setResult(sealed ? "sealed" : "confirmed");
        setPhase("done");
        say(msg);
        return;
      }
      if (action === "change") {
        if (!am) {
          save({ ...a, status: "review", confirmations: {}, events: [...a.events, { at: nowIso(), label: `${a[role].name} asked for a change`, detail: "by phone call (IVR)" }] });
        } else {
          save({ ...a, events: [...a.events, { at: nowIso(), label: `${a[role].name} asked to change ${am.id}`, detail: "by phone call (IVR)" }] });
        }
        setResult("change");
        setPhase("done");
        say(lang === "hi" ? "ठीक है। बदलाव के लिए आपसे बात की जाएगी।" : "Okay. Someone will talk to you about the change.");
        return;
      }
      say(lang === "hi" ? "गलत बटन।" : "Wrong key.", () => say(MENU[lang], () => setPhase("menu")));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The key press was not recorded.");
    }
  }

  function hangUp() {
    window.speechSynthesis?.cancel();
    setPhase("idle");
    setCallId(null);
    setLog([]);
    setResult(null);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="IVR demo · simulated"
        title="Confirm on a simple phone call"
        sub="For a worker without a smartphone: Karaar calls, reads the agreement aloud in their language, and they press 1 to confirm. In live mode a telephony provider (Exotel / Twilio Voice) places the call; here the browser plays it."
      />

      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        <section className="card space-y-4" aria-label="Choose the call">
          <div>
            <label className="label" htmlFor="ivr-deal">Agreement waiting for confirmation</label>
            <select id="ivr-deal" className="input py-2" value={id} disabled={phase !== "idle"} onChange={(e) => setId(e.target.value)}>
              <option value="">Choose…</option>
              {pending.map(({ a: x, am: y }) => (
                <option key={`${x.id}-${y?.id ?? "main"}`} value={x.id}>
                  {y ? `${y.id} (${y.source === "settlement" ? "settlement" : "change"})` : x.id} · {x.worker.name} ↔ {x.hirer.name}
                </option>
              ))}
              {id && !pending.some((p) => p.a.id === id) && <option value={id}>{id}</option>}
            </select>
            {!pending.length && <p className="mt-2 text-sm text-navy-muted">Nothing is waiting. Record a new deal and send it for confirmation first.</p>}
          </div>
          <fieldset className="flex flex-wrap items-center gap-4 text-sm">
            <legend className="label">Who gets the call?</legend>
            {(["worker", "hirer"] as const).map((r) => (
              <label key={r} className="flex items-center gap-1.5">
                <input type="radio" name="ivr-role" className="accent-[#E8762B]" checked={role === r} disabled={phase !== "idle"} onChange={() => setRole(r)} />
                {a ? a[r].name : r === "worker" ? "Worker" : "Hirer"} ({r})
              </label>
            ))}
          </fieldset>
          {already && <p className="rounded-lg bg-leaf-soft p-2.5 text-sm font-semibold text-leaf">{a?.[role].name} has already confirmed{am ? ` ${am.id}` : ""}.</p>}
          {log.length > 0 && (
            <div aria-live="polite" className="max-h-64 space-y-2 overflow-y-auto rounded-xl bg-cream p-3 text-sm">
              {log.map((l, i) => (
                <p key={i} className={cn("whitespace-pre-wrap", l.startsWith("☎") ? "font-bold text-saffron-ink" : "text-navy-body")}>
                  {l.startsWith("☎") ? l : <><Volume2 size={13} className="mr-1 inline text-navy-muted" />{l.replace(/\*/g, "")}</>}
                </p>
              ))}
            </div>
          )}
          {result && a && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex items-center gap-1.5 font-semibold text-leaf">
                <CheckCircle2 size={17} /> {result === "sealed" ? "Sealed" : result === "confirmed" ? "Confirmation recorded (channel: IVR)" : "Change requested"}
              </p>
              <button className="btn-ghost py-2 text-sm" onClick={() => router.push(result === "sealed" || am ? `/deals/${a.id}` : `/deals/${a.id}/${result === "change" ? "review" : "confirm"}`)}>
                Open the agreement
              </button>
            </div>
          )}
          {error && <p className="rounded-lg bg-alert-soft p-2.5 text-sm font-semibold text-alert">{error}</p>}
        </section>

        {/* Feature phone */}
        <section aria-label="Simulated phone" className="mx-auto w-full max-w-[300px] rounded-[2.2rem] border-4 border-navy bg-navy p-3 shadow-lift">
          <div className="rounded-[1.6rem] bg-[#DDE7D4] p-4 font-mono text-navy">
            <p className="text-center text-xs">{phase === "idle" ? "Ready" : phase === "done" ? "Call ended" : "On call · Karaar AI"}</p>
            <p className="mt-2 min-h-12 text-center text-sm font-bold">
              {phase === "idle" && (a ? `Call ${a[role].name}` : "Choose an agreement")}
              {phase === "ringing" && "Incoming call…"}
              {phase === "connecting" && "Connecting…"}
              {phase === "speaking" && "Reading the agreement…"}
              {phase === "menu" && "1 = Pakka · 2 = Change · 9 = Repeat"}
              {phase === "done" && (result === "change" ? "Change requested" : "Haan, pakka ✓")}
            </p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {phase === "idle" ? (
              <button className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-leaf py-2.5 font-bold text-white disabled:opacity-40" disabled={!a || Boolean(already)} onClick={() => setPhase("ringing")}>
                <PhoneCall size={18} /> Place call
              </button>
            ) : phase === "ringing" ? (
              <>
                <button className="flex items-center justify-center gap-2 rounded-xl bg-leaf py-2.5 font-bold text-white" onClick={answer}>
                  <Phone size={18} /> Answer
                </button>
                <button className="flex items-center justify-center gap-2 rounded-xl bg-alert py-2.5 font-bold text-white" onClick={hangUp}>
                  <PhoneOff size={18} /> Decline
                </button>
              </>
            ) : (
              <button className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-alert py-2.5 font-bold text-white" onClick={hangUp}>
                <PhoneOff size={18} /> {phase === "done" ? "Close" : "Hang up"}
              </button>
            )}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Keypad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
              <button
                key={k}
                className={cn("rounded-xl bg-navy-body/40 py-3 font-display text-lg font-bold text-cream hover:bg-navy-body/70 disabled:opacity-40", (k === "1" || k === "2" || k === "9") && "ring-1 ring-saffron/60")}
                disabled={phase !== "menu" && phase !== "speaking"}
                onClick={() => press(k)}
                aria-label={`Key ${k}`}
              >
                {k}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="mt-6 text-center text-sm text-navy-muted">
        The confirmation is stored with channel “IVR” and sealed exactly like a WhatsApp reply. <Link href="/deals" className="font-semibold text-saffron-ink underline-offset-2 hover:underline">All agreements</Link>
      </p>
    </div>
  );
}
