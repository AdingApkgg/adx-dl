/**
 * Durable storage for in-progress downloads, so a job can resume after a full
 * page reload / tab close (not just a soft navigation, which the in-memory store
 * already survives). Partial bytes live in IndexedDB as Blobs; everything here
 * degrades to a no-op when IndexedDB is unavailable (SSR, private mode, tests),
 * so callers never have to guard.
 */

export type PersistedJob = {
  id: string;
  kind: "single" | "batch";
  title: string;
  format: string;
  createdAt: number;
  /** The flat fetch list. For batch, `name` carries the `${index}/...` prefix. */
  files: { name: string; url: string }[];
  /** Batch only: maps the numeric index prefix back to a chart directory name. */
  dirByIndex?: string[];
};

export type PersistedFile = {
  /** Composite primary key: `${jobId}::${name}`. */
  key: string;
  jobId: string;
  name: string;
  url: string;
  /** Validator from the first response, replayed via If-Range on resume. */
  etag: string | null;
  total: number | null;
  /** Always equals `blob.size` — the two are written together atomically. */
  received: number;
  blob: Blob;
};

const DB_NAME = "astrodx-downloads";
const DB_VERSION = 1;
const JOBS = "jobs";
const FILES = "files";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(JOBS)) {
        db.createObjectStore(JOBS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FILES)) {
        const store = db.createObjectStore(FILES, { keyPath: "key" });
        store.createIndex("jobId", "jobId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

function promisifyTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function persistJob(job: PersistedJob): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }
  try {
    const tx = db.transaction(JOBS, "readwrite");
    tx.objectStore(JOBS).put(job);
    await promisifyTx(tx);
  } catch {
    // Storage is best-effort: a failed write just means this job won't resume.
  }
}

export async function persistFile(file: PersistedFile): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }
  try {
    const tx = db.transaction(FILES, "readwrite");
    tx.objectStore(FILES).put(file);
    await promisifyTx(tx);
  } catch {
    // Ignore — the next flush (or a restart) will reconcile.
  }
}

export async function loadAllJobs(): Promise<PersistedJob[]> {
  const db = await openDb();
  if (!db) {
    return [];
  }
  try {
    const tx = db.transaction(JOBS, "readonly");
    return (await promisifyRequest(tx.objectStore(JOBS).getAll())) as PersistedJob[];
  } catch {
    return [];
  }
}

export async function loadFilesForJob(jobId: string): Promise<PersistedFile[]> {
  const db = await openDb();
  if (!db) {
    return [];
  }
  try {
    const tx = db.transaction(FILES, "readonly");
    const index = tx.objectStore(FILES).index("jobId");
    return (await promisifyRequest(index.getAll(jobId))) as PersistedFile[];
  } catch {
    return [];
  }
}

export async function deleteJob(jobId: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }
  try {
    const tx = db.transaction([JOBS, FILES], "readwrite");
    tx.objectStore(JOBS).delete(jobId);
    const index = tx.objectStore(FILES).index("jobId");
    const keysRequest = index.getAllKeys(jobId);
    keysRequest.onsuccess = () => {
      const filesStore = tx.objectStore(FILES);
      for (const key of keysRequest.result) {
        filesStore.delete(key as IDBValidKey);
      }
    };
    await promisifyTx(tx);
  } catch {
    // Nothing else to do — a stale record is harmless and overwritten on reuse.
  }
}

export function fileKey(jobId: string, name: string): string {
  return `${jobId}::${name}`;
}
