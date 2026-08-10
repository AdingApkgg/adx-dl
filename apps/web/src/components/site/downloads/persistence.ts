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
  /** Exact mirror root used by this job; required to resume a custom route safely. */
  sourceBaseUrl?: string;
  /** Custom route label snapshot, retained after the configured route is renamed/deleted. */
  sourceName?: string;
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
  /** Exact mirror root that supplied the file, including a custom path prefix. */
  sourceBaseUrl?: string;
  /** Explicit marker distinguishes a legitimate zero-byte file from no data. */
  complete: true;
  size: number;
  blob: Blob;
};

/**
 * A finished job kept so the same selection can be downloaded again without
 * rebuilding it by hand. Only the spec is retained — never the blobs, which are
 * deleted the moment the archive is saved.
 */
export type DownloadHistoryEntry = {
  /** Unique per completion; a job id repeats every time the same chart is fetched. */
  key: string;
  job: PersistedJob;
  finishedAt: number;
  fileCount: number;
};

export type DownloadsPersistenceAdapter = {
  persistJob: (job: PersistedJob) => Promise<void>;
  persistFile: (file: PersistedFile) => Promise<void>;
  loadAllJobs: () => Promise<PersistedJob[]>;
  loadFilesForJob: (jobId: string) => Promise<PersistedFile[]>;
  /** Atomically updates the route spec while retaining only whole relevant files. */
  replaceJobKeepingCompletedFiles: (job: PersistedJob) => Promise<void>;
  deleteJob: (jobId: string) => Promise<void>;
  loadHistory: () => Promise<DownloadHistoryEntry[]>;
  /** Appends one completion and trims the store back to MAX_DOWNLOAD_HISTORY. */
  recordHistory: (entry: DownloadHistoryEntry) => Promise<void>;
  clearHistory: () => Promise<void>;
};

const DB_NAME = "astrodx-downloads";
// v2 adds the completed-download history store.
const DB_VERSION = 2;
const JOBS = "jobs";
const FILES = "files";
const HISTORY = "history";

/**
 * Newest-first cap. The list exists to repeat "the batch I just did", not to be
 * an archive of everything ever fetched — and a batch spec is a few hundred
 * file URLs, so an unbounded list would quietly grow into megabytes.
 */
export const MAX_DOWNLOAD_HISTORY = 8;

type CheckpointFailureListener = (kind: "quota" | "unknown") => void;
const checkpointFailureListeners = new Set<CheckpointFailureListener>();

/**
 * Checkpoint writes used to fail completely silently, so a device that had run
 * out of quota kept promising "已完成文件会保留" for files that were never
 * durable. Subscribers surface that instead.
 */
export function subscribeToCheckpointFailures(
  listener: CheckpointFailureListener
): () => void {
  checkpointFailureListeners.add(listener);
  return () => {
    checkpointFailureListeners.delete(listener);
  };
}

/** QuotaExceededError arrives as a DOMException on some engines, an Error on others. */
export function classifyStorageError(error: unknown): "quota" | "unknown" {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  return name === "QuotaExceededError" || /quota/i.test(message) ? "quota" : "unknown";
}

function reportCheckpointFailure(error: unknown): void {
  const kind = classifyStorageError(error);
  for (const listener of [...checkpointFailureListeners]) {
    listener(kind);
  }
}

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
      if (!db.objectStoreNames.contains(HISTORY)) {
        db.createObjectStore(HISTORY, { keyPath: "key" });
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
    ...(typeof record.sourceBaseUrl === "string"
      ? { sourceBaseUrl: record.sourceBaseUrl }
      : {}),
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
  } catch (error) {
    // The in-memory run continues (the bytes are already on hand), but the
    // promise that a reload can resume from here no longer holds — say so.
    reportCheckpointFailure(error);
  }
}

async function indexedDbLoadHistory(): Promise<DownloadHistoryEntry[]> {
  const db = await openDb();
  if (!db) {
    return [];
  }
  try {
    const tx = db.transaction(HISTORY, "readonly");
    const stored = (await promisifyRequest(
      tx.objectStore(HISTORY).getAll()
    )) as DownloadHistoryEntry[];
    return stored
      .filter((entry) => entry && typeof entry.key === "string" && entry.job)
      .sort((left, right) => right.finishedAt - left.finishedAt);
  } catch {
    return [];
  }
}

async function indexedDbRecordHistory(entry: DownloadHistoryEntry): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }
  try {
    const tx = db.transaction(HISTORY, "readwrite");
    const store = tx.objectStore(HISTORY);
    store.put(entry);
    // Trim inside the same transaction: two round-trips would let a burst of
    // finishing batch jobs each read a pre-trim snapshot and keep everything.
    const allRequest = store.getAll();
    allRequest.onsuccess = () => {
      const stored = (allRequest.result as DownloadHistoryEntry[])
        .filter((candidate) => candidate && typeof candidate.key === "string")
        .sort((left, right) => right.finishedAt - left.finishedAt);
      for (const stale of stored.slice(MAX_DOWNLOAD_HISTORY)) {
        store.delete(stale.key);
      }
    };
    await promisifyTx(tx);
  } catch {
    // History is a convenience; losing an entry must never fail a download.
  }
}

async function indexedDbClearHistory(): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }
  try {
    const tx = db.transaction(HISTORY, "readwrite");
    tx.objectStore(HISTORY).clear();
    await promisifyTx(tx);
  } catch {
    // Nothing to recover: the list is rebuilt by the next completed download.
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
  loadHistory: indexedDbLoadHistory,
  recordHistory: indexedDbRecordHistory,
  clearHistory: indexedDbClearHistory,
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

export function loadHistory(): Promise<DownloadHistoryEntry[]> {
  return activeAdapter.loadHistory();
}

export function recordHistory(entry: DownloadHistoryEntry): Promise<void> {
  return activeAdapter.recordHistory(entry);
}

export function clearHistory(): Promise<void> {
  return activeAdapter.clearHistory();
}

export function fileKey(jobId: string, name: string): string {
  return `${jobId}::${name}`;
}
