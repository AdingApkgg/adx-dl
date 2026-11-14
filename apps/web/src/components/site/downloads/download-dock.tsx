"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AlertCircleIcon,
  ArrowLeftRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  HistoryIcon,
  PauseIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";

import {
  AnimatePresence,
  DrawnCheck,
  MotionSurface,
  getSemanticTransition,
  getPressTarget,
  motionPresets,
  motionTokens,
  useMotionProgress,
  useMotionActivity,
  RollingNumber,
  motion,
  useReducedMotion,
} from "@astrodx/ui/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@astrodx/ui/components/dropdown-menu";
import { getDictionary, type Locale } from "@/lib/i18n";
import { cn } from "@astrodx/ui/lib/utils";
import { downloadManagerSummary } from "./download-manager-summary";
import { DownloadSourceMenu, DownloadSourceSummary } from "./download-source-selector";
import { useWakeLock } from "@/components/chart-preview/hooks/use-wake-lock";
import { jobPercent, useDownloadsStore } from "./downloads-store";
import { DownloadJobNotes, DownloadJobStatusLine, DownloadStorageNotice } from "./download-job-notes";
import { DownloadSaveAction } from "./download-save-action";
import { DownloadSupportPrompt } from "./download-support-prompt";
import { DownloadHistoryList } from "./download-history";

/**
 * Fired by a download trigger (with the button's viewport center) so the dock
 * can fly a ghost icon from the button into its corner.
 */
export const DOWNLOAD_STARTED_EVENT = "astrodx:download-started";

export type DownloadStartedDetail = { x: number; y: number };

const SOURCE_PROBE_REFRESH_MS = 5 * 60_000;

/**
 * The dock's icon buttons render outside the shared Button primitive, so they
 * inherited only theme.css's faint `*` outline (@astrodx/ui) — effectively
 * invisible for keyboard users. This is the same ring the primitives use.
 */
const DOCK_ICON_BUTTON_CLASS =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type DownloadProgressBarProps = {
  /** Raw store percent (0–100), or null when the total is unknown (indeterminate). */
  percent: number | null;
  /** True while bytes are actually moving — keeps the sweep highlight looping. */
  active: boolean;
  label: string;
  /** Fill tint override, e.g. the dimmed fill for paused jobs. */
  fillClassName?: string;
};

/**
 * Progress track shared by the dock rows and the inline chart-page button. The
 * fill uses bounded interpolation; aria values stay bound to the raw store numbers.
 */
export function DownloadProgressBar({
  percent,
  active,
  label,
  fillClassName,
}: DownloadProgressBarProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const motionActive = useMotionActivity(ref);
  const fraction = percent === null ? 1 : Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) / 100 : 0;
  const scaleX = useMotionProgress(fraction);

  return (
    <div
      ref={ref}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent === null ? undefined : fraction * 100}
      aria-label={label}
      className="relative h-1.5 w-full max-w-full overflow-hidden rounded-full bg-muted"
    >
      <motion.div
        className={cn("h-full w-full origin-left rounded-full", fillClassName ?? "bg-primary")}
        style={{ scaleX }}
      />
      <div
        aria-hidden="true"
        data-motion-loop="download-sweep"
        className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/25"
        style={{ animationPlayState: active && motionActive ? "running" : "paused", opacity: active && motionActive ? 1 : 0 }}
      />
    </div>
  );
}

/**
 * Dismissing a job that still holds completed-file checkpoints (paused/error) or is
 * actively downloading throws that data away, so the X arms a short-lived
 * confirm state and only a second click actually discards.
 */
