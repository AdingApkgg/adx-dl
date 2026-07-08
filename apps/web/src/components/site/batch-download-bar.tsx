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
import { BATCH_FORMATS, type BatchArchiveFormat } from "@/lib/adx-archive";
import { isChartVideoFile, type ChartDownloadSpec } from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";
import { downloadJobStatusText } from "./downloads/download-status-text";
import { batchJobId, jobPercent, useDownloadsStore } from "./downloads/downloads-store";

/** Above this many charts, one click could start a multi-GB transfer — confirm first. */
const CONFIRM_THRESHOLD = 50;

type BatchDownloadBarProps = {
  /** The selected charts to pack, one folder per chart. */
  charts: ChartDownloadSpec[];
  /** Base name for the combined archive (e.g. the version label). */
  collectionName: string;
  locale: Locale;
  onClear: () => void;
};

export function BatchDownloadBar({
  charts,
  collectionName,
  locale,
  onClear,
}: BatchDownloadBarProps) {
  const dictionary = getDictionary(locale);
  const detail = dictionary.detail;
  const browser = dictionary.catalogBrowser;
  const tray = dictionary.downloads;
  const [includeVideo, setIncludeVideo] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  // Format chosen from the menu while a large selection awaits confirmation.
  const [pendingFormat, setPendingFormat] = React.useState<BatchArchiveFormat | null>(null);
  const barRef = React.useRef<HTMLDivElement | null>(null);

  // The pack+download runs in a module-level store so it keeps going after the
  // user navigates away from this page; we read the job back to drive the bar.
  const jobId = batchJobId(collectionName);
  const job = useDownloadsStore((state) => state.jobs.find((entry) => entry.id === jobId));
  const startBatch = useDownloadsStore((state) => state.startBatch);
  const resume = useDownloadsStore((state) => state.resume);
  const pause = useDownloadsStore((state) => state.pause);
  const dismiss = useDownloadsStore((state) => state.dismiss);
  const presentInline = useDownloadsStore((state) => state.presentInline);
  const unpresentInline = useDownloadsStore((state) => state.unpresentInline);
  const presentBottomBar = useDownloadsStore((state) => state.presentBottomBar);
  const unpresentBottomBar = useDownloadsStore((state) => state.unpresentBottomBar);

  const count = charts.length;
  const fileStats = React.useMemo(() => {
    let totalFiles = 0;
    let videoFiles = 0;
    for (const chart of charts) {
      for (const file of chart.files) {
        totalFiles += 1;
        if (isChartVideoFile(file.name)) {
          videoFiles += 1;
        }
      }
    }
    return { totalFiles, videoFiles };
  }, [charts]);
  const selectedFileCount = includeVideo
    ? fileStats.totalFiles
    : fileStats.totalFiles - fileStats.videoFiles;
  const hasVideoFiles = fileStats.videoFiles > 0;
  const status = job?.status ?? "idle";
  const isBusy = status === "packing" || status === "archiving";
  const isResumable = status === "paused" || status === "error";
  const progress = { completed: job?.completed ?? 0, total: job?.total ?? 0 };
  const statusText = job ? downloadJobStatusText(job, detail, tray) : "";
  const canDownload = count > 0 && !isBusy && !isResumable;

  // Hide this job from the floating tray while the bar itself is on screen.
  const hasJob = job != null;
  React.useEffect(() => {
    if (!hasJob) {
      return;
    }
    presentInline(jobId);
    return () => unpresentInline(jobId);
  }, [hasJob, jobId, presentInline, unpresentInline]);

  // Tell the floating tray a full-width bottom bar is on screen so it lifts
  // itself above instead of overlapping on phones.
  React.useEffect(() => {
    presentBottomBar();
    return () => unpresentBottomBar();
  }, [presentBottomBar, unpresentBottomBar]);

  React.useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) {
      return;
    }
    const root = document.documentElement;
    const updateHeight = () => {
      root.style.setProperty("--batch-download-bar-height", `${Math.ceil(bar.offsetHeight)}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--batch-download-bar-height");
    };
  }, []);

  React.useEffect(() => {
    if (!confirmDiscard) {
      return;
    }
    const timer = window.setTimeout(() => setConfirmDiscard(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmDiscard]);

  function handleSelect(format: BatchArchiveFormat) {
    if (!canDownload) {
      return;
    }
    // Select-all makes a multi-gigabyte transfer one click away — above the
    // threshold, ask once before committing.
    if (count > CONFIRM_THRESHOLD) {
      setPendingFormat(format);
      return;
    }
    startBatch({ id: jobId, title: collectionName, charts, includeVideo, format });
  }

  function confirmPending() {
    if (pendingFormat === null) {
      return;
    }
    startBatch({ id: jobId, title: collectionName, charts, includeVideo, format: pendingFormat });
    setPendingFormat(null);
  }

  const percent = job ? jobPercent(job) : 0;

  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex justify-center px-4"
    >
      <div
        ref={barRef}
        className="flex w-full max-w-xl flex-col gap-2 rounded-2xl border border-border/70 bg-popover/95 p-3 shadow-lg ring-1 ring-foreground/5 backdrop-blur"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium tabular-nums">
            {browser.selectedCount(count)}
          </span>
          <span className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={isBusy}>
            <XIcon data-icon="inline-start" />
            {browser.clearSelection}
          </Button>
          {isResumable ? (
            <>
              <Button type="button" size="sm" onClick={() => resume(jobId)}>
                <RotateCwIcon data-icon="inline-start" />
                {tray.resume}
                {percent > 0 ? ` · ${percent}%` : null}
              </Button>
              <Button
                type="button"
                variant={confirmDiscard ? "destructive" : "ghost"}
                size="icon"
                aria-label={confirmDiscard ? tray.confirmDiscard : tray.cancel}
                title={confirmDiscard ? tray.confirmDiscard : tray.cancel}
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
            </>
          ) : (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" disabled={!canDownload || isBusy}>
                    <DownloadIcon data-icon="inline-start" />
                    {status === "archiving"
                      ? tray.archiving
                      : isBusy
                        ? detail.downloadPacking(progress.completed, progress.total)
                        : browser.batchDownload}
                    {canDownload ? (
                      <ChevronDownIcon data-icon="inline-end" className="opacity-70" />
                    ) : null}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{detail.downloadFormatLabel}</DropdownMenuLabel>
                  {BATCH_FORMATS.map((format) => (
                    <DropdownMenuItem
                      key={format}
                      onSelect={() => handleSelect(format)}
                      className="justify-between gap-4"
                    >
                      <span className="font-mono">.{format}</span>
                      {format === "adx" ? (
                        <span className="text-xs text-muted-foreground">
                          {detail.formatHintAdx}
                        </span>
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  {hasVideoFiles ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuCheckboxItem
                        checked={includeVideo}
                        onCheckedChange={(value) => setIncludeVideo(value === true)}
                        onSelect={(event) => event.preventDefault()}
                      >
                        {detail.downloadIncludeVideo}
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
                  aria-label={tray.pause}
                  title={tray.pause}
                  onClick={() => pause(jobId)}
                >
                  <PauseIcon />
                </Button>
              ) : null}
            </>
          )}
        </div>

        {!isBusy && !isResumable && status !== "success" ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{tray.batchSummary(count, selectedFileCount)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {includeVideo && hasVideoFiles
                ? tray.batchVideoSummary(fileStats.videoFiles)
                : tray.batchNoVideoSummary}
            </span>
          </div>
        ) : null}

        <AnimatePresence mode="wait">
          {pendingFormat !== null && !isBusy ? (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0 flex-1 text-xs text-muted-foreground">
                <p>{tray.batchConfirm(count, includeVideo)}</p>
                {includeVideo && hasVideoFiles ? (
                  <p className="mt-0.5">{tray.batchVideoLargeHint}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingFormat(null)}
                >
                  {tray.cancel}
                </Button>
                <Button type="button" size="sm" onClick={confirmPending}>
                  {tray.batchConfirmStart}
                </Button>
              </div>
            </motion.div>
          ) : status === "archiving" ? (
            <motion.div
              key="archiving"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="overflow-hidden"
            >
              <div
                role="progressbar"
                aria-label={collectionName}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full w-full animate-pulse rounded-full bg-primary/60" />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{statusText}</p>
            </motion.div>
          ) : status === "packing" || status === "paused" ? (
            <motion.div
              key="progress"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="overflow-hidden"
            >
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={collectionName}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={
                    status === "paused"
                      ? "h-full rounded-full bg-primary/40 transition-[width] duration-150 ease-out"
                      : "h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                  }
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{statusText}</p>
            </motion.div>
          ) : status === "success" ? (
            <motion.p
              key="success"
              role="status"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="text-xs text-muted-foreground"
            >
              {tray.completed}
            </motion.p>
          ) : status === "error" ? (
            <motion.p
              key="error"
              role="status"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="text-xs text-destructive"
              title={job?.error ?? undefined}
            >
              {statusText}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
