import type { getDictionary } from "@/lib/i18n";
import type { DownloadJob } from "./downloads-store";

type Copy = ReturnType<typeof getDictionary>["downloads"];

/** A collapsed manager surfaces work that needs attention before activity. */
export function downloadManagerSummary(jobs: readonly DownloadJob[], copy: Copy): string {
  if (jobs.some((job) => job.status === "ready")) return copy.readyToSave;
  if (jobs.some((job) => job.status === "success" && job.mobileBatch && job.archives?.length)) return copy.managerConfirmSave;
  if (jobs.some((job) => job.status === "error")) return copy.managerFailed;
  if (jobs.some((job) => job.status === "paused")) return copy.paused;
  if (jobs.some((job) => job.status === "archiving")) return copy.archiving;
  if (jobs.some((job) => job.status === "packing")) return copy.managerDownloading;
  if (jobs.some((job) => job.status === "queued")) return copy.queued;
  return jobs.length > 0 ? copy.completed : "";
}
