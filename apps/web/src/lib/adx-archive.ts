import { Gzip, Zip, ZipPassThrough } from "fflate";

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

type ArchiveProgressCallback = (progress: ArchiveProgress) => void;

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

function archivePathSegment(value: string): string {
  const cleaned = value.trim().replace(/[\\/]+/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 && cleaned !== "." ? cleaned : "chart";
}

function withRootDirectory(
  files: AdxArchiveInput[],
  directoryName?: string
): AdxArchiveInput[] {
  if (!directoryName) {
    return files;
  }
  const root = archivePathSegment(directoryName);
  return files.map((file) => ({ ...file, name: `${root}/${file.name}` }));
}

// Output accumulates into a growing Blob rather than one big buffer, so the
// browser can spill it to disk and peak memory stays a small constant regardless
// of how large the archive gets. ~4 MB of streamed chunks per merge keeps the
// Blob's part list short without holding much in RAM.
const OUTPUT_FLUSH_BYTES = 4 * 1024 * 1024;

type BlobSink = {
  push: (chunk: Uint8Array) => void;
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
  return {
    push(chunk) {
      if (chunk.length === 0) {
        return;
      }
      pending.push(chunk);
      pendingBytes += chunk.length;
      if (pendingBytes >= OUTPUT_FLUSH_BYTES) {
        blob = new Blob([blob, ...(pending as BlobPart[])]);
        pending = [];
        pendingBytes = 0;
      }
    },
    finish(type) {
      return new Blob([blob, ...(pending as BlobPart[])], { type });
    },
  };
}

/** Reads a Blob to the end in chunks, never materialising the whole thing in RAM. */
async function streamBlob(blob: Blob, onChunk: (chunk: Uint8Array) => void): Promise<void> {
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    onChunk(value);
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
  const sink = createBlobSink();
  const progress = createProgressReporter(files, onProgress);
  progress.emit();
  let zipError: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err) {
      zipError = err;
      return;
    }
    sink.push(data);
  });

  for (const file of files) {
    if (zipError) {
      break;
    }
    const entry = new ZipPassThrough(file.name);
    entry.mtime = mtime;
    zip.add(entry);
    progress.startFile(file.name);
    await streamBlob(file.blob, (chunk) => {
      entry.push(chunk);
      progress.addBytes(chunk.length);
    });
    entry.push(new Uint8Array(0), true);
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
    encoder.encode(value.toString(8).padStart(length - 1, "0") + "\0");

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
  header.set(encoder.encode(checksum.toString(8).padStart(6, "0") + "\0 "), 148);

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

/** Combined archive formats for a batch download. `.adx` is zip-compatible. */
export type BatchArchiveFormat = ArchiveFormat;

export const BATCH_FORMATS: readonly BatchArchiveFormat[] = ["adx", "zip", "tar.gz"];

/**
 * One chart in a batch: a folder name plus its asset files. `groupDir` inserts
 * an optional folder above the chart, such as a maimai version in multi-version
 * downloads.
 */
export type NestedChart = { name: string; files: AdxArchiveInput[]; groupDir?: string };

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

  const usedByGroup = new Map<string, Set<string>>();
  const entries: AdxArchiveInput[] = [];
  for (const chart of charts) {
    if (chart.files.length === 0) {
      throw new Error(`Chart has no files: ${chart.name}`);
    }

    const safeGroupName = chart.groupDir ? archivePathSegment(chart.groupDir) : "";
    const usedKey = safeGroupName || ".";
    const used = usedByGroup.get(usedKey) ?? new Set<string>();
    usedByGroup.set(usedKey, used);

    // Disambiguate the case where two selected charts share a directory name in
    // the same group; identical names in different version folders can stay as-is.
    const safeChartName = archivePathSegment(chart.name);
    let directoryName = safeChartName;
    for (let copy = 2; used.has(directoryName); copy += 1) {
      directoryName = `${safeChartName} (${copy})`;
    }
    used.add(directoryName);

    const chartEntries = withRootDirectory(chart.files, directoryName);
    entries.push(
      ...(safeGroupName ? withRootDirectory(chartEntries, safeGroupName) : chartEntries)
    );
  }

  const type = "application/octet-stream";
  const stamp = archiveTimestamp(mtime);
  const rootedEntries = withRootDirectory(entries, directoryName);
  return format === "tar.gz"
    ? packTarGz(rootedEntries, type, stamp, onProgress)
    : packZip(rootedEntries, type, stamp, onProgress);
}

export function saveBlobAsFile(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();

  queueMicrotask(() => URL.revokeObjectURL(objectUrl));
}
