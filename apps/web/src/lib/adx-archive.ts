import { Gzip, Zip, ZipPassThrough } from "fflate";

/** One archive entry: an in-archive name plus its bytes, held as a (disk-backable) Blob. */
export type AdxArchiveInput = {
  name: string;
  blob: Blob;
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

// Output accumulates into a growing Blob rather than one big buffer, so the
// browser can spill it to disk and peak memory stays a small constant regardless
// of how large the archive gets. ~4 MB of streamed chunks per merge keeps the
// Blob's part list short without holding much in RAM.
const OUTPUT_FLUSH_BYTES = 4 * 1024 * 1024;

type BlobSink = {
  push: (chunk: Uint8Array) => void;
  finish: (type: string) => Blob;
};

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

/**
 * Streams every entry's bytes into a STORE (uncompressed) zip. The payloads are
 * already-compressed media (mp3/mp4/png), so deflate would burn CPU for ~0 gain;
 * STORE also lets fflate pass bytes straight through with negligible buffering.
 * `.adx` and `.zip` are byte-for-byte the same archive; only the extension differs.
 */
async function packZip(files: AdxArchiveInput[], type: string): Promise<Blob> {
  const sink = createBlobSink();
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
    zip.add(entry);
    await streamBlob(file.blob, (chunk) => entry.push(chunk));
    entry.push(new Uint8Array(0), true);
  }

  zip.end();
  if (zipError) {
    throw zipError;
  }
  return sink.finish(type);
}

/** Builds a USTAR tar header block (512 bytes) for one file. Deterministic (no mtime/owner). */
function tarHeader(name: string, size: number): Uint8Array {
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

  return header;
}

/** Streams entries into a gzip-compressed USTAR tar, holding only a window in RAM. */
async function packTarGz(files: AdxArchiveInput[], type: string): Promise<Blob> {
  const sink = createBlobSink();
  const gzip = new Gzip({ mtime: 0 }, (data) => sink.push(data));

  for (const file of files) {
    const size = file.blob.size;
    gzip.push(tarHeader(file.name, size), false);
    await streamBlob(file.blob, (chunk) => gzip.push(chunk, false));
    const remainder = size % 512;
    if (remainder !== 0) {
      gzip.push(new Uint8Array(512 - remainder), false); // pad data to a 512-byte boundary
    }
  }

  gzip.push(new Uint8Array(1024), true); // two zero blocks mark end of archive + final flush
  return sink.finish(type);
}

export async function buildArchiveBlob(
  files: AdxArchiveInput[],
  format: ArchiveFormat = "adx"
): Promise<Blob> {
  if (files.length === 0) {
    throw new Error("Directory is empty");
  }

  // Always tag as generic binary. A specific type (e.g. application/zip) makes
  // browsers "correct" the download name by appending the canonical extension
  // (e.g. "39.adx.zip"); octet-stream keeps the extension we set on the anchor.
  const type = "application/octet-stream";
  return format === "tar.gz" ? packTarGz(files, type) : packZip(files, type);
}

/** Outer container formats for a batch download (`.adx` is per-chart only, so excluded). */
export type BatchArchiveFormat = Exclude<ArchiveFormat, "adx">;

export const BATCH_FORMATS: readonly BatchArchiveFormat[] = ["zip", "tar.gz"];

/** One chart in a batch: a folder name plus its asset files (packed into a single `.adx`). */
export type NestedChart = { name: string; files: AdxArchiveInput[] };

/**
 * Builds a batch archive: each chart becomes its own `.adx` (a zip of that chart's files),
 * and all the `.adx` files are packed into one outer container (`.zip` by default). Charts
 * are processed one at a time, so peak memory is bounded by a single chart, not the batch.
 */
export async function buildNestedArchiveBlob(
  charts: NestedChart[],
  format: BatchArchiveFormat = "zip"
): Promise<Blob> {
  if (charts.length === 0) {
    throw new Error("No charts selected");
  }

  const used = new Set<string>();
  const entries: AdxArchiveInput[] = [];
  for (const chart of charts) {
    if (chart.files.length === 0) {
      throw new Error(`Chart has no files: ${chart.name}`);
    }

    const adxBlob = await packZip(chart.files, "application/octet-stream");

    // Disambiguate the rare case where two selected charts share a directory name.
    let name = `${chart.name}.adx`;
    for (let copy = 2; used.has(name); copy += 1) {
      name = `${chart.name} (${copy}).adx`;
    }
    used.add(name);

    entries.push({ name, blob: adxBlob });
  }

  const type = "application/octet-stream";
  return format === "tar.gz" ? packTarGz(entries, type) : packZip(entries, type);
}

export function saveBlobAsFile(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();

  queueMicrotask(() => URL.revokeObjectURL(objectUrl));
}
