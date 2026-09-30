"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Fingerprint, FlaskConical, QrCode, ShieldAlert, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { hashAgreement, verifyChain } from "@/lib/hash";
import { DEMO_MODE, verifyOnServer } from "@/lib/api";
import { inr } from "@/lib/numbers";
import type { Agreement } from "@/lib/types";
import { cn } from "./ui";

/** Shows the seal, re-verifies it, and lets a judge try tampering to see the hash break. */
export function HashPanel({ a }: { a: Agreement }) {
  const [verify, setVerify] = useState<null | "checking" | "ok" | "broken">(null);
  const [copied, setCopied] = useState(false);
  const [tamperPrice, setTamperPrice] = useState<string>("");
  const [tamperHash, setTamperHash] = useState<string | null>(null);
  const [server, setServer] = useState<null | "ok" | "broken" | "offline">(null);
  const [chain, setChain] = useState<{ ok: boolean; checked: number; broken?: string } | null>(null);
  const links = (a.amendments ?? []).filter((am) => am.hash).length;

  async function check() {
    setVerify("checking");
    const h = await hashAgreement(a);
    let remote: "ok" | "broken" | "offline" | null = null;
    if (!DEMO_MODE) {
      try {
        const v = await verifyOnServer(a.id);
        remote = v.valid && v.storedHash === a.hash ? "ok" : "broken";
      } catch {
        remote = "offline";
      }
    } else {
      await new Promise((r) => setTimeout(r, 500));
    }
    const c = await verifyChain(a);
    setChain(c);
    setServer(remote);
    setVerify(h === a.hash && c.ok && remote !== "broken" ? "ok" : "broken");
  }
  async function tamper() {
    const n = parseInt(tamperPrice.replace(/\D/g, ""), 10);
    if (!n) return;
    setTamperHash(await hashAgreement({ ...a, terms: { ...a.terms, price: n } }));
  }
  function copy() {
    if (!a.hash) return;
    navigator.clipboard?.writeText(a.hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <section className="card space-y-4" aria-label="Tamper-evident seal">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <Fingerprint size={20} className="text-saffron-ink" /> Tamper-evident seal
        </h2>
        <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-bold text-navy-muted">SHA-256</span>
      </div>
      <div className="flex items-center gap-2 rounded-xl bg-navy p-3">
        <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-cream">{a.hash}</code>
        <button onClick={copy} className="shrink-0 rounded-lg p-2 text-cream hover:bg-white/10" aria-label="Copy hash">
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-ghost py-2 text-sm" onClick={check} disabled={verify === "checking"}>
          <ShieldCheck size={16} /> {verify === "checking" ? "Re-computing…" : "Verify integrity"}
        </button>
        {verify === "ok" && <span className="flex items-center gap-1.5 text-sm font-bold text-leaf"><ShieldCheck size={16} /> Matches. Record is untouched.</span>}
        {verify === "broken" && <span className="flex items-center gap-1.5 text-sm font-bold text-alert"><ShieldAlert size={16} /> Mismatch. Record was altered.</span>}
      </div>
      {verify && verify !== "checking" && links > 0 && chain && (
        <p className={cn("text-xs", chain.ok ? "text-leaf" : "text-alert")}>
          {chain.ok
            ? `The agreement and ${links} sealed change${links > 1 ? "s" : ""} form an unbroken chain.`
            : `The chain breaks at ${chain.broken}: it was altered or does not link to the record before it.`}
        </p>
      )}
      {verify && verify !== "checking" && server && (
        <p className={cn("text-xs", server === "ok" ? "text-leaf" : server === "broken" ? "text-alert" : "text-navy-muted")}>
          {server === "ok"
            ? "The server's copy re-hashed to the same seal."
            : server === "broken"
              ? "The server's copy does not match this seal."
              : "Server not reachable; checked on this device only."}
        </p>
      )}

      {a.hash && <VerifyQr hash={a.hash} />}

      <details className="group rounded-xl border border-dashed border-line p-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-navy">
          <FlaskConical size={16} className="text-saffron-ink" /> Try to tamper with it
        </summary>
        <p className="mt-2 text-sm text-navy-body">Change the agreed price of {inr(a.terms.price)} and see what happens to the seal.</p>
        <div className="mt-2 flex gap-2">
          <label htmlFor="tp" className="sr-only">New price</label>
          <input id="tp" className="input py-2" inputMode="numeric" placeholder="e.g. 12000" value={tamperPrice} onChange={(e) => setTamperPrice(e.target.value)} />
          <button className="btn-primary py-2 text-sm" onClick={tamper}>Re-hash</button>
        </div>
        {tamperHash && (
          <div className="mt-3 space-y-1 font-mono text-xs">
            <p><span className="font-sans font-bold text-leaf">Sealed:</span> {a.hash?.slice(0, 32)}…</p>
            <p className={cn(tamperHash !== a.hash && "text-alert")}>
              <span className="font-sans font-bold">Edited:</span> {tamperHash.slice(0, 32)}…
            </p>
            <p className="font-sans text-sm font-bold text-alert">
              {tamperHash === a.hash ? "Same price, same hash." : "Completely different hash. The edit is detectable."}
            </p>
          </div>
        )}
      </details>
    </section>
  );
}

/** B5: anyone can scan this to check the record is genuine, without seeing prices or phone numbers. */
function VerifyQr({ hash }: { hash: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/verify/${hash}`;
  return (
    <details className="rounded-xl border border-line p-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-navy">
        <QrCode size={16} className="text-saffron-ink" /> Verification QR · for a forum, lender or employer
      </summary>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {origin && (
          <div className="rounded-lg bg-white p-2">
            <QRCodeSVG value={url} size={120} fgColor="#1B2A41" bgColor="#FFFFFF" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <p className="text-navy-body">Shows only that the record is genuine and unchanged, who (first names) and when. No price, no phone numbers.</p>
          <a href={`/verify/${hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-saffron-ink underline-offset-2 hover:underline">
            Open verification page <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </details>
  );
}
