"use client";

import * as React from "react";
import { RotateCwIcon, Trash2Icon } from "lucide-react";

import { getDictionary, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useDownloadsStore } from "./downloads-store";

/**
 * The last few completed downloads, replayable in one click.
 *
 * A finished job deletes itself (its checkpoints were the only reason to keep
 * it) and the tray row auto-dismisses after 30 s, so "download that whole
 * version again" used to mean rebuilding the selection by hand. Only the spec
 * is stored — never the bytes.
 */
export function DownloadHistoryList({
  locale,
  className,
}: {
  locale: Locale;
  className?: string;
}) {
  const copy = getDictionary(locale).downloads;
  const history = useDownloadsStore((state) => state.history);
  const rerunHistoryEntry = useDownloadsStore((state) => state.rerunHistoryEntry);
  const clearDownloadHistory = useDownloadsStore((state) => state.clearDownloadHistory);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {history.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.historyEmpty}</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {history.map((entry) => (
              <li
                key={entry.key}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {entry.job.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {copy.historyEntrySummary(entry.fileCount)} · .{entry.job.format}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => rerunHistoryEntry(entry.key)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <RotateCwIcon className="size-3" aria-hidden="true" />
                  {copy.historyRerun}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={clearDownloadHistory}
            className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Trash2Icon className="size-3" aria-hidden="true" />
            {copy.historyClear}
          </button>
        </>
      )}
    </div>
  );
}
