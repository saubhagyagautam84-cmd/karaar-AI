"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Agreement } from "./types";
import { buildSeed } from "./seed";
import { DEMO_MODE, fetchAgreements, putAgreement, resetServer } from "./api";
import { clearOutbox, dequeue, enqueue, pendingAll } from "./outbox";

const KEY = "karaar.agreements.v1";

interface StoreCtx {
  ready: boolean;
  agreements: Agreement[];
  get: (id: string) => Agreement | undefined;
  save: (a: Agreement) => void;
  reset: () => Promise<void>;
  /** Live mode: "server" when the backend holds the shared copy; "local" in demo mode or when it is unreachable. */
  source: "server" | "local";
  /** Resolves once every queued save of this agreement has reached the server. */
  flush: (id: string) => Promise<void>;
  /** B2: whether the backend is reachable, and how many agreements have changes waiting to sync. */
  online: boolean;
  pending: number;
  /** The last save the server refused (e.g. an edit to sealed terms), shown to the user. */
  syncError: string | null;
}

const Ctx = createContext<StoreCtx | null>(null);

function persist(list: Agreement[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode) — keep in memory */
  }
}

function readLocal(): Agreement[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** fetch() rejects with a TypeError when there is no connection; anything else is the server's answer. */
const isNetworkError = (e: unknown) => e instanceof TypeError;

async function seedServer(): Promise<Agreement[]> {
  const seed = await buildSeed();
  for (const a of [...seed].reverse()) await putAgreement(a);
  return seed;
}

export function AgreementsProvider({ children }: { children: React.ReactNode }) {
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<"server" | "local">("local");
  const [online, setOnline] = useState(true);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [syncError, setSyncError] = useState<string | null>(null);

  // Writes go out one at a time per agreement, always sending the newest copy.
  const latest = useRef(new Map<string, Agreement>());
  const queue = useRef(new Map<string, Promise<void>>());

  const markPending = useCallback(
    (id: string, on: boolean) =>
      setPendingIds((prev) => {
        if (prev.has(id) === on) return prev;
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );

  const push = useCallback(
    (a: Agreement) => {
      latest.current.set(a.id, a);
      markPending(a.id, true);
      const prev = queue.current.get(a.id) ?? Promise.resolve();
      const next = prev.then(async () => {
        const current = latest.current.get(a.id);
        if (!current) return;
        latest.current.delete(a.id);
        try {
          // Outbox first, so a closed tab or dropped network loses nothing.
          await enqueue(current).catch(() => undefined);
          await putAgreement(current);
          if (!latest.current.has(a.id)) {
            await dequeue(a.id).catch(() => undefined);
            markPending(a.id, false);
          }
          setOnline(true);
        } catch (e) {
          if (isNetworkError(e)) {
            setOnline(false); // stays in the outbox; replayed when the connection is back
          } else {
            // The server refused it (e.g. sealed terms changed). Retrying would not help.
            await dequeue(a.id).catch(() => undefined);
            markPending(a.id, false);
            setSyncError(`${a.id}: ${e instanceof Error ? e.message : "not saved on the server"}`);
            console.error(`Karaar: the server refused ${a.id}`, e);
          }
        }
      });
      queue.current.set(a.id, next);
      return next;
    },
    [markPending],
  );

  /** Replay the outbox (on load, on reconnect, and every 20 s while something is waiting). */
  const replay = useCallback(async () => {
    if (DEMO_MODE) return;
    const waiting = await pendingAll().catch(() => [] as Agreement[]);
    await Promise.all(waiting.map((a) => push(a)));
  }, [push]);

  useEffect(() => {
    let alive = true;
    (async () => {
      let list: Agreement[] | null = null;
      let from: "server" | "local" = "local";
      if (!DEMO_MODE) {
        await replay();
        try {
          list = await fetchAgreements();
          if (list.length === 0) list = await seedServer();
          from = "server";
          // Copies still waiting in the outbox are newer than the server's.
          const waiting = await pendingAll().catch(() => [] as Agreement[]);
          for (const w of waiting) list = [w, ...list.filter((x) => x.id !== w.id)];
        } catch (e) {
          console.warn("Karaar: backend unreachable, working offline on this device's copy", e);
          setOnline(false);
          list = null;
        }
      }
      if (!list) list = readLocal();
      if (!list) list = await buildSeed();
      persist(list);
      if (alive) {
        setAgreements(list);
        setSource(from);
        setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [replay]);

  // Back online: send what was queued, then switch to the server's copy if we started offline.
  const pendingCount = pendingIds.size;
  useEffect(() => {
    if (DEMO_MODE) return;
    const up = async () => {
      await replay();
      if (source !== "local") return;
      try {
        const list = await fetchAgreements();
        setOnline(true);
        if (list.length) {
          persist(list);
          setAgreements(list);
          setSource("server");
        }
      } catch {
        setOnline(false);
      }
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const timer = setInterval(() => {
      if (pendingCount || source === "local") void up();
    }, 20000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(timer);
    };
  }, [replay, source, pendingCount]);

  const save = useCallback(
    (a: Agreement) => {
      setAgreements((prev) => {
        const next = prev.some((x) => x.id === a.id) ? prev.map((x) => (x.id === a.id ? a : x)) : [a, ...prev];
        persist(next);
        return next;
      });
      if (DEMO_MODE) return;
      void push(a);
    },
    [push],
  );

  const get = useCallback((id: string) => agreements.find((a) => a.id === id), [agreements]);

  const reset = useCallback(async () => {
    let seed: Agreement[];
    if (!DEMO_MODE && source === "server") {
      await clearOutbox().catch(() => undefined);
      setPendingIds(new Set());
      await resetServer();
      seed = await seedServer();
    } else {
      seed = await buildSeed();
    }
    persist(seed);
    setAgreements(seed);
  }, [source]);

  const flush = useCallback((id: string) => queue.current.get(id) ?? Promise.resolve(), []);

  const value = useMemo(
    () => ({ ready, agreements, get, save, reset, source, flush, online, pending: pendingCount, syncError }),
    [ready, agreements, get, save, reset, source, flush, online, pendingCount, syncError],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAgreements() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAgreements must be used inside AgreementsProvider");
  return c;
}

export function newId() {
  // 6000-9999: never collides with the seeded history (KR-4821 … KR-5232).
  const n = Math.floor(6000 + Math.random() * 4000);
  return `KR-${n}`;
}

export function nowIso() {
  return new Date().toISOString();
}
