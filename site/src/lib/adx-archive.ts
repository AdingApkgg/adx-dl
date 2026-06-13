import { zipSync } from "fflate";

import type { AdxRemoteFile } from "./adx-directory";

export type AdxArchiveInput = {
  name: string;
  bytes: Uint8Array;
};

export function getAdxDownloadFileName(directoryName: string): string {
  const trimmed = directoryName.trim();

  if (!trimmed) {
    throw new Error("Directory name is required");
  }

  return `${trimmed}.adx`;
}

export async function downloadRemoteFile(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store", mode: "cors" });

  if (!response.ok) {
    throw new Error(`File download failed: ${url}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export async function downloadAdxArchiveInputs(
  files: AdxRemoteFile[],
  options: {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<AdxArchiveInput[]> {
  const total = files.length;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const results = new Array<AdxArchiveInput>(total);
  let nextIndex = 0;
  let completed = 0;

  async function worker(): Promise<void> {
    while (nextIndex < total) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const file = files[currentIndex];

      results[currentIndex] = {
        name: file.name,
        bytes: await downloadRemoteFile(file.url),
      };

      completed += 1;
      options.onProgress?.(completed, total);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

  return results;
}

export async function buildAdxArchiveBlob(
  _directoryName: string,
  files: AdxArchiveInput[]
): Promise<Blob> {
  if (files.length === 0) {
    throw new Error("Directory is empty");
  }

  const zipEntries = Object.fromEntries(files.map((file) => [file.name, file.bytes]));
  return new Blob([zipSync(zipEntries)], { type: "application/zip" });
}

export function saveBlobAsFile(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();

  queueMicrotask(() => URL.revokeObjectURL(objectUrl));
}
