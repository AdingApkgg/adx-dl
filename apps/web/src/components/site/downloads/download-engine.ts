import type { AdxArchiveInput } from "@/lib/adx-archive";

/** Per-file download state, surfaced so the UI can render a progress bar per file. */
export type AdxFileProgress = {
  name: string;
  /** Bytes received so far. */
  received: number;
  /** Total bytes when known, or null until the size is learned. */
  total: number | null;
  status: "pending" | "downloading" | "done";
};

/**
 * A resumable multi-file downloader. Each file carries whatever bytes were
 * already fetched in a previous session (an empty Blob for a fresh start); the
 * engine asks the server only for the remainder via an HTTP `Range` request,
 * validated with `If-Range` so a changed file restarts cleanly. Bytes accumulate
 * as Blobs (structural concat, no megabyte copies) and are flushed to the caller
 * periodically so a reload loses at most the last unflushed window.
 *
 * Storage is injected through callbacks, which keeps the engine pure enough to
 * unit-test with a mocked `fetch` and no IndexedDB.
 */

export type ResumeFileInput = {
  name: string;
  url: string;
  /** Validator captured on first download; replayed via If-Range to resume. */
  etag: string | null;
  /** Full size when known (from a prior response), else null. */
  total: number | null;
  /** Bytes already on hand; size === the resume offset. Empty Blob = fresh. */
  blob: Blob;
};

export type EngineFlush = {
  name: string;
  url: string;
  etag: string | null;
  total: number | null;
  received: number;
  blob: Blob;
};

export type EngineCallbacks = {
  concurrency?: number;
  /** Fires as each file finishes, with running file counts. */
  onFileComplete?: (completed: number, total: number) => void;
  /** Throttled byte totals across all files (for an aggregate %). */
  onBytes?: (receivedBytes: number, totalBytes: number) => void;
  /** Throttled per-file snapshot (drives the single-download per-file bars). */
  onFileProgress?: (progress: AdxFileProgress[]) => void;
  /** Throttled persistence hook; the caller writes this file's bytes durably. */
  onFlush?: (file: EngineFlush) => void;
  signal?: AbortSignal;
};

const FLUSH_BYTES = 2 * 1024 * 1024;
const FLUSH_MS = 1500;

type LiveFile = {
  name: string;
  url: string;
  etag: string | null;
  total: number | null;
  /** Durable, flushed bytes. */
  blob: Blob;
  /** New chunks not yet merged into `blob`. */
  pending: Uint8Array[];
  pendingBytes: number;
  lastFlush: number;
  status: AdxFileProgress["status"];
};

/** Bytes we hold for a file right now: flushed prefix + not-yet-merged chunks. */
function liveReceived(file: LiveFile): number {
  return file.blob.size + file.pendingBytes;
}

function isAlreadyComplete(file: LiveFile): boolean {
  return file.total != null && file.blob.size >= file.total && file.blob.size > 0;
}

