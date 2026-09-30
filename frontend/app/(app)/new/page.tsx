"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Keyboard, MapPin, Play, ShieldCheck, Sparkles, UserRound, Wrench } from "lucide-react";
import { PageHeader, Stepper, cn } from "@/components/ui";
import { Recorder } from "@/components/Recorder";
import { LANGUAGES } from "@/lib/languages";
import { SAMPLE_PARTIES, SAMPLE_TRANSCRIPT, parseTypedTranscript } from "@/lib/sample";
import { backendHealth, extract, transcribe } from "@/lib/api";
import { toHinglish } from "@/lib/devanagari";
import { newId, nowIso, useAgreements } from "@/lib/store";
import type { Agreement, Party, Segment } from "@/lib/types";

const JOBS = ["Painting", "Plumbing", "Electrical", "Carpentry", "Domestic work", "Driving", "Other"];

type Busy = null | "transcribing" | "extracting";

export default function NewDeal() {
  const router = useRouter();
  const { save } = useAgreements();
  const [worker, setWorker] = useState<Party>({ name: "", phone: "", lang: "hinglish", role: "worker" });
  const [hirer, setHirer] = useState<Party>({ name: "", phone: "", lang: "hi", role: "hirer" });
  const [jobType, setJobType] = useState("Painting");
  const [location, setLocation] = useState("");
  const [consent, setConsent] = useState({ worker: false, hirer: false });
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [speechLang, setSpeechLang] = useState<"hi-IN" | "en-IN">("hi-IN");

  const partiesOk = worker.name.trim() && hirer.name.trim() && worker.phone.trim() && hirer.phone.trim();
  const ready = Boolean(partiesOk && consent.worker && consent.hirer);
  const missing = [
    !worker.name.trim() && "worker's name",
    !worker.phone.trim() && "worker's number",
    !hirer.name.trim() && "hirer's name",
    !hirer.phone.trim() && "hirer's number",
    !consent.worker && "worker's consent",
    !consent.hirer && "hirer's consent",
  ].filter((x): x is string => Boolean(x));

  function fillDemo() {
    setWorker({ ...SAMPLE_PARTIES.worker, role: "worker" });
    setHirer({ ...SAMPLE_PARTIES.hirer, role: "hirer" });
    setJobType("Painting");
    setLocation("Lajpat Nagar, New Delhi");
    setConsent({ worker: true, hirer: true });
  }

  async function run(source: { audio?: Blob | null; seconds?: number; segments?: Segment[]; speechError?: string | null; recorded?: boolean }) {
    setError(null);
    try {
      let segments = source.segments ?? [];
      if (source.recorded && !segments.length) {
        // Nothing was heard in the browser. Only a real server-side speech service may try the audio;
        // never substitute a sample conversation for what these two people said.
        const health = await backendHealth();
        if (source.audio && health && health.providers.speech !== "mock") {
          setBusy("transcribing");
          segments = await transcribe(source.audio, worker.lang);
        }
        if (!segments.length) {
          setBusy(null);
          setTyping(true);
          setError(`${source.speechError ?? "No words were heard in the recording."} You can type the conversation below.`);
          return;
        }
      }
      setBusy("extracting");
      const { terms, flags } = await extract(segments.map((x) => ({ ...x, text: toHinglish(x.text) })), { jobType, location });
      const id = newId();
      const at = nowIso();
      const a: Agreement = {
        id,
        createdAt: at,
        status: "review",
        worker,
        hirer,
        consent: { ...consent, at },
        audioSeconds: source.seconds ?? segments[segments.length - 1]?.t ?? 0,
        transcript: segments,
        terms,
        flags,
        confirmations: {},
        payments: [],
        events: [
          { at, label: "Both parties consented to recording" },
          { at, label: "Conversation transcribed", detail: `${segments.length} turns` },
          { at, label: "Terms extracted", detail: `${flags.length} gap${flags.length === 1 ? "" : "s"} flagged` },
        ],
      };
      save(a);
      router.push(`/deals/${id}/review`);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  if (busy) {
    return (
      <div className="mx-auto max-w-2xl">
        <Stepper current={busy === "transcribing" ? 0 : 1} />
        <div className="card flex flex-col items-center gap-6 py-14 text-center">
          <span className="h-12 w-12 animate-spin rounded-full border-4 border-saffron/25 border-t-saffron" />
          <div>
            <p className="font-display text-xl font-bold">{busy === "transcribing" ? "Transcribing the conversation" : "Reading the deal"}</p>
            <p className="mt-1 text-navy-body">
              {busy === "transcribing"
                ? "Speech-to-text on the server, then spoken numbers are normalised (athaarah hazaar → ₹18,000)."
                : "Extracting price, scope, advance and deadline, then checking for anything left unsaid."}
            </p>
          </div>
          <ul className="w-full max-w-xs space-y-2 text-left text-sm">
            {[
              ["Speech to text", busy !== "transcribing"],
              ["Number normalizer", busy !== "transcribing"],
              ["Structured terms (strict JSON)", false],
              ["Ambiguity detector", false],
            ].map(([label, done]) => (
              <li key={label as string} className="flex items-center gap-2">
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-full", done ? "bg-leaf text-white" : "border-2 border-line")}>
                  {done ? <Check size={12} strokeWidth={3} /> : null}
                </span>
                <span className={done ? "text-navy" : "text-navy-muted"}>{label as string}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Stepper current={0} />
      <PageHeader
        eyebrow="New deal · नया करार"
        title="Talk it through. We'll write it down."
        sub="Add both people, get consent, then record the conversation exactly as you'd normally have it."
        action={
          <button onClick={fillDemo} className="btn-ghost text-sm">
            <Sparkles size={16} /> Fill demo
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <PartyCard title="Worker" titleHi="कारीगर" icon={<Wrench size={18} />} party={worker} onChange={setWorker} />
        <PartyCard title="Hirer" titleHi="काम देने वाले" icon={<UserRound size={18} />} party={hirer} onChange={setHirer} />
      </div>

      <div className="card mt-4">
        <p className="label">Type of work</p>
        <div className="flex flex-wrap gap-2">
          {JOBS.map((j) => (
            <button
              key={j}
              type="button"
              onClick={() => setJobType(j)}
              className={cn("chip", jobType === j ? "border-navy bg-navy text-cream" : "border-line bg-paper text-navy hover:bg-cream")}
              aria-pressed={jobType === j}
            >
              {j}
            </button>
          ))}
        </div>
        <label className="label mt-4" htmlFor="loc">
          Location
        </label>
        <div className="relative">
          <MapPin size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy-muted" />
          <input id="loc" className="input pl-10" placeholder="e.g. Lajpat Nagar, New Delhi" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>

      <fieldset className="card mt-4 border-leaf/30 bg-leaf-soft/60">
        <legend className="sr-only">Consent</legend>
        <p className="flex items-center gap-2 font-display font-bold text-leaf">
          <ShieldCheck size={20} /> Consent first · सहमति
        </p>
        <p className="mt-1 text-sm text-navy-body">
          Recording starts only after both people agree. Audio is used to draft the agreement; the sealed record keeps the transcript, not Aadhaar or raw phone numbers.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(["worker", "hirer"] as const).map((r) => (
            <label key={r} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border bg-paper p-3", consent[r] ? "border-leaf" : "border-line")}>
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 accent-[#1F7A4D]"
                checked={consent[r]}
                onChange={(e) => setConsent((c) => ({ ...c, [r]: e.target.checked }))}
              />
              <span className="text-sm">
                <b>{(r === "worker" ? worker.name : hirer.name) || (r === "worker" ? "Worker" : "Hirer")}</b> agrees to record this conversation
                <span className="block text-navy-muted">मैं इस बातचीत को रिकॉर्ड करने की सहमति देता/देती हूँ</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <section className="card mt-4" aria-labelledby="rec-h">
        <h2 id="rec-h" className="font-display text-lg font-bold">
          Record the deal
        </h2>
        {!ready && (
          <p className="mt-2 rounded-lg bg-amber-soft px-3 py-2 text-sm font-semibold text-amber-ink" role="status">
            To start, add: {missing.join(", ")}.
          </p>
        )}
        <fieldset className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <legend className="sr-only">Language the conversation is spoken in</legend>
          <span className="font-semibold">Spoken in</span>
          {([["hi-IN", "Hindi · हिन्दी"], ["en-IN", "Hinglish / English"]] as const).map(([code, label]) => (
            <button key={code} type="button" aria-pressed={speechLang === code} onClick={() => setSpeechLang(code)}
              className={cn("chip", speechLang === code ? "border-navy bg-navy text-cream" : "border-line bg-paper text-navy hover:bg-cream")}>
              {label}
            </button>
          ))}
        </fieldset>
        <Recorder
          disabled={!ready}
          lang={speechLang}
          names={{ worker: worker.name, hirer: hirer.name }}
          onDone={(audio, seconds, segments, speechError) => run({ audio, seconds, segments, speechError, recorded: true })}
        />
        <p className="text-center text-xs text-navy-muted">
          Live captions use your browser&apos;s speech service (Google in Chrome, Microsoft in Edge) and need internet. Typing works everywhere.
        </p>
        <div className="flex flex-wrap justify-center gap-2 border-t border-line/70 pt-4">
          <button className="btn-ghost text-sm" disabled={!ready} onClick={() => run({ segments: SAMPLE_TRANSCRIPT, seconds: 44 })}>
            <Play size={16} /> Use demo conversation
          </button>
          <button className="btn-ghost text-sm" disabled={!ready} onClick={() => setTyping((v) => !v)} aria-expanded={typing}>
            <Keyboard size={16} /> Type it instead
          </button>
        </div>
        {typing && (
          <div className="mt-4">
            <label htmlFor="typed" className="label">
              One line per turn. Start with <code>W:</code> for worker, <code>H:</code> for hirer.
            </label>
            <textarea
              id="typed"
              rows={6}
              className="input font-mono text-sm"
              placeholder={"H: Nal theek karna hai, kitna loge?\nW: Dedh hazaar lagega, 2 din mein.\nH: Theek hai, pakka."}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <button className="btn-primary mt-3" disabled={!typed.trim()} onClick={() => run({ segments: parseTypedTranscript(typed) })}>
              Extract terms
            </button>
          </div>
        )}
        {error && <p className="mt-3 rounded-lg bg-alert-soft p-3 text-sm font-semibold text-alert">{error}</p>}
      </section>
    </div>
  );
}

function PartyCard({
  title, titleHi, icon, party, onChange,
}: { title: string; titleHi: string; icon: React.ReactNode; party: Party; onChange: (p: Party) => void }) {
  const id = party.role;
  return (
    <div className="card">
      <p className="mb-3 flex items-center gap-2 font-display font-bold">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy text-saffron">{icon}</span>
        {title} <span className="font-sans text-sm font-normal text-navy-muted">· {titleHi}</span>
      </p>
      <label className="label" htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} className="input" value={party.name} onChange={(e) => onChange({ ...party, name: e.target.value })} autoComplete="off" />
      <label className="label mt-3" htmlFor={`${id}-phone`}>WhatsApp number</label>
      <div className="flex">
        <span className="flex items-center rounded-l-xl border border-r-0 border-line bg-cream px-3 text-navy-muted">+91</span>
        <input
          id={`${id}-phone`}
          className="input rounded-l-none"
          inputMode="tel"
          value={party.phone}
          onChange={(e) => onChange({ ...party, phone: e.target.value.replace(/[^\d ]/g, "").slice(0, 11) })}
        />
      </div>
      <label className="label mt-3" htmlFor={`${id}-lang`}>Language for their summary</label>
      <select id={`${id}-lang`} className="input" value={party.lang} onChange={(e) => onChange({ ...party, lang: e.target.value })}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native === l.name ? l.name : `${l.native} · ${l.name}`}
          </option>
        ))}
      </select>
    </div>
  );
}
