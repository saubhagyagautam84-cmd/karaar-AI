"use client";

import { useSyncExternalStore } from "react";
import { Accessibility } from "lucide-react";
import { cn } from "./ui";

/** B3: "Easy mode" (bigger text and buttons, stronger contrast, big Listen buttons, no motion). Same colours. */
const KEY = "karaar.easy";
const listeners = new Set<() => void>();

export function isEasy(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("easy");
}

function setEasy(on: boolean) {
  document.documentElement.classList.toggle("easy", on);
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

export function useEasy(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    isEasy,
    () => false,
  );
}

/** Runs before the page paints, so there is no flash of small text. */
export function A11yScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `try{if(localStorage.getItem("${KEY}")==="1")document.documentElement.classList.add("easy")}catch(e){}`,
      }}
    />
  );
}

export function EasyToggle({ className }: { className?: string }) {
  const on = useEasy();
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setEasy(!on)}
      className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold", on ? "border-navy bg-navy text-cream" : "border-line bg-paper text-navy", className)}
      title="Bigger text and buttons, stronger contrast, bigger Listen buttons, no motion"
    >
      <Accessibility size={15} /> <span>Easy · आसान</span>
    </button>
  );
}