export async function runResumableDownload(
  inputs: ResumeFileInput[],
  callbacks: EngineCallbacks = {}
): Promise<AdxArchiveInput[]> {
  const { signal } = callbacks;
  const total = inputs.length;
  const concurrency = Math.max(1, callbacks.concurrency ?? 4);

  const files: LiveFile[] = inputs.map((input) => ({
    name: input.name,
    url: input.url,
    etag: input.etag,
    total: input.total,
    blob: input.blob,
    pending: [],
    pendingBytes: 0,
    lastFlush: 0,
    status: input.blob.size > 0 ? "downloading" : "pending",
  }));

  // Already-complete (resumed) files are counted by the workers below, which
  // process them without a network round-trip — so completed starts at 0.
  let completed = 0;
  callbacks.onFileComplete?.(completed, total);

  // Coalesce progress to one emit per frame: byte-level updates fire very often.
  let rafId: number | null = null;
  const emitNow = (): void => {
    rafId = null;
    if (callbacks.onFileProgress) {
      callbacks.onFileProgress(
        files.map((file) => ({
          name: file.name,
          received: liveReceived(file),
          total: file.total,
          status: file.status,
        }))
      );
    }
    if (callbacks.onBytes) {
      let received = 0;
      let totalBytes = 0;
      let totalKnown = true;
      for (const file of files) {
        received += liveReceived(file);
        if (file.total == null) {
          totalKnown = false;
        } else {
          totalBytes += file.total;
        }
      }
      callbacks.onBytes(received, totalKnown ? totalBytes : 0);
    }
  };
  const scheduleEmit = (): void => {
    if (rafId !== null) {
      return;
    }
    if (typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(emitNow);
    } else {
      emitNow();
    }
  };

  const flush = (file: LiveFile, force = false): void => {
    if (file.pendingBytes === 0 && !force) {
      return;
    }
    if (file.pendingBytes > 0) {
      file.blob = new Blob([file.blob, ...(file.pending as BlobPart[])]);
      file.pending = [];
      file.pendingBytes = 0;
    }
    file.lastFlush = Date.now();
    callbacks.onFlush?.({
      name: file.name,
      url: file.url,
      etag: file.etag,
      total: file.total,
      received: file.blob.size,
      blob: file.blob,
    });
  };

  let nextIndex = 0;

  async function downloadOne(file: LiveFile): Promise<void> {
    if (isAlreadyComplete(file)) {
      file.status = "done";
      return;
    }

    const received = file.blob.size;
    const headers: Record<string, string> = {};
    if (received > 0) {
      headers.Range = `bytes=${received}-`;
      if (file.etag) {
        headers["If-Range"] = file.etag;
      }
    }

    file.status = "downloading";
    scheduleEmit();

    let response = await fetch(file.url, { cache: "no-store", mode: "cors", headers, signal });

    // 416 = our start offset is at/beyond EOF. This happens for CDN-compressed
    // files (e.g. a gzip'd maidata.txt) that arrive with no Content-Length, so we
    // never learned the size and can't tell a finished file from an unfinished
    // one. Drop the prefix and re-fetch the whole file from byte 0. Re-fetching a
    // fully-downloaded file is cheap, and the completion handler below records
    // its size so the next resume skips it outright.
    if (response.status === 416) {
      file.blob = new Blob([]);
      response = await fetch(file.url, { cache: "no-store", mode: "cors", signal });
    }

    if (!response.ok && response.status !== 206) {
      throw new Error(`File download failed: ${file.url}`);
    }

    // We asked to resume but the server sent the whole file (changed, or it
    // ignores Range): drop the stale prefix and take this response from byte 0.
    if (file.blob.size > 0 && response.status === 200) {
      file.blob = new Blob([]);
    }

    const responseEtag = response.headers.get("etag");
    if (responseEtag) {
      file.etag = responseEtag;
    }
    if (file.total == null) {
      const contentRange = response.headers.get("content-range");
      const sizeFromRange = contentRange ? /\/(\d+)\s*$/.exec(contentRange)?.[1] : null;
      const contentLength = response.headers.get("content-length");
      if (sizeFromRange) {
        file.total = Number(sizeFromRange);
      } else if (response.status === 200 && contentLength && Number.isFinite(Number(contentLength))) {
        file.total = Number(contentLength);
      }
    }

    if (!response.body) {
      const buffered = await response.arrayBuffer();
      file.blob = new Blob([file.blob, buffered]);
    } else {
      const reader = response.body.getReader();
      // Seed the flush clock so the time-based flush fires after a real interval,
      // not on the very first chunk.
      file.lastFlush = Date.now();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        file.pending.push(value);
        file.pendingBytes += value.length;
        if (file.pendingBytes >= FLUSH_BYTES || Date.now() - file.lastFlush >= FLUSH_MS) {
          flush(file);
        }
        scheduleEmit();
      }
    }

    // If the server never told us the size (compressed response, no
    // Content-Length, Content-Range not CORS-exposed), the bytes we just finished
    // streaming ARE the full size. Recording it lets the next resume recognise the
    // file as complete instead of range-requesting past its end (→ 416).
    if (file.total == null) {
      file.total = file.blob.size + file.pendingBytes;
    }

    flush(file, true);
    file.status = "done";
  }

  async function worker(): Promise<void> {
    while (nextIndex < total) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const file = files[nextIndex];
      nextIndex += 1;
      await downloadOne(file);
      completed += 1;
      callbacks.onFileComplete?.(completed, total);
      scheduleEmit();
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));
  } finally {
    if (rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
    }
  }

  // Hand back the accumulated Blobs as-is — the streaming packer reads them
  // chunk by chunk, so we never materialise a whole file (let alone the whole
  // archive) in RAM.
  return files.map((file): AdxArchiveInput => ({ name: file.name, blob: file.blob }));
}
