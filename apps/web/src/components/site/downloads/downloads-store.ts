import { create } from "zustand";

import {
  ARCHIVE_FORMATS,
  getArchiveDownloadFileName,
  saveBlobAsFile,
  type AdxArchiveInput,
  type ArchiveProgress,
  type ArchiveFormat,
  type BatchArchiveFormat,
  type NestedChart,
} from "@/lib/adx-archive-shared";
import type { AdxRemoteFile } from "@/lib/adx-directory";
import {
  isChartVideoFile,
  isOptionalChartAssetFile,
  type ChartDownloadSpec,
} from "@/lib/catalog-shared";
import {
  DOWNLOAD_SOURCE_PROBE_TTL_MS,
  probeCustomDownloadSource,
  probeDownloadSource,
  type DownloadSourceProbe,
} from "@/lib/download-source-probe";
import {
  canonicalDownloadResourceUrl,
  CUSTOM_DOWNLOAD_SOURCE_ID,
  DEFAULT_DOWNLOAD_SOURCE_ID,
  DOWNLOAD_SOURCES,
  getSelectableDownloadSource,
  inferDownloadSourceId,
  isCustomDownloadSourceId,
  normalizeCustomDownloadSourceName,
  normalizeCustomDownloadSourceUrl,
  pickFailoverDownloadSource,
  rerouteDownloadFiles,
  routeChartDownloadSpecs,
  routeDownloadFiles,
  type CustomDownloadSourceConfig,
  type CustomDownloadSourceId,
  type DownloadSourceId,
} from "@/lib/download-sources";
import { tagMaidataInputs } from "@/lib/maidata-title";
import {
  runMultiFileDownload,
  type AdxFileProgress,
  type DownloadFileInput,
  type SkippedDownloadFile,
} from "./download-engine";
import {
  clearHistory,
  deleteJob,
  fileKey,
  loadAllJobs,
  loadFilesForJob,
  loadHistory,
  MAX_DOWNLOAD_HISTORY,
  persistFile,
  persistJob,
  recordHistory,
  replaceJobKeepingCompletedFiles,
  subscribeToCheckpointFailures,
  type DownloadHistoryEntry,
  type PersistedFile,
  type PersistedJob,
} from "./persistence";
import { requestPersistentStorage } from "./storage-estimate";

/**
 * A download job. The store is a module-level singleton, so a job keeps running
 * (and updating) after the component that started it unmounts on a client-side
 * navigation. Whole files are checkpointed in IndexedDB, so an interrupted job
 * comes back as `paused`, skips completed files, and restarts only the unfinished
 * files from byte zero.
 */
export type DownloadJob = {
  id: string;
  kind: "single" | "batch";
  /** Display name — the chart directory name or the batch collection name. */
  title: string;
  /** Route chosen when the job started; remains stable across pause/resume. */
  sourceId: DownloadSourceId;
  /** Exact route root, so an existing custom-source job is independent of later edits. */
  sourceBaseUrl?: string;
  /** Custom route label snapshot, retained even if that route is later deleted. */
  sourceName?: string;
  format: ArchiveFormat;
  /**
   * `queued` = accepted but waiting for a download slot; `packing` = fetching
   * files; `archiving` = all bytes on hand, building the archive blob (can take
   * a while for big batches — distinct so the UI doesn't look frozen at 100%).
   * `paused` = interrupted (reload or manual pause), awaiting manual resume.
   */
  status: "queued" | "packing" | "archiving" | "success" | "error" | "paused";
  /** Files finished downloading so far / total files to fetch. */
  completed: number;
  total: number;
  /** Aggregate byte progress (0 total when no file size is known yet). */
  receivedBytes: number;
  totalBytes: number;
  /** True when `totalBytes` extrapolated files that had not declared a size. */
  totalBytesEstimated: boolean;
  /** Smoothed transfer rate in bytes/second (0 until measured). */
  speedBps: number;
  /** Milliseconds left at the current smoothed rate, or null when unknowable. */
  etaMs: number | null;
  /** Per-file byte progress; only populated for single-chart downloads. */
  fileProgress: AdxFileProgress[];
  /** Current in-archive file while locally writing the final .adx/.zip/.tar.gz. */
  archiveCurrentFile: string | null;
  error: string | null;
  /**
   * Coarse cause so the UI can show a friendly, localized message. `missing`
   * (a permanent 4xx) and `server` (5xx) used to be bucketed as `network`,
   * which told the user to "just retry" a file that will never exist.
   */
  errorKind: "offline" | "network" | "missing" | "server" | "unknown" | null;
  /** Verbatim URL + status, for the expandable detail block and its copy button. */
  errorDetail: string | null;
  /** Optional assets the mirror did not have; the archive is complete without them. */
  skippedFiles: SkippedDownloadFile[];
  /** Route this run moved to by itself after a failure, until the user acts. */
  autoSwitchedTo: DownloadSourceId | null;
  /** Disambiguates a restart from a stale auto-dismiss timer. */
  startedAt: number;
};

type StartSingleParams = {
  id: string;
  title: string;
  files: AdxRemoteFile[];
  groupDir?: string;
  includeVideo: boolean;
  format?: ArchiveFormat;
  sourceId?: DownloadSourceId;
};

/** Folder layout inside a batch archive: one folder per version or per genre. */
export type BatchGrouping = "version" | "genre";

export const BATCH_GROUPINGS: readonly BatchGrouping[] = ["version", "genre"];

/** The grouping folder a chart lands in under the given batch layout. */
export function chartGroupingDir(
  chart: Pick<ChartDownloadSpec, "groupDir" | "genreDir">,
  grouping: BatchGrouping
): string {
  return (grouping === "genre" ? chart.genreDir : chart.groupDir) ?? "";
}

type StartBatchParams = {
  id: string;
  title: string;
  charts: ChartDownloadSpec[];
  includeVideo: boolean;
  format?: BatchArchiveFormat;
  sourceId?: DownloadSourceId;
  /** Folder grouping inside the archive; defaults to the stored preference. */
  grouping?: BatchGrouping;
};

type DownloadsState = {
  jobs: DownloadJob[];
  /** Shared choice so every single and batch download entry stays consistent. */
  selectedSourceId: DownloadSourceId;
  /** Device-local user routes. Built-in routes live in DOWNLOAD_SOURCES instead. */
  customSources: CustomDownloadSourceConfig[];
  /** Global one-click archive format; each running job keeps its own snapshot. */
  preferredFormat: ArchiveFormat;
  /** Batch archive folder layout (per version / per genre); device-local. */
  preferredBatchGrouping: BatchGrouping;
  /** One shared latency snapshot prevents every picker from probing independently. */
  sourceProbes: DownloadSourceProbeMap;
  /**
   * Ref-count of job ids currently rendered inline by an on-page component, so
   * the floating tray can avoid showing the same progress twice.
   */
  presented: Record<string, number>;
  /**
   * Ref-count of full-width bottom bars on screen (the batch download bar), so
   * the floating tray can lift itself above them instead of overlapping.
   */
  bottomBars: number;
  /** Newest-first completed downloads that can be started again as-is. */
  history: DownloadHistoryEntry[];
  /**
   * Set once a checkpoint write has failed. Everything still downloads, but the
   * "已完成文件会保留" promise no longer holds across a reload, and the UI has
   * to stop making it.
   */
  checkpointsUnavailable: boolean;
  startSingle: (params: StartSingleParams) => void;
  /** Returns the queued job ids — one per version/genre group in the selection. */
  startBatch: (params: StartBatchParams) => string[];
  setSelectedSourceId: (sourceId: DownloadSourceId) => void;
  setPreferredFormat: (format: ArchiveFormat) => void;
  setPreferredBatchGrouping: (grouping: BatchGrouping) => void;
  /** Adds a device-local route and returns its stable id when valid. */
  addCustomSource: (name: string, url: string) => CustomDownloadSourceId | null;
  /** Updates a custom route without changing running-job snapshots. */
  updateCustomSource: (
    id: CustomDownloadSourceId,
    name: string,
    url: string
  ) => boolean;
  /** Built-ins are rejected; deleting the selected custom route restores R2. */
  removeCustomSource: (id: DownloadSourceId) => boolean;
  refreshSourceProbes: (force?: boolean) => Promise<void>;
  /** Keeps completed files and restarts unfinished files on another route. */
  restartWithSource: (id: string, sourceId: DownloadSourceId) => void;
  resume: (id: string) => void;
  /**
   * Restarts every job a lost connection left stranded. Called when the tab
   * comes back to the foreground online — a phone that backgrounded mid-batch
   * otherwise showed a wall of failures nobody had asked for.
   */
  resumeInterrupted: () => number;
  /** Aborts in-flight files but keeps its spec and whole-file checkpoints. */
  pause: (id: string) => void;
  dismiss: (id: string) => void;
  /** Queues a finished download again under a fresh job id. */
  rerunHistoryEntry: (key: string) => void;
  clearDownloadHistory: () => void;
  hydrateFromStorage: () => void;
  presentInline: (id: string) => void;
  unpresentInline: (id: string) => void;
  presentBottomBar: () => void;
  unpresentBottomBar: () => void;
};

