"use client";

import * as React from "react";
import { DownloadIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  buildAdxArchiveBlob,
  downloadAdxArchiveInputs,
  getAdxDownloadFileName,
  saveBlobAsFile,
} from "@/lib/adx-archive";
import { fetchAdxDirectoryFiles } from "@/lib/adx-directory";
import { getDictionary, type Locale } from "@/lib/i18n";

type AdxDownloadButtonProps = {
  directoryName?: string;
  locale: Locale;
};

type DownloadStatus = "idle" | "probing" | "packing" | "success" | "error";

export function AdxDownloadButton({ directoryName, locale }: AdxDownloadButtonProps) {
  const detailDictionary = getDictionary(locale).detail;
  const [status, setStatus] = React.useState<DownloadStatus>("idle");
  const [progress, setProgress] = React.useState({ completed: 0, total: 0 });
  const [errorMessage, setErrorMessage] = React.useState("");
  const normalizedDirectoryName =
    typeof directoryName === "string" ? directoryName.trim() : "";
  const canDownload = normalizedDirectoryName.length > 0;
  const isBusy = status === "probing" || status === "packing";

  async function handleClick() {
    if (!canDownload || isBusy) {
      return;
    }

    try {
      setErrorMessage("");
      setStatus("probing");

      const files = await fetchAdxDirectoryFiles(normalizedDirectoryName);

      setProgress({ completed: 0, total: files.length });
      setStatus("packing");

      const archiveInputs = await downloadAdxArchiveInputs(files, {
        concurrency: 4,
        onProgress: (completed, total) => setProgress({ completed, total }),
      });
      const archiveBlob = await buildAdxArchiveBlob(normalizedDirectoryName, archiveInputs);

      saveBlobAsFile(archiveBlob, getAdxDownloadFileName(normalizedDirectoryName));
      setStatus("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
      setStatus("error");
    }
  }

  const label =
    status === "probing"
      ? detailDictionary.downloadPreparing
      : status === "packing"
        ? detailDictionary.downloadPacking(progress.completed, progress.total)
        : canDownload
          ? detailDictionary.onsiteDownload
          : detailDictionary.onsitePending;

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={handleClick} disabled={!canDownload || isBusy}>
        <DownloadIcon data-icon="inline-start" />
        {label}
      </Button>
      {status === "success" ? (
        <p className="text-sm text-muted-foreground">{detailDictionary.downloadSuccess}</p>
      ) : null}
      {status === "error" ? (
        <p className="text-sm text-destructive">
          {detailDictionary.downloadErrorPrefix}
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
