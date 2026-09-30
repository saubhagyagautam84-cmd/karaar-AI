/**
 * Proof-of-work photos (A2): compress in the browser, hash (SHA-256), keep in IndexedDB.
 * Live mode also uploads them; the server re-hashes the bytes and must get the same value.
 */
import type { Photo } from "./types";
import { sha256Bytes } from "./hash";

const DB = "karaar-photos";
const STORE = "images";
const MAX_SIDE = 1280;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putImage(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getImage(id: string): Promise<Blob | null> {
  const db = await openDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}

export async function clearImages(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

/** Downscale to at most 1280px on the long side and re-encode as JPEG (~80%). */
export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not compress the photo."))), "image/jpeg", 0.8),
  );
}

/** Location only with permission; gives up quietly after 5 seconds. */
export function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 60000 },
    );
  });
}

export async function hashBlob(blob: Blob): Promise<string> {
  return sha256Bytes(await blob.arrayBuffer());
}

/** Compress, hash and store one photo. Returns the record kept on the agreement. */
export async function preparePhoto(file: Blob, kind: Photo["kind"], withLocation: boolean): Promise<{ photo: Photo; blob: Blob }> {
  const blob = await compressImage(file);
  const hash = await hashBlob(blob);
  const pos = withLocation ? await currentPosition() : null;
  const photo: Photo = {
    id: `ph-${hash.slice(0, 12)}-${Date.now().toString(36)}`,
    kind,
    hash,
    takenAt: new Date().toISOString(),
    size: blob.size,
    ...(pos ? { lat: pos.lat, lng: pos.lng } : {}),
  };
  await putImage(photo.id, blob);
  return { photo, blob };
}

/** Load a photo's bytes: this device's IndexedDB first, then the server copy. */
export async function loadPhoto(p: Photo): Promise<Blob | null> {
  const local = await getImage(p.id).catch(() => null);
  if (local) return local;
  if (p.url) {
    try {
      const res = await fetch(p.url);
      if (res.ok) return await res.blob();
    } catch {
      /* offline */
    }
  }
  return null;
}

/** Re-hash the stored bytes: "ok" when they still match the recorded SHA-256. */
export async function verifyPhoto(p: Photo): Promise<"ok" | "mismatch" | "missing"> {
  const blob = await loadPhoto(p);
  if (!blob) return "missing";
  return (await hashBlob(blob)) === p.hash ? "ok" : "mismatch";
}

/** For the tamper demo: flip one byte of the image and hash it again. */
export async function tamperedHash(p: Photo): Promise<string | null> {
  const blob = await loadPhoto(p);
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  bytes[Math.floor(bytes.length / 2)] ^= 0xff;
  return sha256Bytes(bytes.buffer);
}