/** How long a finished (success) job lingers before the tray auto-clears it. */
const AUTO_DISMISS_MS = 30000;

/**
 * Cap on automatic route switches per job. Two is enough to escape one bad
 * mirror plus one unlucky second pick; beyond that the failure is almost
 * certainly the user's own connection, and silently churning through all six
 * routes only delays telling them so.
 */
const MAX_AUTO_SOURCE_SWITCHES = 2;

/**
 * Ignore the first moments of a transfer when quoting a finish time: the EMA
 * has not converged yet, and a wildly wrong "剩余 47 分钟" is worse than none.
 */
const MIN_ETA_SPEED_BPS = 16 * 1024;

/**
 * Download slots. A grouped batch enqueues one job per version/genre, so
 * without a cap "select all" would open dozens of jobs × their own per-file
 * concurrency at once. Two slots rather than one: a job parked in a retry
 * backoff or waiting for connectivity would otherwise stall the whole queue.
 */
const MAX_ACTIVE_JOBS = 2;
const activeJobIds = new Set<string>();
type SlotWaiter = { grant: () => void; cancel: () => void };
/** FIFO, so jobs start in the order the user added them. */
const slotWaiters: SlotWaiter[] = [];

function pumpJobQueue(): void {
  while (activeJobIds.size < MAX_ACTIVE_JOBS && slotWaiters.length > 0) {
    slotWaiters.shift()?.grant();
  }
}

/** Resolves when this job may start; rejects if it is aborted while waiting. */
function acquireJobSlot(id: string, signal: AbortSignal): Promise<void> {
  const abortReason = (): unknown =>
    signal.reason ?? new DOMException("Aborted", "AbortError");
  if (signal.aborted) {
    return Promise.reject(abortReason());
  }
  if (activeJobIds.size < MAX_ACTIVE_JOBS) {
    activeJobIds.add(id);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      const index = slotWaiters.indexOf(waiter);
      if (index >= 0) {
        slotWaiters.splice(index, 1);
      }
    };
    const waiter: SlotWaiter = {
      grant: () => {
        cleanup();
        activeJobIds.add(id);
        resolve();
      },
      cancel: () => {
        cleanup();
        reject(abortReason());
      },
    };
    const onAbort = (): void => waiter.cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    slotWaiters.push(waiter);
  });
}

function releaseJobSlot(id: string): void {
  activeJobIds.delete(id);
  pumpJobQueue();
}

/** Test seam: the queue is module state, so it must reset between test cases. */
export function resetDownloadQueueForTests(): void {
  for (const waiter of [...slotWaiters]) {
    waiter.cancel();
  }
  slotWaiters.length = 0;
  activeJobIds.clear();
}

// Module-level (outside the store value) so they survive store updates but stay
// out of React's snapshot: the durable job spec and any in-flight abort handle.
const jobSpecs = new Map<string, PersistedJob>();
const abortControllers = new Map<string, AbortController>();
/** Includes worker shutdown and any durable file callback already in flight. */
const activeRunPromises = new Map<string, Promise<void>>();
const restartingJobs = new Set<string>();
/** Byte samples for the smoothed transfer-rate estimate, keyed by job id. */
const speedSamples = new Map<string, { time: number; bytes: number; ema: number }>();
/** Routes this job has already failed on, so failover never retries a dead one. */
const jobTriedSources = new Map<string, Set<DownloadSourceId>>();
const jobAutoSwitchCounts = new Map<string, number>();
let hydrated = false;
let sourceProbePromise: Promise<void> | null = null;
/** Test seam: shrink the engine's retry backoff so failure paths settle fast. */
let engineRetryBaseDelayMs: number | undefined;

export function setDownloadRetryBaseDelayForTests(ms: number | undefined): void {
  engineRetryBaseDelayMs = ms;
}
const customSourceProbeVersions = new Map<CustomDownloadSourceId, number>();
let customSourceIdSequence = 0;

/** Minimum sampling window before updating the rate estimate. */
const SPEED_SAMPLE_MS = 500;
const ARCHIVE_PROGRESS_SAMPLE_MS = 100;
/** Gap between consecutive archive saves in a cross-version batch. */
const MULTI_SAVE_SPACING_MS = 250;
const SOURCE_PREFERENCE_KEY = "astrodx-download-source";
const CUSTOM_SOURCE_URL_KEY = "astrodx-custom-download-source";
const CUSTOM_SOURCES_KEY = "astrodx-custom-download-sources";
const FORMAT_PREFERENCE_KEY = "astrodx-download-format";
const BATCH_GROUPING_PREFERENCE_KEY = "astrodx-download-batch-grouping";

export type DownloadSourceProbeMap = Partial<
  Record<DownloadSourceId, DownloadSourceProbe>
>;

export function createInitialDownloadSourceProbes(
  customSources: readonly CustomDownloadSourceConfig[] = []
): DownloadSourceProbeMap {
  return Object.fromEntries(
    [
      ...DOWNLOAD_SOURCES.map((source) => source.id),
      ...customSources.map((source) => source.id),
    ].map((sourceId) => [
      sourceId,
      {
        state: "idle",
        latencyMs: null,
        measuredAt: null,
      } satisfies DownloadSourceProbe,
    ])
  ) as DownloadSourceProbeMap;
}

function sourceProbesAreFresh(
  probes: DownloadSourceProbeMap,
  customSources: readonly CustomDownloadSourceConfig[],
  now: number
): boolean {
  const sourceIds: DownloadSourceId[] = [
    ...DOWNLOAD_SOURCES.map((source) => source.id),
    ...customSources.map((source) => source.id),
  ];
  return sourceIds.every((sourceId) => {
    const measuredAt = probes[sourceId]?.measuredAt ?? null;
    return measuredAt !== null && now - measuredAt < DOWNLOAD_SOURCE_PROBE_TTL_MS;
  });
}

/** Reuse only a whole file representing the same logical resource across mirrors. */
export function reusablePersistedFile(
  file: { url: string },
  prior: PersistedFile | undefined,
  sourceBaseUrl?: string
): PersistedFile | undefined {
  if (!prior || prior.complete !== true || prior.size !== prior.blob.size) {
    return undefined;
  }
  const knownSourceBaseUrls = [sourceBaseUrl ?? "", prior.sourceBaseUrl ?? ""];
  return canonicalDownloadResourceUrl(prior.url, knownSourceBaseUrls) ===
    canonicalDownloadResourceUrl(file.url, knownSourceBaseUrls)
    ? prior
    : undefined;
}

/** Paused/failed UI may show only durable whole files, never discarded prefixes. */
function completedCheckpointProgress(job: DownloadJob): Pick<
  DownloadJob,
  "completed" | "receivedBytes" | "totalBytes" | "fileProgress"
> {
  const fileProgress = job.fileProgress.map((file) =>
    // "skipped" is as final as "done": the mirror does not have the file, and
    // a resume must not present it as something still to fetch.
    file.status === "done" || file.status === "skipped"
      ? file
      : { name: file.name, received: 0, total: null, status: "pending" as const }
  );
  return {
    completed:
      job.kind === "single"
        ? fileProgress.filter((file) => file.status === "done").length
        : job.completed,
    // Aggregate paused/error progress falls back to completed file count. The
    // per-file rows still retain exact sizes for files marked done.
    receivedBytes: 0,
    totalBytes: 0,
    fileProgress,
  };
}

function saveSourcePreference(sourceId: DownloadSourceId): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(SOURCE_PREFERENCE_KEY, sourceId);
  } catch {
    // A blocked/private localStorage should not prevent downloads.
  }
}

function saveCustomSources(customSources: readonly CustomDownloadSourceConfig[]): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      CUSTOM_SOURCES_KEY,
      JSON.stringify({ version: 1, sources: customSources })
    );
    // The versioned collection is authoritative, including when empty. Remove
    // the legacy singleton so a deleted route cannot reappear on the next load.
    localStorage.removeItem(CUSTOM_SOURCE_URL_KEY);
  } catch {
    // A blocked/private localStorage should not prevent downloads.
  }
}

