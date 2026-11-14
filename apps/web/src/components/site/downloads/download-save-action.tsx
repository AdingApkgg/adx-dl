"use client";

import { DownloadIcon } from "lucide-react";
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
  const action = getDownloadSaveAction(jobs);
  if (!action) return null;
  // Keep the just-clicked save position non-interactive. The separate
  // confirmation below the file list is deliberate, not the next double tap.
  if (action.kind === "confirm") {
    return <p className="flex min-h-11 items-center text-sm text-muted-foreground">{copy.managerConfirmSave}</p>;
  }
  return (
    <Button type="button" className="h-auto min-h-11 whitespace-normal py-2" onClick={() => {
      saveArchive(action.job.id, action.index);
    }}>
      <DownloadIcon data-icon="inline-start" />
      {copy.saveArchive}
      {action.job.archives!.length > 1 ? (
        <span className="tabular-nums">{action.index + 1}/{action.job.archives!.length}</span>
      ) : null}
    </Button>
  );
}
