"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { animate, useMotionValue, useSpring } from "framer-motion";
import {
  AlertCircleIcon,
  ArrowLeftRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  PauseIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";

import {
  AnimatePresence,
  DrawnCheck,
  EASE_OUT,
  RollingNumber,
  motion,
  springSoft,
  useReducedMotion,
} from "@/components/motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getDictionary, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { DownloadSourceMenu, DownloadSourceSummary } from "./download-source-selector";
import { jobPercent, useDownloadsStore } from "./downloads-store";
import { downloadJobStatusText } from "./download-status-text";

/**
 * Fired by a download trigger (with the button's viewport center) so the dock
 * can fly a ghost icon from the button into its corner.
 */
export const DOWNLOAD_STARTED_EVENT = "astrodx:download-started";

export type DownloadStartedDetail = { x: number; y: number };

const SOURCE_PROBE_REFRESH_MS = 5 * 60_000;

/** True while the tab is visible — stops infinite sweep loops in hidden tabs. */
function usePageVisible(): boolean {
  const [visible, setVisible] = React.useState(true);
  React.useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

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
 * fill is a spring-driven scaleX (transform-only, replacing the old width
 * transition); aria values stay bound to the raw store numbers.
 */
export function DownloadProgressBar({
  percent,
  active,
  label,
  fillClassName,
}: DownloadProgressBarProps) {
  const reduced = useReducedMotion();
  const pageVisible = usePageVisible();
  const fraction = percent === null ? 1 : Math.min(100, Math.max(0, percent)) / 100;
  const target = useMotionValue(fraction);
  const spring = useSpring(target, { stiffness: 240, damping: 34, mass: 0.8 });

  React.useEffect(() => {
    target.set(fraction);
  }, [fraction, target]);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-label={label}
      className="relative h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <motion.div
        className={cn("h-full w-full origin-left rounded-full", fillClassName ?? "bg-primary")}
        // Style-bound motion values bypass MotionConfig's reducedMotion, so
        // reduced motion binds the raw target (instant) instead of the spring.
        style={{ scaleX: reduced ? target : spring }}
      />
      {active && !reduced && pageVisible ? (
        <motion.div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/25"
          initial={{ x: "-110%" }}
          animate={{ x: "320%" }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "linear", repeatDelay: 0.4 }}
        />
      ) : null}
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
      whileTap={{ scale: 0.92 }}
      onClick={() => {
        if (armed) {
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
      aria-label={armed ? confirmHint : label}
      title={armed ? confirmHint : label}
      className={cn(
        "relative -m-0.5 rounded-md p-1.5 transition-colors",
        armed
          ? "bg-destructive/10 text-destructive"
          : "text-muted-foreground hover:text-foreground"
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
            initial={{ pathLength: 1 }}
            animate={{ pathLength: 0 }}
            transition={{ duration: 3, ease: "linear" }}
          />
        </svg>
      ) : null}
      <motion.span
        className="flex"
        animate={armed ? { x: [0, -2.5, 2.5, -1.5, 1.5, 0] } : { x: 0 }}
        transition={armed ? { duration: 0.35, ease: "easeInOut" } : { duration: 0.15 }}
      >
        <XIcon className="size-3.5" />
      </motion.span>
    </motion.button>
  );
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
  const detail = dictionary.detail;
  const tray = dictionary.downloads;

  const jobs = useDownloadsStore((state) => state.jobs);
  const presented = useDownloadsStore((state) => state.presented);
  const bottomBars = useDownloadsStore((state) => state.bottomBars);
  const dismiss = useDownloadsStore((state) => state.dismiss);
  const resume = useDownloadsStore((state) => state.resume);
  const restartWithSource = useDownloadsStore((state) => state.restartWithSource);
  const pause = useDownloadsStore((state) => state.pause);
  const hydrateFromStorage = useDownloadsStore((state) => state.hydrateFromStorage);
  const refreshSourceProbes = useDownloadsStore((state) => state.refreshSourceProbes);
  const [collapsed, setCollapsed] = React.useState(false);

  const reducedMotion = useReducedMotion();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [ghost, setGhost] = React.useState<GhostFlight | null>(null);
  // The pill/tray "catch" pulse. Driven imperatively when the ghost lands, so
  // it inherits the ghost's reduced-motion gate.
  const trayScale = useMotionValue(1);

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

  React.useEffect(() => {
    const onStarted = (event: Event) => {
      const startDetail = (event as CustomEvent<DownloadStartedDetail>).detail;
      if (!startDetail || reducedMotion) {
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
  }, [reducedMotion]);

  const visible = jobs.filter((job) => !((presented[job.id] ?? 0) > 0));
  const activeCount = visible.filter(
    (job) => job.status === "packing" || job.status === "archiving"
  ).length;
  const aggregatePercent =
    visible.length > 0
      ? Math.round(visible.reduce((sum, job) => sum + jobPercent(job), 0) / visible.length)
      : 0;

  return (
    <div
      ref={containerRef}
      className={cn(
        // Safe-area aware, and lifted above the batch bar when one is on screen
        // so the two fixed bottom surfaces never overlap on phones.
        "pointer-events-none fixed right-4 z-50 flex w-full max-w-xs flex-col items-end gap-2",
        bottomBars > 0 ? "" : "bottom-[max(1rem,env(safe-area-inset-bottom))]"
      )}
      style={
        bottomBars > 0
          ? {
              bottom:
                "calc(var(--batch-download-bar-height, 5rem) + max(1rem, env(safe-area-inset-bottom)) + 0.75rem)",
            }
          : undefined
      }
    >
      {/* popLayout pops the outgoing pill/panel out of the flex flow, so the
          incoming one measures its final box and the shared layoutId can morph
          cleanly between the two shapes. */}
      <AnimatePresence initial={false} mode="popLayout">
        {visible.length > 0 ? (
          collapsed ? (
            <motion.button
              key="tray-collapsed"
              layoutId="download-tray"
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ ...springSoft, opacity: { duration: 0.18, ease: EASE_OUT } }}
              // borderRadius lives in style so the pill↔panel morph animates it.
              style={{ borderRadius: 20, scale: trayScale }}
              whileTap={{ scale: 0.92 }}
              onClick={() => setCollapsed(false)}
              aria-label={tray.expand}
              className="pointer-events-auto relative isolate flex items-center gap-2 border border-border/70 bg-popover/95 px-3 py-2 text-xs font-medium shadow-lg ring-1 ring-foreground/5"
            >
              {/* Blur on a child, not the morphing element, so it doesn't smear mid-morph. */}
              <span aria-hidden="true" className="absolute inset-0 -z-10 rounded-[inherit] backdrop-blur" />
              <DownloadIcon className="size-3.5" />
              <RollingNumber value={visible.length} format={tray.jobsCount} />
              {activeCount > 0 ? (
                <RollingNumber
                  value={aggregatePercent}
                  format={(n) => `${n}%`}
                  className="tabular-nums text-muted-foreground"
                />
              ) : null}
              <ChevronUpIcon className="size-3.5 text-muted-foreground" />
            </motion.button>
          ) : (
            <motion.div
              key="tray"
              layoutId="download-tray"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ ...springSoft, opacity: { duration: 0.18, ease: EASE_OUT } }}
              style={{ borderRadius: 16, scale: trayScale }}
              className="pointer-events-auto relative isolate flex w-full flex-col gap-2 border border-border/70 bg-popover/95 p-3 shadow-lg ring-1 ring-foreground/5"
            >
              <span aria-hidden="true" className="absolute inset-0 -z-10 rounded-[inherit] backdrop-blur" />
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <DownloadIcon className="size-3.5" />
                {tray.trayTitle}
                <span className="flex-1" />
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setCollapsed(true)}
                  aria-label={tray.collapse}
                  title={tray.collapse}
                  className="-m-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronDownIcon className="size-3.5" />
                </motion.button>
              </div>
              <ul className="relative flex max-h-[50vh] touch-pan-y flex-col gap-2 overflow-y-auto">
                <AnimatePresence initial={false} mode="popLayout">
                  {visible.map((job) => {
                    const percent = jobPercent(job);
                    const resumable = job.status === "paused" || job.status === "error";
                    const active = job.status === "packing";
                    const statusText = downloadJobStatusText(job, detail, tray);

                    return (
                      <motion.li
                        key={job.id}
                        layout
                        initial={{ opacity: 0, y: 12, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 56, transition: { duration: 0.18, ease: EASE_OUT } }}
                        transition={{ ...springSoft, opacity: { duration: 0.2, ease: EASE_OUT } }}
                        // Completed rows can also be swiped away; the X button
                        // stays as the accessible path.
                        drag={job.status === "success" ? "x" : false}
                        dragDirectionLock
                        dragConstraints={{ left: 0, right: 0 }}
                        dragElastic={{ left: 0.08, right: 0.7 }}
                        onDragEnd={(_, info) => {
                          if (
                            job.status === "success" &&
                            (info.offset.x > 72 || info.velocity.x > 600)
                          ) {
                            dismiss(job.id);
                          }
                        }}
                        className="relative flex flex-col gap-1.5 overflow-hidden rounded-lg"
                      >
                        {job.status === "success" ? (
                          // One-shot emerald wash as the row lands on success.
                          <motion.span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-0 rounded-[inherit] bg-emerald-500/15"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: [0, 1, 0] }}
                            transition={{ duration: 1.2, times: [0, 0.2, 1], ease: "easeInOut" }}
                          />
                        ) : null}
                        <div className="flex items-center gap-1.5">
                          {job.status === "success" ? (
                            <span className="relative flex size-3.5 shrink-0 items-center justify-center text-emerald-500">
                              <DrawnCheck size={14} />
                              <motion.span
                                aria-hidden="true"
                                className="absolute inset-0 rounded-full border border-emerald-500/70"
                                initial={{ scale: 0.5, opacity: 1 }}
                                animate={{ scale: 1.8, opacity: 0 }}
                                transition={{ duration: 0.7, ease: EASE_OUT }}
                              />
                            </span>
                          ) : job.status === "error" ? (
                            <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
                          ) : null}
                          <span className="truncate text-sm font-medium">{job.title}</span>
                          <span className="flex-1" />
                          <AnimatePresence initial={false} mode="wait">
                            <motion.span
                              key={job.status}
                              className="flex items-center gap-1"
                              initial={{ opacity: 0, scale: 0.6, rotate: -45 }}
                              animate={{ opacity: 1, scale: 1, rotate: 0 }}
                              exit={{ opacity: 0, scale: 0.6, rotate: -45 }}
                              transition={{ duration: 0.15, ease: EASE_OUT }}
                            >
                              {resumable ? (
                                <>
                                  <motion.button
                                    type="button"
                                    whileTap={{ scale: 0.92 }}
                                    onClick={() => resume(job.id)}
                                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                                  >
                                    <RotateCwIcon className="size-3" />
                                    {tray.resume}
                                  </motion.button>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <motion.button
                                        type="button"
                                        whileTap={{ scale: 0.92 }}
                                        aria-label={tray.sourcePicker.switchAndRestart}
                                        title={tray.sourcePicker.restartHint}
                                        className="-m-0.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                                      >
                                        <ArrowLeftRightIcon className="size-3.5" />
                                      </motion.button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                      align="end"
                                      collisionPadding={8}
                                      className="max-h-[min(28rem,calc(100dvh-5rem))] w-[min(20rem,calc(100vw-2rem))] overscroll-contain"
                                    >
                                      <DownloadSourceMenu
                                        value={job.sourceId}
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
                                  whileTap={{ scale: 0.92 }}
                                  onClick={() => pause(job.id)}
                                  aria-label={tray.pause}
                                  title={tray.pause}
                                  className="-m-0.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                                >
                                  <PauseIcon className="size-3.5" />
                                </motion.button>
                              ) : null}
                              {job.status === "success" ? (
                                <motion.button
                                  type="button"
                                  whileTap={{ scale: 0.92 }}
                                  onClick={() => dismiss(job.id)}
                                  aria-label={tray.dismiss}
                                  title={tray.dismiss}
                                  className="-m-0.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
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
                            </motion.span>
                          </AnimatePresence>
                        </div>
                        <DownloadSourceSummary
                          sourceId={job.sourceId}
                          copy={tray.sourcePicker}
                          className="w-fit"
                        />
                        {/* Live region: progress and failures are otherwise
                            invisible to screen readers. */}
                        <p
                          role="status"
                          className={cn(
                            "truncate text-xs",
                            job.status === "error" ? "text-destructive" : "text-muted-foreground"
                          )}
                          title={job.error ?? undefined}
                        >
                          {statusText}
                        </p>
                        {job.status === "packing" ||
                        job.status === "paused" ||
                        job.status === "archiving" ? (
                          <DownloadProgressBar
                            percent={percent}
                            active={job.status === "packing" || job.status === "archiving"}
                            label={job.title}
                            fillClassName={job.status === "paused" ? "bg-primary/40" : undefined}
                          />
                        ) : null}
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </motion.div>
          )
        ) : null}
      </AnimatePresence>
      {ghost
        ? createPortal(
            <motion.span
              key={ghost.key}
              aria-hidden="true"
              className="pointer-events-none fixed left-0 top-0 z-[60] text-primary"
              initial={{ x: ghost.from.x - 12, y: ghost.from.y - 12, scale: 1.15, opacity: 1 }}
              animate={{ x: ghost.to.x - 12, y: ghost.to.y - 12, scale: 0.45, opacity: 0.85 }}
              transition={{ ...springSoft, opacity: { duration: 0.4, ease: EASE_OUT } }}
              onAnimationComplete={() => {
                setGhost(null);
                void animate(trayScale, [1, 1.12, 1], { duration: 0.45, ease: "easeInOut" });
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
