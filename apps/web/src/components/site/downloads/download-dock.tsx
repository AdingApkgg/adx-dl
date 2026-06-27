"use client";

import * as React from "react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  DownloadIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";

import { AnimatePresence, EASE_OUT, motion } from "@/components/motion";
import { getDictionary, type Locale } from "@/lib/i18n";
import { useDownloadsStore, type DownloadJob } from "./downloads-store";

/** Fraction 0–100, preferring byte-level totals and falling back to file counts. */
function jobPercent(job: DownloadJob): number {
  if (job.totalBytes > 0) {
    return Math.min(100, Math.round((job.receivedBytes / job.totalBytes) * 100));
  }
  if (job.total > 0) {
    return Math.min(100, Math.round((job.completed / job.total) * 100));
  }
  return 0;
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
  const dismiss = useDownloadsStore((state) => state.dismiss);
  const resume = useDownloadsStore((state) => state.resume);
  const hydrateFromStorage = useDownloadsStore((state) => state.hydrateFromStorage);

  // Rehydrate interrupted downloads once, after mount (IndexedDB is client-only).
  React.useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  const visible = jobs.filter((job) => !((presented[job.id] ?? 0) > 0));

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-xs flex-col gap-2">
      <AnimatePresence initial={false}>
        {visible.length > 0 ? (
          <motion.div
            key="tray"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="pointer-events-auto flex flex-col gap-2 rounded-2xl border border-border/70 bg-popover/95 p-3 shadow-lg ring-1 ring-foreground/5 backdrop-blur"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <DownloadIcon className="size-3.5" />
              {tray.trayTitle}
            </div>
            <ul className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {visible.map((job) => {
                  const percent = jobPercent(job);
                  const resumable = job.status === "paused" || job.status === "error";
                  const statusText =
                    job.status === "packing"
                      ? detail.downloadPacking(job.completed, job.total)
                      : job.status === "success"
                        ? detail.downloadSuccess
                        : job.status === "paused"
                          ? `${tray.paused} · ${percent}%`
                          : `${detail.downloadErrorPrefix}${job.error ?? ""}`;

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
                      <div className="flex items-center gap-2">
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
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                          >
                            <RotateCwIcon className="size-3" />
                            {tray.resume}
                          </button>
                        ) : null}
                        {job.status !== "packing" ? (
                          <button
                            type="button"
                            onClick={() => dismiss(job.id)}
                            aria-label={resumable ? tray.cancel : tray.dismiss}
                            className="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        ) : null}
                      </div>
                      {job.status === "error" ? (
                        <p className="truncate text-xs text-destructive">{statusText}</p>
                      ) : (
                        <p className="truncate text-xs text-muted-foreground">{statusText}</p>
                      )}
                      {job.status === "packing" || job.status === "paused" ? (
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={
                              job.status === "paused"
                                ? "h-full rounded-full bg-primary/40 transition-[width] duration-150 ease-out"
                                : "h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                            }
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      ) : null}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
