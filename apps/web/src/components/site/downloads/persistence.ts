/**
 * Device-local checkpoints for unfinished archive jobs. Only whole loose files
 * are durable: an interrupted file is discarded and fetched from byte zero on
 * the next run. Everything degrades to a no-op when IndexedDB is unavailable
 * (SSR/private mode), so callers never have to guard browser storage access.
 */

export type PersistedJob = {
  id: string;
  kind: "single" | "batch";
  title: string;
  format: string;
  createdAt: number;
  /** Optional for backward compatibility with jobs saved before source routing. */
  sourceId?: string;
  /** The flat fetch list. For batch, `name` carries the `${index}/...` prefix. */
  files: { name: string; url: string }[];
  /** Single-chart jobs: optional version folder above the chart folder. */
  groupDir?: string;
  /** Batch only: maps the numeric index prefix back to a chart directory name. */
  dirByIndex?: string[];
  /** Batch only: optional grouping folder for each chart, e.g. a version name. */
  groupByIndex?: string[];
};

export type PersistedFile = {
  /** Composite primary key: `${jobId}::${name}`. */
  key: string;
  jobId: string;
  name: string;
  /** Route that supplied the whole file; kept for logical-resource validation. */
  url: string;
  /** Explicit marker distinguishes a legitimate zero-byte file from no data. */
  complete: true;
  size: number;
  blob: Blob;
};

export type DownloadsPersistenceAdapter = {
  persistJob: (job: PersistedJob) => Promise<void>;
  persistFile: (file: PersistedFile) => Promise<void>;
  loadAllJobs: () => Promise<PersistedJob[]>;
  loadFilesForJob: (jobId: string) => Promise<PersistedFile[]>;
  /** Atomically updates the route spec while retaining only whole relevant files. */
  replaceJobKeepingCompletedFiles: (job: PersistedJob) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
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

/**
 * Lazily migrates old byte-prefix records. A legacy record is reusable only
 * when its recorded total, received count and Blob size prove it was complete;
 * every partial or inconsistent record is ignored.
 */
export function normalizePersistedFile(value: unknown): PersistedFile | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.key !== "string" ||
    typeof record.jobId !== "string" ||
    typeof record.name !== "string" ||
    typeof record.url !== "string" ||
    !(record.blob instanceof Blob)
  ) {
    return null;
  }

  const blob = record.blob;
  const currentComplete =
    record.complete === true &&
    typeof record.size === "number" &&
    Number.isFinite(record.size) &&
    record.size >= 0 &&
    record.size === blob.size;
  const legacyComplete =
    record.complete === undefined &&
    typeof record.total === "number" &&
    typeof record.received === "number" &&
    Number.isFinite(record.total) &&
    record.total >= 0 &&
    record.total === record.received &&
    record.received === blob.size;

  if (!currentComplete && !legacyComplete) {
    return null;
  }

  return {
    key: record.key,
    jobId: record.jobId,
    name: record.name,
    url: record.url,
    complete: true,
    size: blob.size,
    blob,
  };
}

async function indexedDbPersistJob(job: PersistedJob): Promise<void> {
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

async function indexedDbPersistFile(file: PersistedFile): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }
  try {
    const tx = db.transaction(FILES, "readwrite");
    tx.objectStore(FILES).put(file);
    await promisifyTx(tx);
  } catch {
    // Ignore — the complete file can be fetched again if this checkpoint fails.
  }
}

async function indexedDbLoadAllJobs(): Promise<PersistedJob[]> {
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

async function indexedDbLoadFilesForJob(jobId: string): Promise<PersistedFile[]> {
  const db = await openDb();
  if (!db) {
    return [];
  }
  try {
    const tx = db.transaction(FILES, "readonly");
    const index = tx.objectStore(FILES).index("jobId");
    const stored = (await promisifyRequest(index.getAll(jobId))) as unknown[];
    return stored
      .map(normalizePersistedFile)
      .filter((file): file is PersistedFile => file !== null);
  } catch {
    return [];
  }
}

async function indexedDbReplaceJobKeepingCompletedFiles(job: PersistedJob): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }
  try {
    const allowedNames = new Set(job.files.map((file) => file.name));
    const tx = db.transaction([JOBS, FILES], "readwrite");
    tx.objectStore(JOBS).put(job);
    const filesStore = tx.objectStore(FILES);
    const storedRequest = filesStore.index("jobId").getAll(job.id);
    storedRequest.onsuccess = () => {
      for (const raw of storedRequest.result as unknown[]) {
        const key =
          raw && typeof raw === "object" && typeof (raw as { key?: unknown }).key === "string"
            ? (raw as { key: string }).key
            : null;
        const completed = normalizePersistedFile(raw);
        if (!completed || !allowedNames.has(completed.name)) {
          if (key !== null) {
            filesStore.delete(key);
          }
          continue;
        }
        // Rewriting also lazily upgrades a legacy complete record.
        filesStore.put(completed);
      }
    };
    await promisifyTx(tx);
  } catch {
    // The in-memory run can still continue even when local checkpoints fail.
  }
}

async function indexedDbDeleteJob(jobId: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }
  try {
    const tx = db.transaction([JOBS, FILES], "readwrite");
    tx.objectStore(JOBS).delete(jobId);
    const filesStore = tx.objectStore(FILES);
    const keysRequest = filesStore.index("jobId").getAllKeys(jobId);
    keysRequest.onsuccess = () => {
      for (const key of keysRequest.result) {
        filesStore.delete(key);
      }
    };
    await promisifyTx(tx);
  } catch {
    // A stale record is harmless and is replaced when the same job starts again.
  }
}

const indexedDbAdapter: DownloadsPersistenceAdapter = {
  persistJob: indexedDbPersistJob,
  persistFile: indexedDbPersistFile,
  loadAllJobs: indexedDbLoadAllJobs,
  loadFilesForJob: indexedDbLoadFilesForJob,
  replaceJobKeepingCompletedFiles: indexedDbReplaceJobKeepingCompletedFiles,
  deleteJob: indexedDbDeleteJob,
};

let activeAdapter = indexedDbAdapter;

/** Test seam for exercising store recovery without a browser IndexedDB runtime. */
export function setDownloadsPersistenceAdapterForTests(
  adapter: DownloadsPersistenceAdapter | null
): void {
  activeAdapter = adapter ?? indexedDbAdapter;
}

export function persistJob(job: PersistedJob): Promise<void> {
  return activeAdapter.persistJob(job);
}

export function persistFile(file: PersistedFile): Promise<void> {
  return activeAdapter.persistFile(file);
}

export function loadAllJobs(): Promise<PersistedJob[]> {
  return activeAdapter.loadAllJobs();
}

export function loadFilesForJob(jobId: string): Promise<PersistedFile[]> {
  return activeAdapter.loadFilesForJob(jobId);
}

export function replaceJobKeepingCompletedFiles(job: PersistedJob): Promise<void> {
  return activeAdapter.replaceJobKeepingCompletedFiles(job);
}

export function deleteJob(jobId: string): Promise<void> {
  return activeAdapter.deleteJob(jobId);
}

export function fileKey(jobId: string, name: string): string {
  return `${jobId}::${name}`;
}
