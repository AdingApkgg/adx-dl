import type { getDictionary } from "@/lib/i18n";
import { formatBytes } from "./format-bytes";
import { jobPercent, type DownloadJob } from "./downloads-store";

type DetailDictionary = ReturnType<typeof getDictionary>["detail"];
type DownloadsDictionary = ReturnType<typeof getDictionary>["downloads"];

/** `1:20` / `12:05` / `1:02:30`, chosen for glanceability over a spelled-out phrase. */
export function formatEtaClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}

/**
 * The coarse state a screen reader should hear.
 *
 * Split from the numeric detail below on purpose: the byte counters update on
 * every chunk, and splicing them into one string inside a `role="status"` made
 * assistive tech read the whole line dozens of times a second — which is also
 * why the terminal states were never actually noticed. This half changes only
 * when the job changes phase.
 */
export function downloadJobStateText(
  job: DownloadJob,
  detail: DetailDictionary,
  tray: DownloadsDictionary
): string {
  switch (job.status) {
    case "queued":
      return tray.queued;
    case "packing":
      return detail.downloadPacking(job.completed, job.total);
    case "archiving":
      return tray.archiving;
    case "success":
      return job.skippedFiles.length > 0
        ? `${tray.completed} · ${tray.skippedSummary(job.skippedFiles.length)}`
        : tray.completed;
    case "paused":
      return tray.paused;
    case "error":
      return job.errorKind === "offline"
        ? tray.errorOffline
        : job.errorKind === "missing"
          ? tray.errorMissing
          : job.errorKind === "server"
            ? tray.errorServer
            : job.errorKind === "network"
              ? tray.errorNetwork
              : tray.errorGeneric;
  }
}

/**
 * The per-frame numbers: transferred bytes, rate and remaining time. Rendered
 * `aria-hidden`, so the wording only has to work visually.
 *
 * The total carries a "~" whenever it extrapolated files that had not declared
 * a Content-Length — with six-way concurrency that is most of them for most of
 * a run, and quoting an extrapolation as exact would be a lie the user can
 * watch drift.
 */
export function downloadJobMetricsText(
  job: DownloadJob,
  tray: DownloadsDictionary
): string {
  if (job.status !== "packing" && job.status !== "archiving") {
    return job.status === "paused" ? `${jobPercent(job)}%` : "";
  }
  const parts: string[] = [];
  if (job.status === "archiving") {
    parts.push(`${jobPercent(job)}%`);
    if (job.total > 0) {
      parts.push(`${job.completed}/${job.total}`);
    }
  }
  if (job.receivedBytes > 0 || job.totalBytes > 0) {
    const prefix = job.totalBytesEstimated ? "~" : "";
    parts.push(
      job.totalBytes > 0
        ? `${formatBytes(job.receivedBytes)} / ${prefix}${formatBytes(job.totalBytes)}`
        : formatBytes(job.receivedBytes)
    );
  }
  if (job.speedBps > 1024) {
    parts.push(`${formatBytes(job.speedBps)}/s`);
  }
  if (job.etaMs !== null) {
    parts.push(tray.etaRemaining(formatEtaClock(job.etaMs)));
  }
  if (job.status === "archiving" && job.archiveCurrentFile) {
    parts.push(job.archiveCurrentFile);
  }
  return parts.join(" · ");
}

/** Localized job status line shared by inline download boxes and the floating tray. */
export function downloadJobStatusText(
  job: DownloadJob,
  detail: DetailDictionary,
  tray: DownloadsDictionary
): string {
  const state = downloadJobStateText(job, detail, tray);
  const metrics = downloadJobMetricsText(job, tray);
  return metrics ? `${state} · ${metrics}` : state;
}