function normalizedCustomSourceRecord(
  value: unknown
): CustomDownloadSourceConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const name =
    typeof record.name === "string"
      ? normalizeCustomDownloadSourceName(record.name)
      : null;
  const baseUrl =
    typeof record.baseUrl === "string"
      ? normalizeCustomDownloadSourceUrl(record.baseUrl)
      : null;
  if (!isCustomDownloadSourceId(id) || name === null || baseUrl === null) {
    return null;
  }
  return { id, name, baseUrl };
}

/**
 * Parses the versioned collection and migrates the former singleton only when
 * no new payload exists. An explicit empty collection must remain empty.
 */
export function parseStoredCustomSources(
  serialized: string | null,
  legacyUrl: string | null
): CustomDownloadSourceConfig[] {
  if (serialized !== null) {
    try {
      const payload = JSON.parse(serialized) as {
        version?: unknown;
        sources?: unknown;
      };
      if (payload.version !== 1 || !Array.isArray(payload.sources)) {
        return [];
      }
      const seen = new Set<CustomDownloadSourceId>();
      const sources: CustomDownloadSourceConfig[] = [];
      for (const value of payload.sources) {
        const source = normalizedCustomSourceRecord(value);
        if (source && !seen.has(source.id)) {
          seen.add(source.id);
          sources.push(source);
        }
      }
      return sources;
    } catch {
      return [];
    }
  }

  const baseUrl = normalizeCustomDownloadSourceUrl(legacyUrl ?? "");
  return baseUrl === null
    ? []
    : [
        {
          id: CUSTOM_DOWNLOAD_SOURCE_ID,
          name: "Custom",
          baseUrl,
        },
      ];
}

function loadCustomSources(): CustomDownloadSourceConfig[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    return parseStoredCustomSources(
      localStorage.getItem(CUSTOM_SOURCES_KEY),
      localStorage.getItem(CUSTOM_SOURCE_URL_KEY)
    );
  } catch {
    return [];
  }
}

function configuredDownloadSource(
  sourceId: string | null | undefined,
  customSources: readonly CustomDownloadSourceConfig[],
  fallbackBaseUrl?: string,
  fallbackName?: string
) {
  const normalizedId =
    sourceId === "custom" ? CUSTOM_DOWNLOAD_SOURCE_ID : sourceId;
  const configured = customSources.find((source) => source.id === normalizedId);
  return getSelectableDownloadSource(
    normalizedId,
    configured?.baseUrl ?? fallbackBaseUrl,
    configured?.name ?? fallbackName
  );
}

function loadSourcePreference(
  customSources: readonly CustomDownloadSourceConfig[]
): DownloadSourceId {
  if (typeof localStorage === "undefined") {
    return DEFAULT_DOWNLOAD_SOURCE_ID;
  }
  try {
    return configuredDownloadSource(
      localStorage.getItem(SOURCE_PREFERENCE_KEY),
      customSources
    ).id;
  } catch {
    return DEFAULT_DOWNLOAD_SOURCE_ID;
  }
}

function isArchiveFormat(value: string | null | undefined): value is ArchiveFormat {
  return ARCHIVE_FORMATS.some((format) => format === value);
}

function savePreferredFormat(format: ArchiveFormat): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(FORMAT_PREFERENCE_KEY, format);
  } catch {
    // A blocked/private localStorage should not prevent downloads.
  }
}

function loadPreferredFormat(): ArchiveFormat {
  if (typeof localStorage === "undefined") {
    return "adx";
  }
  try {
    const stored = localStorage.getItem(FORMAT_PREFERENCE_KEY);
    return isArchiveFormat(stored) ? stored : "adx";
  } catch {
    return "adx";
  }
}

function isBatchGrouping(value: string | null | undefined): value is BatchGrouping {
  return BATCH_GROUPINGS.some((grouping) => grouping === value);
}

function savePreferredBatchGrouping(grouping: BatchGrouping): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(BATCH_GROUPING_PREFERENCE_KEY, grouping);
  } catch {
    // A blocked/private localStorage should not prevent downloads.
  }
}

function loadPreferredBatchGrouping(): BatchGrouping {
  if (typeof localStorage === "undefined") {
    return "version";
  }
  try {
    const stored = localStorage.getItem(BATCH_GROUPING_PREFERENCE_KEY);
    return isBatchGrouping(stored) ? stored : "version";
  } catch {
    return "version";
  }
}

