"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { recognitionCtor, type Recognition } from "@/lib/speech";
import { cn } from "./ui";

/**
 * Speak instead of typing. Uses the browser's speech recognition when it exists; hidden otherwise
 * (typing always works, including offline demo mode).
 */
export function Dictate({ lang, onText, className }: { lang: "hi" | "en"; onText: (text: string) => void; className?: string }) {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => rec.current?.stop();
  }, []);
  if (!supported) return null;

  function toggle() {
    if (on) {
      rec.current?.stop();
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = lang === "hi" ? "hi-IN" : "en-IN";
    r.interimResults = false;
    r.continuous = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) onText(res[0].transcript.trim());
      }
    };
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  }

  return (
    <button type="button" className={cn("btn-ghost py-2 text-sm", on && "border-alert text-alert", className)} aria-pressed={on} onClick={toggle}>
      {on ? <Square size={15} /> : <Mic size={16} />} {on ? "Stop" : "Speak · बोलिए"}
    </button>
  );
}
