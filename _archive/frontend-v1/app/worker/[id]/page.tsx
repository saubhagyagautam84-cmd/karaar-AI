"use client";

import { use, useCallback, useEffect, useState } from "react";
import { api, errorText } from "@/lib/api";
import { niceDate, rupees } from "@/lib/format";
import type { WorkerProfile } from "@/lib/types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

export default function WorkerPage({
  params,
  searchParams,
}: PageProps<"/worker/[id]">) {
  const { id } = use(params);
  const query = use(searchParams);
  const key = typeof query.key === "string" ? query.key : undefined;
  const share = typeof query.share === "string" ? query.share : undefined;

  const [profile, setProfile] = useState<WorkerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uan, setUan] = useState("");
  const [shareUrl, setShareUrl] = useState<{
    url: string;
    expires_at: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erased, setErased] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);

  const noAccess = !key && !share;
  const load = useCallback(() => {
    if (!key && !share) return;
    api
      .worker(id, key ? { key } : { share })
      .then(setProfile)
      .catch(() =>
        setError(
          "This work record is private, or the shared link has expired.",
        ),
      );
  }, [id, key, share]);

  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (erased) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h1 className="text-2xl font-bold">Record deleted</h1>
        <p className="mt-2 text-muted">
          Your name, number and e-Shram link are gone and share links no longer
          work.
        </p>
      </section>
    );
  }

  if (noAccess && !error) {
    return (
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h1 className="text-2xl font-bold">Private record</h1>
        <p className="mt-2 text-muted">
          This work record is private. Open it from your own link, or ask the
          worker to share it.
        </p>
      </section>
    );
  }

  if (!profile) {
    return error ? (
      <section className="rounded-2xl border border-line bg-surface p-6">
        <h1 className="text-2xl font-bold">Private record</h1>
        <p className="mt-2 text-muted">{error}</p>
      </section>
    ) : (
      <p className="text-muted">Loading…</p>
    );
  }

  const owner = profile.access === "owner";
  const onTime =
    profile.on_time_rate === null
      ? "—"
      : `${Math.round(profile.on_time_rate * 100)}%`;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-saffron uppercase">
            {owner ? "My work record" : "Shared work record"}
          </p>
          <h1 className="text-2xl font-bold">{profile.name ?? "Worker"}</h1>
          <p className="text-muted capitalize">
            {profile.trades.join(", ") || "Trade not recorded"}
          </p>
        </div>
        {profile.eshram_linked && (
          <span className="rounded-full bg-leaf-soft px-3 py-1 text-xs font-semibold text-leaf">
            e-Shram linked ✓
          </span>
        )}
      </header>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Jobs done" value={String(profile.jobs_completed)} />
        <Stat label="On time" value={onTime} />
        <Stat label="Earned" value={rupees(profile.total_earned_inr) ?? "₹0"} />
      </div>
      <p className="text-xs text-muted">
        Every job here was confirmed by both people and paid through UPI.
        Earnings count payments received.
      </p>

      {profile.jobs.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-4">
          <h2 className="font-semibold">Completed jobs</h2>
          <ul className="mt-2 divide-y divide-line text-sm">
            {profile.jobs.map((j, i) => (
              <li
                key={j.agreement_id ?? i}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="capitalize">
                  {j.trade ?? "job"} · {j.district ?? ""}
                </span>
                <span className="text-right text-muted">
                  {niceDate(j.completed_on)}{" "}
                  {j.on_time === null ? (
                    ""
                  ) : j.on_time ? (
                    <span className="text-leaf">on time</span>
                  ) : (
                    <span className="text-danger">late</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className="rounded-xl bg-danger-soft px-4 py-3 font-medium text-danger">
          {error}
        </p>
      )}

      {owner && (
        <>
          <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
            <h2 className="font-semibold">Share my record</h2>
            <p className="text-sm text-muted">
              Private by default. A share link lets a lender, employer or scheme
              see this page for 7 days.
            </p>
            <button
              onClick={() =>
                act(async () =>
                  setShareUrl(
                    await api.post(`/api/workers/${id}/share`, { key }),
                  ),
                )
              }
              disabled={busy}
              className="h-12 w-full rounded-xl bg-saffron font-semibold text-white disabled:opacity-50"
            >
              Create a 7-day link
            </button>
            {shareUrl && (
              <div className="space-y-2 rounded-xl bg-background p-3 text-sm">
                <p className="break-all font-mono text-xs">{shareUrl.url}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">
                    Expires{" "}
                    {new Date(shareUrl.expires_at).toLocaleDateString("en-IN")}
                  </span>
                  <button
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(shareUrl.url)
                        .then(() => setCopied(true))
                    }
                    className="h-10 rounded-lg border border-line px-3 font-semibold"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}
            {(profile.share_links?.length ?? 0) > 0 && (
              <button
                onClick={() =>
                  act(() =>
                    api.post(`/api/workers/${id}/share/revoke`, { key }),
                  )
                }
                className="text-sm font-semibold text-danger hover:underline"
              >
                Stop sharing ({profile.share_links?.length} active link
                {profile.share_links?.length === 1 ? "" : "s"})
              </button>
            )}
          </section>

          {!profile.eshram_linked && (
            <section className="space-y-2 rounded-2xl border border-line bg-surface p-4">
              <h2 className="font-semibold">Link e-Shram</h2>
              <p className="text-sm text-muted">
                Add your 12-digit e-Shram UAN so these jobs count towards your
                profile.
              </p>
              <div className="flex gap-2">
                <input
                  value={uan}
                  onChange={(e) => setUan(e.target.value)}
                  inputMode="numeric"
                  placeholder="UAN"
                  aria-label="e-Shram UAN"
                  className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-background px-3 text-base"
                />
                <button
                  onClick={() =>
                    act(() =>
                      api.post(`/api/workers/${id}/eshram`, { key, uan }),
                    )
                  }
                  disabled={busy || uan.replace(/\D/g, "").length !== 12}
                  className="h-12 shrink-0 rounded-xl bg-leaf px-4 font-semibold text-white disabled:opacity-50"
                >
                  Link
                </button>
              </div>
            </section>
          )}
          {profile.eshram_uan_masked && (
            <p className="text-xs text-muted">
              e-Shram UAN {profile.eshram_uan_masked}
            </p>
          )}

          <div className="text-center text-xs">
            {confirmErase ? (
              <p className="space-x-3">
                <span>Delete your record for good?</span>
                <button
                  className="font-semibold text-danger underline"
                  onClick={() =>
                    act(async () => {
                      await api.post(`/api/workers/${id}/erase`, { key });
                      setErased(true);
                    })
                  }
                >
                  Yes, delete
                </button>
                <button
                  className="underline"
                  onClick={() => setConfirmErase(false)}
                >
                  Cancel
                </button>
              </p>
            ) : (
              <button
                className="text-muted underline"
                onClick={() => setConfirmErase(true)}
              >
                Delete my record
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
