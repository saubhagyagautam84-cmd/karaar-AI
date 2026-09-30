"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, FlaskConical, ImageIcon, MapPin, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import type { Photo } from "@/lib/types";
import { loadPhoto, preparePhoto, tamperedHash, verifyPhoto } from "@/lib/photos";
import { fmtDateTime } from "@/lib/summary";
import { DEMO_MODE } from "@/lib/api";
import { cn } from "./ui";

/** Object URL for a stored photo (revoked on unmount). */
function usePhotoUrl(p: Photo | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!p) return;
    let alive = true;
    let made: string | null = null;
    loadPhoto(p).then((blob) => {
      if (!alive || !blob) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [p]);
  return url;
}

/** Draws a simple wall picture, so the demo works on a laptop without a camera. */
async function samplePhoto(kind: Photo["kind"]): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = 960;
  c.height = 640;
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas unavailable");
  g.fillStyle = kind === "before" ? "#B7AFA3" : "#F6E7C8";
  g.fillRect(0, 0, 960, 640);
  if (kind === "before") {
    g.strokeStyle = "#8C8377";
    g.lineWidth = 3;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      g.moveTo(80 + i * 60, 90 + ((i * 37) % 200));
      g.lineTo(140 + i * 55, 260 + ((i * 53) % 260));
      g.stroke();
    }
  }
  g.fillStyle = "#7A5230";
  g.fillRect(0, 560, 960, 80);
  g.fillStyle = "#1B2A41";
  g.font = "bold 36px sans-serif";
  g.fillText(kind === "before" ? "BEFORE · sample photo" : "AFTER · sample photo", 32, 60);
  g.font = "24px sans-serif";
  g.fillText(new Date().toLocaleString("en-IN"), 32, 100);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not draw"))), "image/jpeg", 0.9));
}

export function PhotoProof({
  photos,
  canAdd,
  onAdd,
}: {
  photos: Photo[];
  canAdd: boolean;
  onAdd: (photo: Photo, blob: Blob) => Promise<void>;
}) {
  const before = photos.filter((p) => p.kind === "before");
  const after = photos.filter((p) => p.kind === "after");
  const [busy, setBusy] = useState<Photo["kind"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withGps, setWithGps] = useState(false);
  const inputs = { before: useRef<HTMLInputElement>(null), after: useRef<HTMLInputElement>(null) };

  async function add(kind: Photo["kind"], file: Blob) {
    setBusy(kind);
    setError(null);
    try {
      const { photo, blob } = await preparePhoto(file, kind, withGps);
      await onAdd(photo, blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the photo.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {before[0] && after[0] ? <BeforeAfter before={before[before.length - 1]} after={after[after.length - 1]} /> : null}
      {photos.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {photos.map((p) => (
            <PhotoRow key={p.id} p={p} />
          ))}
        </ul>
      )}
      {canAdd && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {(["before", "after"] as const).map((kind) => (
              <span key={kind}>
                <input
                  ref={inputs[kind]}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  aria-label={`Add ${kind} photo`}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void add(kind, f);
                    e.target.value = "";
                  }}
                />
                <button type="button" className="btn-ghost py-2 text-sm" disabled={busy !== null} onClick={() => inputs[kind].current?.click()}>
                  <Camera size={16} /> {busy === kind ? "Hashing…" : kind === "before" ? "Before photo · पहले" : "After photo · बाद में"}
                </button>
              </span>
            ))}
            {DEMO_MODE || process.env.NODE_ENV !== "production" ? (
              <button
                type="button"
                className="btn-ghost py-2 text-sm"
                disabled={busy !== null}
                onClick={async () => {
                  await add("before", await samplePhoto("before"));
                  await add("after", await samplePhoto("after"));
                }}
              >
                <Sparkles size={16} /> Use sample photos (demo)
              </button>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-xs text-navy-muted">
            <input type="checkbox" className="h-4 w-4 accent-[#1F7A4D]" checked={withGps} onChange={(e) => setWithGps(e.target.checked)} />
            <MapPin size={13} /> Add location to photos (asks for permission)
          </label>
        </div>
      )}
      {error && <p className="rounded-lg bg-alert-soft p-2 text-sm font-semibold text-alert">{error}</p>}
    </div>
  );
}

function PhotoRow({ p }: { p: Photo }) {
  const url = usePhotoUrl(p);
  const [state, setState] = useState<null | "ok" | "mismatch" | "missing">(null);
  const [tamper, setTamper] = useState<string | null>(null);
  return (
    <li className="flex gap-3 rounded-xl border border-line/70 bg-paper p-2">
      <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-cream">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${p.kind} photo`} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center text-navy-muted">
            <ImageIcon size={20} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-bold capitalize text-navy">{p.kind}</p>
        <p className="text-navy-muted">
          {fmtDateTime(p.takenAt)}
          {p.lat !== undefined ? ` · ${p.lat}, ${p.lng}` : ""}
        </p>
        <p className="truncate font-mono text-[11px] text-navy-muted" title={p.hash}>
          sha256 {p.hash.slice(0, 16)}…
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button type="button" className="font-semibold text-saffron-ink underline-offset-2 hover:underline" onClick={async () => setState(await verifyPhoto(p))}>
            Verify
          </button>
          <button type="button" className="flex items-center gap-1 font-semibold text-navy-muted hover:text-navy" onClick={async () => setTamper(await tamperedHash(p))}>
            <FlaskConical size={12} /> Tamper test
          </button>
          {state === "ok" && <span className="flex items-center gap-1 font-bold text-leaf"><ShieldCheck size={13} /> Matches</span>}
          {state === "mismatch" && <span className="flex items-center gap-1 font-bold text-alert"><ShieldAlert size={13} /> Photo changed</span>}
          {state === "missing" && <span className="text-navy-muted">Image not on this device</span>}
        </div>
        {tamper && (
          <p className={cn("mt-1 font-mono text-[11px]", tamper !== p.hash && "text-alert")}>
            1 byte changed → {tamper.slice(0, 16)}… <span className="font-sans font-bold">mismatch</span>
          </p>
        )}
      </div>
    </li>
  );
}

/** Before/after slider (keyboard accessible range input). */
export function BeforeAfter({ before, after }: { before: Photo; after: Photo }) {
  const b = usePhotoUrl(before);
  const a = usePhotoUrl(after);
  const [pos, setPos] = useState(50);
  if (!a || !b) return null;
  return (
    <figure className="space-y-1.5">
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-xl bg-cream">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={a} alt="After the work" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b} alt="Before the work" className="absolute inset-0 h-full w-full max-w-none object-cover" style={{ width: `${10000 / Math.max(pos, 1)}%` }} />
        </div>
        <div className="absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }} aria-hidden />
        <span className="absolute left-2 top-2 rounded bg-navy/80 px-1.5 py-0.5 text-[11px] font-bold text-cream">Before</span>
        <span className="absolute right-2 top-2 rounded bg-leaf/90 px-1.5 py-0.5 text-[11px] font-bold text-white">After</span>
      </div>
      <label className="flex items-center gap-2 text-xs text-navy-muted">
        <span className="sr-only">Compare before and after</span>
        Before
        <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="flex-1 accent-[#E8762B]" />
        After
      </label>
    </figure>
  );
}
