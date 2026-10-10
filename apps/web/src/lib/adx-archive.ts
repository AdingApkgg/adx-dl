/**
 * The archive packers. This module pulls in `fflate`, so it must only ever be
 * reached through a dynamic `import()` from the download path — never from a
 * component that renders on page load. Constants, types and the DOM helpers
 * live in `adx-archive-shared.ts` for exactly that reason, and are re-exported
 * here so the combined surface stays importable in tests and scripts.
 */
import { Gzip, Zip, ZipPassThrough } from "fflate";
import { assertZip32Limits, nestedArchiveFiles, withRootDirectory } from "./adx-archive-layout";

import type {
  AdxArchiveInput,
  ArchiveFormat,
  ArchiveProgressCallback,
  BatchArchiveFormat,
  NestedChart,
} from "./adx-archive-shared";

export * from "./adx-archive-shared";

// Gzip output coalesces small chunks. STORE ZIP payloads instead reuse their
// source Blobs: copying each streamed media chunk into a second output Blob
// kept a full extra batch of bytes alive on mobile browsers.
const OUTPUT_FLUSH_BYTES = 4 * 1024 * 1024;
/** CRC/gzip work shares the UI thread; promise-only Blob reads do not yield to taps. */
const ARCHIVE_WORK_SLICE_MS = 16;
const ARCHIVE_WORK_SLICE_BYTES = 4 * 1024 * 1024;
const ARCHIVE_STREAM_CHUNK_BYTES = 64 * 1024;

type BlobSink = {
  push: (chunk: Uint8Array) => void;
  pushBlob: (source: Blob) => void;
  finish: (type: string) => Blob;
};

function createProgressReporter(
  files: AdxArchiveInput[],
  onProgress?: ArchiveProgressCallback
) {
  let completedFiles = 0;
  let writtenBytes = 0;
  let currentFile: string | null = null;
  const totalFiles = files.length;
  const totalBytes = files.reduce((sum, file) => sum + file.blob.size, 0);

  const emit = () => {
    onProgress?.({
      completedFiles,
      totalFiles,
      writtenBytes,
      totalBytes,
      currentFile,
    });
  };

  return {
    startFile(name: string) {
      currentFile = name;
      emit();
    },
    addBytes(count: number) {
      writtenBytes += count;
      emit();
    },
    finishFile(name: string) {
      completedFiles += 1;
      currentFile = name;
      emit();
    },
    finish() {
      completedFiles = totalFiles;
      writtenBytes = totalBytes;
      currentFile = null;
      emit();
    },
    emit,
  };
}

function createBlobSink(): BlobSink {
  let blob = new Blob([]);
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  const flush = (): void => {
    if (pendingBytes === 0) return;
    blob = new Blob([blob, ...(pending as BlobPart[])]);
    pending = [];
    pendingBytes = 0;
  };
  return {
    push(chunk) {
      if (chunk.length === 0) {
        return;
      }
      pending.push(chunk);
      pendingBytes += chunk.length;
      if (pendingBytes >= OUTPUT_FLUSH_BYTES) {
        flush();
      }
    },
    pushBlob(source) {
      flush();
      blob = new Blob([blob, source]);
    },
    finish(type) {
      return new Blob([blob, ...(pending as BlobPart[])], { type });
    },
  };
}

