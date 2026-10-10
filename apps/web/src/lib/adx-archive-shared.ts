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

export function saveBlobAsFile(blob: Blob, fileName: string): () => void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  // Some mobile download managers resolve the URL after the click task has
  // returned. Revoking in a microtask races that handoff, especially for blobs.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = (): void => {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  try {
    anchor.click();
  } catch (error) {
    cleanup();
    throw error;
  }
  timer = setTimeout(cleanup, 60_000);
  // Node/Bun test runners must not stay alive just for browser URL cleanup.
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  return cleanup;
}

/** Mobile browsers need a fresh user gesture after an asynchronous pack. */
export function requiresManualArchiveSave(): boolean {
  if (typeof navigator === "undefined") return false;
  // ArkWeb identifies Harmony phones/tablets as OpenHarmony, without Android.
  // Its compatibility "Mobile" suffix is also present on PCs.
  if (/\((?:Phone|Tablet);\s*OpenHarmony\b/i.test(navigator.userAgent)) return true;
  return /Android|iPhone|iPad|iPod|HarmonyOS/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
