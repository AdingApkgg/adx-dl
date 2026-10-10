"use client";

import * as React from "react";
import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";

import { getDictionary, type Locale } from "@/lib/i18n";
import { cn } from "@astrodx/ui/lib/utils";
import { downloadJobMetricsText, downloadJobStateText } from "./download-status-text";
import { getDownloadSource } from "@/lib/download-sources";
import { useDownloadsStore, type DownloadJob } from "./downloads-store";
import { formatBytes } from "./format-bytes";
import { DownloadImportGuide } from "./download-import-guide";

type Dictionary = ReturnType<typeof getDictionary>;

export function DownloadStorageNotice({ locale }: { locale: Locale }) {
  const unavailable = useDownloadsStore((state) => state.checkpointsUnavailable);
  const blocked = useDownloadsStore((state) => state.checkpointsBlocked);
  if (!unavailable && !blocked) return null;
  const tray = getDictionary(locale).downloads;
  return (
    <p role="alert" className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] leading-snug text-amber-800 dark:text-amber-300">
      {blocked ? tray.checkpointsBlocked : tray.checkpointsUnavailable}
    </p>
  );
}

/**
 * The one live region per job.
 *
 * It stays mounted for the whole lifetime of the job on purpose: success and
 * failure used to be conditionally-rendered elements, and most screen readers
 * do not announce a `role="status"` that appears at the same time as its text.
 * Only the coarse phase lives inside it — the byte/rate/ETA counters are
 * `aria-hidden`, because patching them on every chunk turned the region into a
 * firehose that read the whole line dozens of times a second.
 */
export function DownloadJobStatusLine({
  job,
  locale,
  className,
}: {
  job: DownloadJob;
  locale: Locale;
  className?: string;
}) {
  const dictionary = getDictionary(locale);
  const state = downloadJobStateText(job, dictionary.detail, dictionary.downloads);
  const metrics = downloadJobMetricsText(job, dictionary.downloads);

  return (
    <p
      className={cn(
        "text-xs",
        job.status === "error" ? "text-destructive" : "text-muted-foreground",
        className
      )}
    >
      <span role="status" className="truncate">
        {state}
      </span>
      {metrics ? (
        <span aria-hidden="true" className="truncate tabular-nums">
          {` · ${metrics}`}
        </span>
      ) : null}
    </p>
  );
}

function CopyButton({ value, copyLabel, copiedLabel }: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          // A denied clipboard leaves the text selectable in the block above,
          // which is the whole reason the detail is rendered rather than hidden
          // in a `title` attribute.
          .catch(() => undefined);
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {copied ? (
        <CheckIcon className="size-3" aria-hidden="true" />
      ) : (
        <CopyIcon className="size-3" aria-hidden="true" />
      )}
      {copied ? copiedLabel : copyLabel}
    </button>
  );
}

/**
 * Everything a job needs to say beyond its one-line status: the route it moved
 * to by itself, optional assets it gave up on, and the verbatim failure.
 *
 * The failure detail used to live only in a `title` attribute, i.e. nowhere at
 * all on a touch device — and it is exactly what someone needs in order to
 * report the problem, so it is copyable text behind a disclosure.
 */
export function DownloadJobNotes({
  job,
  locale,
}: {
  job: DownloadJob;
  locale: Locale;
}) {
  const dictionary: Dictionary = getDictionary(locale);
  const tray = dictionary.downloads;
  const saveArchive = useDownloadsStore((state) => state.saveArchive);
  const confirmSavedBatch = useDownloadsStore((state) => state.confirmSavedBatch);
  const restartLegacyBatch = useDownloadsStore((state) => state.restartLegacyBatch);
  const hasNextJob = useDownloadsStore((state) =>
    state.jobs.some((entry) => entry.status === "queued")
  );
  const hasArchives = Boolean(job.archives?.length);
  const hasRequestedSave = job.archives?.some((archive) => archive.requested);
  const savedArchiveInfo = job.savedArchiveInfo;
  const showImportGuide = Boolean(hasRequestedSave || savedArchiveInfo);
  const showMemoryWarning = job.mobileMemoryWarning && job.status !== "queued" && !savedArchiveInfo;
  const showLegacyWarning = job.mobileLegacyBatch && (job.status === "paused" || job.status === "error");
  const hasSkipped = job.skippedFiles.length > 0;
  const showSwitchNotice =
    job.autoSwitchedTo !== null && job.status !== "success";

  if (!hasSkipped && !showSwitchNotice && !job.errorDetail && !hasArchives && !showImportGuide && !showMemoryWarning && !showLegacyWarning) {
    return null;
  }

  // A custom route's label is the user's own; only built-ins are localized.
  const switchedName =
    job.autoSwitchedTo === null
      ? ""
      : job.sourceName ??
        tray.sourcePicker.options[getDownloadSource(job.autoSwitchedTo).copyKey].name;

  return (
    <div className="flex flex-col gap-1.5 text-[11px] leading-snug">
      {showMemoryWarning ? (
        <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-300">
          {job.mobileMemoryWarning === "unknown-size" ? tray.mobileUnknownSizeHint : tray.mobileLargeChartHint}
        </p>
      ) : null}
      {showLegacyWarning ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-300">
          <p>{tray.mobileLegacyBatchHint}</p>
          <button
            type="button"
            onClick={() => restartLegacyBatch(job.id)}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-current px-2 py-1.5 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {tray.mobileRestartBatch}
          </button>
        </div>
      ) : null}
      {hasArchives ? (
        <>
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto overscroll-contain">
            {job.archives!.map((archive, index) => (
              <li key={archive.fileName} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => saveArchive(job.id, index)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border/70 px-2 py-1.5 text-left text-xs text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <DownloadIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 break-all">{archive.fileName}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(archive.bytes)}</span>
                  <span className="shrink-0">{archive.requested ? tray.saveAgain : tray.saveArchive}</span>
                </button>
                {archive.error ? <p role="alert" className="text-destructive">{tray.saveError}</p> : null}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">{tray.saveHint}</p>
          {job.mobileBatch && job.status === "success" ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-muted-foreground">{tray.confirmSavedBatchHint}</p>
              <button
                type="button"
                onClick={() => confirmSavedBatch(job.id)}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {hasNextJob ? tray.confirmSavedBatch : tray.releaseSavedBatch}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {showImportGuide ? (
        <DownloadImportGuide
          locale={locale}
          format={savedArchiveInfo?.format ?? job.format}
          split={(savedArchiveInfo?.archiveCount ?? job.archives?.length ?? 0) > 1}
          cacheReleased={Boolean(savedArchiveInfo)}
        />
      ) : null}
      {showSwitchNotice ? (
        <p className="text-muted-foreground">{tray.autoSwitched(switchedName)}</p>
      ) : null}
      {hasSkipped ? (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {tray.skippedSummary(job.skippedFiles.length)}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono break-all">
            {job.skippedFiles.map((file) => (
              <li key={file.name}>
                {file.name}
                {file.status === null ? "" : ` (HTTP ${file.status})`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {job.errorDetail ? (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {tray.errorDetailLabel}
          </summary>
          <div className="mt-1 flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all font-mono">{job.errorDetail}</code>
            <CopyButton
              value={job.errorDetail}
              copyLabel={tray.copyDetail}
              copiedLabel={tray.copiedDetail}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
