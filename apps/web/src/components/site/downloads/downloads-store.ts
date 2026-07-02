import { create } from "zustand";

import {
  buildArchiveBlob,
  buildNestedArchiveBlob,
  getArchiveDownloadFileName,
  saveBlobAsFile,
  type AdxArchiveInput,
  type ArchiveFormat,
  type BatchArchiveFormat,
} from "@/lib/adx-archive";
import type { AdxRemoteFile } from "@/lib/adx-directory";
import { isChartVideoFile, type ChartDownloadSpec } from "@/lib/catalog-shared";
import {
  runResumableDownload,
  type AdxFileProgress,
  type ResumeFileInput,
} from "./download-engine";
import {
  deleteJob,
  fileKey,
  loadAllJobs,
  loadFilesForJob,
  persistFile,
  persistJob,
  type PersistedFile,
  type PersistedJob,
} from "./persistence";

/**
 * A download job. The store is a module-level singleton, so a job keeps running
 * (and updating) after the component that started it unmounts on a client-side
 * navigation. Partial bytes are also mirrored to IndexedDB by the engine, so a
 * job that was interrupted by a full reload comes back as `paused` and can be
 * resumed from its last byte offset.
 */
export type DownloadJob = {
  id: string;
  kind: "single" | "batch";
  /** Display name — the chart directory name or the batch collection name. */
  title: string;
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
  includeVideo: boolean;
  format: ArchiveFormat;
};

type StartBatchParams = {
  id: string;
  title: string;
  charts: ChartDownloadSpec[];
  includeVideo: boolean;
  format: BatchArchiveFormat;
};

type DownloadsState = {
  jobs: DownloadJob[];
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
  resume: (id: string) => void;
  /** Aborts an in-flight job but keeps its spec and partial bytes for resume. */
  pause: (id: string) => void;
  dismiss: (id: string) => void;
  hydrateFromStorage: () => void;
  presentInline: (id: string) => void;
  unpresentInline: (id: string) => void;
  presentBottomBar: () => void;
  unpresentBottomBar: () => void;
};

/** How long a finished (success) job lingers before the tray auto-clears it. */
const AUTO_DISMISS_MS = 6000;

// Module-level (outside the store value) so they survive store updates but stay
// out of React's snapshot: the durable job spec and any in-flight abort handle.
const jobSpecs = new Map<string, PersistedJob>();
const abortControllers = new Map<string, AbortController>();
/** Byte samples for the smoothed transfer-rate estimate, keyed by job id. */
const speedSamples = new Map<string, { time: number; bytes: number; ema: number }>();
let hydrated = false;

