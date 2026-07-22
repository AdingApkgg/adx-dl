import { create } from "zustand";

import {
  buildArchiveBlob,
  buildNestedArchiveBlob,
  getArchiveDownloadFileName,
  saveBlobAsFile,
  type AdxArchiveInput,
  type ArchiveProgress,
  type ArchiveFormat,
  type BatchArchiveFormat,
  type NestedChart,
} from "@/lib/adx-archive";
import type { AdxRemoteFile } from "@/lib/adx-directory";
import { isChartVideoFile, type ChartDownloadSpec } from "@/lib/catalog-shared";
import {
  DOWNLOAD_SOURCE_PROBE_TTL_MS,
  probeDownloadSource,
  type DownloadSourceProbe,
} from "@/lib/download-source-probe";
import {
  canonicalDownloadResourceUrl,
  DEFAULT_DOWNLOAD_SOURCE_ID,
  DOWNLOAD_SOURCES,
  getSelectableDownloadSource,
  inferDownloadSourceId,
  rerouteDownloadFiles,
  routeChartDownloadSpecs,
  routeDownloadFiles,
  type DownloadSourceId,
} from "@/lib/download-sources";
import {
  runMultiFileDownload,
  type AdxFileProgress,
  type DownloadFileInput,
} from "./download-engine";
import {
  deleteJob,
  fileKey,
  loadAllJobs,
  loadFilesForJob,
  persistFile,
  persistJob,
  replaceJobKeepingCompletedFiles,
  type PersistedFile,
  type PersistedJob,
} from "./persistence";

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
  format: ArchiveFormat;
  /**
   * `packing` = fetching files; `archiving` = all bytes on hand, building the
   * archive blob (can take a while for big batches — distinct so the UI doesn't
   * look frozen at 100%). `paused` = interrupted (reload or manual pause),
   * awaiting manual resume.
   */
  status: "packing" | "archiving" | "success" | "error" | "paused";
  /** Files finished downloading so far / total files to fetch. */
  completed: number;
  total: number;
  /** Aggregate byte progress (0 total when any file's size is unknown). */
  receivedBytes: number;
  totalBytes: number;
  /** Smoothed transfer rate in bytes/second (0 until measured). */
  speedBps: number;
  /** Per-file byte progress; only populated for single-chart downloads. */
  fileProgress: AdxFileProgress[];
  /** Current in-archive file while locally writing the final .adx/.zip/.tar.gz. */
  archiveCurrentFile: string | null;
  error: string | null;
  /** Coarse cause so the UI can show a friendly, localized message. */
  errorKind: "offline" | "network" | "unknown" | null;
  /** Disambiguates a restart from a stale auto-dismiss timer. */
  startedAt: number;
};

type StartSingleParams = {
  id: string;
  title: string;
  files: AdxRemoteFile[];
  groupDir?: string;
  includeVideo: boolean;
  format: ArchiveFormat;
  sourceId?: DownloadSourceId;
};

type StartBatchParams = {
  id: string;
  title: string;
  charts: ChartDownloadSpec[];
  includeVideo: boolean;
  format: BatchArchiveFormat;
  sourceId?: DownloadSourceId;
};

type DownloadsState = {
  jobs: DownloadJob[];
  /** Shared choice so every single and batch download entry stays consistent. */
  selectedSourceId: DownloadSourceId;
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
  startSingle: (params: StartSingleParams) => void;
  startBatch: (params: StartBatchParams) => void;
  setSelectedSourceId: (sourceId: DownloadSourceId) => void;
  refreshSourceProbes: (force?: boolean) => Promise<void>;
  /** Keeps completed files and restarts unfinished files on another route. */
  restartWithSource: (id: string, sourceId: DownloadSourceId) => void;
  resume: (id: string) => void;
  /** Aborts in-flight files but keeps its spec and whole-file checkpoints. */
  pause: (id: string) => void;
  dismiss: (id: string) => void;
  hydrateFromStorage: () => void;
  presentInline: (id: string) => void;
  unpresentInline: (id: string) => void;
  presentBottomBar: () => void;
  unpresentBottomBar: () => void;
};

/** How long a finished (success) job lingers before the tray auto-clears it. */
const AUTO_DISMISS_MS = 30000;

