"use client";

import * as React from "react";
import { ChevronDownIcon, DownloadIcon } from "lucide-react";

import { AnimatePresence, EASE_OUT, motion } from "@/components/motion";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ARCHIVE_FORMATS,
  buildArchiveBlob,
  downloadAdxArchiveInputs,
  getArchiveDownloadFileName,
  saveBlobAsFile,
  type AdxFileProgress,
  type ArchiveFormat,
} from "@/lib/adx-archive";
import type { AdxRemoteFile } from "@/lib/adx-directory";
import { getDictionary, type Locale } from "@/lib/i18n";

type AdxDownloadButtonProps = {
  /** Files to pack into the .adx (maidata + assets), with their in-archive names. */
  files: AdxRemoteFile[];
  /** Base name for the downloaded .adx file (the chart's directory name). */
  fileName?: string;
  locale: Locale;
};

type DownloadStatus = "idle" | "packing" | "success" | "error";

/** Compact human-readable size, used when the server doesn't report Content-Length. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

export function AdxDownloadButton({ files, fileName, locale }: AdxDownloadButtonProps) {
  const detailDictionary = getDictionary(locale).detail;
  const [status, setStatus] = React.useState<DownloadStatus>("idle");
  const [progress, setProgress] = React.useState({ completed: 0, total: 0 });
  const [fileProgress, setFileProgress] = React.useState<AdxFileProgress[]>([]);
  const [errorMessage, setErrorMessage] = React.useState("");
  const normalizedFileName = typeof fileName === "string" ? fileName.trim() : "";
  const canDownload = files.length > 0 && normalizedFileName.length > 0;
  const isBusy = status === "packing";

  // Byte-level progress fires many times per file; coalesce to one render per frame.
  const pendingFileProgress = React.useRef<AdxFileProgress[] | null>(null);
  const rafId = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    },
    []
  );

  function scheduleFileProgress(next: AdxFileProgress[]) {
    pendingFileProgress.current = next;
    if (rafId.current !== null) {
      return;
    }
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      if (pendingFileProgress.current) {
        setFileProgress(pendingFileProgress.current);
      }
    });
  }

  async function handleSelect(format: ArchiveFormat) {
    if (!canDownload || isBusy) {
      return;
    }

    try {
      setErrorMessage("");
      setProgress({ completed: 0, total: files.length });
      setFileProgress(files.map((file) => ({
        name: file.name,
        received: 0,
        total: null,
        status: "pending",
      })));
      setStatus("packing");

      const archiveInputs = await downloadAdxArchiveInputs(files, {
        concurrency: 4,
        onProgress: (completed, total) => setProgress({ completed, total }),
        onFileProgress: scheduleFileProgress,
      });
      const archiveBlob = await buildArchiveBlob(archiveInputs, format);

      saveBlobAsFile(archiveBlob, getArchiveDownloadFileName(normalizedFileName, format));
      setStatus("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
      setStatus("error");
    }
  }

  const label =
    status === "packing"
      ? detailDictionary.downloadPacking(progress.completed, progress.total)
      : canDownload
        ? detailDictionary.onsiteDownload
        : detailDictionary.onsitePending;

  return (
    <div className="flex flex-col gap-2">
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
                  {detailDictionary.downloadFormatRecommended}
                </span>
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
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
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
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
          <motion.p
            key="success"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="text-sm text-muted-foreground"
          >
            {detailDictionary.downloadSuccess}
          </motion.p>
        ) : status === "error" ? (
          <motion.p
            key="error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="text-sm text-destructive"
          >
            {detailDictionary.downloadErrorPrefix}
            {errorMessage}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