/** Minimum sampling window before updating the rate estimate. */
const SPEED_SAMPLE_MS = 500;

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

    const persisted = await loadFilesForJob(id);
    const byName = new Map<string, PersistedFile>(persisted.map((file) => [file.name, file]));
    const inputs: ResumeFileInput[] = spec.files.map((file) => {
      const prior = byName.get(file.name);
      return {
        name: file.name,
        url: file.url,
        etag: prior?.etag ?? null,
        total: prior?.total ?? null,
        blob: prior?.blob ?? new Blob([]),
      };
    });

    const controller = new AbortController();
    abortControllers.set(id, controller);
    speedSamples.delete(id);
    patchJob(id, { status: "packing", error: null, errorKind: null, speedBps: 0 });

    try {
      const archiveInputs = await runResumableDownload(inputs, {
        concurrency: spec.kind === "batch" ? 6 : 4,
        signal: controller.signal,
        onFileComplete: (completed, total) => patchJob(id, { completed, total }),
        onBytes: (receivedBytes, totalBytes) => {
          const now = Date.now();
          const sample = speedSamples.get(id);
          if (!sample) {
            speedSamples.set(id, { time: now, bytes: receivedBytes, ema: 0 });
            patchJob(id, { receivedBytes, totalBytes });
            return;
          }
          const elapsed = now - sample.time;
          if (elapsed >= SPEED_SAMPLE_MS) {
            const instant = ((receivedBytes - sample.bytes) / elapsed) * 1000;
            const ema = sample.ema === 0 ? instant : sample.ema * 0.7 + instant * 0.3;
            speedSamples.set(id, { time: now, bytes: receivedBytes, ema });
            patchJob(id, { receivedBytes, totalBytes, speedBps: Math.max(0, ema) });
            return;
          }
          patchJob(id, { receivedBytes, totalBytes });
        },
        onFileProgress:
          spec.kind === "single"
            ? (fileProgress) => patchJob(id, { fileProgress })
            : undefined,
        onFlush: (file) => {
          void persistFile({
            key: fileKey(id, file.name),
            jobId: id,
            name: file.name,
            url: file.url,
            etag: file.etag,
            total: file.total,
            received: file.received,
            blob: file.blob,
          });
        },
      });

      // All bytes are on hand; building the archive can take a while for big
      // batches, so surface it as its own phase instead of a full, frozen bar.
      patchJob(id, { status: "archiving", speedBps: 0 });

      const format = spec.format as ArchiveFormat;
      const archiveBlob =
        spec.kind === "batch"
          ? await buildNestedArchiveBlob(
              regroupBatch(archiveInputs, spec.dirByIndex ?? []),
              format as BatchArchiveFormat
            )
          : await buildArchiveBlob(archiveInputs, format);

      saveBlobAsFile(archiveBlob, getArchiveDownloadFileName(spec.title, format));

      abortControllers.delete(id);
      speedSamples.delete(id);
      jobSpecs.delete(id);
      void deleteJob(id);
      patchJob(id, { status: "success" });
      scheduleAutoDismiss(id, startedAt);
    } catch (error) {
      abortControllers.delete(id);
      speedSamples.delete(id);
      // An abort comes from pause() (which has already set the job to `paused`,
      // keeping spec + bytes) or dismiss() (which removed the job entirely) —
      // either way there is nothing to report.
      if (controller.signal.aborted) {
        return;
      }
      // Any other failure keeps the persisted partial bytes so it can resume.
      patchJob(id, {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        errorKind: classifyError(error),
        speedBps: 0,
      });
    }
  };

  const beginJob = (spec: PersistedJob): void => {
    const existing = get().jobs.find((job) => job.id === spec.id)?.status;
    if (existing === "packing" || existing === "archiving") {
      return;
    }
    jobSpecs.set(spec.id, spec);
    void persistJob(spec);
    upsertJob({
      id: spec.id,
      kind: spec.kind,
      title: spec.title,
      format: spec.format as ArchiveFormat,
      status: "packing",
      completed: 0,
      total: spec.files.length,
      receivedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      fileProgress:
        spec.kind === "single"
          ? spec.files.map((file) => ({
              name: file.name,
              received: 0,
              total: null,
              status: "pending",
            }))
          : [],
      error: null,
      errorKind: null,
      startedAt: Date.now(),
    });
    void runJob(spec.id);
  };

  return {
    jobs: [],
    presented: {},
    bottomBars: 0,

    startSingle: ({ id, title, files, includeVideo, format }) => {
      const selected = includeVideo ? files : files.filter((file) => !isChartVideoFile(file.name));
      if (selected.length === 0) {
        return;
      }
      beginJob({
        id,
        kind: "single",
        title,
        format,
        createdAt: Date.now(),
        files: selected.map((file) => ({ name: file.name, url: file.url })),
      });
    },

    startBatch: ({ id, title, charts, includeVideo, format }) => {
      // Download flat (one fetch per file), tagging each by chart index so results
      // can be regrouped — an opaque numeric prefix avoids clashing with chart
      // names that contain "/".
      const dirByIndex: string[] = [];
      const files: { name: string; url: string }[] = [];
      charts.forEach((chart, index) => {
        dirByIndex[index] = chart.dir;
        for (const file of chart.files) {
          if (includeVideo || !isChartVideoFile(file.name)) {
            files.push({ name: `${index}/${file.name}`, url: file.url });
          }
        }
      });
      if (files.length === 0) {
        return;
      }
      beginJob({ id, kind: "batch", title, format, createdAt: Date.now(), files, dirByIndex });
    },

    resume: (id) => {
      const job = get().jobs.find((entry) => entry.id === id);
      if (!job || (job.status !== "paused" && job.status !== "error")) {
        return;
      }
      if (!jobSpecs.has(id)) {
        return;
      }
      void runJob(id);
    },

    pause: (id) => {
      const job = get().jobs.find((entry) => entry.id === id);
      if (!job || job.status !== "packing") {
        return;
      }
      // Abort the engine but keep the spec and the flushed partial bytes; the
      // runJob catch sees the abort and leaves the status we set here alone.
      abortControllers.get(id)?.abort();
      abortControllers.delete(id);
      speedSamples.delete(id);
      patchJob(id, { status: "paused", speedBps: 0 });
    },

    dismiss: (id) => {
      abortControllers.get(id)?.abort();
      abortControllers.delete(id);
      speedSamples.delete(id);
      jobSpecs.delete(id);
      void deleteJob(id);
      set((state) => ({ jobs: state.jobs.filter((job) => job.id !== id) }));
    },

    hydrateFromStorage: () => {
      if (hydrated) {
        return;
      }
      hydrated = true;
      void (async () => {
        const stored = await loadAllJobs();
        for (const spec of stored) {
          if (get().jobs.some((job) => job.id === spec.id)) {
            continue;
          }
          jobSpecs.set(spec.id, spec);
          const files = await loadFilesForJob(spec.id);
          const byName = new Map(files.map((file) => [file.name, file]));
          let completed = 0;
          let receivedBytes = 0;
          let totalBytes = 0;
          let totalKnown = true;
          for (const file of spec.files) {
            const prior = byName.get(file.name);
            const received = prior?.blob.size ?? 0;
            receivedBytes += received;
            if (prior?.total == null) {
              totalKnown = false;
            } else {
              totalBytes += prior.total;
              if (received >= prior.total && received > 0) {
                completed += 1;
              }
            }
          }
          upsertJob({
            id: spec.id,
            kind: spec.kind,
            title: spec.title,
            format: spec.format as ArchiveFormat,
            status: "paused",
            completed,
            total: spec.files.length,
            receivedBytes,
            totalBytes: totalKnown ? totalBytes : 0,
            speedBps: 0,
            fileProgress: [],
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
  dirByIndex: string[]
): { name: string; files: AdxArchiveInput[] }[] {
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
    .map(([index, files]) => ({ name: dirByIndex[index], files }));
}

/** Stable job id for a single-chart download, keyed by its archive base name. */
export function singleJobId(fileName: string): string {
  return `single:${fileName}`;
}

/** Stable job id for a batch download, keyed by its collection name. */
export function batchJobId(collectionName: string): string {
  return `batch:${collectionName}`;
}
