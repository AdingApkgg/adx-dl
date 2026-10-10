import type { DownloadJob } from "@/components/site/downloads/downloads-store";

export type CacheProbeResult = "ok" | "unavailable" | "blocked" | "quota" | "timeout" | "error";

/** Tiny isolated Blob round trip: metadata-only writes cannot prove file caching. */
export function probeDownloadCache(factory: IDBFactory | undefined, timeoutMs = 2000): Promise<CacheProbeResult> {
  if (!factory) return Promise.resolve("unavailable");
  return new Promise((resolve) => {
    const name = `astrodx-compat-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let db: IDBDatabase | undefined;
    let transaction: IDBTransaction | undefined;
    let settled = false;
    const finish = (result: CacheProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result !== "ok") { try { transaction?.abort(); } catch { /* Already closed. */ } }
      db?.close();
      try { factory.deleteDatabase(name); } catch { /* Does not touch download checkpoints. */ }
      resolve(result);
    };
    const failure = (error: DOMException | null | undefined) => finish(error?.name === "QuotaExceededError" ? "quota" : error?.name === "SecurityError" ? "blocked" : "error");
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    try {
      const opening = factory.open(name, 1);
      opening.onblocked = () => finish("blocked");
      opening.onerror = () => failure(opening.error);
      opening.onupgradeneeded = () => {
        if (settled) { opening.transaction?.abort(); return; }
        opening.result.createObjectStore("probe");
      };
      opening.onsuccess = () => {
        db = opening.result;
        if (settled) { db.close(); factory.deleteDatabase(name); return; }
        try {
          transaction = db.transaction("probe", "readwrite");
          const store = transaction.objectStore("probe");
          const blob = new Blob(["AstroDX cache probe"]);
          let roundTrip = false;
          store.put(blob, "blob");
          const read = store.get("blob");
          read.onsuccess = () => { roundTrip = read.result instanceof Blob && read.result.size === blob.size; };
          transaction.oncomplete = () => finish(roundTrip ? "ok" : "error");
          transaction.onabort = () => failure(transaction?.error);
          transaction.onerror = () => failure(transaction?.error);
        } catch (error) { failure(error as DOMException); }
      };
    } catch (error) { failure(error as DOMException); }
  });
}

/** Keep useful origins/paths but never export URL credentials, queries or fragments. */
export function redactDiagnosticUrls(detail: string): string {
  return detail.replace(/https?:\/\/[^\s]+/gi, (raw) => {
    try { const url = new URL(raw); return `${url.origin}${url.pathname}`; } catch { return "[URL]"; }
  }).slice(0, 2000);
}

function probeLocalPreferences(): boolean {
  const key = `astrodx-compat-preferences-probe-${Date.now()}`;
  try {
    localStorage.setItem(key, "probe");
    const works = localStorage.getItem(key) === "probe";
    return works;
  } catch { return false; }
  finally { try { localStorage.removeItem(key); } catch { /* Storage is blocked. */ } }
}

export async function collectBrowserDiagnostics(job?: DownloadJob, checkpointsUnavailable = false) {
  let factory: IDBFactory | undefined;
  try { factory = window.indexedDB; } catch { /* Security policy can block access. */ }
  const cache = await probeDownloadCache(factory);
  const media = (query: string) => typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  return {
    version: 1,
    collectedAt: new Date().toISOString(),
    browser: { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints },
    viewport: { width: window.innerWidth, height: window.innerHeight, scale: window.visualViewport?.scale ?? null, rootFontSize: getComputedStyle(document.documentElement).fontSize },
    preferences: { forcedColors: media("(forced-colors: active)"), reducedMotion: media("(prefers-reduced-motion: reduce)"), compatibility: document.documentElement.dataset.compatibility ?? "normal" },
    capabilities: { secureContext: window.isSecureContext, blobSaveApi: typeof Blob === "function" && typeof URL.createObjectURL === "function" && typeof URL.revokeObjectURL === "function" && "download" in document.createElement("a"), clipboardApi: typeof navigator.clipboard?.writeText === "function" },
    storage: { downloadBlobRoundTrip: cache, preferencesWrite: probeLocalPreferences(), downloadCheckpointFailureObserved: checkpointsUnavailable },
    job: job ? { kind: job.kind, status: job.status, format: job.format, fileCount: job.total, errorKind: job.errorKind, errorDetail: job.errorDetail ? redactDiagnosticUrls(job.errorDetail) : null, saveFailureObserved: job.archives?.some((archive) => archive.error) ?? false } : null,
  };
}
