"use client";

import * as React from "react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  PauseIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";

import { AnimatePresence, EASE_OUT, motion } from "@/components/motion";
import { getDictionary, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatBytes } from "./format-bytes";
import { jobPercent, useDownloadsStore, type DownloadJob } from "./downloads-store";

/**
 * Dismissing a job that still holds resumable bytes (paused/error) or is
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
    <button
      type="button"
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
        "-m-0.5 rounded-md p-1.5 transition-colors",
        armed
          ? "bg-destructive/10 text-destructive"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <XIcon className="size-3.5" />
    </button>
  );
}

/** Localized status line for a job, with byte counts and speed while active. */
function jobStatusText(
  job: DownloadJob,
  detail: ReturnType<typeof getDictionary>["detail"],
  tray: ReturnType<typeof getDictionary>["downloads"]
): string {
  const percent = jobPercent(job);
  switch (job.status) {
    case "packing": {
      const counts = detail.downloadPacking(job.completed, job.total);
      const bytes =
        job.receivedBytes > 0
          ? job.totalBytes > 0
            ? ` · ${formatBytes(job.receivedBytes)} / ${formatBytes(job.totalBytes)}`
            : ` · ${formatBytes(job.receivedBytes)}`
          : "";
      const speed = job.speedBps > 1024 ? ` · ${formatBytes(job.speedBps)}/s` : "";
      return `${counts}${bytes}${speed}`;
    }
    case "archiving":
      return tray.archiving;
    case "success":
      return tray.completed;
    case "paused":
      return `${tray.paused} · ${percent}%`;
    case "error":
      return job.errorKind === "offline"
        ? tray.errorOffline
        : job.errorKind === "network"
          ? tray.errorNetwork
          : tray.errorGeneric;
  }
}

/**
 * A floating tray that keeps download progress visible no matter which page the
 * user is on. It shows jobs whose inline owner (the chart page button or the
 * batch bar) has unmounted — i.e. downloads still running after a navigation —
 * plus any `paused` job rehydrated from storage after a full reload, which the
 * user can resume from its last byte offset.
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
  const pause = useDownloadsStore((state) => state.pause);
  const hydrateFromStorage = useDownloadsStore((state) => state.hydrateFromStorage);
  const [collapsed, setCollapsed] = React.useState(false);

  // Rehydrate interrupted downloads once, after mount (IndexedDB is client-only).
  React.useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

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
      className={cn(
        // Safe-area aware, and lifted above the batch bar when one is on screen
        // so the two fixed bottom surfaces never overlap on phones.
        "pointer-events-none fixed right-4 z-50 flex w-full max-w-xs flex-col items-end gap-2",
        bottomBars > 0
          ? "bottom-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]"
          : "bottom-[max(1rem,env(safe-area-inset-bottom))]"
      )}
    >
      <AnimatePresence initial={false}>
        {visible.length > 0 ? (
          collapsed ? (
            <motion.button
              key="tray-collapsed"
              type="button"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              onClick={() => setCollapsed(false)}
              aria-label={tray.expand}
              className="pointer-events-auto flex items-center gap-2 rounded-full border border-border/70 bg-popover/95 px-3 py-2 text-xs font-medium shadow-lg ring-1 ring-foreground/5 backdrop-blur"
            >
              <DownloadIcon className="size-3.5" />
              {tray.jobsCount(visible.length)}
              {activeCount > 0 ? (
                <span className="tabular-nums text-muted-foreground">{aggregatePercent}%</span>
              ) : null}
              <ChevronUpIcon className="size-3.5 text-muted-foreground" />
            </motion.button>
          ) : (
            <motion.div
              key="tray"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="pointer-events-auto flex w-full flex-col gap-2 rounded-2xl border border-border/70 bg-popover/95 p-3 shadow-lg ring-1 ring-foreground/5 backdrop-blur"
            >
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <DownloadIcon className="size-3.5" />
                {tray.trayTitle}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  aria-label={tray.collapse}
                  title={tray.collapse}
                  className="-m-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronDownIcon className="size-3.5" />
                </button>
              </div>
              <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
                <AnimatePresence initial={false}>
                  {visible.map((job) => {
                    const percent = jobPercent(job);
                    const resumable = job.status === "paused" || job.status === "error";
                    const active = job.status === "packing";
                    const statusText = jobStatusText(job, detail, tray);

                    return (
                      <motion.li
                        key={job.id}
                        layout
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: EASE_OUT }}
                        className="flex flex-col gap-1.5 overflow-hidden"
                      >
                        <div className="flex items-center gap-1.5">
                          {job.status === "success" ? (
                            <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-500" />
                          ) : job.status === "error" ? (
                            <AlertCircleIcon className="size-3.5 shrink-0 text-destructive" />
                          ) : null}
                          <span className="truncate text-sm font-medium">{job.title}</span>
                          <span className="flex-1" />
                          {resumable ? (
                            <button
                              type="button"
                              onClick={() => resume(job.id)}
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                            >
                              <RotateCwIcon className="size-3" />
                              {tray.resume}
                            </button>
                          ) : null}
                          {active ? (
                            <button
                              type="button"
                              onClick={() => pause(job.id)}
                              aria-label={tray.pause}
                              title={tray.pause}
                              className="-m-0.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <PauseIcon className="size-3.5" />
                            </button>
                          ) : null}
                          {job.status === "success" ? (
                            <button
                              type="button"
                              onClick={() => dismiss(job.id)}
                              aria-label={tray.dismiss}
                              title={tray.dismiss}
                              className="-m-0.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <XIcon className="size-3.5" />
                            </button>
                          ) : job.status !== "archiving" ? (
                            <ConfirmDismissButton
                              onConfirm={() => dismiss(job.id)}
                              label={tray.cancel}
                              confirmHint={tray.confirmDiscard}
                            />
                          ) : null}
                        </div>
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
                        {job.status === "packing" || job.status === "paused" ? (
                          <div
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={percent}
                            aria-label={job.title}
                            className="h-1.5 overflow-hidden rounded-full bg-muted"
                          >
                            <div
                              className={
                                job.status === "paused"
                                  ? "h-full rounded-full bg-primary/40 transition-[width] duration-150 ease-out"
                                  : "h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                              }
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                        ) : job.status === "archiving" ? (
                          <div
                            role="progressbar"
                            aria-label={job.title}
                            className="h-1.5 overflow-hidden rounded-full bg-muted"
                          >
                            <div className="h-full w-full animate-pulse rounded-full bg-primary/60" />
                          </div>
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
    </div>
  );
}
