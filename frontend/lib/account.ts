/**
 * Phase B account features: phone OTP login (B7), public seal verification (B5), consent-based
 * sharing with an access log (B6). Live mode calls the backend; demo mode keeps the same data on
 * this device so everything still works with no backend and no internet.
 */
import type { Agreement } from "./types";
import { DEMO_MODE, send } from "./api";
import { hashAmendment, hashAgreement, maskPhone, sha256Hex, verifyChain } from "./hash";
import { paidTotal } from "./terms";
import type { AccountRole, Session } from "./session";

export const DEMO_OTP = "123456";
const AGREEMENTS = "karaar.agreements.v1";
const SHARES = "karaar.shares.v1";
const LOG = "karaar.accesslog.v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function tenDigits(phone: string): string | null {
  let d = phone.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(-10);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export const phoneHashOf = (phone: string) => sha256Hex("karaar:" + phone.replace(/\D/g, ""));

// ---- B7: OTP login ----

export async function sendOtp(phone: string): Promise<{ to: string; demoCode: string | null }> {
  const d = tenDigits(phone);
  if (!d) throw new Error("Enter a 10-digit Indian mobile number.");
  if (DEMO_MODE) {
    await sleep(600);
    return { to: maskPhone(d), demoCode: DEMO_OTP };
  }
  return send("POST", "/v1/auth/otp/send", { phone: d });
}

export async function verifyOtp(phone: string, code: string, role: AccountRole): Promise<Session> {
  const d = tenDigits(phone);
  if (!d) throw new Error("Enter a 10-digit Indian mobile number.");
  if (DEMO_MODE) {
    await sleep(500);
    if (code.trim() !== DEMO_OTP) throw new Error("That code is not right. In demo mode it is 123456.");
    return { token: `demo-${Date.now()}`, role, phone: maskPhone(d), phoneHash: await phoneHashOf(d) };
  }
  return send("POST", "/v1/auth/otp/verify", { phone: d, code: code.trim(), role });
}

export async function logoutServer(s: Session): Promise<void> {
  if (!DEMO_MODE) await send("POST", "/v1/auth/logout", {}, s.token).catch(() => undefined);
}

// ---- B5: public verification ----

export interface PublicVerification {
  found: boolean;
  kind?: "agreement" | "change order" | "settlement";
  id?: string;
  valid?: boolean;
  chainOk?: boolean;
  sealedAt?: string;
  status?: string;
  jobType?: string;
  area?: string | null;
  worker?: string;
  hirer?: string;
  changes?: number;
}

export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] ?? "—";
}

export async function verifyPublic(seal: string): Promise<PublicVerification> {
  if (!/^[0-9a-f]{64}$/.test(seal)) throw new Error("That is not a Karaar seal (64 hex characters).");
  if (!DEMO_MODE) return send("GET", `/v1/verify/${seal}`);
  await sleep(400);
  for (const a of readJson<Agreement[]>(AGREEMENTS, [])) {
    let kind: PublicVerification["kind"] | null = null;
    let valid = false;
    if (a.hash === seal) {
      kind = "agreement";
      valid = (await hashAgreement(a)) === seal;
    } else {
      const am = (a.amendments ?? []).find((x) => x.hash === seal);
      if (am) {
        kind = am.source === "settlement" ? "settlement" : "change order";
        valid = (await hashAmendment(am)) === seal;
      }
    }
    if (!kind) continue;
    return {
      found: true, kind, id: a.id, valid, chainOk: (await verifyChain(a)).ok, sealedAt: a.sealedAt, status: a.status,
      jobType: a.terms.jobType, area: a.terms.location.split(",").pop()?.trim() || null,
      worker: shortName(a.worker.name), hirer: shortName(a.hirer.name),
      changes: (a.amendments ?? []).filter((x) => x.hash).length,
    };
  }
  return { found: false };
}

// ---- B6: sharing and the access log ----

export type ShareScope = "jobs" | "earnings" | "ratings";
export interface Share {
  id: string;
  recipient: string;
  scope: ShareScope[];
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}
interface LocalShare extends Share {
  subject: string;
}
export interface AccessEntry {
  at: string;
  actor: string;
  action: string;
  shareId: string | null;
}
export interface SharedHistory {
  id: string;
  recipient: string;
  scope: ShareScope[];
  expiresAt: string;
  worker: string | null;
  verifiedJobs: number;
  jobs?: { id: string; jobType: string; month: string; status: string }[];
  earnedViaUpi?: number;
  ratings?: { onTime: number; fair: number; respectful: number } | null;
}

const nowIso = () => new Date().toISOString();

