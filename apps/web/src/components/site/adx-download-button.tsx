"use client";

import * as React from "react";
import { ChevronDownIcon, DownloadIcon, PauseIcon, RotateCwIcon, XIcon } from "lucide-react";

import { AnimatePresence, EASE_OUT, motion } from "@/components/motion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ARCHIVE_FORMATS, type ArchiveFormat } from "@/lib/adx-archive";
import type { AdxRemoteFile } from "@/lib/adx-directory";
import { isChartVideoFile } from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";
import { formatBytes } from "./downloads/format-bytes";
import { singleJobId, useDownloadsStore } from "./downloads/downloads-store";

type AdxDownloadButtonProps = {
  /** Files to pack into the .adx (maidata + assets), with their in-archive names. */
  files: AdxRemoteFile[];
  /** Base name for the downloaded .adx file (the chart's directory name). */
  fileName?: string;
  locale: Locale;
};

export function AdxDownloadButton({ files, fileName, locale }: AdxDownloadButtonProps) {
  const dictionary = getDictionary(locale);
  const detailDictionary = dictionary.detail;
  const downloadsDictionary = dictionary.downloads;
  const [includeVideo, setIncludeVideo] = React.useState(true);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const normalizedFileName = typeof fileName === "string" ? fileName.trim() : "";
  const canDownload = files.length > 0 && normalizedFileName.length > 0;

  // The download runs in a module-level store, so it (and this state) survives a
  // client-side navigation away from the chart page. We read the job back here to
  // keep rendering the same inline progress while the user stays on the page.
  const jobId = singleJobId(normalizedFileName);
  const job = useDownloadsStore((state) => state.jobs.find((entry) => entry.id === jobId));
  const startSingle = useDownloadsStore((state) => state.startSingle);
  const resume = useDownloadsStore((state) => state.resume);
  const pause = useDownloadsStore((state) => state.pause);
  const dismiss = useDownloadsStore((state) => state.dismiss);

  const status = job?.status ?? "idle";
  const isBusy = status === "packing" || status === "archiving";
  // After a full reload an interrupted job comes back as `paused`; an in-session
  // failure is `error`. Both keep their partial bytes and can resume from offset.
  const isResumable = status === "paused" || status === "error";
  const progress = { completed: job?.completed ?? 0, total: job?.total ?? 0 };
  const fileProgress = job?.fileProgress ?? [];
  const resumePercent =
    job && job.totalBytes > 0
      ? Math.min(100, Math.round((job.receivedBytes / job.totalBytes) * 100))
      : 0;
  const friendlyError =
    status === "error"
      ? job?.errorKind === "offline"
        ? downloadsDictionary.errorOffline
        : job?.errorKind === "network"
          ? downloadsDictionary.errorNetwork
          : downloadsDictionary.errorGeneric
      : "";

  const hasVideo = files.some((file) => isChartVideoFile(file.name));

  // While this job is shown inline, claim it so the floating tray doesn't also
  // render it; once we unmount (navigation) the tray takes over its progress.
  const hasJob = job != null;
  const presentInline = useDownloadsStore((state) => state.presentInline);
  const unpresentInline = useDownloadsStore((state) => state.unpresentInline);
  React.useEffect(() => {
    if (!hasJob) {
      return;
    }
    presentInline(jobId);
    return () => unpresentInline(jobId);
  }, [hasJob, jobId, presentInline, unpresentInline]);

  React.useEffect(() => {
    if (!confirmDiscard) {
      return;
    }
    const timer = window.setTimeout(() => setConfirmDiscard(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmDiscard]);

  function handleSelect(format: ArchiveFormat) {
    if (!canDownload || isBusy) {
      return;
    }
    startSingle({ id: jobId, title: normalizedFileName, files, includeVideo, format });
  }

  const label =
    status === "archiving"
      ? downloadsDictionary.archiving
      : status === "packing"
        ? detailDictionary.downloadPacking(progress.completed, progress.total)
        : canDownload
          ? detailDictionary.onsiteDownload
          : detailDictionary.onsitePending;

  return (
    <div className="flex flex-col gap-2">
      {isResumable ? (
        <div className="flex items-center gap-2">
          <Button type="button" onClick={() => resume(jobId)}>
            <RotateCwIcon data-icon="inline-start" />
            {downloadsDictionary.resume}
            {resumePercent > 0 ? ` · ${resumePercent}%` : null}
          </Button>
          <Button
            type="button"
            variant={confirmDiscard ? "destructive" : "ghost"}
            size="icon"
            aria-label={
              confirmDiscard ? downloadsDictionary.confirmDiscard : downloadsDictionary.cancel
            }
            title={
              confirmDiscard ? downloadsDictionary.confirmDiscard : downloadsDictionary.cancel
            }
            onClick={() => {
              if (confirmDiscard) {
                dismiss(jobId);
              } else {
                setConfirmDiscard(true);
              }
            }}
          >
            <XIcon />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" disabled={!canDownload || isBusy}>
                <motion.span
                  className="inline-flex"
                  animate={isBusy ? { y: [0, 2, 0] } : { y: 0 }}
                  transition={
                    isBusy
                      ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" }
                      : { duration: 0.2 }
                  }
                >
                  <DownloadIcon data-icon="inline-start" />
                </motion.span>
                {label}
                {canDownload && !isBusy ? (
                  <ChevronDownIcon data-icon="inline-end" className="opacity-70" />
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-(--radix-dropdown-menu-trigger-width)">
              <DropdownMenuLabel>{detailDictionary.downloadFormatLabel}</DropdownMenuLabel>
              {ARCHIVE_FORMATS.map((format) => (
                <DropdownMenuItem
                  key={format}
                  onSelect={() => handleSelect(format)}
                  className="justify-between gap-4"
                >
                  <span className="font-mono">.{format}</span>
                  {format === "adx" ? (
                    <span className="text-xs text-muted-foreground">
                      {detailDictionary.formatHintAdx}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
              {hasVideo ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={includeVideo}
                    onCheckedChange={(value) => setIncludeVideo(value === true)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {detailDictionary.downloadIncludeVideo}
                  </DropdownMenuCheckboxItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {status === "packing" ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={downloadsDictionary.pause}
              title={downloadsDictionary.pause}
              onClick={() => pause(jobId)}
            >
              <PauseIcon />
            </Button>
          ) : null}
        </div>
      )}
      <AnimatePresence>
        {isBusy && fileProgress.length > 0 ? (
          <motion.ul
            key="file-progress"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="flex flex-col gap-2 overflow-hidden"
          >
            {fileProgress.map((file) => {
              const percent =
                file.status === "done"
                  ? 100
                  : file.total
                    ? Math.min(100, Math.round((file.received / file.total) * 100))
                    : null;
              const isIndeterminate = percent === null;

              return (
                <li key={file.name} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-mono text-muted-foreground">
                      {file.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {isIndeterminate ? formatBytes(file.received) : `${percent}%`}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={isIndeterminate ? undefined : percent}
                    aria-label={file.name}
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={
                        isIndeterminate
                          ? "h-full w-full animate-pulse rounded-full bg-primary/40"
                          : "h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                      }
                      style={isIndeterminate ? undefined : { width: `${percent}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {status === "success" ? (
          <motion.div
            key="success"
            role="status"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="flex flex-col gap-1 text-sm text-muted-foreground"
          >
            <p>{downloadsDictionary.completed}</p>
            <p className="text-xs">{downloadsDictionary.importHint}</p>
          </motion.div>
        ) : status === "error" ? (
          <motion.p
            key="error"
            role="status"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="text-sm text-destructive"
            title={job?.error ?? undefined}
          >
            {friendlyError}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
