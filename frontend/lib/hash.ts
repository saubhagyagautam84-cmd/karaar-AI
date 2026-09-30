import type { Agreement, Amendment } from "./types";

/** Deterministic JSON: sorted keys, no undefined. Same input -> same bytes -> same hash. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(o[k]))
      .join(",") +
    "}"
  );
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function maskPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length >= 4 ? `xxxxxx${d.slice(-4)}` : "xxxx";
}

/** Exactly what gets sealed. Phone numbers are hashed; audio is referenced, never stored in the record. */
export async function sealPayload(a: Agreement) {
  return {
    id: a.id,
    createdAt: a.createdAt,
    worker: { name: a.worker.name, phoneHash: a.worker.phoneHash ?? (await sha256Hex("karaar:" + a.worker.phone.replace(/\D/g, ""))) },
    hirer: { name: a.hirer.name, phoneHash: a.hirer.phoneHash ?? (await sha256Hex("karaar:" + a.hirer.phone.replace(/\D/g, ""))) },
    consent: a.consent,
    terms: a.terms,
    transcript: a.transcript,
    confirmations: a.confirmations,
  };
}

export async function hashAgreement(a: Agreement): Promise<string> {
  return sha256Hex(canonical(await sealPayload(a)));
}

/**
 * A change order or settlement is sealed on its own, chained to the hash before it
 * (the agreement's, or the previous amendment's). The original seal never changes.
 */
export function amendmentPayload(am: Amendment) {
  return {
    id: am.id,
    createdAt: am.createdAt,
    source: am.source,
    description: am.description,
    transcript: am.transcript,
    delta: am.delta,
    parentHash: am.parentHash,
    confirmations: am.confirmations,
  };
}

export async function hashAmendment(am: Amendment): Promise<string> {
  return sha256Hex(canonical(amendmentPayload(am)));
}

/** SHA-256 of raw bytes (photos). */
export async function sha256Bytes(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function shortHash(h?: string) {
  return h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "—";
}

/**
 * Re-checks the whole chain: the agreement's seal, then every sealed amendment's own hash and its
 * link to the one before. Returns the first broken link, if any.
 */
export async function verifyChain(a: Agreement): Promise<{ ok: boolean; checked: number; broken?: string }> {
  if (!a.hash || (await hashAgreement(a)) !== a.hash) return { ok: false, checked: 0, broken: a.id };
  let head = a.hash;
  let checked = 1;
  for (const am of (a.amendments ?? []).filter((x) => x.hash)) {
    if (am.parentHash !== head || (await hashAmendment(am)) !== am.hash) return { ok: false, checked, broken: am.id };
    head = am.hash as string;
    checked++;
  }
  return { ok: true, checked };
}
