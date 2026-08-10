/**
 * Device storage headroom for archive jobs.
 *
 * A batch download holds every byte twice before it can be saved: once as the
 * IndexedDB checkpoints that make a resume possible, and again as the archive
 * Blob being assembled. Browsers answer an over-quota write with a plain
 * rejected transaction, so without an up-front estimate the only symptom of a
 * full disk was a job that failed near the end for no stated reason.
 */

export type StorageHeadroomLevel = "ok" | "tight" | "insufficient";

export type StorageHeadroom = {
  level: StorageHeadroomLevel;
  /** Bytes the origin may still write, or null when the browser won't say. */
  availableBytes: number | null;
};

export type StorageEstimateSnapshot = {
  usage: number;
  quota: number;
};

/**
 * `null` for the estimate (no Storage API, or a browser that reports nothing
 * usable) deliberately grades as "ok": a warning we cannot substantiate would
 * scare users off downloads that would have worked.
 */
export function storageHeadroom(
  estimate: StorageEstimateSnapshot | null,
  requiredBytes: number
): StorageHeadroom {
  if (
    estimate === null ||
    !Number.isFinite(estimate.quota) ||
    !Number.isFinite(estimate.usage) ||
    estimate.quota <= 0
  ) {
    return { level: "ok", availableBytes: null };
  }
  const availableBytes = Math.max(0, estimate.quota - estimate.usage);
  if (requiredBytes <= 0) {
    return { level: "ok", availableBytes };
  }
  if (availableBytes < requiredBytes) {
    return { level: "insufficient", availableBytes };
  }
  // Checkpoints and the archive Blob coexist at the moment of the save, so
  // anything under double the payload is a real risk rather than a nicety.
  return {
    level: availableBytes < requiredBytes * 2 ? "tight" : "ok",
    availableBytes,
  };
}

export async function readStorageEstimate(): Promise<StorageEstimateSnapshot | null> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.storage?.estimate !== "function"
  ) {
    return null;
  }
  try {
    const estimate = await navigator.storage.estimate();
    if (typeof estimate.quota !== "number" || typeof estimate.usage !== "number") {
      return null;
    }
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}

/**
 * Asks the browser to exempt this origin from best-effort eviction. Chrome
 * grants it silently on an engaged site and Firefox prompts; either way a
 * refusal is not worth surfacing, since the download itself is unaffected —
 * only whether an interrupted job still resumes days later.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.storage?.persist !== "function"
  ) {
    return false;
  }
  try {
    if (typeof navigator.storage.persisted === "function") {
      if (await navigator.storage.persisted()) {
        return true;
      }
    }
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
