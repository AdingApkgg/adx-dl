"use client";

import * as React from "react";
import {
  ArrowLeftRightIcon,
  ChevronDownIcon,
  DownloadIcon,
  PauseIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";

import { AnimatePresence, DrawnCheck, EASE_OUT, motion } from "@/components/motion";
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
import { ARCHIVE_FORMATS, type ArchiveFormat } from "@/lib/adx-archive-shared";
import {
  isChartVideoFile,
  sumChartDownloadBytes,
  type ChartDownloadSpec,
} from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  DownloadSourceMenu,
  DownloadSourceSummary,
} from "./downloads/download-source-selector";
import {
  DOWNLOAD_STARTED_EVENT,
  DownloadProgressBar,
  type DownloadStartedDetail,
} from "./downloads/download-dock";
import {
  DownloadJobNotes,
  DownloadJobStatusLine,
} from "./downloads/download-job-notes";
import { formatBytes } from "./downloads/format-bytes";
import { jobPercent, singleJobId, useDownloadsStore } from "./downloads/downloads-store";

// framer-motion 12 removed the motion(Component) call form.
const MotionButton = motion.create(Button);

type AdxDownloadButtonProps = {
  /** Global chart download spec: chart folder, version folder and packable assets. */
  spec?: ChartDownloadSpec;
  locale: Locale;
};

