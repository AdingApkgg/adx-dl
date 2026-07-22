import type { AdxArchiveInput } from "@/lib/adx-archive";

/** Per-file download state, surfaced so the UI can render a progress bar per file. */
export type AdxFileProgress = {
  name: string;
  /** Bytes received during the current request, or the full saved file size. */
  received: number;
  /** Total bytes when known, or null until the response finishes. */
  total: number | null;
  status: "pending" | "downloading" | "done";
};

/**
 * One logical file in a multi-file archive job. A completed Blob is an
 * all-or-nothing checkpoint from an earlier run; unfinished byte prefixes are
 * deliberately never accepted or persisted.
 */
export type DownloadFileInput = {
  name: string;
  url: string;
  /** null = fetch the whole file; Blob (including an empty Blob) = already complete. */
  completedBlob: Blob | null;
};

export type CompletedDownloadFile = {
  name: string;
  url: string;
  blob: Blob;
};

export type EngineCallbacks = {
  concurrency?: number;
  /** Fires once per complete file and waits for its durable checkpoint write. */
  onFileComplete?: (
    file: CompletedDownloadFile,
    completed: number,
    total: number
  ) => void | Promise<void>;
  /** Throttled byte totals across all files (for an aggregate %). */
  onBytes?: (receivedBytes: number, totalBytes: number) => void;
  /** Throttled per-file snapshot (drives the single-download per-file bars). */
  onFileProgress?: (progress: AdxFileProgress[]) => void;
  signal?: AbortSignal;
};

/** Coalesce response chunks in memory without making them durable mid-file. */
const COALESCE_BYTES = 2 * 1024 * 1024;

type LiveFile = {
  name: string;
  url: string;
  total: number | null;
  blob: Blob;
  pending: Uint8Array[];
  pendingBytes: number;
  complete: boolean;
  status: AdxFileProgress["status"];
};

function liveReceived(file: LiveFile): number {
  return file.blob.size + file.pendingBytes;
}

function coalesce(file: LiveFile): void {
  if (file.pendingBytes === 0) {
    return;
  }
  file.blob = new Blob([file.blob, ...(file.pending as BlobPart[])]);
  file.pending = [];
  file.pendingBytes = 0;
}

/**
 * Downloads a set of loose files before local archive creation. Recovery is at
 * file granularity: complete files are skipped, while every incomplete file is
 * fetched from byte zero with a normal GET (never Range / If-Range).
 */
export async function runMultiFileDownload(
  inputs: DownloadFileInput[],
  callbacks: EngineCallbacks = {}
): Promise<AdxArchiveInput[]> {
  const { signal } = callbacks;
  // One failed worker aborts every sibling request. The caller's signal is
  // linked into this controller, but an internal failure never mutates the
  // caller-owned controller.
  const runController = new AbortController();
  const runSignal = runController.signal;
  const abortFromCaller = (): void => {
    if (!runSignal.aborted) {
      runController.abort(signal?.reason);
    }
  };
  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const total = inputs.length;
  const concurrency = Math.max(1, callbacks.concurrency ?? 4);

  const files: LiveFile[] = inputs.map((input) => ({
    name: input.name,
    url: input.url,
    total: input.completedBlob === null ? null : input.completedBlob.size,
    blob: input.completedBlob ?? new Blob([]),
    pending: [],
    pendingBytes: 0,
    complete: input.completedBlob !== null,
    status: input.completedBlob === null ? "pending" : "done",
  }));

  let completed = 0;

  // Coalesce progress to one emit per frame: byte-level updates fire very often.
  let rafId: number | null = null;
  const emitNow = (): void => {
    rafId = null;
    callbacks.onFileProgress?.(
      files.map((file) => ({
        name: file.name,
        received: liveReceived(file),
        total: file.total,
        status: file.status,
      }))
    );
    if (callbacks.onBytes) {
      let received = 0;
      let totalBytes = 0;
      let totalKnown = true;
      for (const file of files) {
        received += liveReceived(file);
        if (file.total === null) {
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

  let nextIndex = 0;

  async function downloadOne(file: LiveFile): Promise<CompletedDownloadFile> {
    if (!file.complete) {
      file.status = "downloading";
      scheduleEmit();

      const response = await fetch(file.url, {
        cache: "no-store",
        mode: "cors",
        signal: runSignal,
      });

      // Without a Range request, a 206 body is not guaranteed to contain the
      // full resource and must never be mistaken for a completed archive input.
      if (!response.ok || response.status !== 200) {
        throw new Error(`File download failed: ${file.url}`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && Number.isFinite(Number(contentLength))) {
        file.total = Number(contentLength);
      }

      if (!response.body) {
        file.blob = new Blob([await response.arrayBuffer()]);
      } else {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          file.pending.push(value);
          file.pendingBytes += value.length;
          if (file.pendingBytes >= COALESCE_BYTES) {
            coalesce(file);
          }
          scheduleEmit();
        }
        coalesce(file);
      }

      // The browser-visible Blob size is authoritative even when a compressed
      // transfer's Content-Length described a different wire representation.
      file.total = file.blob.size;
      file.complete = true;
      file.status = "done";
    }

    return { name: file.name, url: file.url, blob: file.blob };
  }

  async function worker(): Promise<void> {
    while (nextIndex < total) {
      if (runSignal.aborted) {
        throw runSignal.reason ?? new DOMException("Aborted", "AbortError");
      }
      const file = files[nextIndex];
      nextIndex += 1;
      const completedFile = await downloadOne(file);
      // A sibling may have failed while this worker was finishing its body.
      // Never start a new durable checkpoint after the run has been aborted.
      if (runSignal.aborted) {
        throw runSignal.reason ?? new DOMException("Aborted", "AbortError");
      }
      completed += 1;
      await callbacks.onFileComplete?.(completedFile, completed, total);
      if (runSignal.aborted) {
        throw runSignal.reason ?? new DOMException("Aborted", "AbortError");
      }
      scheduleEmit();
    }
  }

  emitNow();
  let firstError: unknown;
  let hasFirstError = false;
  const guardedWorker = async (): Promise<void> => {
    try {
      await worker();
    } catch (error) {
      if (!hasFirstError) {
        hasFirstError = true;
        firstError = error;
      }
      if (!runSignal.aborted) {
        runController.abort(error);
      }
      throw error;
    }
  };
  try {
    // allSettled is intentional: the store must not expose an error/source
    // switch until sibling fetches and any checkpoint callback already in
    // flight have fully quiesced.
    await Promise.allSettled(
      Array.from({ length: Math.min(concurrency, total) }, () => guardedWorker())
    );
    if (hasFirstError) {
      throw firstError;
    }
  } finally {
    signal?.removeEventListener("abort", abortFromCaller);
    if (rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
    }
  }

  return files.map((file): AdxArchiveInput => ({ name: file.name, blob: file.blob }));
}