function createCustomSourceId(): CustomDownloadSourceId {
  const randomUuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${(++customSourceIdSequence).toString(36)}`;
  return `custom:${randomUuid}`;
}

/** Fraction 0–100, preferring byte-level totals and falling back to file counts. */
export function jobPercent(job: DownloadJob): number {
  if (job.totalBytes > 0) {
    return Math.min(100, Math.round((job.receivedBytes / job.totalBytes) * 100));
  }
  if (job.total > 0) {
    return Math.min(100, Math.round((job.completed / job.total) * 100));
  }
  return 0;
}

/** Roll-up of the jobs one batch surface started, for a single inline summary. */
export type DownloadJobsSummary = {
  /** `idle` = nothing started yet; a running job outranks a failed/paused one. */
  status: DownloadJob["status"] | "idle";
  percent: number;
  /** Jobs already finished successfully. */
  done: number;
  total: number;
};

export function summarizeDownloadJobs(
  jobs: readonly DownloadJob[]
): DownloadJobsSummary {
  if (jobs.length === 0) {
    return { status: "idle", percent: 0, done: 0, total: 0 };
  }
  const running = jobs.filter(
    (job) =>
      job.status === "queued" ||
      job.status === "packing" ||
      job.status === "archiving"
  );
  let status: DownloadJobsSummary["status"];
  if (running.length > 0) {
    // Anything still moving means the selection as a whole is still in flight,
    // even when a sibling has already failed.
    status = running.every((job) => job.status === "queued")
      ? "queued"
      : running.every((job) => job.status === "archiving")
        ? "archiving"
        : "packing";
  } else if (jobs.some((job) => job.status === "error")) {
    status = "error";
  } else if (jobs.some((job) => job.status === "paused")) {
    status = "paused";
  } else {
    status = "success";
  }

  // Weight by file count so a 200-chart version doesn't count the same as a
  // 3-chart one. The count is known upfront and stays stable for the run.
  let weighted = 0;
  let weight = 0;
  for (const job of jobs) {
    const jobWeight = Math.max(1, job.total);
    const jobProgress =
      job.status === "success" ? 100 : job.status === "queued" ? 0 : jobPercent(job);
    weighted += jobProgress * jobWeight;
    weight += jobWeight;
  }

  return {
    status,
    percent: weight > 0 ? Math.round(weighted / weight) : 0,
    done: jobs.filter((job) => job.status === "success").length,
    total: jobs.length,
  };
}

/**
 * The HTTP status the engine stamped into a failure message, if any. The engine
 * and the store are separate modules with their own error classes; matching on
 * the message keeps the two decoupled and survives an error that crossed a
 * structured-clone boundary.
 */
export function downloadFailureStatus(message: string): number | null {
  const match = /\(HTTP (\d{3})\)/.exec(message);
  return match ? Number(match[1]) : null;
}

/** The failed URL, for the expandable detail block. */
export function downloadFailureUrl(message: string): string | null {
  const match = /File download failed: (\S+)/.exec(message);
  return match ? match[1] : null;
}

/** Coarse failure classification for a friendly, localized error message. */
export function classifyDownloadError(error: unknown): DownloadJob["errorKind"] {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "offline";
  }
  const message = error instanceof Error ? error.message : "";
  const status = downloadFailureStatus(message);
  if (status !== null) {
    // 408/425/429 exhausted their retries; that is congestion, not a missing
    // file, so it stays in the "try again" bucket rather than the 4xx one.
    if (status >= 500) {
      return "server";
    }
    if (status >= 400 && status !== 408 && status !== 425 && status !== 429) {
      return "missing";
    }
    return "network";
  }
  if (message.includes("download failed") || error instanceof TypeError) {
    return "network";
  }
  return "unknown";
}

/** A route change can only help when the current route is the thing failing. */
function isRoutableFailure(errorKind: DownloadJob["errorKind"]): boolean {
  return errorKind === "network" || errorKind === "server" || errorKind === "missing";
}

/**
 * Remaining milliseconds at the smoothed rate. Null whenever the answer would
 * be a guess: no measured total, no converged rate, or a total that the byte
 * extrapolation has already overshot.
 */
export function estimateDownloadEtaMs(
  receivedBytes: number,
  totalBytes: number,
  speedBps: number
): number | null {
  if (totalBytes <= 0 || speedBps < MIN_ETA_SPEED_BPS) {
    return null;
  }
  const remaining = totalBytes - receivedBytes;
  return remaining <= 0 ? null : Math.round((remaining / speedBps) * 1000);
}

export const useDownloadsStore = create<DownloadsState>((set, get) => {
  const patchJob = (id: string, patch: Partial<DownloadJob>): void => {
    set((state) => ({
      jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
    }));
  };

  const upsertJob = (job: DownloadJob): void => {
    set((state) => {
      const exists = state.jobs.some((existing) => existing.id === job.id);
      return {
        jobs: exists
          ? state.jobs.map((existing) => (existing.id === job.id ? job : existing))
          : [...state.jobs, job],
      };
    });
  };

  const scheduleAutoDismiss = (id: string, startedAt: number): void => {
    setTimeout(() => {
      const job = get().jobs.find((entry) => entry.id === id);
      if (job && job.status === "success" && job.startedAt === startedAt) {
        get().dismiss(id);
      }
    }, AUTO_DISMISS_MS);
  };

  /** Runs (or resumes) a job whose durable spec already lives in `jobSpecs`. */
  const runJob = async (id: string): Promise<void> => {
    const spec = jobSpecs.get(id);
    const startedAt = get().jobs.find((job) => job.id === id)?.startedAt ?? Date.now();
    if (!spec) {
      return;
    }

    // Register the run before the first await. Otherwise a synchronous pause can
    // miss the controller while IndexedDB is loading and the stale run will
    // later race a source-switch restart.
    const controller = new AbortController();
    abortControllers.get(id)?.abort();
    abortControllers.set(id, controller);
    speedSamples.delete(id);
    const isCurrentRun = (): boolean =>
      abortControllers.get(id) === controller && !controller.signal.aborted;
    const patchCurrentJob = (patch: Partial<DownloadJob>): void => {
      if (isCurrentRun()) {
        patchJob(id, patch);
      }
    };
    patchJob(id, {
      // Surface the wait as its own state instead of a job that looks started
      // but never moves.
      status: activeJobIds.size < MAX_ACTIVE_JOBS ? "packing" : "queued",
      error: null,
      errorKind: null,
      errorDetail: null,
      speedBps: 0,
      etaMs: null,
      archiveCurrentFile: null,
    });
    const triedSources = jobTriedSources.get(id) ?? new Set<DownloadSourceId>();
    triedSources.add(
      inferDownloadSourceId(spec.files, spec.sourceId, spec.sourceBaseUrl)
    );
    jobTriedSources.set(id, triedSources);

    let holdsSlot = false;
    try {
      await acquireJobSlot(id, controller.signal);
      holdsSlot = true;
      if (!isCurrentRun()) {
        return;
      }
      patchCurrentJob({ status: "packing" });
      const persisted = await loadFilesForJob(id);
      if (!isCurrentRun()) {
        return;
      }
      const byName = new Map<string, PersistedFile>(
        persisted.map((file) => [file.name, file])
      );
      const inputs: DownloadFileInput[] = spec.files.map((file) => {
        const prior = reusablePersistedFile(
          file,
          byName.get(file.name),
          spec.sourceBaseUrl
        );
        return {
          name: file.name,
          url: file.url,
          completedBlob: prior?.blob ?? null,
          optional: isOptionalChartAssetFile(file.name),
        };
      });

      const completeByName = new Map(
        inputs
          .filter(
            (file): file is DownloadFileInput & { completedBlob: Blob } =>
              file.completedBlob !== null
          )
          .map((file) => [file.name, file.completedBlob])
      );
      patchCurrentJob({
        completed: completeByName.size,
        receivedBytes: 0,
        totalBytes: 0,
        totalBytesEstimated: false,
        etaMs: null,
        skippedFiles: [],
        fileProgress:
          spec.kind === "single"
            ? spec.files.map((file) => {
                const blob = completeByName.get(file.name);
                return blob
                  ? {
                      name: file.name,
                      received: blob.size,
                      total: blob.size,
                      status: "done" as const,
                    }
                  : {
                      name: file.name,
                      received: 0,
                      total: null,
                      status: "pending" as const,
                    };
              })
            : [],
      });

      const archiveInputs = await runMultiFileDownload(inputs, {
        concurrency: spec.kind === "batch" ? 6 : 4,
        signal: controller.signal,
        ...(engineRetryBaseDelayMs !== undefined
          ? { retryBaseDelayMs: engineRetryBaseDelayMs }
          : {}),
        onFileComplete: async (file, completed, total) => {
          // The engine calls this only after receiving the entire file. Awaiting
          // the write ensures archive cleanup cannot race a late checkpoint.
          if (!isCurrentRun()) {
            return;
          }
          await persistFile({
            key: fileKey(id, file.name),
            jobId: id,
            name: file.name,
            url: file.url,
            ...(spec.sourceBaseUrl ? { sourceBaseUrl: spec.sourceBaseUrl } : {}),
            complete: true,
            size: file.blob.size,
            blob: file.blob,
          });
          if (!isCurrentRun()) {
            return;
          }
          const current = get().jobs.find((job) => job.id === id);
          patchCurrentJob({
            completed,
            total,
            fileProgress:
              current?.kind === "single"
                ? current.fileProgress.map((progress) =>
                    progress.name === file.name
                      ? {
                          name: progress.name,
                          received: file.blob.size,
                          total: file.blob.size,
                          status: "done" as const,
                        }
                      : progress
                  )
                : [],
          });
        },
        onFileSkipped: (skipped) => {
          if (!isCurrentRun()) {
            return;
          }
          const current = get().jobs.find((job) => job.id === id);
          patchCurrentJob({
            skippedFiles: [...(current?.skippedFiles ?? []), skipped],
          });
        },
        onBytes: (receivedBytes, totalBytes, totalBytesEstimated) => {
          if (!isCurrentRun()) {
            return;
          }
          const now = Date.now();
          const sample = speedSamples.get(id);
          if (!sample) {
            speedSamples.set(id, { time: now, bytes: receivedBytes, ema: 0 });
            patchCurrentJob({ receivedBytes, totalBytes, totalBytesEstimated });
            return;
          }
          const elapsed = now - sample.time;
          if (elapsed >= SPEED_SAMPLE_MS) {
            const instant = ((receivedBytes - sample.bytes) / elapsed) * 1000;
            const ema = sample.ema === 0 ? instant : sample.ema * 0.7 + instant * 0.3;
            speedSamples.set(id, { time: now, bytes: receivedBytes, ema });
            const speedBps = Math.max(0, ema);
            patchCurrentJob({
              receivedBytes,
              totalBytes,
              totalBytesEstimated,
              speedBps,
              // Recomputed only on a rate sample: an ETA that re-derives on
              // every chunk jitters by whole seconds and is unreadable.
              etaMs: estimateDownloadEtaMs(receivedBytes, totalBytes, speedBps),
            });
            return;
          }
          patchCurrentJob({ receivedBytes, totalBytes, totalBytesEstimated });
        },
        onFileProgress:
          spec.kind === "single"
            ? (fileProgress) => patchCurrentJob({ fileProgress })
            : undefined,
      });
      if (!isCurrentRun()) {
        return;
      }

      // Normalize `&title` kind markers into spaced suffixes (" [SD]", utage
      // "[即]…" → "… [即]") so same-named charts stay tellable apart in
      // AstroDX's level list. Pack-time only: the checkpoints persisted above
      // and the served files keep the original.
      const packedInputs = await tagMaidataInputs(archiveInputs);
      if (!isCurrentRun()) {
        return;
      }

      // All bytes are on hand; building the archive can take a while for big
      // batches, so surface it as its own phase instead of a full, frozen bar.
      const archiveTotalBytes = packedInputs.reduce((sum, input) => sum + input.blob.size, 0);
      patchCurrentJob({
        status: "archiving",
        completed: 0,
        total: archiveInputs.length,
        receivedBytes: 0,
        totalBytes: archiveTotalBytes,
        totalBytesEstimated: false,
        speedBps: 0,
        etaMs: null,
        archiveCurrentFile: null,
      });

      let lastArchiveProgressAt = 0;
      const onArchiveProgress = (progress: ArchiveProgress): void => {
        if (!isCurrentRun()) {
          return;
        }
        const now = Date.now();
        const isFinal =
          progress.completedFiles >= progress.totalFiles &&
          progress.writtenBytes >= progress.totalBytes;
        if (!isFinal && now - lastArchiveProgressAt < ARCHIVE_PROGRESS_SAMPLE_MS) {
          return;
        }
        lastArchiveProgressAt = now;
        patchCurrentJob({
          completed: progress.completedFiles,
          total: progress.totalFiles,
          receivedBytes: progress.writtenBytes,
          totalBytes: progress.totalBytes,
          archiveCurrentFile: progress.currentFile,
          speedBps: 0,
        });
      };

      const format = spec.format as ArchiveFormat;
      // fflate (~18.5 KB gzip) is only needed once bytes are actually being
      // packed. Loading it here instead of at module scope keeps it out of the
      // shared chunk that every page pays for just to render a download button.
      const { buildArchiveBlob, buildNestedArchiveBlob } = await import("@/lib/adx-archive");
      if (!isCurrentRun()) {
        return;
      }
      if (spec.kind === "batch") {
        // A cross-version selection saves one archive per version instead of
        // merging every version folder into a single giant archive. Archives
        // build sequentially with cumulative progress across the whole set.
        const charts = regroupBatch(packedInputs, spec.dirByIndex ?? [], spec.groupByIndex ?? []);
        const groups = splitBatchArchives(charts, spec.title);
        let fileOffset = 0;
        let byteOffset = 0;
        for (const [groupIndex, group] of groups.entries()) {
          const groupFiles = group.charts.reduce((sum, chart) => sum + chart.files.length, 0);
          const groupBytes = group.charts.reduce(
            (sum, chart) => sum + chart.files.reduce((inner, file) => inner + file.blob.size, 0),
            0
          );
          const blob = await buildNestedArchiveBlob(
            group.charts,
            format as BatchArchiveFormat,
            undefined,
            (progress) =>
              onArchiveProgress({
                completedFiles: fileOffset + progress.completedFiles,
                totalFiles: packedInputs.length,
                writtenBytes: byteOffset + progress.writtenBytes,
                totalBytes: archiveTotalBytes,
                currentFile: progress.currentFile,
              })
          );
          if (!isCurrentRun()) {
            return;
          }
          saveBlobAsFile(blob, getArchiveDownloadFileName(group.name, format));
          fileOffset += groupFiles;
          byteOffset += groupBytes;
          // Space out the save clicks so browsers don't drop back-to-back
          // programmatic downloads (small versions can archive in a few ms).
          if (groupIndex < groups.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, MULTI_SAVE_SPACING_MS));
            if (!isCurrentRun()) {
              return;
            }
          }
        }
      } else {
        const archiveBlob = spec.groupDir
          ? await buildNestedArchiveBlob(
              [{ name: spec.title, groupDir: spec.groupDir, files: packedInputs }],
              format,
              undefined,
              onArchiveProgress
            )
          : await buildArchiveBlob(packedInputs, format, spec.title, onArchiveProgress);
        if (!isCurrentRun()) {
          return;
        }
        saveBlobAsFile(archiveBlob, getArchiveDownloadFileName(spec.title, format));
      }

      if (!isCurrentRun()) {
        return;
      }
      jobSpecs.delete(id);
      // Keep successful cleanup inside the same-id lifecycle barrier. A new
      // start must not persist its spec while this generation is still being
      // deleted.
      await deleteJob(id);
      if (!isCurrentRun()) {
        return;
      }
      patchJob(id, { status: "success", etaMs: null });
      // The job's own record is gone by design (its checkpoints were the only
      // reason to keep it). The history entry is a separate, blob-free copy so
      // "download that version again" survives the cleanup.
      await rememberCompletedJob(spec);
      jobTriedSources.delete(id);
      jobAutoSwitchCounts.delete(id);
      scheduleAutoDismiss(id, startedAt);
    } catch (error) {
      // An abort comes from pause() (which already kept whole-file checkpoints),
      // dismiss(), or a newer run for this same id.
      if (!isCurrentRun()) {
        return;
      }
      const current = get().jobs.find((job) => job.id === id);
      const message = error instanceof Error ? error.message : "Unknown error";
      const errorKind = classifyDownloadError(error);
      const status = downloadFailureStatus(message);
      const failedUrl = downloadFailureUrl(message);
      patchJob(id, {
        ...(current ? completedCheckpointProgress(current) : {}),
        status: "error",
        error: message,
        errorKind,
        errorDetail: failedUrl
          ? status === null
            ? failedUrl
            : `HTTP ${status} · ${failedUrl}`
          : message,
        speedBps: 0,
        etaMs: null,
        archiveCurrentFile: null,
      });
      // Only after the failure is fully visible: if a healthy mirror exists the
      // job hops onto it by itself, and the user sees the switch rather than a
      // dead end behind a wordless ⇄ icon.
      maybeFailOverToAnotherSource(id, errorKind);
    } finally {
      // Hand the slot to the next queued job before anything else can await.
      if (holdsSlot) {
        releaseJobSlot(id);
      }
      // A stale run must never clear the controller or speed samples belonging
      // to the replacement run that superseded it.
      if (abortControllers.get(id) === controller) {
        abortControllers.delete(id);
        speedSamples.delete(id);
      }
    }
  };

  /**
   * Files are keyed to whichever mirror they were fetched from, so the history
   * entry stores the spec canonicalized back to the catalog origin: re-running
   * it months later must honour the route selected *then*, not the dead mirror
   * the original run happened to use.
   */
  const rememberCompletedJob = async (spec: PersistedJob): Promise<void> => {
    const entry: DownloadHistoryEntry = {
      key: `${spec.id}@${Date.now().toString(36)}`,
      job: {
        ...spec,
        files: spec.files.map((file) => ({
          name: file.name,
          url: canonicalDownloadResourceUrl(file.url, [spec.sourceBaseUrl ?? ""]),
        })),
      },
      finishedAt: Date.now(),
      fileCount: spec.files.length,
    };
    await recordHistory(entry);
    set((state) => ({
      history: [entry, ...state.history.filter((old) => old.key !== entry.key)].slice(
        0,
        MAX_DOWNLOAD_HISTORY
      ),
    }));
  };

  /**
   * Moves an interrupted job to another mirror, keeping every whole file it
   * already holds. `rememberPreference` is what separates a deliberate user
   * switch (which should become the new default route) from the automatic
   * failover below (which must not touch the user's setting).
   */
  const restartJobWithSource = (
    id: string,
    sourceId: DownloadSourceId,
    rememberPreference: boolean
  ): void => {
    const job = get().jobs.find((entry) => entry.id === id);
    const spec = jobSpecs.get(id);
    if (
      !job ||
      !spec ||
      (job.status !== "paused" && job.status !== "error") ||
      restartingJobs.has(id)
    ) {
      return;
    }

    const nextSource = configuredDownloadSource(sourceId, get().customSources);
    const previousSourceId = inferDownloadSourceId(
      spec.files,
      spec.sourceId,
      spec.sourceBaseUrl
    );
    const restartedSpec: PersistedJob = {
      ...spec,
      sourceId: nextSource.id,
      sourceBaseUrl: nextSource.baseUrl,
      sourceName: nextSource.name,
      createdAt: Date.now(),
      files: rerouteDownloadFiles(
        spec.files,
        previousSourceId,
        nextSource.id,
        spec.sourceBaseUrl,
        nextSource.baseUrl
      ),
    };

    restartingJobs.add(id);
    if (rememberPreference) {
      set({ selectedSourceId: nextSource.id });
      saveSourcePreference(nextSource.id);
    }
    void (async () => {
      try {
        await enqueueLifecycle(id, async () => {
          const current = get().jobs.find((entry) => entry.id === id);
          if (
            !current ||
            jobSpecs.get(id) !== spec ||
            (current.status !== "paused" && current.status !== "error")
          ) {
            return;
          }
          // Update the routed spec and discard only legacy/incomplete records.
          // Whole files survive because the mirror path identifies the same
          // logical archive input regardless of which host supplied it.
          await replaceJobKeepingCompletedFiles(restartedSpec);
          // dismiss() can queue while the replacement transaction is open.
          // Recheck the generation before exposing/starting the routed spec.
          if (
            get().jobs.some((entry) => entry.id === id) &&
            jobSpecs.get(id) === spec
          ) {
            beginJob(restartedSpec, false);
          }
        });
      } catch (error) {
        const current = get().jobs.find((entry) => entry.id === id);
        if (current && jobSpecs.get(id) === spec) {
          patchJob(id, {
            status: "error",
            error: error instanceof Error ? error.message : "Unknown error",
            errorKind: classifyDownloadError(error),
          });
        }
      } finally {
        restartingJobs.delete(id);
      }
    })();
  };

  const maybeFailOverToAnotherSource = (
    id: string,
    errorKind: DownloadJob["errorKind"]
  ): void => {
    if (!isRoutableFailure(errorKind)) {
      return;
    }
    const switches = jobAutoSwitchCounts.get(id) ?? 0;
    if (switches >= MAX_AUTO_SOURCE_SWITCHES) {
      return;
    }
    const next = pickFailoverDownloadSource(
      get().sourceProbes,
      [...(jobTriedSources.get(id) ?? [])],
      get().customSources
    );
    if (next === null) {
      return;
    }
    jobAutoSwitchCounts.set(id, switches + 1);
    patchJob(id, { autoSwitchedTo: next });
    // `false` for the preference: an automatic recovery must not silently
    // rewrite the default route the user picked in settings.
    restartJobWithSource(id, next, false);
  };

  /** Serialize all persistence/run transitions that target the same stable id. */
  const enqueueLifecycle = (
    id: string,
    task: () => void | Promise<void>
  ): Promise<void> => {
    const previous = activeRunPromises.get(id);
    const queued = (async () => {
      try {
        await previous;
      } catch {
        // A lifecycle operation must not strand later cleanup/restarts merely
        // because the prior persistence adapter rejected.
      }
      await task();
    })();
    activeRunPromises.set(id, queued);
    const clear = (): void => {
      if (activeRunPromises.get(id) === queued) {
        activeRunPromises.delete(id);
      }
    };
    void queued.then(clear, clear);
    return queued;
  };

  /** Queue a run, including its spec write, behind the prior id generation. */
  const startRun = (
    id: string,
    startedAt: number,
    expectedSpec: PersistedJob,
    persistSpec: boolean
  ): Promise<void> => {
    return enqueueLifecycle(id, async () => {
      const isRequestedRun = (): boolean => {
        const job = get().jobs.find((entry) => entry.id === id);
        return Boolean(
          job &&
            job.status === "packing" &&
            job.startedAt === startedAt &&
            jobSpecs.get(id) === expectedSpec
        );
      };
      if (!isRequestedRun()) {
        return;
      }
      if (persistSpec) {
        try {
          await persistJob(expectedSpec);
        } catch {
          // IndexedDB recovery is best-effort; an unavailable database should
          // not prevent the current browser session from downloading.
        }
      }
      if (isRequestedRun()) {
        await runJob(id);
      }
    });
  };

  const beginJob = (spec: PersistedJob, persistSpec = true): void => {
    const existing = get().jobs.find((job) => job.id === spec.id)?.status;
    if (existing === "queued" || existing === "packing" || existing === "archiving") {
      return;
    }
    const inferredSourceId = inferDownloadSourceId(
      spec.files,
      spec.sourceId,
      spec.sourceBaseUrl
    );
    const source = getSelectableDownloadSource(
      inferredSourceId,
      spec.sourceBaseUrl,
      spec.sourceName
    );
    const sourceId = source.id;
    const sourcedSpec: PersistedJob = {
      ...spec,
      sourceId,
      sourceBaseUrl: source.baseUrl,
      sourceName: source.name,
    };
    jobSpecs.set(sourcedSpec.id, sourcedSpec);
    const startedAt = Date.now();
    upsertJob({
      id: sourcedSpec.id,
      kind: sourcedSpec.kind,
      title: sourcedSpec.title,
      sourceId,
      sourceBaseUrl: source.baseUrl,
      sourceName: source.name,
      format: sourcedSpec.format as ArchiveFormat,
      status: "packing",
      completed: 0,
      total: sourcedSpec.files.length,
      receivedBytes: 0,
      totalBytes: 0,
      totalBytesEstimated: false,
      speedBps: 0,
      etaMs: null,
      fileProgress:
        sourcedSpec.kind === "single"
          ? sourcedSpec.files.map((file) => ({
              name: file.name,
              received: 0,
              total: null,
              status: "pending",
            }))
          : [],
      archiveCurrentFile: null,
      error: null,
      errorKind: null,
      errorDetail: null,
      skippedFiles: [],
      // Preserved across a reroute so the "已自动切换到 X" note survives the
      // restart that the switch itself performs.
      autoSwitchedTo: get().jobs.find((job) => job.id === spec.id)?.autoSwitchedTo ?? null,
      startedAt,
    });
    void startRun(sourcedSpec.id, startedAt, sourcedSpec, persistSpec);
  };

  return {
    jobs: [],
    selectedSourceId: DEFAULT_DOWNLOAD_SOURCE_ID,
    customSources: [],
    preferredFormat: "adx",
    preferredBatchGrouping: "version",
    sourceProbes: createInitialDownloadSourceProbes(),
    presented: {},
    bottomBars: 0,
    history: [],
    checkpointsUnavailable: false,

    startSingle: ({
      id,
      title,
      files,
      groupDir,
      includeVideo,
      format,
      sourceId,
    }) => {
      const selectedSource = configuredDownloadSource(
        sourceId ?? get().selectedSourceId,
        get().customSources
      );
      const routedFiles = routeDownloadFiles(
        files,
        selectedSource.id,
        selectedSource.baseUrl
      );
      const selected = includeVideo
        ? routedFiles
        : routedFiles.filter((file) => !isChartVideoFile(file.name));
      if (selected.length === 0) {
        return;
      }
      beginJob({
        id,
        kind: "single",
        title,
        format: format ?? get().preferredFormat,
        createdAt: Date.now(),
        sourceId: selectedSource.id,
        sourceBaseUrl: selectedSource.baseUrl,
        ...(selectedSource.name ? { sourceName: selectedSource.name } : {}),
        files: selected.map((file) => ({ name: file.name, url: file.url })),
        ...(groupDir ? { groupDir } : {}),
      });
    },

    startBatch: ({
      id,
      title,
      charts,
      includeVideo,
      format,
      sourceId,
      grouping,
    }) => {
      const selectedSource = configuredDownloadSource(
        sourceId ?? get().selectedSourceId,
        get().customSources
      );
      const batchGrouping = grouping ?? get().preferredBatchGrouping;

      // A selection spanning several versions/genres becomes one queued job per
      // group rather than a single job that only saves anything at the very end.
      // Each job then pauses, resumes, retries and reroutes on its own, and its
      // archive lands as soon as that group finishes.
      const groups = new Map<string, ChartDownloadSpec[]>();
      for (const chart of routeChartDownloadSpecs(
        charts,
        selectedSource.id,
        selectedSource.baseUrl
      )) {
        const groupDir = chartGroupingDir(chart, batchGrouping);
        const bucket = groups.get(groupDir);
        if (bucket) {
          bucket.push(chart);
        } else {
          groups.set(groupDir, [chart]);
        }
      }

      const startedIds: string[] = [];
      for (const [groupDir, groupCharts] of groups) {
        // Download flat (one fetch per file), tagging each by chart index so
        // results can be regrouped — an opaque numeric prefix avoids clashing
        // with chart names that contain "/".
        const dirByIndex: string[] = [];
        const groupByIndex: string[] = [];
        const files: { name: string; url: string }[] = [];
        groupCharts.forEach((chart, index) => {
          dirByIndex[index] = chart.dir;
          groupByIndex[index] = groupDir;
          for (const file of chart.files) {
            if (includeVideo || !isChartVideoFile(file.name)) {
              files.push({ name: `${index}/${file.name}`, url: file.url });
            }
          }
        });
        if (files.length === 0) {
          continue;
        }
        // A single-group selection keeps the caller's id and collection name, so
        // its archive is named exactly as before this split existed.
        const single = groups.size === 1;
        const jobId = single ? id : `${id}#${startedIds.length}`;
        beginJob({
          id: jobId,
          kind: "batch",
          title: single ? title : groupDir || title,
          format: format ?? get().preferredFormat,
          createdAt: Date.now(),
          sourceId: selectedSource.id,
          sourceBaseUrl: selectedSource.baseUrl,
          ...(selectedSource.name ? { sourceName: selectedSource.name } : {}),
          files,
          dirByIndex,
          ...(groupDir ? { groupByIndex } : {}),
        });
        startedIds.push(jobId);
      }
      return startedIds;
    },

    setSelectedSourceId: (sourceId) => {
      const selectedSourceId = configuredDownloadSource(
        sourceId,
        get().customSources
      ).id;
      set({ selectedSourceId });
      saveSourcePreference(selectedSourceId);
    },

    setPreferredFormat: (format) => {
      if (!isArchiveFormat(format)) {
        return;
      }
      set({ preferredFormat: format });
      savePreferredFormat(format);
    },

    setPreferredBatchGrouping: (grouping) => {
      if (!isBatchGrouping(grouping)) {
        return;
      }
      set({ preferredBatchGrouping: grouping });
      savePreferredBatchGrouping(grouping);
    },

    addCustomSource: (name, url) => {
      const normalizedName = normalizeCustomDownloadSourceName(name);
      const baseUrl = normalizeCustomDownloadSourceUrl(url);
      if (normalizedName === null || baseUrl === null) {
        return null;
      }
      const id = createCustomSourceId();
      const source: CustomDownloadSourceConfig = {
        id,
        name: normalizedName,
        baseUrl,
      };
      set((state) => ({
        customSources: [...state.customSources, source],
        sourceProbes: {
          ...state.sourceProbes,
          [id]: { state: "testing", latencyMs: null, measuredAt: null },
        },
      }));
      saveCustomSources(get().customSources);
      const version = (customSourceProbeVersions.get(id) ?? 0) + 1;
      customSourceProbeVersions.set(id, version);
      void probeCustomDownloadSource(baseUrl).then((result) => {
        const current = get().customSources.find((entry) => entry.id === id);
        if (
          customSourceProbeVersions.get(id) !== version ||
          current?.baseUrl !== baseUrl
        ) {
          return;
        }
        set((state) => ({
          sourceProbes: {
            ...state.sourceProbes,
            [id]: { ...result, measuredAt: Date.now() },
          },
        }));
      });
      return id;
    },

    updateCustomSource: (id, name, url) => {
      if (!isCustomDownloadSourceId(id)) {
        return false;
      }
      const normalizedName = normalizeCustomDownloadSourceName(name);
      const baseUrl = normalizeCustomDownloadSourceUrl(url);
      const current = get().customSources.find((source) => source.id === id);
      if (!current || normalizedName === null || baseUrl === null) {
        return false;
      }
      const urlChanged = current.baseUrl !== baseUrl;
      set((state) => ({
        customSources: state.customSources.map((source) =>
          source.id === id
            ? { ...source, name: normalizedName, baseUrl }
            : source
        ),
        sourceProbes: urlChanged
          ? {
              ...state.sourceProbes,
              [id]: { state: "testing", latencyMs: null, measuredAt: null },
            }
          : state.sourceProbes,
      }));
      saveCustomSources(get().customSources);
      if (urlChanged) {
        const version = (customSourceProbeVersions.get(id) ?? 0) + 1;
        customSourceProbeVersions.set(id, version);
        void probeCustomDownloadSource(baseUrl).then((result) => {
          const latest = get().customSources.find((source) => source.id === id);
          if (
            customSourceProbeVersions.get(id) !== version ||
            latest?.baseUrl !== baseUrl
          ) {
            return;
          }
          set((state) => ({
            sourceProbes: {
              ...state.sourceProbes,
              [id]: { ...result, measuredAt: Date.now() },
            },
          }));
        });
      }
      return true;
    },

    removeCustomSource: (id) => {
      if (
        !isCustomDownloadSourceId(id) ||
        !get().customSources.some((source) => source.id === id)
      ) {
        return false;
      }
      customSourceProbeVersions.set(
        id,
        (customSourceProbeVersions.get(id) ?? 0) + 1
      );
      set((state) => {
        const sourceProbes = { ...state.sourceProbes };
        delete sourceProbes[id];
        return {
          customSources: state.customSources.filter(
            (source) => source.id !== id
          ),
          selectedSourceId:
            state.selectedSourceId === id
              ? DEFAULT_DOWNLOAD_SOURCE_ID
              : state.selectedSourceId,
          sourceProbes,
        };
      });
      saveCustomSources(get().customSources);
      if (get().selectedSourceId === DEFAULT_DOWNLOAD_SOURCE_ID) {
        saveSourcePreference(DEFAULT_DOWNLOAD_SOURCE_ID);
      }
      return true;
    },

    refreshSourceProbes: async (force = false) => {
      if (sourceProbePromise) {
        return sourceProbePromise;
      }
      const customSources = get().customSources;
      if (
        !force &&
        sourceProbesAreFresh(
          get().sourceProbes,
          customSources,
          Date.now()
        )
      ) {
        return;
      }

      set((state) => {
        const sourceProbes = { ...state.sourceProbes };
        for (const source of DOWNLOAD_SOURCES) {
          sourceProbes[source.id] = {
            ...(sourceProbes[source.id] ?? {
              latencyMs: null,
              measuredAt: null,
            }),
            state: "testing",
          };
        }
        for (const source of customSources) {
          sourceProbes[source.id] = {
            ...(sourceProbes[source.id] ?? {
              latencyMs: null,
              measuredAt: null,
            }),
            state: "testing",
          };
        }
        return { sourceProbes };
      });

      const run = (async () => {
        const [builtInResults, customResults] = await Promise.all([
          Promise.all(
            DOWNLOAD_SOURCES.map(async (source) => ({
              sourceId: source.id,
              result: await probeDownloadSource(source.id),
            }))
          ),
          Promise.all(
            customSources.map(async (source) => ({
              sourceId: source.id,
              baseUrl: source.baseUrl,
              result: await probeCustomDownloadSource(source.baseUrl),
            }))
          ),
        ]);
        const measuredAt = Date.now();
        set((state) => {
          const sourceProbes = createInitialDownloadSourceProbes(
            state.customSources
          );
          for (const { sourceId, result } of builtInResults) {
            sourceProbes[sourceId] = { ...result, measuredAt };
          }
          for (const source of state.customSources) {
            const measured = customResults.find(
              (result) =>
                result.sourceId === source.id &&
                result.baseUrl === source.baseUrl
            );
            sourceProbes[source.id] = measured
              ? { ...measured.result, measuredAt }
              : state.sourceProbes[source.id] ?? {
                  state: "idle",
                  latencyMs: null,
                  measuredAt: null,
                };
          }
          return { sourceProbes };
        });
      })();
      sourceProbePromise = run;
      try {
        await run;
      } finally {
        if (sourceProbePromise === run) {
          sourceProbePromise = null;
        }
      }
    },

    restartWithSource: (id, sourceId) => restartJobWithSource(id, sourceId, true),

    resume: (id) => {
      const job = get().jobs.find((entry) => entry.id === id);
      if (
        !job ||
        restartingJobs.has(id) ||
        (job.status !== "paused" && job.status !== "error")
      ) {
        return;
      }
      const spec = jobSpecs.get(id);
      if (!spec) {
        return;
      }
      // Mark the transition immediately so a second resume/source switch cannot
      // queue behind the same paused run. startRun serializes against a file
      // checkpoint that may still be finishing from pause().
      const startedAt = Date.now();
      patchJob(id, {
        status: "packing",
        error: null,
        errorKind: null,
        errorDetail: null,
        speedBps: 0,
        etaMs: null,
        archiveCurrentFile: null,
        startedAt,
      });
      void startRun(id, startedAt, spec, false);
    },

    resumeInterrupted: () => {
      // Only failures a reconnect can plausibly fix. A permanent 404 and a
      // manual pause both stay put: retrying the first is pointless, and
      // overriding the second would be the app disobeying the user.
      const resumable = get().jobs.filter(
        (job) =>
          job.status === "error" &&
          (job.errorKind === "offline" ||
            job.errorKind === "network" ||
            job.errorKind === "server")
      );
      for (const job of resumable) {
        get().resume(job.id);
      }
      return resumable.length;
    },

    pause: (id) => {
      const job = get().jobs.find((entry) => entry.id === id);
      // Pausing a still-queued job takes it out of the queue without ever
      // opening a connection.
      if (!job || (job.status !== "packing" && job.status !== "queued")) {
        return;
      }
      // Abort current requests. Only whole files are durable; reset every
      // unfinished row so the paused UI matches what can actually be resumed.
      abortControllers.get(id)?.abort();
      abortControllers.delete(id);
      speedSamples.delete(id);
      patchJob(id, {
        ...completedCheckpointProgress(job),
        status: "paused",
        speedBps: 0,
      });
    },

    dismiss: (id) => {
      abortControllers.get(id)?.abort();
      abortControllers.delete(id);
      speedSamples.delete(id);
      jobSpecs.delete(id);
      jobTriedSources.delete(id);
      jobAutoSwitchCounts.delete(id);
      set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) }));
      void enqueueLifecycle(id, async () => {
        // A checkpoint callback that began just before dismiss must finish
        // before cleanup, otherwise it could recreate an orphaned file record.
        await deleteJob(id);
      });
    },

    rerunHistoryEntry: (key) => {
      const entry = get().history.find((candidate) => candidate.key === key);
      if (!entry) {
        return;
      }
      const source = configuredDownloadSource(
        get().selectedSourceId,
        get().customSources
      );
      // A brand-new id: the original job id may still be on screen (or have a
      // live spec), and reusing it would adopt that generation's checkpoints.
      const id =
        entry.job.kind === "batch"
          ? newBatchJobId()
          : `${entry.job.id}#again:${Date.now().toString(36)}`;
      beginJob({
        ...entry.job,
        id,
        createdAt: Date.now(),
        sourceId: source.id,
        sourceBaseUrl: source.baseUrl,
        ...(source.name ? { sourceName: source.name } : {}),
        files: routeDownloadFiles(entry.job.files, source.id, source.baseUrl),
      });
    },

    clearDownloadHistory: () => {
      set({ history: [] });
      void clearHistory();
    },

    hydrateFromStorage: () => {
      if (hydrated) {
        return;
      }
      hydrated = true;
      const customSources = loadCustomSources();
      set({
        customSources,
        preferredFormat: loadPreferredFormat(),
        preferredBatchGrouping: loadPreferredBatchGrouping(),
        selectedSourceId: loadSourcePreference(customSources),
        sourceProbes: createInitialDownloadSourceProbes(customSources),
      });
      saveCustomSources(customSources);
      subscribeToCheckpointFailures(() => {
        set({ checkpointsUnavailable: true });
      });
      // Best-effort: without it, checkpoints for a big batch are the first
      // thing a browser evicts under storage pressure, silently turning
      // "resume after a reload" into "start over".
      void requestPersistentStorage();
      void loadHistory().then((history) => {
        set({ history: history.slice(0, MAX_DOWNLOAD_HISTORY) });
      });
      void (async () => {
        const stored = await loadAllJobs();
        for (const storedSpec of stored) {
          if (get().jobs.some((job) => job.id === storedSpec.id)) {
            continue;
          }
          const inferredSourceId = inferDownloadSourceId(
            storedSpec.files,
            storedSpec.sourceId,
            storedSpec.sourceBaseUrl
          );
          const source = getSelectableDownloadSource(
            inferredSourceId,
            storedSpec.sourceBaseUrl,
            storedSpec.sourceName
          );
          const sourceId = source.id;
          // Normalize every configured/legacy mirror URL while hydrating. This
          // lets jobs saved before the Alice migration resume normally without
          // requiring the user to manually switch source first.
          const spec: PersistedJob = {
            ...storedSpec,
            sourceId,
            sourceBaseUrl: source.baseUrl,
            sourceName: source.name,
            files: routeDownloadFiles(
              storedSpec.files,
              sourceId,
              source.baseUrl
            ),
          };
          jobSpecs.set(spec.id, spec);
          const files = await loadFilesForJob(spec.id);
          // A same-id job may have started while IndexedDB was being read. Its
          // live state/spec wins over the older persisted snapshot.
          if (
            get().jobs.some((job) => job.id === spec.id) ||
            jobSpecs.get(spec.id) !== spec
          ) {
            continue;
          }
          const byName = new Map(files.map((file) => [file.name, file]));
          let completed = 0;
          let receivedBytes = 0;
          let totalBytes = 0;
          let totalKnown = true;
          for (const file of spec.files) {
            const prior = reusablePersistedFile(
              file,
              byName.get(file.name),
              spec.sourceBaseUrl
            );
            const received = prior?.blob.size ?? 0;
            receivedBytes += received;
            if (!prior) {
              totalKnown = false;
            } else {
              totalBytes += prior.size;
              completed += 1;
            }
          }
          const fileProgress =
            spec.kind === "single"
              ? spec.files.map((file) => {
                  const prior = reusablePersistedFile(
                    file,
                    byName.get(file.name),
                    spec.sourceBaseUrl
                  );
                  const received = prior?.blob.size ?? 0;
                  const total = prior?.size ?? null;
                  const status: AdxFileProgress["status"] = prior ? "done" : "pending";
                  return {
                    name: file.name,
                    received,
                    total,
                    status,
                  };
                })
              : [];

          upsertJob({
            id: spec.id,
            kind: spec.kind,
            title: spec.title,
            sourceId,
            sourceBaseUrl: source.baseUrl,
            sourceName: source.name,
            format: spec.format as ArchiveFormat,
            status: "paused",
            completed,
            total: spec.files.length,
            receivedBytes,
            totalBytes: totalKnown ? totalBytes : 0,
            totalBytesEstimated: false,
            speedBps: 0,
            etaMs: null,
            fileProgress,
            archiveCurrentFile: null,
            error: null,
            errorKind: null,
            errorDetail: null,
            skippedFiles: [],
            autoSwitchedTo: null,
            startedAt: Date.now(),
          });
        }
      })();
    },

    presentInline: (id) => {
      set((state) => ({
        presented: { ...state.presented, [id]: (state.presented[id] ?? 0) + 1 },
      }));
    },

    unpresentInline: (id) => {
      set((state) => {
        const next = (state.presented[id] ?? 0) - 1;
        const presented = { ...state.presented };
        if (next > 0) {
          presented[id] = next;
        } else {
          delete presented[id];
        }
        return { presented };
      });
    },

    presentBottomBar: () => {
      set((state) => ({ bottomBars: state.bottomBars + 1 }));
    },

    unpresentBottomBar: () => {
      set((state) => ({ bottomBars: Math.max(0, state.bottomBars - 1) }));
    },
  };
});