// Module-level (outside the store value) so they survive store updates but stay
// out of React's snapshot: the durable job spec and any in-flight abort handle.
const jobSpecs = new Map<string, PersistedJob>();
const abortControllers = new Map<string, AbortController>();
/** Includes worker shutdown and any durable file callback already in flight. */
const activeRunPromises = new Map<string, Promise<void>>();
const restartingJobs = new Set<string>();
/** Byte samples for the smoothed transfer-rate estimate, keyed by job id. */
const speedSamples = new Map<string, { time: number; bytes: number; ema: number }>();
let hydrated = false;
let sourceProbePromise: Promise<void> | null = null;

/** Minimum sampling window before updating the rate estimate. */
const SPEED_SAMPLE_MS = 500;
const ARCHIVE_PROGRESS_SAMPLE_MS = 100;
/** Gap between consecutive archive saves in a cross-version batch. */
const MULTI_SAVE_SPACING_MS = 250;
const SOURCE_PREFERENCE_KEY = "astrodx-download-source";

export type DownloadSourceProbeMap = Record<DownloadSourceId, DownloadSourceProbe>;

export function createInitialDownloadSourceProbes(): DownloadSourceProbeMap {
  return Object.fromEntries(
    DOWNLOAD_SOURCES.map((source) => [
      source.id,
      { state: "idle", latencyMs: null, measuredAt: null } satisfies DownloadSourceProbe,
    ])
  ) as DownloadSourceProbeMap;
}

function sourceProbesAreFresh(probes: DownloadSourceProbeMap, now: number): boolean {
  return DOWNLOAD_SOURCES.every((source) => {
    const measuredAt = probes[source.id].measuredAt;
    return measuredAt !== null && now - measuredAt < DOWNLOAD_SOURCE_PROBE_TTL_MS;
  });
}

/** Reuse only a whole file representing the same logical resource across mirrors. */
export function reusablePersistedFile(
  file: { url: string },
  prior: PersistedFile | undefined
): PersistedFile | undefined {
  if (!prior || prior.complete !== true || prior.size !== prior.blob.size) {
    return undefined;
  }
  return canonicalDownloadResourceUrl(prior.url) === canonicalDownloadResourceUrl(file.url)
    ? prior
    : undefined;
}

/** Paused/failed UI may show only durable whole files, never discarded prefixes. */
function completedCheckpointProgress(job: DownloadJob): Pick<
  DownloadJob,
  "completed" | "receivedBytes" | "totalBytes" | "fileProgress"
