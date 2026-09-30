/**
 * API adapter. With NEXT_PUBLIC_API_URL unset, everything runs in "demo mode":
 * speech, extraction, WhatsApp and UPI are simulated in the browser with realistic latency.
 * Point NEXT_PUBLIC_API_URL at the FastAPI backend to go live — the function signatures stay the same.
 */
import type { Agreement, Amendment, DisputeReason, Flag, Mediation, Photo, Role, Segment, Terms, TermsDelta } from "./types";
import { mockExtract } from "./extract";
import { extractDelta } from "./amend";
import { mediate as mediateLocally } from "./mediator";

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
export const DEMO_MODE = !BASE;
export const DEMO_VPA = process.env.NEXT_PUBLIC_DEMO_UPI_VPA || "karaar.demo@upi";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The backend's plain-language error, or a generic one. */
async function failure(res: Response, path: string): Promise<Error> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return new Error(body.detail);
  } catch {
    /* not JSON */
  }
  return new Error(`${path} failed: ${res.status}`);
}

/** JSON request to the backend; `token` adds the signed-in session (phone OTP login). */
export async function send<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw await failure(res, path);
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) => send<T>("POST", path, body);
const get = <T>(path: string) => send<T>("GET", path);

/** Speech-to-text (Bhashini ASR, Whisper fallback). POST /v1/transcribe (multipart). */
export async function transcribe(audio: Blob | null, lang: string): Promise<Segment[]> {
  // Never returns a sample for a real recording: without a speech service there is no transcript.
  if (DEMO_MODE || !audio) throw new Error("Speech-to-text is not configured on the server.");
  const fd = new FormData();
  fd.append("audio", audio, "deal.webm");
  fd.append("lang", lang);
  const res = await fetch(`${BASE}/v1/transcribe`, { method: "POST", body: fd });
  if (!res.ok) throw await failure(res, "/v1/transcribe");
  return (await res.json()).segments as Segment[];
}

/** LLM extraction with strict JSON + ambiguity detection. POST /v1/extract */
export async function extract(transcript: Segment[], hints: { jobType?: string; location?: string }): Promise<{ terms: Terms; flags: Flag[] }> {
  if (DEMO_MODE) {
    await sleep(1600);
    return mockExtract(transcript, hints);
  }
  return post("/v1/extract", { transcript, hints });
}

/** Send the bilingual summary to a party over WhatsApp (Twilio). POST /v1/notify/whatsapp */
export async function sendSummary(a: Agreement, role: Role, text: string): Promise<{ messageId: string }> {
  if (DEMO_MODE) {
    await sleep(700);
    return { messageId: `wamid.demo.${role}.${Date.now()}` };
  }
  // A raw number is passed for this one send (real WhatsApp needs it); the backend never stores it.
  const phone = a[role].phone.startsWith("xxxx") ? undefined : a[role].phone;
  return post("/v1/notify/whatsapp", { agreementId: a.id, role, text, phone });
}

/** Store the sealed record server-side (append-only audit log). POST /v1/agreements/:id/seal */
export async function persistSeal(a: Agreement): Promise<void> {
  if (DEMO_MODE) {
    await sleep(500);
    return;
  }
  // The backend re-computes the SHA-256 seal from the agreement and refuses a mismatch.
  await post(`/v1/agreements/${a.id}/seal`, { hash: a.hash, agreement: a });
}

/** UPI intent link (NPCI deep-link spec). Works with any UPI app on a phone. */
export function upiLink(opts: { vpa: string; name: string; amount: number; note: string; ref: string }) {
  const p = new URLSearchParams({
    pa: opts.vpa,
    pn: opts.name,
    am: opts.amount.toFixed(2),
    cu: "INR",
    tn: opts.note,
    tr: opts.ref,
  });
  return `upi://pay?${p.toString()}`;
}

/** Payment confirmation. Live mode: GET /v1/payments/:ref (fed by the PSP webhook). */
export async function confirmPayment(ref: string): Promise<{ upiRef: string }> {
  if (DEMO_MODE) {
    await sleep(1500);
    return { upiRef: `UPI${Math.floor(100000000 + Math.random() * 899999999)}` };
  }
  return get(`/v1/payments/${encodeURIComponent(ref)}`);
}

// ---- Live mode only: the backend keeps the shared copy of every agreement. ----

/** All agreements, newest first. Phones come back masked, with the seal's phoneHash. */
export function fetchAgreements(): Promise<Agreement[]> {
  return get("/v1/agreements");
}

/** Create or update an agreement. Sealed terms can never change: the backend answers 409. */
export function putAgreement(a: Agreement): Promise<Agreement> {
  return send("PUT", `/v1/agreements/${encodeURIComponent(a.id)}`, a);
}

/** The server re-hashes its own stored copy of a sealed agreement. */
export function verifyOnServer(id: string): Promise<{ sealed: boolean; valid: boolean | null; storedHash: string | null }> {
  return get(`/v1/agreements/${encodeURIComponent(id)}/verify`);
}