export function AdxDownloadButton({ spec, locale }: AdxDownloadButtonProps) {
  const dictionary = getDictionary(locale);
  const detailDictionary = dictionary.detail;
  const downloadsDictionary = dictionary.downloads;
  const [includeVideo, setIncludeVideo] = React.useState(true);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const selectedSourceId = useDownloadsStore((state) => state.selectedSourceId);
  const setSelectedSourceId = useDownloadsStore((state) => state.setSelectedSourceId);
  const preferredFormat = useDownloadsStore((state) => state.preferredFormat);
  const files = spec?.files ?? [];
  const normalizedFileName = typeof spec?.dir === "string" ? spec.dir.trim() : "";
  const canDownload = files.length > 0 && normalizedFileName.length > 0;

  // The download runs in a module-level store, so it (and this state) survives a
  // client-side navigation away from the chart page. We read the job back here to
  // keep rendering the same inline progress while the user stays on the page.
  const jobId = singleJobId(normalizedFileName);
  const job = useDownloadsStore((state) => state.jobs.find((entry) => entry.id === jobId));
  const startSingle = useDownloadsStore((state) => state.startSingle);
  const resume = useDownloadsStore((state) => state.resume);
  const restartWithSource = useDownloadsStore((state) => state.restartWithSource);
  const pause = useDownloadsStore((state) => state.pause);
  const dismiss = useDownloadsStore((state) => state.dismiss);

  const status = job?.status ?? "idle";
  const isBusy = status === "packing" || status === "archiving";
  // After a full reload an interrupted job comes back as `paused`; an in-session
  // failure is `error`. Both keep completed loose files and retry unfinished ones.
  const isResumable = status === "paused" || status === "error";
  const progress = { completed: job?.completed ?? 0, total: job?.total ?? 0 };
  const fileProgress = job?.fileProgress ?? [];
  const percent = job ? jobPercent(job) : 0;

  const hasVideo = files.some((file) => isChartVideoFile(file.name));

  // Quote the transfer BEFORE it starts: a chart with a BGA is routinely 40 MB
  // against 6 MB without one, and on mobile data that difference decides the
  // click. Recomputed from the (measured) per-file sizes as the BGA box flips.
  const downloadBytes = React.useMemo(
    () => sumChartDownloadBytes(spec ? [spec] : []),
    [spec]
  );
  const quotedBytes =
    downloadBytes.baseBytes + (includeVideo && hasVideo ? downloadBytes.videoBytes : 0);
  const sizeHint =
    quotedBytes > 0
      ? includeVideo && hasVideo && downloadBytes.videoBytes > 0
        ? detailDictionary.sizeEstimateWithVideo(
            formatBytes(quotedBytes),
            formatBytes(downloadBytes.videoBytes)
          )
        : detailDictionary.sizeEstimate(formatBytes(quotedBytes))
      : null;

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

  const triggerRef = React.useRef<HTMLButtonElement>(null);

  function handleSelect(format: ArchiveFormat) {
    if (!canDownload || isBusy) {
      return;
    }
    // Tell the floating dock where the trigger sits so it can fly a ghost
    // download icon from this button into its corner.
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      window.dispatchEvent(
        new CustomEvent<DownloadStartedDetail>(DOWNLOAD_STARTED_EVENT, {
          detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        })
      );
    }
    startSingle({
      id: jobId,
      title: normalizedFileName,
      files,
      groupDir: spec?.groupDir,
      includeVideo,
      format,
      sourceId: selectedSourceId,
    });
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
        <div className="flex flex-wrap items-center gap-2">
          <MotionButton type="button" whileTap={{ scale: 0.97 }} onClick={() => resume(jobId)}>
            <RotateCwIcon data-icon="inline-start" />
            {downloadsDictionary.resume}
            {percent > 0 ? ` · ${percent}%` : null}
          </MotionButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={downloadsDictionary.sourcePicker.switchAndRestart}
                title={downloadsDictionary.sourcePicker.restartHint}
              >
                <ArrowLeftRightIcon data-icon="inline-start" />
                {downloadsDictionary.sourcePicker.switchAndRestart}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              collisionPadding={8}
              className="max-h-[min(28rem,calc(100dvh-5rem))] w-[min(20rem,calc(100vw-2rem))] overscroll-contain"
            >
              <DownloadSourceMenu
                value={job?.sourceId ?? selectedSourceId}
                sourceBaseUrl={job?.sourceBaseUrl}
                onValueChange={(sourceId) => restartWithSource(jobId, sourceId)}
                copy={downloadsDictionary.sourcePicker}
                hint={downloadsDictionary.sourcePicker.restartHint}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <MotionButton
            type="button"
            whileTap={{ scale: 0.92 }}
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
            <span className="relative flex items-center justify-center">
              {confirmDiscard ? (
                // Countdown ring mirrors the 3s auto-disarm window; the
                // setTimeout above stays the source of truth.
                <svg aria-hidden="true" viewBox="0 0 32 32" className="absolute -inset-2 size-8 -rotate-90">
                  <motion.circle
                    cx="16"
                    cy="16"
                    r="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    initial={{ pathLength: 1 }}
                    animate={{ pathLength: 0 }}
                    transition={{ duration: 3, ease: "linear" }}
                  />
                </svg>
              ) : null}
              <motion.span
                className="flex"
                animate={confirmDiscard ? { x: [0, -2.5, 2.5, -1.5, 1.5, 0] } : { x: 0 }}
                transition={
                  confirmDiscard ? { duration: 0.35, ease: "easeInOut" } : { duration: 0.15 }
                }
              >
                <XIcon />
              </motion.span>
            </span>
          </MotionButton>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div data-slot="button-group" className="inline-flex">
            <Button
              ref={triggerRef}
              type="button"
              disabled={!canDownload || isBusy}
              onClick={() => handleSelect(preferredFormat)}
              className="rounded-r-none"
            >
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
                <span className="font-mono text-xs opacity-75">
                  .{preferredFormat}
                </span>
              ) : null}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  disabled={!canDownload || isBusy}
                  aria-label={detailDictionary.downloadFormatLabel}
                  title={detailDictionary.downloadFormatLabel}
                  className="-ml-px rounded-l-none border-l border-primary-foreground/25 px-0"
                >
                  <ChevronDownIcon className="opacity-80" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                collisionPadding={8}
                className="max-h-[min(28rem,calc(100dvh-5rem))] w-[min(20rem,calc(100vw-2rem))] overscroll-contain"
              >
                <DownloadSourceMenu
                  value={selectedSourceId}
                  onValueChange={setSelectedSourceId}
                  copy={downloadsDictionary.sourcePicker}
                />
                <DropdownMenuSeparator />
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
          </div>
          {sizeHint && !isBusy ? (
            <span className="text-xs tabular-nums text-muted-foreground">{sizeHint}</span>
          ) : null}
          <AnimatePresence initial={false} mode="wait">
            {status === "packing" ? (
              <MotionButton
                key="pause"
                type="button"
                variant="ghost"
                size="icon"
                aria-label={downloadsDictionary.pause}
                title={downloadsDictionary.pause}
                onClick={() => pause(jobId)}
                whileTap={{ scale: 0.92 }}
                initial={{ opacity: 0, scale: 0.6, rotate: -45 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.6, rotate: -45 }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
              >
                <PauseIcon />
              </MotionButton>
            ) : null}
          </AnimatePresence>
        </div>
      )}
      {canDownload || job ? (
        <DownloadSourceSummary
          sourceId={job?.sourceId ?? selectedSourceId}
          sourceBaseUrl={job?.sourceBaseUrl}
          sourceName={job?.sourceName}
          copy={downloadsDictionary.sourcePicker}
          className="w-fit"
        />
      ) : null}
      {/* One always-mounted status line for the whole job lifecycle: the
          success and error blocks below are decoration, and a conditionally
          mounted live region is exactly what screen readers do not announce. */}
      {job ? (
        <>
          <DownloadJobStatusLine job={job} locale={locale} />
          <DownloadJobNotes job={job} locale={locale} />
        </>
      ) : null}
      <AnimatePresence>
        {status === "archiving" ? (
          <motion.div
            key="archive-progress"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <DownloadProgressBar percent={percent} active label={normalizedFileName} />
          </motion.div>
        ) : (status === "packing" || status === "paused") && fileProgress.length > 0 ? (
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
              const skipped = file.status === "skipped";

              return (
                <li key={file.name} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate font-mono text-muted-foreground">
                      {file.name}
                    </span>
                    <span
                      aria-hidden="true"
                      className="shrink-0 tabular-nums text-muted-foreground"
                    >
                      {skipped
                        ? "—"
                        : isIndeterminate
                          ? formatBytes(file.received)
                          : `${percent}%`}
                    </span>
                  </div>
                  <DownloadProgressBar
                    percent={percent}
                    active={status === "packing" && file.status === "downloading"}
                    label={file.name}
                    fillClassName={
                      isIndeterminate
                        ? status === "paused"
                          ? "bg-primary/30"
                          : "bg-primary/40"
                        : status === "paused"
                          ? "bg-primary/40"
                          : undefined
                    }
                  />
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
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="flex flex-col gap-1 text-sm text-muted-foreground"
          >
            {/* The status line above already announces completion; this row is
                the visual celebration, so it must not say it a second time. */}
            <p aria-hidden="true" className="flex items-center gap-1.5">
              <span className="shrink-0 text-emerald-500">
                <DrawnCheck size={16} />
              </span>
              {downloadsDictionary.completed}
            </p>
            <p className="text-xs">{downloadsDictionary.importHint}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
