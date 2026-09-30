"use client";

import { useSyncExternalStore } from "react";

/** B7: who is signed in on this device (phone OTP). The raw number is never kept, only the masked one and its hash. */
export type AccountRole = "worker" | "hirer" | "contractor" | "officer";

export interface Session {
  token: string;
  role: AccountRole;
  phone: string; // masked, e.g. xxxxxx2345
  phoneHash: string;
}

const KEY = "karaar.session.v1";
const listeners = new Set<() => void>();
let cached: Session | null | undefined;

function read(): Session | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function getSession(): Session | null {
  return typeof window === "undefined" ? null : read();
}

export function setSession(s: Session | null) {
  cached = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: keep in memory */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSession, () => null);
}

export const ROLE_LABEL: Record<AccountRole, { en: string; hi: string }> = {
  worker: { en: "Worker", hi: "कारीगर" },
  hirer: { en: "Hirer", hi: "काम देने वाले" },
  contractor: { en: "Contractor", hi: "ठेकेदार" },
  officer: { en: "Labour officer", hi: "श्रम अधिकारी" },
};