/** Clears the backend's demo agreements (DEMO_MODE on the server). */
export function resetServer(): Promise<{ removed: number }> {
  return post("/v1/demo/reset", {});
}

export interface Dashboard {
  monthly: { label: string; value: number }[];
  wages: { label: string; value: number }[];
  delays: { label: string; value: number }[];
  disputes: { label: string; value: number }[];
  kpis: { agreements: number; medianWage: number; onTime: number; disputeRate: number; avgDelay: number };
  meta?: { k: number; synthetic: number; real: number; suppressed: string[] };
}

/** Governance aggregates, k-anonymised server-side. */
export function fetchDashboard(state: string, trade: string, months: number): Promise<Dashboard> {
  const q = new URLSearchParams({ state, trade, months: String(months) });
  return get(`/v1/analytics?${q.toString()}`);
}

export interface BackendHealth {
  status: string;
  providers: Record<string, string>;
  simulated: string[];
  demoMode: boolean;
}

let health: Promise<BackendHealth | null> | null = null;

/** Which services the backend simulates (cached for the session). Null in demo mode or when unreachable. */
export function backendHealth(): Promise<BackendHealth | null> {
  if (DEMO_MODE) return Promise.resolve(null);
  health ??= get<BackendHealth>("/v1/health").catch(() => {
    health = null;
    return null;
  });
  return health;
}

// ---- Phase A: milestones, photos, change orders, mediator, IVR ----

/** Change order: extract only what changed. POST /v1/amendments/extract */
export async function extractChange(transcript: Segment[], terms: Terms): Promise<TermsDelta> {
  if (DEMO_MODE) {
    await sleep(900);
    return extractDelta(transcript);
  }
  return post("/v1/amendments/extract", { transcript, terms });
}

/** Store a sealed change order / settlement. The server re-hashes it and checks the chain. POST /v1/amendments */
export async function persistAmendment(a: Agreement, amendment: Amendment): Promise<void> {
  if (DEMO_MODE) {
    await sleep(400);
    return;
  }
  await post("/v1/amendments", { agreementId: a.id, amendment });
}

/**
 * Upload a proof photo. The server re-computes the SHA-256 of the bytes and must get the
 * same value as the browser. POST /v1/photos (multipart). Demo mode: IndexedDB only.
 */
export async function uploadPhoto(blob: Blob, photo: Photo, agreementId: string, milestoneId: string): Promise<Photo> {
  if (DEMO_MODE) return photo;
  const fd = new FormData();
  fd.append("image", blob, `${photo.id}.jpg`);
  fd.append("photoId", photo.id);
  fd.append("agreementId", agreementId);
  fd.append("milestoneId", milestoneId);
  fd.append("kind", photo.kind);
  fd.append("hash", photo.hash);
  const res = await fetch(`${BASE}/v1/photos`, { method: "POST", body: fd });
  if (!res.ok) throw await failure(res, "/v1/photos");
  const saved = (await res.json()) as { id: string; hash: string; url: string };
  if (saved.hash !== photo.hash) throw new Error("The server computed a different photo hash. Please try again.");
  return { ...photo, url: `${BASE}${saved.url}` };
}

export type MilestoneAction = "submit" | "approve" | "reject";

/** Live mode: the server applies the milestone transition and returns the updated agreement. */
export async function milestoneOnServer(a: Agreement, milestoneId: string, action: MilestoneAction, extra: { photos?: Photo[]; reason?: string } = {}): Promise<Agreement> {
  return post(`/v1/milestones/${encodeURIComponent(milestoneId)}/${action}`, { agreementId: a.id, ...extra });
}

/** AI dispute mediator. POST /v1/mediate (rules; an LLM may rewrite the wording, never the numbers). */
export async function mediate(a: Agreement, reason: DisputeReason): Promise<Mediation> {
  if (DEMO_MODE) {
    await sleep(1200);
    return mediateLocally(a, reason);
  }
  return post("/v1/mediate", { agreement: a, reason });
}

/** IVR (A5): start a simulated call. Live: POST /v1/ivr/call (Exotel / Twilio Voice). */
export async function ivrCall(a: Agreement, role: Role): Promise<{ callId: string }> {
  if (DEMO_MODE) {
    await sleep(600);
    return { callId: `call-demo-${Date.now()}` };
  }
  return post("/v1/ivr/call", { agreementId: a.id, role });
}

/** IVR keypress, as the telephony provider's webhook would report it. POST /v1/ivr/webhook */
export async function ivrKey(callId: string, a: Agreement, role: Role, digits: string): Promise<{ action: "confirm" | "change" | "repeat" | "unknown" }> {
  const action = digits === "1" ? "confirm" : digits === "2" ? "change" : digits === "9" ? "repeat" : "unknown";
  if (DEMO_MODE) return { action };
  return post("/v1/ivr/webhook", { callId, agreementId: a.id, role, digits });
}
