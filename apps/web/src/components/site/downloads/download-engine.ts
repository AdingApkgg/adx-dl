import type { AdxArchiveInput } from "@/lib/adx-archive-shared";

/** Per-file download state, surfaced so the UI can render a progress bar per file. */
export type AdxFileProgress = {
  name: string;
  /** Bytes received during the current request, or the full saved file size. */
  received: number;
  /** Total bytes when known, or null until the response finishes. */
  total: number | null;
  /** `skipped` = an optional asset the mirror does not have; not in the archive. */
  status: "pending" | "downloading" | "done" | "skipped";
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
  /**
   * Decoration (cover art, BGA movie) the archive is still usable without. A
   * deterministic 4xx on one of these drops the file from the archive instead
   * of failing the job — one missing pv.mp4 used to waste a 40-chart batch.
   */
  optional?: boolean;
};

/** An optional file the run gave up on; reported so the UI can list it. */
export type SkippedDownloadFile = {
  name: string;
  url: string;
  /** HTTP status that made the file unrecoverable, when the server gave one. */
  status: number | null;
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
  /**
   * Throttled byte totals across all files (for an aggregate %). `estimated`
   * marks a total that extrapolated the still-unmeasured files, so the UI can
   * render it with a "~".
   */
  onBytes?: (receivedBytes: number, totalBytes: number, estimated: boolean) => void;
  /** Fires once per optional file dropped from the archive. */
  onFileSkipped?: (file: SkippedDownloadFile) => void;
  /** Throttled per-file snapshot (drives the single-download per-file bars). */
  onFileProgress?: (progress: AdxFileProgress[]) => void;
  signal?: AbortSignal;
  /** Test seam: base backoff between retries (default 750ms, doubling, capped). */
  retryBaseDelayMs?: number;
};

/** Coalesce response chunks in memory without making them durable mid-file. */
const COALESCE_BYTES = 2 * 1024 * 1024;

/**
 * Consecutive failed attempts (with zero new bytes) before a file gives up.
 * Any attempt that receives bytes resets the count, so a flaky connection that
 * keeps making partial progress retries indefinitely instead of erroring out.
 */
const MAX_FAILURES_WITHOUT_PROGRESS = 4;
const RETRY_MAX_DELAY_MS = 8000;
/** Brief settle time after the browser reports connectivity is back. */
const ONLINE_SETTLE_DELAY_MS = 300;

/** Transient server/gateway statuses worth retrying (incl. Cloudflare 52x). */
const RETRYABLE_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 521, 522, 523, 524]);

/** A failure the retry loop may absorb; anything else fails the run immediately. */
class RetryableDownloadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "RetryableDownloadError";
    this.cause = cause;
  }
}

/**
 * A response the server will keep giving (404/403/410…). Retrying is pointless,
 * so the only choice is between skipping the file and failing the chart — which
 * `DownloadFileInput.optional` decides.
 */