/** Reads a Blob to the end in chunks, never materialising the whole thing in RAM. */
async function streamBlob(blob: Blob, onChunk: (chunk: Uint8Array) => void): Promise<void> {
  const reader = blob.stream().getReader();
  let lastYieldAt = Date.now();
  let bytesSinceYield = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // A browser may deliver a whole in-memory Blob as one reader chunk.
      // Subarray views bound one synchronous CRC/gzip step without copying.
      for (let offset = 0; offset < value.length; offset += ARCHIVE_STREAM_CHUNK_BYTES) {
        const chunk = value.subarray(offset, offset + ARCHIVE_STREAM_CHUNK_BYTES);
        onChunk(chunk);
        bytesSinceYield += chunk.length;
        if (bytesSinceYield >= ARCHIVE_WORK_SLICE_BYTES || Date.now() - lastYieldAt >= ARCHIVE_WORK_SLICE_MS) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          lastYieldAt = Date.now();
          bytesSinceYield = 0;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// The whole archive shares one timestamp, read off the clock when packing
// starts. Left to itself fflate re-reads the clock per entry, so a batch that
// takes minutes to pack would smear its file dates across that entire run.
// Capturing once also makes the output a pure function of its inputs, which is
// what lets the tests assert adx and zip are the same archive without racing
// DOS time's 2-second granularity — they pass an explicit stamp; nothing else does.
//
// Out-of-range dates are clamped rather than passed through: fflate rejects
// anything outside the DOS range outright (`err(10)`), so a badly skewed device
// clock would fail the download instead of merely mis-stamping it. It reads the
// date back through local getters (getFullYear/getHours/...), so the bounds are
// local-time too, and noon dodges any midnight DST skip.
const DOS_MIN = new Date(1980, 0, 1, 12);
const DOS_MAX = new Date(2099, 11, 31, 12);

function archiveTimestamp(mtime?: Date): Date {
  const value = mtime ?? new Date();
  if (Number.isNaN(value.getTime()) || value.getFullYear() < 1980) {
    return DOS_MIN;
  }
  return value.getFullYear() > 2099 ? DOS_MAX : value;
}

/**
 * Streams every entry's bytes into a STORE (uncompressed) zip. The payloads are
 * already-compressed media (mp3/mp4/png), so deflate would burn CPU for ~0 gain;
 * STORE also lets fflate pass bytes straight through with negligible buffering.
 * `.adx` and `.zip` are byte-for-byte the same archive; only the extension differs.
 */
async function packZip(
  files: AdxArchiveInput[],
  type: string,
  mtime: Date,
  onProgress?: ArchiveProgressCallback
): Promise<Blob> {
  assertZip32Limits(files);
  const sink = createBlobSink();
  const progress = createProgressReporter(files, onProgress);
  progress.emit();
  let zipError: Error | null = null;
  let payloadChunk: Uint8Array | null = null;
  let payloadBlob: Blob | null = null;
  let payloadAppended = false;
  const zip = new Zip((err, data) => {
    if (err) {
      zipError = err;
      return;
    }
    // ZipPassThrough emits each input chunk by identity. Keep its header and
    // descriptor, but substitute one original Blob for all payload chunks.
    // fflate still reads every chunk to calculate the exact CRC and sizes.
    if (data === payloadChunk) {
      if (!payloadAppended && payloadBlob) {
        sink.pushBlob(payloadBlob);
        payloadAppended = true;
      }
    } else {
      sink.push(data);
    }
  });

  for (const file of files) {
    if (zipError) {
      break;
    }
    const entry = new ZipPassThrough(file.name);
    entry.mtime = mtime;
    zip.add(entry);
    payloadBlob = file.blob;
    payloadAppended = false;
    progress.startFile(file.name);
    await streamBlob(file.blob, (chunk) => {
      payloadChunk = chunk;
      entry.push(chunk);
      payloadChunk = null;
      progress.addBytes(chunk.length);
    });
    payloadChunk = new Uint8Array(0);
    entry.push(payloadChunk, true);
    payloadChunk = null;
    payloadBlob = null;
    progress.finishFile(file.name);
  }

  zip.end();
  if (zipError) {
    throw zipError;
  }
  progress.finish();
  return sink.finish(type);
}

/** Builds a USTAR tar header block (512 bytes) for one file. No owner recorded. */
function tarHeader(name: string, size: number, mtime: Date): Uint8Array {
  const encoder = new TextEncoder();
  const octalField = (value: number, length: number): Uint8Array =>
    encoder.encode(`${value.toString(8).padStart(length - 1, "0")}\0`);

  // USTAR splits long paths into a 155-byte prefix (dir) + 100-byte name (basename),
  // which keeps nested batch paths like "<chart dir>/maidata.txt" within the format.
  let namePart = name;
  let prefixPart = "";
  if (encoder.encode(namePart).length > 100) {
    const slash = name.lastIndexOf("/");
    if (slash > 0) {
      prefixPart = name.slice(0, slash);
      namePart = name.slice(slash + 1);
    }
  }
  const nameBytes = encoder.encode(namePart);
  const prefixBytes = encoder.encode(prefixPart);

  if (nameBytes.length > 100 || prefixBytes.length > 155) {
    throw new Error(`File name too long for tar: ${name}`);
  }

  const header = new Uint8Array(512);
  header.set(nameBytes, 0);
  if (prefixBytes.length > 0) {
    header.set(prefixBytes, 345); // USTAR prefix field
  }
  header.set(octalField(0o644, 8), 100); // mode
  header.set(octalField(0, 8), 108); // uid
  header.set(octalField(0, 8), 116); // gid
  header.set(octalField(size, 12), 124); // size
  // tar records mtime as Unix epoch seconds (UTC); zip's DOS field is local
  // wall time. Same instant, different conventions — that is the formats, not us.
  header.set(octalField(Math.floor(mtime.getTime() / 1000), 12), 136); // mtime
  header[156] = 0x30; // typeflag '0' (regular file)
  header.set(encoder.encode("ustar\0"), 257); // magic
  header.set(encoder.encode("00"), 263); // version

  // Checksum: sum of all header bytes with the checksum field filled with spaces.
  header.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  header.set(encoder.encode(`${checksum.toString(8).padStart(6, "0")}\0 `), 148);

  return header;
}

/** Streams entries into a gzip-compressed USTAR tar, holding only a window in RAM. */
async function packTarGz(
  files: AdxArchiveInput[],
  type: string,
  mtime: Date,
  onProgress?: ArchiveProgressCallback
): Promise<Blob> {
  const sink = createBlobSink();
  const progress = createProgressReporter(files, onProgress);
  progress.emit();
  const gzip = new Gzip({ mtime }, (data) => sink.push(data));

  for (const file of files) {
    const size = file.blob.size;
    progress.startFile(file.name);
    gzip.push(tarHeader(file.name, size, mtime), false);
    await streamBlob(file.blob, (chunk) => {
      gzip.push(chunk, false);
      progress.addBytes(chunk.length);
    });
    const remainder = size % 512;
    if (remainder !== 0) {
      gzip.push(new Uint8Array(512 - remainder), false); // pad data to a 512-byte boundary
    }
    progress.finishFile(file.name);
  }

  gzip.push(new Uint8Array(1024), true); // two zero blocks mark end of archive + final flush
  progress.finish();
  return sink.finish(type);
}

export async function buildArchiveBlob(
  files: AdxArchiveInput[],
  format: ArchiveFormat = "adx",
  directoryName?: string,
  onProgress?: ArchiveProgressCallback,
  mtime?: Date
): Promise<Blob> {
  if (files.length === 0) {
    throw new Error("Directory is empty");
  }

  // Always tag as generic binary. A specific type (e.g. application/zip) makes
  // browsers "correct" the download name by appending the canonical extension
  // (e.g. "39.adx.zip"); octet-stream keeps the extension we set on the anchor.
  const type = "application/octet-stream";
  const stamp = archiveTimestamp(mtime);
  const entries = withRootDirectory(files, directoryName);
  return format === "tar.gz"
    ? packTarGz(entries, type, stamp, onProgress)
    : packZip(entries, type, stamp, onProgress);
}

/**
 * Builds one archive containing multiple chart folders. When `directoryName`
 * is provided, it becomes the top-level collection folder. Charts may also
 * carry `groupDir`, yielding paths like:
 * <collection>/<version>/<chart>/maidata.txt or <version>/<chart>/maidata.txt.
 */
export async function buildNestedArchiveBlob(
  charts: NestedChart[],
  format: BatchArchiveFormat = "adx",
  directoryName?: string,
  onProgress?: ArchiveProgressCallback,
  mtime?: Date
): Promise<Blob> {
  if (charts.length === 0) {
    throw new Error("No charts selected");
  }

  const type = "application/octet-stream";
  const stamp = archiveTimestamp(mtime);
  const rootedEntries = nestedArchiveFiles(charts, directoryName);
  return format === "tar.gz"
    ? packTarGz(rootedEntries, type, stamp, onProgress)
    : packZip(rootedEntries, type, stamp, onProgress);
}