> {
  const fileProgress = job.fileProgress.map((file) =>
    file.status === "done"
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

function loadSourcePreference(): DownloadSourceId {
  if (typeof localStorage === "undefined") {
    return DEFAULT_DOWNLOAD_SOURCE_ID;
  }
  try {
    return getSelectableDownloadSource(localStorage.getItem(SOURCE_PREFERENCE_KEY)).id;
  } catch {
    return DEFAULT_DOWNLOAD_SOURCE_ID;
  }
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

/** Coarse failure classification for a friendly, localized error message. */
function classifyError(error: unknown): DownloadJob["errorKind"] {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "offline";
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("download failed") || error instanceof TypeError) {
    return "network";
  }
  return "unknown";
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
      status: "packing",
      error: null,
      errorKind: null,
      speedBps: 0,
      archiveCurrentFile: null,
    });

    try {
      const persisted = await loadFilesForJob(id);
      if (!isCurrentRun()) {
        return;
      }
      const byName = new Map<string, PersistedFile>(
        persisted.map((file) => [file.name, file])
      );
      const inputs: DownloadFileInput[] = spec.files.map((file) => {
        const prior = reusablePersistedFile(file, byName.get(file.name));
        return {
          name: file.name,
          url: file.url,
          completedBlob: prior?.blob ?? null,
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
        onBytes: (receivedBytes, totalBytes) => {
          if (!isCurrentRun()) {
            return;
          }
          const now = Date.now();
          const sample = speedSamples.get(id);
          if (!sample) {
            speedSamples.set(id, { time: now, bytes: receivedBytes, ema: 0 });
            patchCurrentJob({ receivedBytes, totalBytes });
            return;
          }
          const elapsed = now - sample.time;
          if (elapsed >= SPEED_SAMPLE_MS) {
            const instant = ((receivedBytes - sample.bytes) / elapsed) * 1000;
            const ema = sample.ema === 0 ? instant : sample.ema * 0.7 + instant * 0.3;
            speedSamples.set(id, { time: now, bytes: receivedBytes, ema });
            patchCurrentJob({ receivedBytes, totalBytes, speedBps: Math.max(0, ema) });
            return;
          }
          patchCurrentJob({ receivedBytes, totalBytes });
        },
        onFileProgress:
          spec.kind === "single"
            ? (fileProgress) => patchCurrentJob({ fileProgress })
            : undefined,
      });
      if (!isCurrentRun()) {
        return;
      }

      // All bytes are on hand; building the archive can take a while for big
      // batches, so surface it as its own phase instead of a full, frozen bar.
      const archiveTotalBytes = archiveInputs.reduce((sum, input) => sum + input.blob.size, 0);
      patchCurrentJob({
        status: "archiving",
        completed: 0,
        total: archiveInputs.length,
        receivedBytes: 0,
        totalBytes: archiveTotalBytes,
        speedBps: 0,
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
      if (spec.kind === "batch") {
        // A cross-version selection saves one archive per version instead of
        // merging every version folder into a single giant archive. Archives
        // build sequentially with cumulative progress across the whole set.
        const charts = regroupBatch(archiveInputs, spec.dirByIndex ?? [], spec.groupByIndex ?? []);
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
                totalFiles: archiveInputs.length,
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
              [{ name: spec.title, groupDir: spec.groupDir, files: archiveInputs }],
              format,
              undefined,
              onArchiveProgress
            )
          : await buildArchiveBlob(archiveInputs, format, spec.title, onArchiveProgress);
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
      patchJob(id, { status: "success" });
      scheduleAutoDismiss(id, startedAt);
    } catch (error) {
      // An abort comes from pause() (which already kept whole-file checkpoints),
      // dismiss(), or a newer run for this same id.
      if (!isCurrentRun()) {
        return;
      }
      const current = get().jobs.find((job) => job.id === id);
      patchJob(id, {
        ...(current ? completedCheckpointProgress(current) : {}),
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        errorKind: classifyError(error),
        speedBps: 0,
        archiveCurrentFile: null,
      });
    } finally {
      // A stale run must never clear the controller or speed samples belonging
      // to the replacement run that superseded it.
      if (abortControllers.get(id) === controller) {
        abortControllers.delete(id);
        speedSamples.delete(id);
      }
    }
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
    if (existing === "packing" || existing === "archiving") {
      return;
    }
    const sourceId = inferDownloadSourceId(spec.files, spec.sourceId);
    const sourcedSpec: PersistedJob =
      spec.sourceId === sourceId ? spec : { ...spec, sourceId };
    jobSpecs.set(sourcedSpec.id, sourcedSpec);
    const startedAt = Date.now();
    upsertJob({
      id: sourcedSpec.id,
      kind: sourcedSpec.kind,
      title: sourcedSpec.title,
      sourceId,
      format: sourcedSpec.format as ArchiveFormat,
      status: "packing",
      completed: 0,
      total: sourcedSpec.files.length,
      receivedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
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
      startedAt,
    });
    void startRun(sourcedSpec.id, startedAt, sourcedSpec, persistSpec);
  };

  return {
    jobs: [],
    selectedSourceId: DEFAULT_DOWNLOAD_SOURCE_ID,
    sourceProbes: createInitialDownloadSourceProbes(),
    presented: {},
    bottomBars: 0,

    startSingle: ({
      id,
      title,
      files,
      groupDir,
      includeVideo,
      format,
      sourceId,
    }) => {
      const selectedSourceId = getSelectableDownloadSource(
        sourceId ?? get().selectedSourceId
      ).id;
      const routedFiles = routeDownloadFiles(files, selectedSourceId);
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
        format,
        createdAt: Date.now(),
        sourceId: selectedSourceId,
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
    }) => {
      const selectedSourceId = getSelectableDownloadSource(
        sourceId ?? get().selectedSourceId
      ).id;
      // Download flat (one fetch per file), tagging each by chart index so results
      // can be regrouped — an opaque numeric prefix avoids clashing with chart
      // names that contain "/".
      const dirByIndex: string[] = [];
      const groupByIndex: string[] = [];
      const files: { name: string; url: string }[] = [];
      routeChartDownloadSpecs(charts, selectedSourceId).forEach((chart, index) => {
        dirByIndex[index] = chart.dir;
        groupByIndex[index] = chart.groupDir ?? "";
        for (const file of chart.files) {
          if (includeVideo || !isChartVideoFile(file.name)) {
            files.push({ name: `${index}/${file.name}`, url: file.url });
          }
        }
      });
      if (files.length === 0) {
        return;
      }
      beginJob({
        id,
        kind: "batch",
        title,
        format,
        createdAt: Date.now(),
        sourceId: selectedSourceId,
        files,
        dirByIndex,
        ...(groupByIndex.some(Boolean) ? { groupByIndex } : {}),
      });
    },

    setSelectedSourceId: (sourceId) => {
      const selectedSourceId = getSelectableDownloadSource(sourceId).id;
      set({ selectedSourceId });
      saveSourcePreference(selectedSourceId);
    },

    refreshSourceProbes: async (force = false) => {
      if (sourceProbePromise) {
        return sourceProbePromise;
      }
      if (!force && sourceProbesAreFresh(get().sourceProbes, Date.now())) {
        return;
      }

      set((state) => {
        const sourceProbes = { ...state.sourceProbes };
        for (const source of DOWNLOAD_SOURCES) {
          sourceProbes[source.id] = {
            ...sourceProbes[source.id],
            state: "testing",
          };
        }
        return { sourceProbes };
      });

      const run = (async () => {
        const results = await Promise.all(
          DOWNLOAD_SOURCES.map(async (source) => ({
            sourceId: source.id,
            result: await probeDownloadSource(source.id),
          }))
        );
        const measuredAt = Date.now();
        const sourceProbes = createInitialDownloadSourceProbes();
        for (const { sourceId, result } of results) {
          sourceProbes[sourceId] = { ...result, measuredAt };
        }
        set({ sourceProbes });
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

    restartWithSource: (id, sourceId) => {
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

      const nextSourceId = getSelectableDownloadSource(sourceId).id;
      const previousSourceId = inferDownloadSourceId(spec.files, spec.sourceId);
      const restartedSpec: PersistedJob = {
        ...spec,
        sourceId: nextSourceId,
        createdAt: Date.now(),
        files: rerouteDownloadFiles(spec.files, previousSourceId, nextSourceId),
      };

      restartingJobs.add(id);
      set({ selectedSourceId: nextSourceId });
      saveSourcePreference(nextSourceId);
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
              errorKind: classifyError(error),
            });
          }
        } finally {
          restartingJobs.delete(id);
        }
      })();
    },

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
        speedBps: 0,
        archiveCurrentFile: null,
        startedAt,
      });
      void startRun(id, startedAt, spec, false);
    },

    pause: (id) => {
      const job = get().jobs.find((entry) => entry.id === id);
      if (!job || job.status !== "packing") {
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
      set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) }));
      void enqueueLifecycle(id, async () => {
        // A checkpoint callback that began just before dismiss must finish
        // before cleanup, otherwise it could recreate an orphaned file record.
        await deleteJob(id);
      });
    },

    hydrateFromStorage: () => {
      if (hydrated) {
        return;
      }
      hydrated = true;
      set({ selectedSourceId: loadSourcePreference() });
      void (async () => {
        const stored = await loadAllJobs();
        for (const storedSpec of stored) {
          if (get().jobs.some((job) => job.id === storedSpec.id)) {
            continue;
          }
          const sourceId = inferDownloadSourceId(storedSpec.files, storedSpec.sourceId);
          // Normalize every configured/legacy mirror URL while hydrating. This
          // lets jobs saved before the Alice migration resume normally without
          // requiring the user to manually switch source first.
          const spec: PersistedJob = {
            ...storedSpec,
            sourceId,
            files: routeDownloadFiles(storedSpec.files, sourceId),
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
            const prior = reusablePersistedFile(file, byName.get(file.name));
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
                  const prior = reusablePersistedFile(file, byName.get(file.name));
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
            format: spec.format as ArchiveFormat,
            status: "paused",
            completed,
            total: spec.files.length,
            receivedBytes,
            totalBytes: totalKnown ? totalBytes : 0,
            speedBps: 0,
            fileProgress,
            archiveCurrentFile: null,
            error: null,
            errorKind: null,
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
 * Splits a regrouped batch into the archives to save: one per version folder
 * when the selection spans multiple versions (each named by that folder, e.g.
 * "25 CiRCLE"), otherwise a single archive named by the collection title.
 * Charts without a version folder fall back to the collection title too.
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
