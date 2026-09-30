"use client";

import { useEffect, useRef, useState } from "react";
import AgreementWorkspace from "@/components/AgreementWorkspace";
import { api, errorText } from "@/lib/api";
import { DISTRICTS, TRADES } from "@/lib/format";
import { CONSENT_NOTICE, speak, stopSpeaking } from "@/lib/speech";
import type { DraftResponse, Lang, Role, Sample } from "@/lib/types";

type Step = "details" | "consent" | "capture" | "result";

interface Details {
  client_name: string;
  client_phone: string;
  client_lang: Lang;
  worker_name: string;
  worker_phone: string;
  worker_lang: Lang;
  worker_trade: string;
  district: string;
}

const DEMO_DETAILS: Details = {
  client_name: "Ritu Sharma",
  client_phone: "",
  client_lang: "en",
  worker_name: "Ramesh Kumar",
  worker_phone: "",
  worker_lang: "hi",
  worker_trade: "",
  district: "South Delhi",
};

const key = (role: Role, f: "name" | "phone" | "lang") =>
  `${role}_${f}` as keyof Details;

const input =
  "h-12 w-full rounded-xl border border-line bg-surface px-3 text-base";

function pickMime(): { mime: string; ext: string } {
  const options = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
    { mime: "audio/ogg", ext: "ogg" },
  ];
  if (typeof MediaRecorder === "undefined") return options[1];
  return (
    options.find((o) => MediaRecorder.isTypeSupported(o.mime)) ?? {
      mime: "",
      ext: "webm",
    }
  );
}

