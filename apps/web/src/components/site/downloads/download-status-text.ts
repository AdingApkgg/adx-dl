import type { getDictionary } from "@/lib/i18n";
import { formatBytes } from "./format-bytes";
import { jobPercent, type DownloadJob } from "./downloads-store";

type DetailDictionary = ReturnType<typeof getDictionary>["detail"];
type DownloadsDictionary = ReturnType<typeof getDictionary>["downloads"];

/** Localized job status line shared by inline download boxes and the floating tray. */
export function downloadJobStatusText(
  job: DownloadJob,
  detail: DetailDictionary,
  tray: DownloadsDictionary
): string {
  const percent = jobPercent(job);
  switch (job.status) {
    case "packing": {
      const counts = detail.downloadPacking(job.completed, job.total);
      const bytes =
        job.receivedBytes > 0
          ? job.totalBytes > 0
            ? ` · ${formatBytes(job.receivedBytes)} / ${formatBytes(job.totalBytes)}`
            : ` · ${formatBytes(job.receivedBytes)}`
          : "";
      const speed = job.speedBps > 1024 ? ` · ${formatBytes(job.speedBps)}/s` : "";
      return `${counts}${bytes}${speed}`;
    }
    case "archiving":
      return tray.archiving;
    case "success":
      return tray.completed;
    case "paused":
      return `${tray.paused} · ${percent}%`;
    case "error":
      return job.errorKind === "offline"
        ? tray.errorOffline
        : job.errorKind === "network"
          ? tray.errorNetwork
          : tray.errorGeneric;
  }
}
