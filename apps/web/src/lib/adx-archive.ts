import { gzipSync, zipSync } from "fflate";

import type { AdxRemoteFile } from "./adx-directory";

export type AdxArchiveInput = {
  name: string;
  bytes: Uint8Array;
};

/** Archive formats offered in the download picker. `.adx` is the primary/native one. */
export type ArchiveFormat = "adx" | "zip" | "tar.gz";

export const ARCHIVE_FORMATS: readonly ArchiveFormat[] = ["adx", "zip", "tar.gz"];

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

/** Per-file download state, surfaced so the UI can render a progress bar per file. */
export type AdxFileProgress = {
  name: string;
  /** Bytes received so far. */
  received: number;
  /** Total bytes from Content-Length, or null when the server doesn't report it. */
  total: number | null;
  status: "pending" | "downloading" | "done";
};

export async function downloadRemoteFile(
  url: string,
  onProgress?: (received: number, total: number | null) => void
): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store", mode: "cors" });

  if (!response.ok) {
    throw new Error(`File download failed: ${url}`);
  }

  const lengthHeader = response.headers.get("content-length");
  const total =
    lengthHeader && Number.isFinite(Number(lengthHeader)) ? Number(lengthHeader) : null;

  // Without a listener (or a streamable body) a single buffered read is simplest.
  if (!onProgress || !response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(bytes.length, total ?? bytes.length);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    received += value.length;
    onProgress(received, total);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

export async function downloadAdxArchiveInputs(
  files: AdxRemoteFile[],
  options: {
    concurrency?: number;
    /** Fires once per file as it finishes, with the running completed/total counts. */
    onProgress?: (completed: number, total: number) => void;
    /** Fires on every byte chunk with a fresh snapshot of every file's progress. */
    onFileProgress?: (progress: AdxFileProgress[]) => void;
  } = {}
): Promise<AdxArchiveInput[]> {
  const total = files.length;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const results = new Array<AdxArchiveInput>(total);
  const progress: AdxFileProgress[] = files.map((file) => ({
    name: file.name,
    received: 0,
    total: null,
    status: "pending",
  }));
  let nextIndex = 0;
  let completed = 0;

  // Each emit hands out fresh objects so consumers (e.g. React) see new references.
  const emitFileProgress = (): void =>
    options.onFileProgress?.(progress.map((entry) => ({ ...entry })));

  async function worker(): Promise<void> {
    while (nextIndex < total) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const file = files[currentIndex];
      const entry = progress[currentIndex];

      entry.status = "downloading";
      emitFileProgress();

      const byteListener = options.onFileProgress
        ? (received: number, fileTotal: number | null) => {
            entry.received = received;
            entry.total = fileTotal;
            emitFileProgress();
          }
        : undefined;

      const bytes = await downloadRemoteFile(file.url, byteListener);

      results[currentIndex] = { name: file.name, bytes };
      entry.received = bytes.length;
      entry.total = entry.total ?? bytes.length;
      entry.status = "done";
      emitFileProgress();

      completed += 1;
      options.onProgress?.(completed, total);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

  return results;
}

export async function buildArchiveBlob(
  files: AdxArchiveInput[],
  format: ArchiveFormat = "adx"
): Promise<Blob> {
  if (files.length === 0) {
    throw new Error("Directory is empty");
  }

  const bytes =
    format === "tar.gz"
      ? gzipSync(buildTar(files), { mtime: 0 })
      : // `.adx` and `.zip` are byte-for-byte the same zip archive; only the extension differs.
        zipSync(Object.fromEntries(files.map((file) => [file.name, file.bytes])));

  // Always tag as a generic binary type. Tagging the blob with a specific type (e.g.
  // application/zip) makes browsers "correct" the download name by appending the canonical
  // extension (e.g. "39.adx.zip"); octet-stream keeps the extension we set on the anchor.
  return new Blob([bytes], { type: "application/octet-stream" });
}

/** Builds a USTAR tar archive with files at the root. Deterministic (no timestamps/owners). */
function buildTar(files: AdxArchiveInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const blocks: Uint8Array[] = [];

  const octalField = (value: number, length: number): Uint8Array =>
    encoder.encode(value.toString(8).padStart(length - 1, "0") + "\0");

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);

    if (nameBytes.length > 100) {
      throw new Error(`File name too long for tar: ${file.name}`);
    }

    const header = new Uint8Array(512);
    header.set(nameBytes, 0);
    header.set(octalField(0o644, 8), 100); // mode
    header.set(octalField(0, 8), 108); // uid
    header.set(octalField(0, 8), 116); // gid
    header.set(octalField(file.bytes.length, 12), 124); // size
    header.set(octalField(0, 12), 136); // mtime (epoch — deterministic)
    header[156] = 0x30; // typeflag '0' (regular file)
    header.set(encoder.encode("ustar\0"), 257); // magic
    header.set(encoder.encode("00"), 263); // version

    // Checksum: sum of all header bytes with the checksum field filled with spaces.
    header.fill(0x20, 148, 156);
    let checksum = 0;
    for (const byte of header) {
      checksum += byte;
    }
    header.set(encoder.encode(checksum.toString(8).padStart(6, "0") + "\0 "), 148);

    blocks.push(header, file.bytes);
    const remainder = file.bytes.length % 512;
    if (remainder !== 0) {
      blocks.push(new Uint8Array(512 - remainder)); // pad data to a 512-byte boundary
    }
  }

  blocks.push(new Uint8Array(1024)); // two zero blocks mark end of archive

  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }

  return out;
}

export function saveBlobAsFile(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();

  queueMicrotask(() => URL.revokeObjectURL(objectUrl));
}