class MissingDownloadFileError extends Error {
  readonly status: number;
  constructor(url: string, status: number) {
    super(`File download failed: ${url} (HTTP ${status})`);
    this.name = "MissingDownloadFileError";
    this.status = status;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** True only when the browser affirmatively reports being offline. */
function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Resolves once connectivity is back (or immediately when not offline). An
 * offline gap therefore never consumes retry attempts — the download simply
 * waits and picks up where it left off.
 */
async function waitForOnline(signal: AbortSignal): Promise<void> {
  if (
    !isOffline() ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      window.removeEventListener("online", onOnline);
      signal.removeEventListener("abort", onAbort);
    };
    const onOnline = (): void => {
      cleanup();
      resolve();
    };
    const onAbort = (): void => {
      cleanup();
      reject(abortReason(signal));
    };
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    window.addEventListener("online", onOnline, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
  await abortableDelay(ONLINE_SETTLE_DELAY_MS, signal);
}

/**
 * `bytes <start>-<end>/<total|*>` — anything else is treated as unusable.
 * `total` is null for the `*` (unknown complete length) form; `end` is always
 * concrete, so the size this response must deliver is known either way.
 */
function parseContentRange(
  header: string | null
): { start: number; end: number; total: number | null } | null {
  if (!header) {
    return null;
  }
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim());
  if (!match) {
    return null;
  }
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? null : Number(match[3]),
  };
}

/**
 * The validator a continuation is keyed on, remembered together with the header
 * it came from so a 206 can be checked against the same field.
 *
 * A strong ETag is the only true byte-identity guarantee. A weak ETag is the
 * server explicitly disclaiming byte-for-byte equivalence, and RFC 9110 §13.1.5
 * forbids falling back to Last-Modified when the response carried an entity tag
 * — so a weak ETag yields no validator at all and the file restarts from zero.
 * Last-Modified is used only when no ETag exists: it is the one CORS-safelisted
 * validator, and its second-level granularity is acceptable here because charts
 * are immutable static files (a mid-download replacement is additionally caught
 * by the 206 validator cross-check below).
 */
type ResumeValidator = { header: "etag" | "last-modified"; value: string };

function readResumeValidator(response: Response): ResumeValidator | null {
  const etag = response.headers.get("etag")?.trim();
  if (etag) {
    return /^w\//i.test(etag) ? null : { header: "etag", value: etag };
  }
  const lastModified = response.headers.get("last-modified")?.trim();
  return lastModified ? { header: "last-modified", value: lastModified } : null;
}

type LiveFile = {
  name: string;
  url: string;
  total: number | null;
  blob: Blob;
  pending: Uint8Array[];
  pendingBytes: number;
  complete: boolean;
  optional: boolean;
  /** Set once an optional file is given up on; it leaves the archive entirely. */
  skipped: boolean;
  status: AdxFileProgress["status"];
  /**
   * Resume validator from the first response. Bytes received in this run are
   * only continued via Range/If-Range when this is present; without it a retry
   * restarts the file from byte zero.
   */
  validator: ResumeValidator | null;
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

/** Drops every byte buffered for the current run (the file starts over). */
function resetLiveFile(file: LiveFile): void {
  file.blob = new Blob([]);
  file.pending = [];
  file.pendingBytes = 0;
  file.total = null;
}

/**
 * Downloads a set of loose files before local archive creation. Two recovery
 * layers keep flaky networks from killing a job:
 *
 * - Across runs (reload/pause), recovery is at file granularity: complete
 *   files are skipped and every incomplete file starts from byte zero.
 * - Within a run, a transient failure retries with backoff. Bytes already
 *   received are continued via `Range`/`If-Range` when the server supplied a
 *   strong validator; otherwise (or when the server ignores the Range) the
 *   file safely restarts from byte zero. Attempts that make progress reset
 *   the retry budget, and offline gaps wait for connectivity instead of
 *   consuming attempts.
 *
 * A file only ever completes after its entire body has been read; a 206 is
 * accepted solely as the exact continuation this run asked for.
 *
 * A third outcome exists for files marked `optional`: a deterministic 4xx drops
 * them from the archive (reported via `onFileSkipped`) rather than failing the
 * run, because one mirror missing a BGA movie should not waste the other 159
 * files of a batch.
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
  const retryBaseDelayMs = Math.max(1, callbacks.retryBaseDelayMs ?? 750);

  const files: LiveFile[] = inputs.map((input) => ({
    name: input.name,
    url: input.url,
    total: input.completedBlob === null ? null : input.completedBlob.size,
    blob: input.completedBlob ?? new Blob([]),
    pending: [],
    pendingBytes: 0,
    complete: input.completedBlob !== null,
    optional: input.optional === true,
    skipped: false,
    status: input.completedBlob === null ? "pending" : "done",
    validator: null,
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
      // Waiting for every file to declare a Content-Length pinned the
      // denominator at 0 for the whole run: with six-way concurrency over ~160
      // files most sizes are still unknown at any instant, so the bar fell back
      // to a file count that does not move while a large pv.mp4 streams.
      // Extrapolating the unknowns from the mean measured size keeps the
      // percentage roughly honest; `estimated` tells the UI to say "~".
      let received = 0;
      let knownBytes = 0;
      let knownFiles = 0;
      let unknownFiles = 0;
      for (const file of files) {
        if (file.skipped) {
          continue;
        }
        received += liveReceived(file);
        if (file.total === null) {
          unknownFiles += 1;
        } else {
          knownBytes += file.total;
          knownFiles += 1;
        }
      }
      const estimated = unknownFiles > 0 && knownFiles > 0;
      const totalBytes = estimated
        ? Math.round(knownBytes + (knownBytes / knownFiles) * unknownFiles)
        : unknownFiles > 0
          ? 0
          : knownBytes;
      callbacks.onBytes(received, totalBytes, estimated);
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

  /** One request: either the whole file or a validated continuation of it. */
  async function attemptFile(file: LiveFile): Promise<void> {
    coalesce(file);
    let received = file.blob.size;
    const canResume = received > 0 && file.validator !== null;
    if (received > 0 && !canResume) {
      // No validator means a continuation can't be proven to match the bytes
      // we already hold — restarting from zero is the only safe option.
      resetLiveFile(file);
      received = 0;
      scheduleEmit();
    }

    let response: Response;
    try {
      response = await fetch(file.url, {
        cache: "no-store",
        mode: "cors",
        signal: runSignal,
        ...(canResume
          ? {
              headers: {
                Range: `bytes=${received}-`,
                "If-Range": (file.validator as ResumeValidator).value,
              },
            }
          : {}),
      });
    } catch (error) {
      // Browsers surface pure network failures as TypeError; anything else
      // (including aborts) is not a connectivity blip and must not retry.
      if (error instanceof TypeError && !runSignal.aborted) {
        throw new RetryableDownloadError(`File download failed: ${file.url}`, error);
      }
      throw error;
    }

    // Bytes this response must leave the file holding, and the size the whole
    // file must reach. Both are null for a 200 (its length is unverifiable —
    // Content-Length describes the wire form, which differs under compression).
    let expectedSize: number | null = null;
    let declaredTotal: number | null = null;
    if (response.status === 206) {
      // Without a Range request, a 206 body is not guaranteed to contain the
      // full resource and must never be mistaken for a completed archive input.
      if (!canResume) {
        throw new Error(`File download failed: ${file.url}`);
      }
      const range = parseContentRange(response.headers.get("content-range"));
      const validator = file.validator as ResumeValidator;
      const echoed = response.headers.get(validator.header)?.trim();
      if (
        range === null ||
        range.start !== received ||
        range.end < range.start ||
        (range.total !== null && range.total <= range.end)
      ) {
        // The server resumed from the wrong offset (or described a range that
        // cannot exist) — these bytes are unusable.
        resetLiveFile(file);
        scheduleEmit();
        throw new RetryableDownloadError(
          `File download failed: ${file.url} (unexpected Content-Range)`
        );
      }
      if (echoed !== undefined && echoed !== validator.value) {
        // If-Range should have forced a 200 for a changed representation. This
        // server continued a *different* entity — splicing it would corrupt the
        // file, so drop the prefix and start over.
        resetLiveFile(file);
        scheduleEmit();
        throw new RetryableDownloadError(
          `File download failed: ${file.url} (representation changed)`
        );
      }
      // `range.end + 1` holds even for the `bytes S-E/*` form, so an unknown
      // complete length never disables the size check below.
      expectedSize = range.end + 1;
      declaredTotal = range.total;
      file.total = declaredTotal ?? expectedSize;
    } else if (response.status === 200) {
      if (received > 0) {
        // Server ignored the Range (or the file changed under If-Range) and is
        // sending the whole body — drop the stale prefix before streaming.
        resetLiveFile(file);
        received = 0;
        scheduleEmit();
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength && Number.isFinite(Number(contentLength))) {
        file.total = Number(contentLength);
      }
      file.validator = readResumeValidator(response);
    } else if (response.status === 416 && canResume) {
      // The held offset is no longer valid (the file changed or shrank, or the
      // last attempt already received every byte). Restarting is safe recovery,
      // not a job failure — but the prefix can no longer be trusted.
      resetLiveFile(file);
      scheduleEmit();
      throw new RetryableDownloadError(
        `File download failed: ${file.url} (range no longer satisfiable)`
      );
    } else if (RETRYABLE_HTTP_STATUS.has(response.status)) {
      throw new RetryableDownloadError(
        `File download failed: ${file.url} (HTTP ${response.status})`
      );
    } else {
      // Deterministic (the mirror simply does not have this byte range/file).
      // The status travels in the message so the store can tell a permanent
      // 404 apart from a flaky connection when it words the failure.
      throw new MissingDownloadFileError(file.url, response.status);
    }

    try {
      if (!response.body) {
        file.blob = new Blob([file.blob, await response.arrayBuffer()]);
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
    } catch (error) {
      // Keep whatever arrived: a later attempt can continue from this prefix.
      coalesce(file);
      if (runSignal.aborted || isAbortError(error)) {
        throw error;
      }
      throw new RetryableDownloadError(`File download failed: ${file.url}`, error);
    }

    // A 206 continuation is byte-exact: a stream that ended cleanly but short
    // is a truncated transfer (keep the prefix and retry); a stream that ran
    // past the declared range cannot be trusted at all.
    if (expectedSize !== null && file.blob.size !== expectedSize) {
      if (file.blob.size > expectedSize) {
        resetLiveFile(file);
        scheduleEmit();
        throw new Error(`File download failed: ${file.url}`);
      }
      throw new RetryableDownloadError(
        `File download failed: ${file.url} (truncated)`
      );
    }
    // A server may answer `bytes=N-` with a shorter range than asked for; the
    // bytes are good, the file just isn't finished. Retrying continues from the
    // new offset, and the progress made resets the retry budget.
    if (declaredTotal !== null && file.blob.size < declaredTotal) {
      throw new RetryableDownloadError(
        `File download failed: ${file.url} (partial range)`
      );
    }

    // The browser-visible Blob size is authoritative even when a compressed
    // transfer's Content-Length described a different wire representation.
    file.total = file.blob.size;
    file.complete = true;
    file.status = "done";
  }

  /** Drops an optional file from the archive and reports it exactly once. */
  function skipFile(file: LiveFile, status: number | null): void {
    file.skipped = true;
    file.complete = false;
    file.status = "skipped";
    resetLiveFile(file);
    scheduleEmit();
    callbacks.onFileSkipped?.({ name: file.name, url: file.url, status });
  }

  /** Resolves to null when an optional file was skipped rather than fetched. */
  async function downloadOne(file: LiveFile): Promise<CompletedDownloadFile | null> {
    if (!file.complete) {
      file.status = "downloading";
      scheduleEmit();

      let failuresWithoutProgress = 0;
      for (;;) {
        if (runSignal.aborted) {
          throw abortReason(runSignal);
        }
        const receivedBefore = liveReceived(file);
        try {
          await attemptFile(file);
          break;
        } catch (error) {
          coalesce(file);
          if (runSignal.aborted || isAbortError(error)) {
            throw error;
          }
          if (!(error instanceof RetryableDownloadError)) {
            if (error instanceof MissingDownloadFileError && file.optional) {
              skipFile(file, error.status);
              return null;
            }
            throw error;
          }
          if (isOffline()) {
            // A failure while offline is explained by the outage, not the
            // server — wait for connectivity without spending an attempt.
            await waitForOnline(runSignal);
            continue;
          }
          if (liveReceived(file) > receivedBefore) {
            failuresWithoutProgress = 0;
          }
          failuresWithoutProgress += 1;
          if (failuresWithoutProgress >= MAX_FAILURES_WITHOUT_PROGRESS) {
            throw error;
          }
          const backoff = Math.min(
            RETRY_MAX_DELAY_MS,
            retryBaseDelayMs * 2 ** (failuresWithoutProgress - 1)
          );
          // Jitter desynchronizes parallel workers retrying the same outage.
          await abortableDelay(backoff * (0.75 + Math.random() * 0.5), runSignal);
        }
      }
    }

    return { name: file.name, url: file.url, blob: file.blob };
  }

  async function worker(): Promise<void> {
    while (nextIndex < total) {
      if (runSignal.aborted) {
        throw abortReason(runSignal);
      }
      const file = files[nextIndex];
      nextIndex += 1;
      const completedFile = await downloadOne(file);
      // A sibling may have failed while this worker was finishing its body.
      // Never start a new durable checkpoint after the run has been aborted.
      if (runSignal.aborted) {
        throw abortReason(runSignal);
      }
      completed += 1;
      // A skipped file still advances the counter (the job really is that much
      // closer to done) but has no bytes to checkpoint.
      if (completedFile !== null) {
        await callbacks.onFileComplete?.(completedFile, completed, total);
      }
      if (runSignal.aborted) {
        throw abortReason(runSignal);
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

  return files
    .filter((file) => !file.skipped)
    .map((file): AdxArchiveInput => ({ name: file.name, blob: file.blob }));
}
