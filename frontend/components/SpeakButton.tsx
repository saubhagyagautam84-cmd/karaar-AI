"use client";

import { useEffect, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { useEasy } from "./A11y";
import { cn } from "./ui";

/** Text with WhatsApp *bold* markers, emoji and symbols read out naturally. */
export function speakable(text: string): string {
  return text
    .replace(/\*/g, "")
    .replace(/[🧾✅✏️⚠]/gu, "")
    .replace(/₹\s?([\d,]+)/g, (_, n: string) => `${n.replace(/,/g, "")} rupees`)
    .replace(/↔/g, ",");
}

/** Pick the best available voice for Hindi or English (Indian English first). */
export function pickVoice(lang: "hi" | "en"): SpeechSynthesisVoice | undefined {
  const voices = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis.getVoices() : [];
  const want = lang === "hi" ? ["hi-IN", "hi"] : ["en-IN", "en-GB", "en-US", "en"];
  for (const w of want) {
    const v = voices.find((x) => x.lang.toLowerCase().startsWith(w.toLowerCase()));
    if (v) return v;
  }
  return undefined;
}

/**
 * Speak text with the browser's Web Speech API. Falls back to an English voice when no Hindi
 * voice is installed. Live mode could swap in Bhashini TTS behind the same call.
 */
export function speak(text: string, lang: "hi" | "en", onEnd?: () => void): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(speakable(text));
  const voice = pickVoice(lang) ?? pickVoice("en");
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else {
    u.lang = lang === "hi" ? "hi-IN" : "en-IN";
  }
  u.rate = 0.95;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  synth.speak(u);
  return true;
}

/** B1: "🔊 Listen" button that reads a summary in the party's language. */
export function SpeakButton({ text, lang, className, label }: { text: string; lang: "hi" | "en"; className?: string; label?: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(true);
  const easy = useEasy();
  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    // Voices load asynchronously in some browsers.
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.getVoices();
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);
  if (!supported) return null;
  return (
    <button
      type="button"
      className={cn("btn-ghost py-2 text-sm", className, easy && "w-full border-2 border-navy py-3 text-base")}
      aria-pressed={speaking}
      onClick={() => {
        if (speaking) {
          window.speechSynthesis.cancel();
          setSpeaking(false);
          return;
        }
        setSpeaking(speak(text, lang, () => setSpeaking(false)));
      }}
    >
      {speaking ? <Square size={15} /> : <Volume2 size={16} />}
      {speaking ? "Stop" : label ?? (lang === "hi" ? "सुनिए · Listen" : "Listen · सुनिए")}
    </button>
  );
}
