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
import { useSpring } from "framer-motion";

import { AnimatePresence, DrawnCheck, EASE_OUT, motion, useReducedMotion } from "@/components/motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BATCH_FORMATS, type BatchArchiveFormat } from "@/lib/adx-archive-shared";
import {
  isChartVideoFile,
  sumChartDownloadBytes,
  type ChartDownloadSpec,
} from "@/lib/catalog-shared";
import { formatBytes } from "./downloads/format-bytes";
import {
  readStorageEstimate,
  storageHeadroom,
  type StorageEstimateSnapshot,
} from "./downloads/storage-estimate";
import { getDictionary, type Locale } from "@/lib/i18n";
import {
  DownloadSourceMenu,
  DownloadSourceSummary,
} from "./downloads/download-source-selector";
import {
  downloadJobMetricsText,
  downloadJobStateText,
} from "./downloads/download-status-text";
import { DownloadJobNotes } from "./downloads/download-job-notes";
import {
  chartGroupingDir,
  newBatchJobId,
  summarizeDownloadJobs,
  useDownloadsStore,
} from "./downloads/downloads-store";

/** Above this many charts, one click could start a multi-GB transfer — confirm first. */
const CONFIRM_THRESHOLD = 50;

// Spring-driven progress fill rendered as scaleX (GPU) instead of an animated
// width, so the bar glides between store updates. The parent track keeps
// role=progressbar / aria-valuenow bound to the raw store percent.
function ProgressFill({ percent, className }: { percent: number; className?: string }) {
  // MotionConfig's reducedMotion doesn't gate style-bound motion values — jump
  // the spring manually so reduced-motion users get instant updates.
  const reduced = useReducedMotion();
  const scaleX = useSpring(percent / 100, { stiffness: 180, damping: 28 });
  React.useEffect(() => {
    if (reduced) {
      scaleX.jump(percent / 100);
    } else {
      scaleX.set(percent / 100);
    }
  }, [percent, reduced, scaleX]);
  return (
    <motion.div
      className={cn("h-full w-full origin-left", className)}
      style={{ scaleX }}
    />
  );
}

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
  const selectedSourceId = useDownloadsStore((state) => state.selectedSourceId);
  const setSelectedSourceId = useDownloadsStore((state) => state.setSelectedSourceId);
  const preferredFormat = useDownloadsStore((state) => state.preferredFormat);
  const grouping = useDownloadsStore((state) => state.preferredBatchGrouping);
  const setGrouping = useDownloadsStore((state) => state.setPreferredBatchGrouping);

  // The pack+download runs in a module-level store so it keeps going after the
  // user navigates away from this page. The bar only tracks the jobs it started
  // itself (unique ids per start) — a batch running from another page stays in
  // the floating tray instead of being adopted by (and conflicting with) this
  // bar's own selection and controls. A selection spanning several versions or
  // genres queues one job per group, so this is a set, not a single job.
  const [jobIds, setJobIds] = React.useState<readonly string[]>([]);
  const allJobs = useDownloadsStore((state) => state.jobs);
  const jobs = React.useMemo(
    () =>
      jobIds
        .map((id) => allJobs.find((entry) => entry.id === id))
        .filter((entry): entry is (typeof allJobs)[number] => entry !== undefined),
    [allJobs, jobIds]
  );
  const startBatch = useDownloadsStore((state) => state.startBatch);
  const resume = useDownloadsStore((state) => state.resume);
  const restartWithSource = useDownloadsStore((state) => state.restartWithSource);
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
  // Selecting the whole library is 8.9 GB without BGA and 35.6 GB with — a
  // number the user has to see before committing, not after. The sum is over
  // the selection (not the toggle), so flipping BGA only re-adds a term.
  const selectionBytes = React.useMemo(() => sumChartDownloadBytes(charts), [charts]);
  const quotedBytes =
    selectionBytes.baseBytes + (includeVideo ? selectionBytes.videoBytes : 0);
  const sizeHint =
    quotedBytes > 0
      ? includeVideo && selectionBytes.videoBytes > 0
        ? detail.sizeEstimateWithVideo(
            formatBytes(quotedBytes),
            formatBytes(selectionBytes.videoBytes)
          )
        : detail.sizeEstimate(formatBytes(quotedBytes))
      : null;
  // Free space is checked at the confirmation step (see handleSelect): the
  // bytes are held twice at peak — as resumable checkpoints and again as the
  // archive Blob — and an over-quota write surfaces as a job that fails near
  // the end for no stated reason.
  const [storageEstimate, setStorageEstimate] =
    React.useState<StorageEstimateSnapshot | null>(null);
  const headroom = storageHeadroom(storageEstimate, quotedBytes);
  const storageWarning =
    headroom.availableBytes === null || headroom.level === "ok"
      ? null
      : headroom.level === "insufficient"
        ? tray.storageInsufficient(
            formatBytes(headroom.availableBytes),
            formatBytes(quotedBytes)
          )
        : tray.storageTight(formatBytes(headroom.availableBytes));

  // A selection spanning multiple grouping folders (versions or genres) saves
  // one archive per folder (see splitBatchArchives) — tell the user up front.
  const groupCount = React.useMemo(
    () => new Set(charts.map((chart) => chartGroupingDir(chart, grouping))).size,
    [charts, grouping]
  );
  const summary = React.useMemo(() => summarizeDownloadJobs(jobs), [jobs]);
  const status = summary.status;
  const isBusy = status === "packing" || status === "archiving" || status === "queued";
  const isResumable = status === "paused" || status === "error";
  const progress = React.useMemo(
    () =>
      jobs.reduce(
        (totals, entry) => ({
          completed: totals.completed + entry.completed,
          total: totals.total + entry.total,
        }),
        { completed: 0, total: 0 }
      ),
    [jobs]
  );
  // Split for the live region below: the coarse phase is what assistive tech
  // should hear, and the byte/rate/ETA numbers change too often to belong in a
  // region that re-reads its whole contents on every patch.
  const stateText =
    jobs.length === 0
      ? ""
      : jobs.length === 1
        ? downloadJobStateText(jobs[0], detail, tray)
        : status === "success"
          ? tray.completed
          : tray.queueSummary(summary.done, summary.total);
  const metricsText =
    jobs.length === 1
      ? downloadJobMetricsText(jobs[0], tray)
      : jobs.length > 1 && status !== "success"
        ? `${summary.percent}%`
        : "";
  const statusText = metricsText ? `${stateText} · ${metricsText}` : stateText;
  const failedJob = jobs.find((entry) => entry.status === "error");
  const canDownload = count > 0 && !isBusy && !isResumable;

  // Hide these jobs from the floating tray while the bar itself is on screen.
  // Keyed by a joined string so the effect doesn't re-run on array identity.
  const presentedKey = jobs.map((entry) => entry.id).join("\u0000");
  React.useEffect(() => {
    if (presentedKey === "") {
      return;
    }
    const ids = presentedKey.split("\u0000");
    for (const id of ids) {
      presentInline(id);
    }
    return () => {
      for (const id of ids) {
        unpresentInline(id);
      }
    };
  }, [presentedKey, presentInline, unpresentInline]);

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

  function beginBatch(format: BatchArchiveFormat) {
    // Finished runs from this bar are done communicating — clear them instead
    // of letting them pop into the tray as stale success rows.
    for (const entry of jobs) {
      if (entry.status === "success") {
        dismiss(entry.id);
      }
    }
    setJobIds(
      startBatch({
        id: newBatchJobId(),
        title: collectionName,
        charts,
        includeVideo,
        format,
        sourceId: selectedSourceId,
        grouping,
      })
    );
  }

  function handleSelect(format: BatchArchiveFormat) {
    if (!canDownload) {
      return;
    }
    // Select-all makes a multi-gigabyte transfer one click away — above the
    // threshold, ask once before committing.
    if (count > CONFIRM_THRESHOLD) {
      setPendingFormat(format);
      // The estimate is only read when a confirmation is actually shown:
      // navigator.storage.estimate() is not free, and quoting free space next
      // to a three-chart download would be noise.
      void readStorageEstimate().then(setStorageEstimate);
      return;
    }
    beginBatch(format);
  }

  function confirmPending() {
    if (pendingFormat === null) {
      return;
    }
    beginBatch(pendingFormat);
    setPendingFormat(null);
  }

  const percent = summary.percent;
  // Every control acts on the whole set this bar started; per-job controls live
  // in the floating tray.
  const resumeAll = (): void => {
    for (const entry of jobs) {
      if (entry.status === "paused" || entry.status === "error") {
        resume(entry.id);
      }
    }
  };
  const pauseAll = (): void => {
    for (const entry of jobs) {
      pause(entry.id);
    }
  };
  const dismissAll = (): void => {
    for (const entry of jobs) {
      dismiss(entry.id);
    }
  };
  const restartAllWithSource = (sourceId: Parameters<typeof restartWithSource>[1]): void => {
    for (const entry of jobs) {
      if (entry.status === "paused" || entry.status === "error") {
        restartWithSource(entry.id, sourceId);
      }
    }
  };

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
              <Button type="button" size="sm" onClick={resumeAll}>
                <RotateCwIcon data-icon="inline-start" />
                {tray.resume}
                {percent > 0 ? ` · ${percent}%` : null}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={tray.sourcePicker.switchAndRestart}
                    title={tray.sourcePicker.restartHint}
                  >
                    <ArrowLeftRightIcon data-icon="inline-start" />
                    {tray.sourcePicker.switchAndRestart}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  collisionPadding={8}
                  className="max-h-[min(28rem,calc(100dvh-5rem))] w-[min(20rem,calc(100vw-2rem))] overscroll-contain"
                >
                  <DownloadSourceMenu
                    value={jobs[0]?.sourceId ?? selectedSourceId}
                    sourceBaseUrl={jobs[0]?.sourceBaseUrl}
                    onValueChange={restartAllWithSource}
                    copy={tray.sourcePicker}
                    hint={tray.sourcePicker.restartHint}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant={confirmDiscard ? "destructive" : "ghost"}
                size="icon"
                aria-label={confirmDiscard ? tray.confirmDiscard : tray.cancel}
                title={confirmDiscard ? tray.confirmDiscard : tray.cancel}
                onClick={() => {
                  if (confirmDiscard) {
                    dismissAll();
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
              <div data-slot="button-group" className="inline-flex">
                <Button
                  type="button"
                  size="sm"
                  disabled={!canDownload || isBusy}
                  onClick={() => handleSelect(preferredFormat)}
                  className="rounded-r-none"
                >
                  <DownloadIcon data-icon="inline-start" />
                  {status === "archiving"
                    ? `${tray.archiving} · ${percent}%`
                    : isBusy
                      ? detail.downloadPacking(progress.completed, progress.total)
                      : browser.batchDownload}
                  {canDownload ? (
                    <span className="font-mono text-[11px] opacity-75">
                      .{preferredFormat}
                    </span>
                  ) : null}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      disabled={!canDownload || isBusy}
                      aria-label={detail.downloadFormatLabel}
                      title={detail.downloadFormatLabel}
                      className="-ml-px rounded-l-none border-l border-primary-foreground/25 px-0"
                    >
                      <ChevronDownIcon className="opacity-80" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    collisionPadding={8}
                    className="max-h-[min(28rem,calc(100dvh-5rem))] w-[min(20rem,calc(100vw-2rem))] overscroll-contain"
                  >
                    <DownloadSourceMenu
                      value={selectedSourceId}
                      onValueChange={setSelectedSourceId}
                      copy={tray.sourcePicker}
                    />
                    <DropdownMenuSeparator />
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
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>{tray.groupingLabel}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={grouping}
                      onValueChange={(value) =>
                        setGrouping(value === "genre" ? "genre" : "version")
                      }
                    >
                      <DropdownMenuRadioItem
                        value="version"
                        onSelect={(event) => event.preventDefault()}
                      >
                        {tray.groupingVersion}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem
                        value="genre"
                        onSelect={(event) => event.preventDefault()}
                      >
                        {tray.groupingGenre}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
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
              </div>
              {status === "packing" || status === "queued" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tray.pause}
                  title={tray.pause}
                  onClick={pauseAll}
                >
                  <PauseIcon />
                </Button>
              ) : null}
            </>
          )}
        </div>

        <DownloadSourceSummary
          sourceId={jobs[0]?.sourceId ?? selectedSourceId}
          sourceBaseUrl={jobs[0]?.sourceBaseUrl}
          sourceName={jobs[0]?.sourceName}
          copy={tray.sourcePicker}
          className="w-fit"
        />

        {!isBusy && !isResumable && status !== "success" ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{tray.batchSummary(count, selectedFileCount)}</span>
            {sizeHint ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{sizeHint}</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>
              {includeVideo && hasVideoFiles
                ? tray.batchVideoSummary(fileStats.videoFiles)
                : tray.batchNoVideoSummary}
            </span>
            {groupCount > 1 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {grouping === "genre"
                    ? tray.batchSplitSummaryGenre(groupCount)
                    : tray.batchSplitSummary(groupCount)}
                </span>
              </>
            ) : null}
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
                <p>
                  {tray.batchConfirm(count, includeVideo)}
                  {sizeHint ? <span className="ml-1 tabular-nums">{sizeHint}</span> : null}
                </p>
                {includeVideo && hasVideoFiles ? (
                  <p className="mt-0.5">{tray.batchVideoLargeHint}</p>
                ) : null}
                {storageWarning ? (
                  <p
                    className={cn(
                      "mt-0.5",
                      headroom.level === "insufficient"
                        ? "text-destructive"
                        : "text-amber-800 dark:text-amber-300"
                    )}
                  >
                    {storageWarning}
                  </p>
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
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={collectionName}
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <ProgressFill percent={percent} className="bg-primary" />
              </div>
              <p aria-hidden="true" className="mt-1.5 text-xs text-muted-foreground">
                {statusText}
              </p>
            </motion.div>
          ) : status === "packing" || status === "paused" || status === "queued" ? (
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
                <ProgressFill
                  percent={percent}
                  className={cn(
                    "transition-colors",
                    status === "paused" ? "bg-primary/40" : "bg-primary"
                  )}
                />
              </div>
              <p aria-hidden="true" className="mt-1.5 text-xs text-muted-foreground">
                {statusText}
              </p>
            </motion.div>
          ) : status === "success" ? (
            <motion.div
              key="success"
              aria-hidden="true"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              {/* Self-drawing check — the payoff moment for a finished batch. */}
              <DrawnCheck size={14} className="shrink-0 text-primary" />
              <span>{tray.completed}</span>
            </motion.div>
          ) : status === "error" ? (
            <motion.p
              key="error"
              aria-hidden="true"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="text-xs text-destructive"
            >
              {statusText}
            </motion.p>
          ) : null}
        </AnimatePresence>
        {/* Always mounted: a live region that appears together with its text is
            what most screen readers fail to announce, which is exactly how the
            terminal states used to go unreported. */}
        <p role="status" className="sr-only">
          {stateText}
        </p>
        {failedJob ? (
          <DownloadJobNotes job={failedJob} locale={locale} />
        ) : null}
      </div>
    </motion.div>
  );
}
