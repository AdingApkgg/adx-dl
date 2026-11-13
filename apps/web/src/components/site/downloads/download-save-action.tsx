"use client";

import { CheckIcon, DownloadIcon } from "lucide-react";
import { Button } from "@astrodx/ui/components/button";
import { getDictionary, type Locale } from "@/lib/i18n";
import { useDownloadsStore, type DownloadJob } from "./downloads-store";

/** Saving must stay inside the user's click; never infer disk completion. */
export function getDownloadSaveAction(jobs: readonly DownloadJob[]) {
  for (const job of jobs) {
    if (job.status !== "ready" && job.status !== "success") continue;
    const index = job.archives?.findIndex((archive) => !archive.requested || archive.error) ?? -1;
    if (index >= 0) return { kind: "save" as const, job, index };
    if (job.mobileBatch && job.status === "success" && job.archives?.length) {
      return { kind: "confirm" as const, job, index: -1 };
    }
  }
  return null;
}

export function DownloadSaveAction({ jobs, locale }: { jobs: readonly DownloadJob[]; locale: Locale }) {
  const copy = getDictionary(locale).downloads;
  const saveArchive = useDownloadsStore((state) => state.saveArchive);
  const confirmSavedBatch = useDownloadsStore((state) => state.confirmSavedBatch);
  const hasNextJob = useDownloadsStore((state) => state.jobs.some((job) => job.status === "queued"));
  const action = getDownloadSaveAction(jobs);
  if (!action) return null;
  return (
    <Button type="button" className="h-auto min-h-11 whitespace-normal py-2" onClick={() => {
      if (action.kind === "save") saveArchive(action.job.id, action.index);
      else confirmSavedBatch(action.job.id);
    }}>
      {action.kind === "save" ? <DownloadIcon data-icon="inline-start" /> : <CheckIcon data-icon="inline-start" />}
      {action.kind === "save" ? copy.saveArchive : hasNextJob ? copy.confirmSavedBatch : copy.releaseSavedBatch}
      {action.kind === "save" && action.job.archives!.length > 1 ? (
        <span className="tabular-nums">{action.index + 1}/{action.job.archives!.length}</span>
      ) : null}
    </Button>
  );
}