function ConfirmDismissButton({
  onConfirm,
  label,
  confirmHint,
}: {
  onConfirm: () => void;
  label: string;
  confirmHint: string;
}) {
  const [armed, setArmed] = React.useState(false);
  const reducedMotion = useReducedMotion();
  const armedAt = React.useRef(0);
  const attentionAllowed = React.useRef(false);
  React.useEffect(() => { if (reducedMotion) attentionAllowed.current = false; }, [reducedMotion]);

  React.useEffect(() => {
    if (!armed) {
      return;
    }
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <motion.button
      type="button"
      whileTap={getPressTarget(reducedMotion)}
      onClick={() => {
        if (armed) {
          onConfirm();
        } else {
          attentionAllowed.current = !reducedMotion;
          armedAt.current = Date.now();
          setArmed(true);
        }
      }}
      aria-label={armed ? confirmHint : label}
      title={armed ? confirmHint : label}
      className={cn(
        "relative",
        DOCK_ICON_BUTTON_CLASS,
        armed && "bg-destructive/10 text-destructive"
      )}
    >
      {armed ? (
        // Countdown ring mirrors the 3s auto-disarm window; the timeout above
        // stays the source of truth.
        <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute inset-0 size-full -rotate-90">
          <motion.circle
            cx="12"
            cy="12"
            r="10.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            initial={reducedMotion ? false : { pathLength: 1 }}
            animate={{ pathLength: reducedMotion ? 1 : 0 }}
            transition={{ duration: reducedMotion ? 0 : Math.max(0, 3000 - (Date.now() - armedAt.current)) / 1000, ease: "linear" }}
          />
        </svg>
      ) : null}
      <motion.span
        className="flex"
        animate={{ x: armed && attentionAllowed.current && !reducedMotion ? [...motionPresets.feedback.attention.x] : 0 }}
        transition={{ duration: reducedMotion ? 0 : motionPresets.feedback.attention.durationMs / 1000, ease: motionTokens.easing.standard }}
      >
        <XIcon className="size-3.5" />
      </motion.span>
    </motion.button>
  );
}

/** Capture the first presentation; parent updates must not interrupt its draw. */
function DownloadSuccessMark({ animate }: { animate: boolean }) {
  const [animateOnMount] = React.useState(animate);
  return <DrawnCheck size={14} animateOnMount={animateOnMount} />;
}

type GhostFlight = {
  key: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
};

/**
 * A floating tray that keeps download progress visible no matter which page the
 * user is on. It shows jobs whose inline owner (the chart page button or the
 * batch bar) has unmounted — i.e. downloads still running after a navigation —
 * plus any `paused` job rehydrated from storage after a full reload, which can
 * skip whole files already downloaded and continue with the remaining files.
 */
export function DownloadDock({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const tray = dictionary.downloads;

  const jobs = useDownloadsStore((state) => state.jobs);
  const bottomBars = useDownloadsStore((state) => state.bottomBars);
  const dismiss = useDownloadsStore((state) => state.dismiss);
  const resume = useDownloadsStore((state) => state.resume);
  const restartWithSource = useDownloadsStore((state) => state.restartWithSource);
  const pause = useDownloadsStore((state) => state.pause);
  const hydrateFromStorage = useDownloadsStore((state) => state.hydrateFromStorage);
  const refreshSourceProbes = useDownloadsStore((state) => state.refreshSourceProbes);
  const resumeInterrupted = useDownloadsStore((state) => state.resumeInterrupted);
  const history = useDownloadsStore((state) => state.history);
  const [collapsed, setCollapsed] = React.useState(true);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const panelId = React.useId();
  const entryRef = React.useRef<HTMLButtonElement>(null);
  const collapseRef = React.useRef<HTMLButtonElement>(null);
  const transferFocus = React.useRef(false);
  React.useEffect(() => {
    if (!transferFocus.current) return;
    const target = collapsed ? entryRef.current : collapseRef.current;
    target?.focus({ preventScroll: true });
    transferFocus.current = false;
  }, [collapsed]);

  const reducedMotion = useReducedMotion();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [ghost, setGhost] = React.useState<GhostFlight | null>(null);
  const layoutId = React.useId();
  const seenSuccess = React.useRef(new Set<string>());
  React.useEffect(() => {
    for (const job of jobs) {
      if (job.status === "success") seenSuccess.current.add(`${job.id}:${job.startedAt}`);
    }
  }, [jobs]);
  const motionActive = useMotionActivity(containerRef);
  React.useEffect(() => {
    if (!motionActive) setGhost(null);
  }, [motionActive]);

  // Rehydrate interrupted downloads once, after mount (IndexedDB is client-only).
  React.useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  React.useEffect(() => {
    void refreshSourceProbes();
    const onOnline = () => void refreshSourceProbes(true);
    const onVisible = () => {
      if (!document.hidden) {
        void refreshSourceProbes();
      }
    };
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        void refreshSourceProbes();
      }
    }, SOURCE_PROBE_REFRESH_MS);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshSourceProbes]);

  // Backgrounding a phone mid-batch kills its connections, so returning to the
  // tab used to mean a wall of failures. Resume them once — a retry storm on a
  // genuinely broken network would be worse than the failures themselves, so
  // the throttle only lifts after the tab has been away again.
  const [resumedCount, setResumedCount] = React.useState(0);
  const resumeArmedRef = React.useRef(true);
  React.useEffect(() => {
    const attempt = () => {
      if (document.hidden) {
        resumeArmedRef.current = true;
        return;
      }
      if (!resumeArmedRef.current || navigator.onLine === false) {
        return;
      }
      resumeArmedRef.current = false;
      const resumed = resumeInterrupted();
      if (resumed > 0) {
        setResumedCount(resumed);
      }
    };
    document.addEventListener("visibilitychange", attempt);
    window.addEventListener("online", attempt);
    return () => {
      document.removeEventListener("visibilitychange", attempt);
      window.removeEventListener("online", attempt);
    };
  }, [resumeInterrupted]);

  React.useEffect(() => {
    if (resumedCount === 0) {
      return;
    }
    const timer = window.setTimeout(() => setResumedCount(0), 8000);
    return () => window.clearTimeout(timer);
  }, [resumedCount]);

  React.useEffect(() => {
    const onStarted = (event: Event) => {
      const startDetail = (event as CustomEvent<DownloadStartedDetail>).detail;
      if (!startDetail || !motionActive) {
        return;
      }
      const corner = containerRef.current?.getBoundingClientRect();
      const to = corner
        ? { x: corner.right - 28, y: corner.bottom - 28 }
        : { x: window.innerWidth - 44, y: window.innerHeight - 44 };
      setGhost({ key: Date.now(), from: { x: startDetail.x, y: startDetail.y }, to });
    };
    window.addEventListener(DOWNLOAD_STARTED_EVENT, onStarted);
    return () => window.removeEventListener(DOWNLOAD_STARTED_EVENT, onStarted);
  }, [motionActive]);

  const visible = jobs;
  const summaryText = downloadManagerSummary(visible, tray);
  const activeCount = visible.filter(
    (job) =>
      job.status === "packing" ||
      job.status === "archiving" ||
      job.status === "queued"
  ).length;
  // Packing and archiving are both long stretches with no touch input; a phone
  // that sleeps mid-way loses its connections and the run has to be resumed.
  useWakeLock(
    jobs.some((job) => job.status === "packing" || job.status === "archiving")
  );
  const aggregatePercent =
    visible.length > 0
      ? Math.round(visible.reduce((sum, job) => sum + jobPercent(job), 0) / visible.length)
      : 0;
  const baseOffset = "calc(var(--floating-bottom) + var(--music-player-mobile-reserve, 0rem))";
  const stackedOffset = bottomBars > 0
    ? "calc(var(--batch-download-bar-height, 5rem) + var(--floating-bottom) + var(--music-player-mobile-reserve, 0rem) + 0.75rem)"
    : baseOffset;
  // Expanded tasks may cover the batch bar instead of losing their scroll area.
  // Keep the collapsed entry reachable even when a bottom surface is very tall.
  const bottomOffset = collapsed
    ? `min(${stackedOffset}, calc(100dvh - 12rem))`
    : baseOffset;

  return (
    <div
      data-slot="download-dock"
      ref={containerRef}
      className={cn(
        // Safe-area aware, and lifted above the batch bar when one is on screen
        // so the fixed bottom surfaces never overlap on phones.
        "adx-material adx-download-dock pointer-events-none fixed right-4 z-50 flex w-[calc(100vw-2rem)] max-w-[26rem] flex-col items-end gap-2"
      )}
      style={{
        bottom: bottomOffset,
        // Own view-transition-name = pinned during page transitions (see
        // globals.css) instead of blinking with the root snapshot.
        viewTransitionName: "download-dock",
      }}
    >
      {/* popLayout pops the outgoing pill/panel out of the flex flow, so the
          incoming one measures its final box and the shared layoutId can morph
          cleanly between the two shapes. */}
      <AnimatePresence initial={false} mode="popLayout">
        {visible.length > 0 || history.length > 0 ? (
          collapsed || (visible.length === 0 && !historyOpen) ? (
            <MotionSurface as="button" pattern="reveal"
              key="tray-collapsed"
              ref={entryRef}
              layoutId={reducedMotion ? undefined : layoutId}
              type="button"

              transition={getSemanticTransition("layout", reducedMotion)}
              // borderRadius lives in style so the pill↔panel morph animates it.
              style={{ borderRadius: 4 }}
              whileTap={getPressTarget(reducedMotion)}
              onClick={() => {
                transferFocus.current = true;
                setCollapsed(false);
                if (visible.length === 0) setHistoryOpen(true);
              }}
              aria-label={visible.length > 0 ? `${tray.expand} · ${summaryText}` : tray.historyTitle}
              aria-expanded={false}
              aria-controls={panelId}
              className="adx-download-entry pointer-events-auto relative isolate flex min-h-11 max-w-full flex-wrap justify-end items-center gap-2 border border-border/70 bg-popover/95 px-3 py-2 text-xs font-medium shadow-lg ring-1 ring-foreground/5"
            >
              {visible.length > 0 ? (
                <><DownloadIcon className="size-3.5" /><RollingNumber value={visible.length} format={tray.jobsCount} /></>
              ) : (
                <><HistoryIcon className="size-3.5" />{tray.historyTitle}</>
              )}
              {activeCount > 0 && !visible.some((job) => job.status === "archiving") ? (
                <RollingNumber
                  value={aggregatePercent}
                  format={(n) => `${n}%`}
                  className="tabular-nums text-muted-foreground"
                />
              ) : null}
              {visible.length > 0 ? <span className={cn("min-w-0 text-xs", visible.some((job) => job.status === "error") ? "text-destructive" : "text-muted-foreground")}>{summaryText}</span> : null}
              <ChevronUpIcon className="size-3.5 text-muted-foreground" />
            </MotionSurface>
          ) : (
            <MotionSurface as="div" pattern="reveal"
              key="tray"
              id={panelId}
              role="region"
              aria-label={tray.trayTitle}
              data-download-manager
              layoutId={reducedMotion ? undefined : layoutId}
              transition={getSemanticTransition("layout", reducedMotion)}
              style={{ borderRadius: 4, maxHeight: `min(36rem, calc(100dvh - ${bottomOffset} - 6rem))` }}
              className="pointer-events-auto relative isolate flex w-full flex-col overflow-hidden border border-border/70 bg-popover p-0 shadow-lg ring-1 ring-foreground/5"
            >
              <div data-download-manager-header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-sm font-semibold">
                <DownloadIcon className="size-4" />
                <h2>{tray.trayTitle}</h2>
                <span className="text-xs font-normal text-muted-foreground">{tray.jobsCount(visible.length)}</span>
                <span className="flex-1" />
                <motion.button
                  type="button"
                  whileTap={getPressTarget(reducedMotion)}
                  ref={collapseRef}
                  onClick={() => { transferFocus.current = true; setCollapsed(true); }}
                  aria-label={tray.collapse}
                  title={tray.collapse}
                  className={DOCK_ICON_BUTTON_CLASS}
                >
                  <ChevronDownIcon className="size-3.5" />
                </motion.button>
              </div>
              <div data-download-manager-body className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-4">
              {/* Tray-wide notices. The auto-resume line is in its own live
                  region because it reports something the app did on its own,
                  which no per-job status line would ever announce. */}
              <p role="status" className="sr-only">
                {resumedCount > 0 ? tray.autoResumed(resumedCount) : ""}
              </p>
              {resumedCount > 0 ? (
                <p aria-hidden="true" className="text-[11px] text-muted-foreground">
                  {tray.autoResumed(resumedCount)}
                </p>
              ) : null}
              <DownloadStorageNotice locale={locale} />
              {/* overscroll-contain keeps a flick at either end inside the tray
                  instead of scrolling the page underneath it. */}
              <ul className="relative flex shrink-0 flex-col gap-3">
                <AnimatePresence initial={false} mode="popLayout">
                  {visible.map((job) => {
                    const percent = jobPercent(job);
                    const resumable = job.status === "paused" || job.status === "error";
                    // A queued job can be pulled out of the queue with the same
                    // pause control, before it ever opens a connection.
                    const active = job.status === "packing" || job.status === "queued";
                    const canDismissImmediately = job.status === "success" &&
                      !(job.mobileBatch && job.archives?.length);

                    return (
                      <MotionSurface as="li" pattern="popup"
                        key={job.id}

                        layout={!reducedMotion && visible.length <= 12}
                        transition={getSemanticTransition("layout", reducedMotion)}
                        // Completed rows can also be swiped away; the X button
                        // stays as the accessible path.
                        drag={canDismissImmediately ? "x" : false}
                        dragDirectionLock
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={{ left: 0.08, right: 0.7 }}
                        onDragEnd={(_, info) => {
                          if (
                            canDismissImmediately &&
                            (info.offset.x > 72 || info.velocity.x > 600)
                          ) {
                            dismiss(job.id);
                          }
                        }}
                        // shrink-0 is load-bearing: as flex items these rows
                        // would otherwise compress to fit max-h instead of
                        // overflowing, so a long queue squeezed every row into
                        // a clipped sliver and the list never became scrollable.
                        data-download-task
                        className="ui-surface relative flex shrink-0 flex-col gap-3 overflow-hidden p-3"
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          {job.status === "success" ? (
                            <span className="relative flex size-3.5 shrink-0 items-center justify-center text-emerald-500">
                              <DownloadSuccessMark key={`${job.id}:${job.startedAt}`} animate={!seenSuccess.current.has(`${job.id}:${job.startedAt}`)} />
                            </span>
                          ) : job.status === "error" ? (
                            <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
                          ) : null}
                          <span className="min-w-0 flex-1 break-words text-sm font-medium">{job.title}</span>
                        </div>
                            <MotionSurface as="span" pattern="popup"
                              key={job.status}
                              data-download-task-actions
                              className="flex w-full flex-wrap items-center gap-2"

                            >
                              {resumable ? (
                                <>
                                  <motion.button
                                    type="button"
                                    whileTap={getPressTarget(reducedMotion)}
                                    onClick={() => resume(job.id)}
                                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                  >
                                    <RotateCwIcon className="size-3" />
                                    {job.status === "error" ? tray.retry : tray.resume}
                                  </motion.button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <motion.button
                                        type="button"
                                        whileTap={getPressTarget(reducedMotion)}
                                        aria-label={tray.sourcePicker.switchAndRestart}
                                        title={tray.sourcePicker.restartHint}
                                        className={cn(DOCK_ICON_BUTTON_CLASS, "w-auto gap-2 border border-border px-3 text-xs")}
                                      >
                                        <ArrowLeftRightIcon className="size-3.5" />
                                        {tray.sourcePicker.switchAndRestart}
                                      </motion.button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                      data-material-download-menu
                                      align="end"
                                      collisionPadding={8}
                                      className="max-h-[min(28rem,calc(100dvh-5rem))] w-[min(20rem,calc(100vw-2rem))] overscroll-contain"
                                    >
                                      <DownloadSourceMenu
                                        value={job.sourceId}
                                        sourceBaseUrl={job.sourceBaseUrl}
                                        onValueChange={(sourceId) =>
                                          restartWithSource(job.id, sourceId)
                                        }
                                        copy={tray.sourcePicker}
                                        hint={tray.sourcePicker.restartHint}
                                      />
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </>
                              ) : null}
                              {active ? (
                                <motion.button
                                  type="button"
                                  whileTap={getPressTarget(reducedMotion)}
                                  onClick={() => pause(job.id)}
                                  aria-label={tray.pause}
                                  title={tray.pause}
                                  className={DOCK_ICON_BUTTON_CLASS}
                                >
                                  <PauseIcon className="size-3.5" />
                                </motion.button>
                              ) : null}
                              {canDismissImmediately ? (
                                <motion.button
                                  type="button"
                                  whileTap={getPressTarget(reducedMotion)}
                                  onClick={() => dismiss(job.id)}
                                  aria-label={tray.dismiss}
                                  title={tray.dismiss}
                                  className={DOCK_ICON_BUTTON_CLASS}
                                >
                                  <XIcon className="size-3.5" />
                                </motion.button>
                              ) : job.status !== "archiving" ? (
                                <ConfirmDismissButton
                                  onConfirm={() => dismiss(job.id)}
                                  label={tray.cancel}
                                  confirmHint={tray.confirmDiscard}
                                />
                              ) : null}
                            </MotionSurface>
                        <DownloadSourceSummary
                          sourceId={job.sourceId}
                          sourceBaseUrl={job.sourceBaseUrl}
                          sourceName={job.sourceName}
                          copy={tray.sourcePicker}
                          className="w-fit"
                        />
                        <DownloadJobStatusLine job={job} locale={locale} />
                        <DownloadSaveAction jobs={[job]} locale={locale} />
                        <DownloadJobNotes job={job} locale={locale} />
                        {job.status === "packing" ||
                        job.status === "paused" ||
                        job.status === "archiving" ? (
                          <DownloadProgressBar
                            percent={job.status === "archiving" ? null : percent}
                            active={job.status === "packing" || job.status === "archiving"}
                            label={job.title}
                            fillClassName={job.status === "paused" ? "bg-primary/40" : undefined}
                          />
                        ) : null}
                      </MotionSurface>
                    );
                  })}
                </AnimatePresence>
              </ul>
              <DownloadSupportPrompt locale={locale} statuses={visible.map((job) => job.status)} />
              {history.length > 0 ? (
                <div className="border-t border-border/60 pt-2">
                  <button
                    type="button"
                    onClick={() => setHistoryOpen((open) => !open)}
                    aria-expanded={historyOpen}
                    className="inline-flex min-h-11 w-full items-center gap-1.5 rounded-md px-1 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <HistoryIcon className="size-3" aria-hidden="true" />
                    {tray.historyTitle}
                    <ChevronDownIcon
                      aria-hidden="true"
                      className={cn(
                        "ml-auto size-3 transition-transform",
                        historyOpen && "rotate-180"
                      )}
                    />
                  </button>
                  {historyOpen ? (
                    <DownloadHistoryList locale={locale} className="mt-1.5" />
                  ) : null}
                </div>
              ) : null}
              </div>
            </MotionSurface>
          )
        ) : null}
      </AnimatePresence>
      {ghost && motionActive
        ? createPortal(
            <motion.span
              data-motion-feedback="download-flight"
              key={ghost.key}
              aria-hidden="true"
              className="pointer-events-none fixed left-0 top-0 z-[60] text-primary"
              initial={{ x: ghost.from.x - 12, y: ghost.from.y - 12, scale: 1.15, opacity: 1 }}
              animate={{ x: ghost.to.x - 12, y: ghost.to.y - 12, scale: 0.45, opacity: 0.85 }}
              transition={getSemanticTransition("layout", reducedMotion)}
              onAnimationComplete={() => {
                setGhost(null);
              }}
            >
              <DownloadIcon className="size-6" />
            </motion.span>,
            document.body
          )
        : null}
    </div>
  );
}
