"use client";

import * as React from "react";
import { ChevronDownIcon, DownloadIcon, XIcon } from "lucide-react";

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
import {
  BATCH_FORMATS,
  buildNestedArchiveBlob,
  downloadAdxArchiveInputs,
  getArchiveDownloadFileName,
  saveBlobAsFile,
  type AdxArchiveInput,
  type BatchArchiveFormat,
} from "@/lib/adx-archive";
import { isChartVideoFile, type ChartDownloadSpec } from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";

type BatchDownloadBarProps = {
  /** The selected charts to pack, one folder per chart. */
  charts: ChartDownloadSpec[];
  /** Base name for the combined archive (e.g. the version label). */
  collectionName: string;
  locale: Locale;
  onClear: () => void;
};

type DownloadStatus = "idle" | "packing" | "success" | "error";

export function BatchDownloadBar({
  charts,
  collectionName,
  locale,
  onClear,
}: BatchDownloadBarProps) {
  const dictionary = getDictionary(locale);
  const detail = dictionary.detail;
  const browser = dictionary.catalogBrowser;
  const [status, setStatus] = React.useState<DownloadStatus>("idle");
  const [progress, setProgress] = React.useState({ completed: 0, total: 0 });
  const [errorMessage, setErrorMessage] = React.useState("");
  const [includeVideo, setIncludeVideo] = React.useState(true);

  const count = charts.length;
  const isBusy = status === "packing";
  const canDownload = count > 0 && !isBusy;

  async function handleSelect(format: BatchArchiveFormat) {
    if (!canDownload) {
      return;
    }

    // Download flat (one fetch per file), tagging each by chart index so results can be
    // regrouped — an opaque numeric prefix avoids any clash with chart names containing "/".
    const dirByIndex: string[] = [];
    const files: { name: string; url: string }[] = [];
    charts.forEach((chart, index) => {
      dirByIndex[index] = chart.dir;
      for (const file of chart.files) {
        if (includeVideo || !isChartVideoFile(file.name)) {
          files.push({ name: `${index}/${file.name}`, url: file.url });
        }
      }
    });

    if (files.length === 0) {
      return;
    }

    try {
      setErrorMessage("");
      setProgress({ completed: 0, total: files.length });
      setStatus("packing");

      const archiveInputs = await downloadAdxArchiveInputs(files, {
        concurrency: 6,
        onProgress: (completed, total) => setProgress({ completed, total }),
      });

      // Regroup downloaded files by chart, then pack one `.adx` per chart.
      const grouped = new Map<number, AdxArchiveInput[]>();
      for (const input of archiveInputs) {
        const slash = input.name.indexOf("/");
        const index = Number(input.name.slice(0, slash));
        const baseName = input.name.slice(slash + 1);
        const bucket = grouped.get(index) ?? [];
        bucket.push({ name: baseName, bytes: input.bytes });
        grouped.set(index, bucket);
      }
      const nestedCharts = [...grouped.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, chartFiles]) => ({ name: dirByIndex[index], files: chartFiles }));

      const archiveBlob = await buildNestedArchiveBlob(nestedCharts, format);

      saveBlobAsFile(archiveBlob, getArchiveDownloadFileName(collectionName, format));
      setStatus("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
      setStatus("error");
    }
  }

  const percent =
    progress.total > 0 ? Math.min(100, Math.round((progress.completed / progress.total) * 100)) : 0;

  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
    >
      <div className="flex w-full max-w-xl flex-col gap-2 rounded-2xl border border-border/70 bg-popover/95 p-3 shadow-lg ring-1 ring-foreground/5 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium tabular-nums">
            {browser.selectedCount(count)}
          </span>
          <span className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={isBusy}>
            <XIcon data-icon="inline-start" />
            {browser.clearSelection}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="sm" disabled={!canDownload}>
                <DownloadIcon data-icon="inline-start" />
                {isBusy
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
                  {format === "zip" ? (
                    <span className="text-xs text-muted-foreground">
                      {detail.downloadFormatRecommended}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={includeVideo}
                onCheckedChange={(value) => setIncludeVideo(value === true)}
                onSelect={(event) => event.preventDefault()}
              >
                {detail.downloadIncludeVideo}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <AnimatePresence mode="wait">
          {isBusy ? (
            <motion.div
              key="progress"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="overflow-hidden"
            >
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </motion.div>
          ) : status === "success" ? (
            <motion.p
              key="success"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="text-xs text-muted-foreground"
            >
              {detail.downloadSuccess}
            </motion.p>
          ) : status === "error" ? (
            <motion.p
              key="error"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="text-xs text-destructive"
            >
              {detail.downloadErrorPrefix}
              {errorMessage}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