export default function RecordPage() {
  const [step, setStep] = useState<Step>("details");
  const [details, setDetails] = useState<Details>(DEMO_DETAILS);
  const [consent, setConsent] = useState<Partial<Record<Role, string>>>({});
  const [samples, setSamples] = useState<Sample[]>([]);
  const [mockMode, setMockMode] = useState(false);
  const [sampleId, setSampleId] = useState(1);
  const [typed, setTyped] = useState("");
  const [showTyping, setShowTyping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .samples()
      .then(setSamples)
      .catch(() => {});
    api
      .health()
      .then((h) => setMockMode(h.providers.speech === "mock"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const set =
    (k: keyof Details) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDetails({ ...details, [k]: e.target.value });

  function agree(role: Role) {
    const lang = role === "worker" ? details.worker_lang : details.client_lang;
    setConsent((c) => ({ ...c, [role]: new Date().toISOString() }));
    speak(CONSENT_NOTICE[lang], lang);
  }

  async function submit(parts: {
    audio?: Blob;
    filename?: string;
    transcript?: string;
    sample?: number;
  }) {
    setBusy(true);
    setError(null);
    stopSpeaking();
    const form = new FormData();
    Object.entries(details).forEach(([k, v]) => v && form.append(k, v));
    form.append("client_consent_at", consent.client ?? "");
    form.append("worker_consent_at", consent.worker ?? "");
    if (parts.transcript) form.append("transcript", parts.transcript);
    if (parts.audio)
      form.append("audio", parts.audio, parts.filename ?? "recording.webm");
    form.append("sample", String(parts.sample ?? sampleId));
    try {
      setDraft(await api.draft(form));
      setStep("result");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { mime, ext } = pickMime();
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, {
          type: rec.mimeType || "audio/webm",
        });
        submit({ audio: blob, filename: `recording.${ext}` });
      };
      rec.start(1000);
      recorder.current = rec;
      setSeconds(0);
      setRecording(true);
    } catch {
      setError(
        "Could not use the microphone. Allow microphone access, or upload a file / use a sample below.",
      );
    }
  }

  function stopRecording() {
    setRecording(false);
    recorder.current?.stop();
  }

  // DEMO_MODE: a preloaded audio file, so the demo never depends on the room's microphone.
  async function loadSampleAudio() {
    let audio: Blob;
    try {
      audio = await (await fetch(`/samples/sample-${sampleId}.wav`)).blob();
    } catch {
      audio = new Blob([new Uint8Array(2048)], { type: "audio/wav" });
    }
    submit({ audio, filename: `sample-${sampleId}.wav`, sample: sampleId });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) submit({ audio: file, filename: file.name });
    e.target.value = "";
  }

  function reset() {
    setDraft(null);
    setConsent({});
    setTyped("");
    setStep("details");
  }

  if (step === "result" && draft) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Your agreement</h1>
          <button
            onClick={reset}
            className="text-sm font-semibold text-saffron hover:underline"
          >
            New recording
          </button>
        </div>
        <AgreementWorkspace
          initial={draft.agreement}
          transcript={draft.transcript}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ol className="flex gap-2 text-xs font-semibold text-muted">
        {(["details", "consent", "capture"] as Step[]).map((s, i) => (
          <li
            key={s}
            className={`flex-1 rounded-full py-1.5 text-center ${step === s ? "bg-saffron text-white" : "bg-surface"}`}
          >
            {i + 1}.{" "}
            {s === "details" ? "Who" : s === "consent" ? "Consent" : "Talk"}
          </li>
        ))}
      </ol>

      {step === "details" && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            setStep("consent");
          }}
        >
          <h1 className="text-2xl font-bold">Who is making the deal?</h1>
          {(["client", "worker"] as Role[]).map((role) => (
            <fieldset
              key={role}
              className="space-y-2 rounded-2xl border border-line bg-surface p-4"
            >
              <legend className="px-1 font-semibold">
                {role === "client" ? "Client (homeowner)" : "Worker"}
              </legend>
              <input
                className={input}
                placeholder="Name"
                value={details[key(role, "name")]}
                onChange={set(key(role, "name"))}
              />
              <input
                className={input}
                type="tel"
                inputMode="tel"
                placeholder="Phone (optional, stored only as a code)"
                value={details[key(role, "phone")]}
                onChange={set(key(role, "phone"))}
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  className={input}
                  value={details[key(role, "lang")]}
                  onChange={set(key(role, "lang"))}
                  aria-label="Language"
                >
                  <option value="hi">हिन्दी (Hindi)</option>
                  <option value="en">English</option>
                </select>
                {role === "worker" ? (
                  <select
                    className={input}
                    value={details.worker_trade}
                    onChange={set("worker_trade")}
                    aria-label="Trade"
                  >
                    <option value="">Trade: detect</option>
                    {TRADES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    className={input}
                    value={details.district}
                    onChange={set("district")}
                    aria-label="District"
                  >
                    {DISTRICTS.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                )}
              </div>
            </fieldset>
          ))}
          <button className="h-14 w-full rounded-2xl bg-saffron text-lg font-semibold text-white">
            Next
          </button>
        </form>
      )}

      {step === "consent" && (
        <section className="space-y-4">
          <h1 className="text-2xl font-bold">Both agree to record</h1>
          <p className="text-muted">
            Recording starts only after both people tap. We store the terms and
            the audio, nothing else.
          </p>
          {(["client", "worker"] as Role[]).map((role) => {
            const lang =
              role === "worker" ? details.worker_lang : details.client_lang;
            const done = Boolean(consent[role]);
            return (
              <button
                key={role}
                onClick={() => agree(role)}
                disabled={done}
                className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3 text-left font-semibold ${
                  done
                    ? "border-leaf bg-leaf-soft text-leaf"
                    : "border-line bg-surface hover:border-saffron"
                }`}
              >
                <span>
                  {details[key(role, "name")] ||
                    (role === "client" ? "Client" : "Worker")}
                  :{" "}
                  {lang === "hi"
                    ? "मैं रिकॉर्ड करने के लिए सहमत हूँ"
                    : "I agree to record"}
                </span>
                <span aria-hidden>{done ? "✓" : "○"}</span>
              </button>
            );
          })}
          <p className="text-xs text-muted">
            A short spoken notice plays in each person&apos;s language.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setStep("details")}
              className="h-12 rounded-2xl border border-line font-semibold"
            >
              Back
            </button>
            <button
              onClick={() => setStep("capture")}
              disabled={!consent.client || !consent.worker}
              className="h-12 rounded-2xl bg-saffron font-semibold text-white disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {step === "capture" && (
        <section className="space-y-5">
          <h1 className="text-2xl font-bold">Now just talk</h1>
          <p className="text-muted">
            Discuss the work, price, advance, dates and materials in any
            language.
          </p>

          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={busy}
            className={`mx-auto flex size-40 flex-col items-center justify-center rounded-full text-lg font-bold text-white shadow-lg transition ${
              recording
                ? "animate-pulse bg-danger"
                : "bg-saffron hover:scale-105"
            } disabled:opacity-60`}
          >
            <span className="text-4xl" aria-hidden>
              {recording ? "■" : "🎙"}
            </span>
            {busy
              ? "Listening…"
              : recording
                ? `Stop · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                : "Start"}
          </button>

          {mockMode && samples.length > 0 && (
            <div className="rounded-2xl border border-line bg-surface p-4">
              <label className="text-sm font-semibold" htmlFor="sample">
                Demo mode: the offline speech engine returns
              </label>
              <select
                id="sample"
                className={`${input} mt-2`}
                value={sampleId}
                onChange={(e) => setSampleId(Number(e.target.value))}
              >
                {samples.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}. {s.title}
                  </option>
                ))}
              </select>
              <button
                onClick={loadSampleAudio}
                disabled={busy || recording}
                className="mt-2 h-12 w-full rounded-xl bg-foreground font-semibold text-background disabled:opacity-50"
              >
                Use this sample now
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy || recording}
              className="h-12 rounded-2xl border border-line bg-surface font-semibold disabled:opacity-50"
            >
              Upload audio
            </button>
            <button
              onClick={() => setShowTyping((v) => !v)}
              disabled={busy || recording}
              className="h-12 rounded-2xl border border-line bg-surface font-semibold disabled:opacity-50"
            >
              Type it instead
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*,.webm,.m4a,.ogg"
              className="hidden"
              onChange={onFile}
            />
          </div>

          {showTyping && (
            <div className="space-y-2">
              <textarea
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                rows={6}
                placeholder={
                  "Client: Bhaiya do bedroom paint karne hain…\nWorker: Aath hazaar lagega…"
                }
                className="w-full rounded-xl border border-line bg-surface p-3 text-base"
              />
              <button
                onClick={() => submit({ transcript: typed })}
                disabled={busy || !typed.trim()}
                className="h-12 w-full rounded-2xl bg-saffron font-semibold text-white disabled:opacity-50"
              >
                Make the agreement
              </button>
            </div>
          )}
        </section>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-xl bg-danger-soft px-4 py-3 font-medium text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}