function logLocal(subject: string, action: string, actor: string, shareId: string | null) {
  const all = readJson<(AccessEntry & { subject: string })[]>(LOG, []);
  writeJson(LOG, [{ subject, at: nowIso(), actor, action, shareId }, ...all].slice(0, 300));
}

/** Same rules as the backend's history(): only sealed agreements; only what the worker chose to share. */
export async function historyOf(list: Agreement[], subject: string, scope: ShareScope[]) {
  const mine: Agreement[] = [];
  for (const a of list) {
    if (a.hash && (a.worker.phoneHash ?? (await phoneHashOf(a.worker.phone))) === subject) mine.push(a);
  }
  const done = mine.filter((a) => a.status === "completed");
  const out: Omit<SharedHistory, "id" | "recipient" | "scope" | "expiresAt"> = {
    verifiedJobs: done.length,
    worker: mine[0] ? shortName(mine[0].worker.name) : null,
  };
  if (scope.includes("jobs")) out.jobs = mine.map((a) => ({ id: a.id, jobType: a.terms.jobType, month: a.createdAt.slice(0, 7), status: a.status }));
  if (scope.includes("earnings")) out.earnedViaUpi = mine.reduce((s, a) => s + paidTotal(a), 0);
  if (scope.includes("ratings")) {
    const r = done.map((a) => a.ratings?.byHirer).filter((x): x is NonNullable<typeof x> => Boolean(x));
    const avg = (k: "onTime" | "fair" | "respectful") => Math.round((r.reduce((s, x) => s + x[k], 0) / r.length) * 10) / 10;
    out.ratings = r.length ? { onTime: avg("onTime"), fair: avg("fair"), respectful: avg("respectful") } : null;
  }
  return out;
}

export async function createShare(s: Session, recipient: string, scope: ShareScope[], days = 30): Promise<Share> {
  if (!DEMO_MODE) return send("POST", "/v1/profile/share", { recipient, scope, days }, s.token);
  const now = new Date();
  const share: LocalShare = {
    id: `KRS-${Math.random().toString(16).slice(2, 10).toUpperCase()}`,
    recipient: recipient.trim() || "Unnamed recipient",
    scope,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 864e5).toISOString(),
    revokedAt: null,
    subject: s.phoneHash,
  };
  writeJson(SHARES, [share, ...readJson<LocalShare[]>(SHARES, [])]);
  logLocal(s.phoneHash, `shared ${scope.join(", ")} with ${share.recipient}`, "you", share.id);
  return share;
}

export async function listShares(s: Session): Promise<Share[]> {
  if (!DEMO_MODE) return send("GET", "/v1/profile/shares", undefined, s.token);
  return readJson<LocalShare[]>(SHARES, []).filter((x) => x.subject === s.phoneHash);
}

export async function revokeShare(s: Session, id: string): Promise<void> {
  if (!DEMO_MODE) {
    await send("DELETE", `/v1/profile/share/${encodeURIComponent(id)}`, undefined, s.token);
    return;
  }
  const all = readJson<LocalShare[]>(SHARES, []);
  const hit = all.find((x) => x.id === id && x.subject === s.phoneHash);
  if (!hit) throw new Error("No such share.");
  writeJson(SHARES, all.map((x) => (x.id === id ? { ...x, revokedAt: nowIso() } : x)));
  logLocal(s.phoneHash, `revoked access for ${hit.recipient}`, "you", id);
}

export async function accessLog(s: Session): Promise<AccessEntry[]> {
  if (!DEMO_MODE) return send("GET", "/v1/profile/access-log", undefined, s.token);
  return readJson<(AccessEntry & { subject: string })[]>(LOG, []).filter((x) => x.subject === s.phoneHash);
}

/** What the recipient sees. Every view is recorded in the worker's access log. */
export async function sharedView(id: string): Promise<SharedHistory> {
  if (!DEMO_MODE) return send("GET", `/v1/shared/${encodeURIComponent(id)}`);
  const share = readJson<LocalShare[]>(SHARES, []).find((x) => x.id === id);
  if (!share) throw new Error("This link does not exist on this device. (Demo mode keeps shares on the device that made them.)");
  if (share.revokedAt) throw new Error("The worker has withdrawn this access.");
  if (new Date(share.expiresAt) < new Date()) throw new Error("This link has expired.");
  logLocal(share.subject, "viewed your shared history", share.recipient, id);
  const h = await historyOf(readJson<Agreement[]>(AGREEMENTS, []), share.subject, share.scope);
  return { id, recipient: share.recipient, scope: share.scope, expiresAt: share.expiresAt, ...h };
}
