"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BadgeCheck, Building2, CalendarCheck, Copy, Eye, FileCheck2, IndianRupee, Link2, LogIn, Lock, Share2, Star, Users } from "lucide-react";
import { PageHeader, Spinner, cn } from "@/components/ui";
import { useAgreements } from "@/lib/store";
import { inr } from "@/lib/numbers";
import { fmtDate, fmtDateTime } from "@/lib/summary";
import { accessLog, createShare, listShares, phoneHashOf, revokeShare, type AccessEntry, type Share, type ShareScope } from "@/lib/account";
import { useSession } from "@/lib/session";

const DEMO_WORKER_PHONE = "98100 12345"; // Ramesh, the demo worker (synthetic)

export default function Profile() {
  const { ready, agreements } = useAgreements();
  const session = useSession();
  const [lender, setLender] = useState("Demo NBFC (partner)");
  const [scope, setScope] = useState<Record<ShareScope, boolean>>({ jobs: true, earnings: true, ratings: false });
  const [shares, setShares] = useState<Share[]>([]);
  const [log, setLog] = useState<AccessEntry[]>([]);
  const [shareError, setShareError] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [workerHashes, setWorkerHashes] = useState<Record<string, string>>({});
  const signedWorker = session?.role === "worker" ? session : null;

  // Whose profile: the signed-in worker, or Ramesh (the demo worker) otherwise.
  useEffect(() => {
    if (signedWorker) setSubject(signedWorker.phoneHash);
    else void phoneHashOf(DEMO_WORKER_PHONE).then(setSubject);
  }, [signedWorker]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, string> = {};
      for (const a of agreements) out[a.id] = a.worker.phoneHash ?? (await phoneHashOf(a.worker.phone));
      if (alive) setWorkerHashes(out);
    })();
    return () => {
      alive = false;
    };
  }, [agreements]);
  const refresh = useMemo(
    () => async () => {
      if (!signedWorker) return;
      try {
        setShares(await listShares(signedWorker));
        setLog(await accessLog(signedWorker));
      } catch (e) {
        setShareError(e instanceof Error ? e.message : "Could not load your shares.");
      }
    },
    [signedWorker],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mine = useMemo(() => agreements.filter((a) => a.hash && subject && workerHashes[a.id] === subject), [agreements, subject, workerHashes]);
  const workerName = mine[0]?.worker.name ?? (signedWorker ? `Worker ${signedWorker.phone}` : "Ramesh Kumar");
  const initials = workerName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const done = mine.filter((a) => a.status === "completed");
  const earned = mine.flatMap((a) => a.payments).reduce((s, p) => s + p.amount, 0);
  const onTime = done.filter((a) => !a.events.some((e) => /late/i.test(e.label))).length;
  const scoreOf = (a: (typeof done)[number]) => {
    const r = a.ratings?.byHirer;
    return r ? (r.onTime + r.fair + r.respectful) / 3 : a.rating ?? null;
  };
  const scores = done.map(scoreOf).filter((x): x is number => x !== null);
  const avgRating = scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null;
  const disputes = mine.filter((a) => a.status === "disputed").length;

  if (!ready) return <Spinner label="Loading profile…" />;

  async function share() {
    if (!signedWorker) return;
    setShareError(null);
    try {
      await createShare(signedWorker, lender, (Object.keys(scope) as ShareScope[]).filter((k) => scope[k]));
      await refresh();
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Could not create the link.");
    }
  }
  async function revoke(id: string) {
    if (!signedWorker) return;
    try {
      await revokeShare(signedWorker, id);
      await refresh();
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Could not withdraw access.");
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Trust layer · worker-owned" title="Verified work history" sub="Built only from sealed, two-party-confirmed agreements and UPI payments. The worker decides who sees it." />

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <section className="card flex flex-wrap items-center gap-5" aria-label="Worker">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-saffron font-display text-3xl font-extrabold text-navy">{initials}</div>
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
                {workerName} <BadgeCheck className="text-leaf" size={24} aria-label="Verified" />
              </h2>
              <p className="text-navy-body">Painter · Lajpat Nagar, New Delhi · Hinglish</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                <span className="flex items-center gap-1 rounded-full bg-leaf-soft px-2.5 py-1 text-leaf">
                  <Users size={13} /> e-Shram linked (simulated)
                </span>
                <span className="flex items-center gap-1 rounded-full bg-cream px-2.5 py-1 text-navy">
                  <Lock size={13} /> Aadhaar not stored
                </span>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Summary">
            <Stat icon={<FileCheck2 size={18} />} label="Verified jobs" value={String(done.length)} />
            <Stat icon={<IndianRupee size={18} />} label="Paid via UPI" value={inr(earned)} />
            <Stat icon={<CalendarCheck size={18} />} label="On time" value={done.length ? `${onTime} of ${done.length}` : "—"} />
            <Stat icon={<Star size={18} />} label="Avg rating" value={avgRating ? `${avgRating.toFixed(1)} / 5` : "—"} />
          </section>

          <section className="card" aria-label="Job history">
            <h2 className="mb-3 font-display text-lg font-bold">Job history</h2>
            <ul className="divide-y divide-line/70">
              {mine.length === 0 && <li className="py-3 text-sm text-navy-muted">No sealed agreements for this number yet.</li>}
              {mine.map((a) => (
                <li key={a.id}>
                  <Link href={`/deals/${a.id}`} className="flex items-center gap-3 py-3 hover:bg-cream/50">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", a.status === "completed" ? "bg-leaf" : a.status === "disputed" ? "bg-alert" : "bg-saffron")} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {a.terms.jobType} · {a.terms.scope.map((s) => s.en).slice(0, 2).join(", ")}
                      </p>
                      <p className="text-xs text-navy-muted">
                        {fmtDate(a.createdAt)} · {a.terms.location || "—"} · {a.status === "completed" ? "Completed" : a.status === "disputed" ? "Disputed" : "In progress"}
                      </p>
                    </div>
                    {scoreOf(a) ? (
                      <span className="flex items-center gap-0.5 text-sm font-bold">
                        <Star size={14} className="fill-saffron text-saffron" /> {(scoreOf(a) as number).toFixed(1).replace(".0", "")}
                      </span>
                    ) : null}
                    <span className="w-20 text-right font-display font-bold">{inr(a.terms.price)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {disputes > 0 && <p className="mt-3 text-sm text-alert">{disputes} disputed agreement{disputes > 1 ? "s" : ""} shown as-is. Profiles are never edited.</p>}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card" aria-label="Share with consent">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold">
              <Share2 size={19} className="text-saffron-ink" /> Share with consent
            </h2>
            <p className="mt-1 text-sm text-navy-body">Give a lender or employer time-limited access to exactly what you choose.</p>
            {!signedWorker ? (
              <div className="mt-4 space-y-2 rounded-xl bg-cream p-3 text-sm">
                <p>Only the worker can share their history. Sign in with the worker&apos;s phone number first.</p>
                <p className="text-xs text-navy-muted">Demo: Ramesh is 98100 12345, and the code is 123456.</p>
                <Link href="/login?next=/profile" className="btn-primary py-2 text-sm">
                  <LogIn size={16} /> Sign in as the worker
                </Link>
              </div>
            ) : (
              <>
                <label className="label mt-4" htmlFor="lender">Share with</label>
                <select id="lender" className="input" value={lender} onChange={(e) => setLender(e.target.value)}>
                  <option>Demo NBFC (partner)</option>
                  <option>Microfinance institution</option>
                  <option>Contractor / employer</option>
                </select>
                <fieldset className="mt-4 space-y-2">
                  <legend className="label">What they can see</legend>
                  {([
                    ["jobs", "Verified job list"],
                    ["earnings", "UPI earnings total"],
                    ["ratings", "Ratings"],
                  ] as const).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-2.5 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-[#1F7A4D]" checked={scope[k]} onChange={(e) => setScope((s) => ({ ...s, [k]: e.target.checked }))} />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <button className="btn-success mt-4 w-full" onClick={share} disabled={!Object.values(scope).some(Boolean)}>
                  <Link2 size={17} /> Create 30-day share link
                </button>
                {shares.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {shares.map((sh) => (
                      <ShareRow key={sh.id} share={sh} onRevoke={() => revoke(sh.id)} />
                    ))}
                  </ul>
                )}
              </>
            )}
            {shareError && <p className="mt-3 rounded-lg bg-alert-soft p-2 text-sm font-semibold text-alert">{shareError}</p>}
          </section>
          {signedWorker && (
            <section className="card" aria-label="Who saw my data">
              <h2 className="flex items-center gap-2 font-display text-lg font-bold">
                <Eye size={19} className="text-saffron-ink" /> Who saw my data <span className="font-sans text-sm font-normal text-navy-muted">· किसने देखा</span>
              </h2>
              {log.length === 0 ? (
                <p className="mt-2 text-sm text-navy-muted">Nobody yet. Every time a share link is opened, it shows up here.</p>
              ) : (
                <ol className="mt-3 space-y-2 text-sm">
                  {log.map((e, i) => (
                    <li key={i} className="border-l-2 border-line pl-3">
                      <b>{e.actor === "you" ? "You" : e.actor}</b> {e.action}
                      <span className="block text-xs text-navy-muted">{fmtDateTime(e.at)}</span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-3 text-xs text-navy-muted">Recording consents are kept on each agreement ({mine.length} here), given by both people before recording.</p>
            </section>
          )}
          <section className="rounded-2xl bg-navy p-5 text-cream">
            <Building2 className="text-saffron" size={24} />
            <p className="mt-3 font-display text-lg font-bold">Why this matters</p>
            <p className="mt-1 text-sm text-navy-line">
              A verified history of paid work is evidence a lender can use, for someone who has never had a payslip.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ShareRow({ share, onRevoke }: { share: Share; onRevoke: () => void }) {
  const [copied, setCopied] = useState(false);
  const active = !share.revokedAt && new Date(share.expiresAt) > new Date();
  const link = typeof window === "undefined" ? `/shared/${share.id}` : `${window.location.origin}/shared/${share.id}`;
  return (
    <li className={cn("rounded-xl border p-3 text-sm", active ? "border-leaf/30 bg-leaf-soft" : "border-line bg-paper text-navy-muted")}>
      <p className="font-bold">
        {share.recipient} · {share.scope.join(", ")}
      </p>
      <p className="font-mono text-xs">{share.id}</p>
      <p className="text-xs">{active ? `Until ${fmtDate(share.expiresAt)}` : share.revokedAt ? `Withdrawn ${fmtDate(share.revokedAt)}` : "Expired"}</p>
      {active && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold">
          <a href={`/shared/${share.id}`} target="_blank" rel="noreferrer" className="text-saffron-ink underline">
            Open as {share.recipient}
          </a>
          <button
            type="button"
            className="flex items-center gap-1 text-navy underline"
            onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => undefined)}
          >
            <Copy size={12} /> {copied ? "Copied" : "Copy link"}
          </button>
          <button type="button" className="text-alert underline" onClick={onRevoke}>
            Withdraw access
          </button>
        </div>
      )}
    </li>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-navy-muted">
        <span className="text-saffron-ink">{icon}</span>
        {label}
      </p>
      <p className="mt-1 font-display text-xl font-bold">{value}</p>
    </div>
  );
}
