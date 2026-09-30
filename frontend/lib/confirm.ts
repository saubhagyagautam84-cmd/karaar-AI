/**
 * Recording a "Haan, pakka" (WhatsApp, in person or IVR) and sealing once both have said it.
 * Shared by the confirm page, the IVR demo and change orders, so every channel seals the same way.
 */
import type { Agreement, Amendment, Channel, Role } from "./types";
import { hashAgreement, hashAmendment } from "./hash";
import { persistAmendment, persistSeal } from "./api";
import { chainHead } from "./amend";
import { summaryLang } from "./languages";

const now = () => new Date().toISOString();
const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "via WhatsApp",
  in_app: "in person, on this device",
  ivr: "by phone call (IVR)",
};

export function replyFor(lang: string): string {
  return summaryLang(lang) === "hi" ? "हाँ, पक्का ✅" : "Haan, pakka ✅";
}

/** Adds one party's confirmation; seals (and stores the seal) when both have confirmed. */
export async function confirmAgreement(a: Agreement, role: Role, channel: Channel): Promise<{ next: Agreement; sealed: boolean }> {
  const party = a[role];
  const next: Agreement = {
    ...a,
    confirmations: { ...a.confirmations, [role]: { at: now(), channel, reply: replyFor(party.lang), lang: party.lang } },
    events: [...a.events, { at: now(), label: `${party.name} confirmed`, detail: CHANNEL_LABEL[channel] }],
  };
  if (!(next.confirmations.worker && next.confirmations.hirer)) return { next, sealed: false };
  next.hash = await hashAgreement(next);
  next.sealedAt = now();
  next.status = "sealed";
  next.events = [...next.events, { at: next.sealedAt, label: "Sealed (SHA-256)", detail: next.hash.slice(0, 16) + "…" }];
  await persistSeal(next); // live mode: the server re-computes and refuses a mismatch
  return { next, sealed: true };
}

/** Same for a change order / settlement: sealed on its own, chained to the previous hash. */
export async function confirmAmendment(a: Agreement, amendmentId: string, role: Role, channel: Channel): Promise<{ next: Agreement; sealed: boolean }> {
  const list = a.amendments ?? [];
  const am = list.find((x) => x.id === amendmentId);
  if (!am || am.hash) return { next: a, sealed: false };
  const party = a[role];
  const updated: Amendment = {
    ...am,
    confirmations: { ...am.confirmations, [role]: { at: now(), channel, reply: replyFor(party.lang), lang: party.lang } },
  };
  let sealed = false;
  if (updated.confirmations.worker && updated.confirmations.hirer) {
    updated.parentHash = chainHead(a); // chain to whatever was sealed last, even if another change sealed meanwhile
    updated.hash = await hashAmendment(updated);
    updated.sealedAt = now();
    sealed = true;
  }
  const next: Agreement = {
    ...a,
    // Array order is chain order: a newly sealed amendment goes right after the last sealed one.
    amendments: sealed
      ? [...list.filter((x) => x.hash), updated, ...list.filter((x) => !x.hash && x.id !== am.id)]
      : list.map((x) => (x.id === am.id ? updated : x)),
    events: [
      ...a.events,
      { at: now(), label: `${party.name} confirmed ${am.source === "settlement" ? "the settlement" : "a change"}`, detail: CHANNEL_LABEL[channel] },
      ...(sealed ? [{ at: updated.sealedAt as string, label: `${am.source === "settlement" ? "Settlement" : "Change order"} sealed (SHA-256)`, detail: `${am.id} · ${(updated.hash as string).slice(0, 16)}…` }] : []),
    ],
  };
  if (sealed) await persistAmendment(next, updated);
  return { next, sealed };
}
