/**
 * The parts of the archive module that carry no dependency on `fflate`.
 *
 * Split out because the download UI needs the format list, the types and the
 * two DOM helpers on every page that renders a download button — while the
 * packers themselves (~49 KB raw / 18.5 KB gzip of zip and gzip implementation)
 * are only needed once a user actually starts a download. Keeping these here
 * lets `adx-archive.ts`, and therefore `fflate`, stay behind a dynamic import.
 *
 * `adx-archive.ts` re-exports everything below, so existing imports of the
 * combined surface keep working.
 */

/** One archive entry: an in-archive name plus its bytes, held as a (disk-backable) Blob. */
export type AdxArchiveInput = {
  name: string;
  blob: Blob;
};

/** Archive formats offered in the download picker. `.adx` is the primary/native one. */
export type ArchiveFormat = "adx" | "zip" | "tar.gz";

export const ARCHIVE_FORMATS: readonly ArchiveFormat[] = ["adx", "zip", "tar.gz"];

export type ArchiveProgress = {
  completedFiles: number;
  totalFiles: number;
  writtenBytes: number;
  totalBytes: number;
  currentFile: string | null;
};

export type ArchiveProgressCallback = (progress: ArchiveProgress) => void;

/** Combined archive formats for a batch download. `.adx` is zip-compatible. */
export type BatchArchiveFormat = ArchiveFormat;

export const BATCH_FORMATS: readonly BatchArchiveFormat[] = ["adx", "zip", "tar.gz"];

/**
 * One chart in a batch: a folder name plus its asset files. `groupDir` inserts
 * an optional folder above the chart, such as a maimai version in multi-version
 * downloads.
 */
export type NestedChart = { name: string; files: AdxArchiveInput[]; groupDir?: string };

export function getArchiveDownloadFileName(
  directoryName: string,
  format: ArchiveFormat = "adx"
): string {
  const trimmed = directoryName.trim();

  if (!trimmed) {
    throw new Error("Directory name is required");
  }

  return `${trimmed}.${format}`;
}

export function saveBlobAsFile(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();

  queueMicrotask(() => URL.revokeObjectURL(objectUrl));
}