/** Regroups the flat `${index}/name` download results back into per-chart folders. */
function regroupBatch(
  archiveInputs: AdxArchiveInput[],
  dirByIndex: string[],
  groupByIndex: string[]
): { name: string; groupDir?: string; files: AdxArchiveInput[] }[] {
  const grouped = new Map<number, AdxArchiveInput[]>();
  for (const input of archiveInputs) {
    const slash = input.name.indexOf("/");
    const index = Number(input.name.slice(0, slash));
    const baseName = input.name.slice(slash + 1);
    const bucket = grouped.get(index) ?? [];
    bucket.push({ name: baseName, blob: input.blob });
    grouped.set(index, bucket);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, files]) => ({
      name: dirByIndex[index],
      groupDir: groupByIndex[index] || undefined,
      files,
    }));
}

/**
 * Splits a regrouped batch into the archives to save: one per grouping folder
 * (version or genre, whichever layout the job was started with) when the
 * selection spans multiple folders — each named by that folder, e.g.
 * "25 CiRCLE" or "東方Project" — otherwise a single archive named by the
 * collection title. Charts without a grouping folder fall back to the
 * collection title too.
 */
export function splitBatchArchives(
  charts: NestedChart[],
  collectionTitle: string
): { name: string; charts: NestedChart[] }[] {
  const grouped = new Map<string, NestedChart[]>();
  for (const chart of charts) {
    const key = chart.groupDir ?? "";
    const bucket = grouped.get(key) ?? [];
    bucket.push(chart);
    grouped.set(key, bucket);
  }
  if (grouped.size <= 1) {
    return [{ name: collectionTitle, charts }];
  }
  return [...grouped.entries()].map(([groupDir, groupedCharts]) => ({
    name: groupDir || collectionTitle,
    charts: groupedCharts,
  }));
}

/** Stable job id for a single-chart download, keyed by its archive base name. */
export function singleJobId(fileName: string): string {
  return `single:${fileName}`;
}

let batchJobSeq = 0;

/**
 * Unique id for each batch download start. Batch ids are deliberately NOT
 * derived from the collection name: every batch surface shares the same
 * default name, so a name-keyed id made a bar on one page adopt (and hide from
 * the tray) a job started on another page. Each bar instance keeps the id it
 * started; orphaned jobs render in the floating tray instead.
 */
export function newBatchJobId(): string {
  batchJobSeq += 1;
  return `batch:${Date.now().toString(36)}:${batchJobSeq}`;
}
