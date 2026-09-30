/**
 * B2: offline outbox. Every change to an agreement is written here (IndexedDB) before it is sent,
 * and removed once the server has it. If the network drops or the tab closes, nothing is lost:
 * the queue is replayed when the connection comes back.
 */
import type { Agreement } from "./types";

const DB = "karaar-outbox";
const STORE = "pending";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const enqueue = (a: Agreement) => tx("readwrite", (s) => s.put(a, a.id)).then(() => undefined);
export const dequeue = (id: string) => tx("readwrite", (s) => s.delete(id)).then(() => undefined);
export const pendingAll = () => tx<Agreement[]>("readonly", (s) => s.getAll() as IDBRequest<Agreement[]>).then((x) => x ?? []);
export const clearOutbox = () => tx("readwrite", (s) => s.clear()).then(() => undefined);
