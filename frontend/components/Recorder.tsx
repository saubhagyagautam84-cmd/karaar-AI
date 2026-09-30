"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, UserRound, Wrench } from "lucide-react";
import { recognitionCtor, type Recognition } from "@/lib/speech";
import type { Role, Segment } from "@/lib/types";
import { cn } from "./ui";

type Phase = "idle" | "recording" | "finishing" | "denied";

/**
 * Records the conversation with a live level meter and, where the browser supports it, turns the
 * speech into text as people talk (live captions). Whoever is speaking is set with the two buttons;
 * lines are marked "uncertain" when nobody switched speaker, so the review page can ask.
 */
export function Recorder({
  disabled,
  lang,
  names,
  onDone,
}: {
  disabled?: boolean;
  lang: "hi-IN" | "en-IN";
  names: { worker: string; hirer: string };
  onDone: (audio: Blob | null, seconds: number, segments: Segment[], speechError: string | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [secs, setSecs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(28).fill(0.08));
  const [speaker, setSpeakerState] = useState<Role>("hirer");
  const [lines, setLines] = useState<Segment[]>([]);
  const [interim, setInterim] = useState("");
  const [canCaption, setCanCaption] = useState(true);

  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const started = useRef(0);
  const recog = useRef<Recognition | null>(null);
  const listening = useRef(false);
  const speakerRef = useRef<Role>("hirer");
  const switched = useRef(false);
  const segs = useRef<Segment[]>([]);
  const interimRef = useRef("");
  const speechError = useRef<string | null>(null);
  const recogEnded = useRef<(() => void) | null>(null);

  useEffect(() => setCanCaption(recognitionCtor() !== null), []);

  const cleanup = () => {
    cancelAnimationFrame(raf.current);
    if (timer.current) clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    ctx.current?.close().catch(() => {});
    ctx.current = null;
    listening.current = false;
    recog.current?.abort();
  };
  useEffect(() => cleanup, []);

  const elapsed = () => Math.round((Date.now() - started.current) / 1000);

  function setSpeaker(r: Role) {
    if (r !== speakerRef.current) switched.current = true;
    speakerRef.current = r;
    setSpeakerState(r);
  }

  function addLine(text: string) {
    const t = text.trim();
    if (!t) return;
    const seg: Segment = { speaker: speakerRef.current, text: t, t: elapsed() };
    segs.current = [...segs.current, seg];
    setLines(segs.current);
  }

  function startRecognition() {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      speechError.current = "This browser cannot turn speech into text. Use Chrome or Edge, or type the conversation.";
      return;
    }
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) addLine(res[0].transcript);
        else live += res[0].transcript;
      }
      interimRef.current = live;
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        speechError.current = "Speech-to-text was blocked by the browser.";
        listening.current = false;
      } else if (e.error === "network") {
        speechError.current = "Speech-to-text needs an internet connection in this browser.";
        listening.current = false;
      }
    };
    // Browsers end recognition after a pause; keep listening until the person taps stop.
    r.onend = () => {
      if (listening.current) {
        try {
          r.start();
          return;
        } catch {
          /* fall through */
        }
      }
      recogEnded.current?.();
    };
    recog.current = r;
    listening.current = true;
    try {
      r.start();
    } catch {
      speechError.current = "Speech-to-text could not start.";
      listening.current = false;
    }
  }

  async function start() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mr = new MediaRecorder(s);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.start();
      rec.current = mr;

      const ac = new AudioContext();
      ctx.current = ac;
      const an = ac.createAnalyser();
      an.fftSize = 64;
      ac.createMediaStreamSource(s).connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteFrequencyData(data);
        setLevels(Array.from({ length: 28 }, (_, i) => Math.max(0.08, (data[i % data.length] ?? 0) / 255)));
        raf.current = requestAnimationFrame(tick);
      };
      tick();

      segs.current = [];
      setLines([]);
      setInterim("");
      interimRef.current = "";
      switched.current = false;
      speechError.current = null;
      started.current = Date.now();
      setSecs(0);
      timer.current = setInterval(() => setSecs(elapsed()), 250);
      setPhase("recording");
      startRecognition();
    } catch {
      setPhase("denied");
    }
  }

  async function stop() {
    setPhase("finishing");
    const seconds = elapsed();
    const mr = rec.current;
    const audio = await new Promise<Blob | null>((resolve) => {
      if (!mr || mr.state === "inactive") return resolve(null);
      mr.onstop = () => resolve(new Blob(chunks.current, { type: mr.mimeType || "audio/webm" }));
      mr.stop();
    });
    // Let the recognizer deliver its last words (up to 1.5 s).
    if (recog.current && listening.current) {
      listening.current = false;
      await new Promise<void>((resolve) => {
        const done = setTimeout(resolve, 1500);
        recogEnded.current = () => {
          clearTimeout(done);
          resolve();
        };
        recog.current?.stop();
      });
    }
    if (interimRef.current.trim()) addLine(interimRef.current);
    cleanup();
    const out = switched.current ? segs.current : segs.current.map((s) => ({ ...s, uncertain: true }));
    setPhase("idle");
    onDone(audio, seconds, out, out.length ? null : speechError.current);
  }

  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const recording = phase === "recording";

  return (
    <div className="flex flex-col items-center gap-5 py-4">
      <div className="relative">
        {recording && <span className="absolute inset-0 animate-pulseRing rounded-full bg-saffron" aria-hidden />}
        <button
          type="button"
          disabled={disabled || phase === "finishing"}
          onClick={recording ? stop : start}
          className={cn(
            "relative flex h-28 w-28 items-center justify-center rounded-full text-cream shadow-lift transition focus-visible:outline-none focus-visible:ring-8 disabled:opacity-40",
            recording ? "bg-alert focus-visible:ring-alert/25" : "bg-navy hover:scale-105 focus-visible:ring-saffron/30",
          )}
          aria-label={recording ? "Stop recording" : "Start recording"}
        >
          {recording ? <Square size={36} fill="currentColor" /> : <Mic size={44} />}
        </button>
      </div>

      <div className="flex h-12 items-center gap-1" aria-hidden>
        {levels.map((l, i) => (
          <span
            key={i}
            className={cn("w-1.5 rounded-full transition-[height] duration-75", recording ? "bg-saffron" : "bg-line")}
            style={{ height: `${Math.round(l * 48)}px` }}
          />
        ))}
      </div>

      {recording && (
        <div className="w-full max-w-md space-y-2">
          <p className="text-center text-sm font-semibold text-navy">Who is speaking now? · अभी कौन बोल रहा है?</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who is speaking">
            {(["worker", "hirer"] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={speaker === r}
                onClick={() => setSpeaker(r)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border-2 py-2.5 text-sm font-bold transition",
                  speaker === r ? "border-saffron bg-saffron text-white" : "border-line bg-paper text-navy",
                )}
              >
                {r === "worker" ? <Wrench size={16} /> : <UserRound size={16} />}
                {names[r] || (r === "worker" ? "Worker" : "Hirer")}
              </button>
            ))}
          </div>
        </div>
      )}

      {(recording || phase === "finishing") && canCaption && (
        <div className="max-h-48 w-full max-w-xl overflow-y-auto rounded-xl bg-cream p-3 text-sm" aria-live="polite" aria-label="Live captions">
          {lines.length === 0 && !interim && <p className="text-navy-muted">Start talking. The words appear here as they are heard.</p>}
          {lines.map((l, i) => (
            <p key={i}>
              <b>{l.speaker === "worker" ? names.worker || "Worker" : names.hirer || "Hirer"}:</b> {l.text}
            </p>
          ))}
          {interim && <p className="italic text-navy-muted">{interim}…</p>}
        </div>
      )}

      <p className="text-center font-semibold text-navy" aria-live="polite">
        {recording ? (
          <>
            Recording <span className="font-mono">{mmss}</span> · tap to stop
          </>
        ) : phase === "finishing" ? (
          "Finishing…"
        ) : phase === "denied" ? (
          <span className="text-alert">Microphone unavailable. Allow the microphone, or type the conversation below.</span>
        ) : (
          <>
            Tap to record the conversation
            <span className="block text-sm font-normal text-navy-muted">बातचीत रिकॉर्ड करने के लिए टैप करें</span>
          </>
        )}
      </p>
      {!canCaption && phase === "idle" && (
        <p className="max-w-md text-center text-xs text-amber-ink">This browser can record but cannot turn speech into text. Use Chrome or Edge, or type the conversation.</p>
      )}
    </div>
  );
}
