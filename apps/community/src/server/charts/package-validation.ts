import { createReadStream } from "node:fs";
import { open, mkdtemp, readFile, rm, stat, writeFile, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import sharp from "sharp";
import * as yauzl from "yauzl";
import type { ChartPackageInspection } from "../../shared/charts";
import { inspectContainer } from "../../media-worker/image-child";
import { ChartImportError } from "./errors";
import { summarizeMaidata } from "./maidata-summary";
import { writeChartArtifact, type ChartArtifactInput } from "./artifact";

// @types/yauzl 2.x omits the public reference methods used by reader subclasses.
declare module "yauzl" { interface RandomAccessReader { ref(): void; unref(): void } }

export { ChartImportError } from "./errors";
const MAX_SOURCE = 67_108_864, MAX_EXPANDED = 134_217_728, MAX_ENTRIES = 128;
function fail(code: ConstructorParameters<typeof ChartImportError>[0]): never { throw new ChartImportError(code); }
const CRC_TABLE = new Uint32Array(256);
for (let value = 0; value < 256; value++) { let crc = value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); CRC_TABLE[value] = crc >>> 0; }
function updateCrc(crc: number, bytes: Uint8Array): number { for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]; return crc >>> 0; }

export function normalizeChartEntryPath(name: string, directory = false): string {
  if (!name || name.startsWith("/") || /^[a-z]:/i.test(name) || /[\\\p{Cc}]/u.test(name)) fail("CHART_PATH_INVALID");
  const path = (directory && name.endsWith("/") ? name.slice(0, -1) : name).normalize("NFC"), parts = path.split("/");
  if (Buffer.byteLength(path, "utf8") > 240 || parts.length > 8 || parts.some((part) => !part || part === "." || part === "..")) fail("CHART_PATH_INVALID");
  return path;
}
function zipError(error: unknown): Error {
  if (error instanceof ChartImportError) return error;
  const message = error instanceof Error ? error.message : "";
  if (/invalid relative path|absolute path|backslash|invalid characters in fileName/i.test(message)) return new ChartImportError("CHART_PATH_INVALID");
  if (/multi.disk|encryption|compression method/i.test(message)) return new ChartImportError("CHART_ARCHIVE_UNSUPPORTED");
  // Filesystem/network/process errors remain retryable rather than blaming the uploaded package.
  if (error instanceof Error && "code" in error && typeof error.code === "string" && /^(EIO|ENOENT|ENOSPC|EACCES|EMFILE|ENFILE)$/.test(error.code)) return error;
  return new ChartImportError("CHART_PACKAGE_INVALID");
}
type PackageEntry = { entry: yauzl.Entry; path: string; directory: boolean; ignored: boolean };
/** yauzl's legacy fd-slicer stream stalls under pinned Bun; its supported reader API keeps native range streams. */
class NativeZipReader extends yauzl.RandomAccessReader {
  constructor(private readonly file: FileHandle, private readonly path: string) { super(); }
  // The stream owns a separate descriptor. Bun's explicit destroy can close a
  // supplied fd even with autoClose:false, which must never close directory reads.
  _readStreamForRange(start: number, end: number): Readable { return createReadStream(this.path, { start, end: end - 1 }); }
  createReadStream(options?: { start?: number; end?: number }): Readable {
    const start = options?.start, end = options?.end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start! < 0 || end! < start!) throw new Error("Invalid ZIP read range");
    const stream = start === end ? Readable.from([]) : this._readStreamForRange(start!, end!);
    this.ref(); let released = false;
    const release = () => { if (!released) { released = true; this.unref(); } };
    stream.once("end", release); stream.once("close", release);
    return stream;
  }
  read(buffer: Buffer, offset: number, length: number, position: number, callback: (error: Error | null, bytesRead?: number, buffer?: Buffer) => void): void {
    this.file.read(buffer, offset, length, position).then(({ bytesRead }) => {
      // yauzl does not expose the central header's disk-start field on Entry.
      if (bytesRead === 46 && length === 46 && buffer.readUInt32LE(offset) === 0x02014b50 && buffer.readUInt16LE(offset + 34) !== 0) return callback(new ChartImportError("CHART_ARCHIVE_UNSUPPORTED"));
      callback(null, bytesRead, buffer);
    }, (error) => callback(error));
  }
  close(callback: (error: Error | null) => void): void { this.file.close().then(() => callback(null), (error) => callback(error)); }
}
async function openZip(path: string): Promise<yauzl.ZipFile> {
  const file = await open(path, "r"), reader = new NativeZipReader(file, path);
  try {
    const size = (await file.stat()).size;
    await validateSingleDisk(file, size);
    return await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.fromRandomAccessReader(reader, size, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (error, zip) => error || !zip ? reject(zipError(error)) : resolve(zip)));
  } catch (error) { await file.close().catch(() => {}); throw error; }
}
async function validateSingleDisk(file: FileHandle, size: number): Promise<void> {
  const tail = Buffer.alloc(Math.min(size, 65577));
  if ((await file.read(tail, 0, tail.length, size - tail.length)).bytesRead !== tail.length) fail("CHART_PACKAGE_INVALID");
  for (let index = tail.length - 22; index >= 0; index--) {
    if (tail.readUInt32LE(index) !== 0x06054b50 || index + 22 + tail.readUInt16LE(index + 20) !== tail.length) continue;
    if (tail.readUInt16LE(index + 4) !== 0 || tail.readUInt16LE(index + 6) !== 0 || tail.readUInt16LE(index + 8) !== tail.readUInt16LE(index + 10)) fail("CHART_ARCHIVE_UNSUPPORTED");
    if (index >= 20 && tail.readUInt32LE(index - 20) === 0x07064b50) {
      const locator = tail.subarray(index - 20, index);
      if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) fail("CHART_ARCHIVE_UNSUPPORTED");
      const offset = locator.readBigUInt64LE(8);
      if (offset + 56n > BigInt(size)) fail("CHART_PACKAGE_INVALID");
      const record = Buffer.alloc(56);
      if ((await file.read(record, 0, 56, Number(offset))).bytesRead !== 56 || record.readUInt32LE(0) !== 0x06064b50) fail("CHART_PACKAGE_INVALID");
      if (record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0 || record.readBigUInt64LE(24) !== record.readBigUInt64LE(32)) fail("CHART_ARCHIVE_UNSUPPORTED");
    }
    return;
  }
  fail("CHART_PACKAGE_INVALID");
}
function listEntries(zip: yauzl.ZipFile, signal?: AbortSignal): Promise<PackageEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: PackageEntry[] = [], paths = new Set<string>();
    const finish = (error?: unknown) => { cleanup(); if (error) reject(error); else resolve(entries); };
    const abort = () => finish(signal?.reason ?? new Error("aborted"));
    const error = (error: unknown) => finish(zipError(error));
    const end = () => finish();
    const entry = (entry: yauzl.Entry) => {
      try {
        signal?.throwIfAborted();
        if (entries.length >= MAX_ENTRIES) fail("CHART_ENTRY_LIMIT");
        if ((entry.generalPurposeBitFlag & 0x41) !== 0 || ![0, 8].includes(entry.compressionMethod)) fail("CHART_ARCHIVE_UNSUPPORTED");
        const directory = entry.fileName.endsWith("/"), unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (unixType && unixType !== (directory ? 0o040000 : 0o100000)) fail("CHART_ARCHIVE_UNSUPPORTED");
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > MAX_EXPANDED || (directory && entry.uncompressedSize !== 0)) fail("CHART_EXPANDED_LIMIT");
        const path = normalizeChartEntryPath(entry.fileName, directory), collision = path.toLowerCase();
        if (paths.has(collision)) fail("CHART_PATH_COLLISION"); paths.add(collision);
        const parts = path.split("/");
        entries.push({ entry, path, directory, ignored: parts.includes("__MACOSX") || parts.at(-1) === ".DS_Store" });
        zip.readEntry();
      } catch (error) { finish(error); }
    };
    const cleanup = () => { zip.removeListener("entry", entry); zip.removeListener("end", end); zip.removeListener("error", error); signal?.removeEventListener("abort", abort); };
    zip.on("entry", entry); zip.once("end", end); zip.once("error", error); signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort(); else zip.readEntry();
  });
}
function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, { decompress: entry.compressionMethod === 8 ? false : null, decrypt: null, start: null, end: null }, (error, stream) => {
    if (error || !stream) return reject(zipError(error));
    if (entry.compressionMethod === 0) return resolve(stream);
    // Fixed Bun also stalls yauzl's old function-style Transform wrappers. Native
    // inflate stays streamed; our reader loop enforces exact actual size and CRC.
    const inflate = createInflateRaw();
    stream.on("error", (error) => inflate.destroy(error));
    inflate.once("close", () => { stream.unpipe(inflate); stream.destroy(); });
    stream.pipe(inflate); resolve(inflate);
  }));
}
function select(entries: PackageEntry[], preferred: RegExp, fallback: RegExp, required = false): PackageEntry | undefined {
  const priority = entries.filter((entry) => preferred.test(entry.path));
  const choices = priority.length ? priority : entries.filter((entry) => fallback.test(entry.path));
  if (choices.length > 1) fail("CHART_ASSET_AMBIGUOUS");
  if (required && choices.length !== 1) fail("CHART_MAIDATA_MISSING");
  return choices[0];
}
async function sniffAudio(path: string): Promise<"audio/mpeg" | "audio/ogg" | "audio/wav"> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size, head = Buffer.alloc(Math.min(size, 4096));
    if ((await file.read(head, 0, head.length, 0)).bytesRead !== head.length || head.length < 4) fail("CHART_ASSET_INVALID");
    if (head.toString("ascii", 0, 4) === "OggS" && head.length >= 27 && head[4] === 0 && (head[5] & ~7) === 0 && head.length >= 27 + head[26]) {
      const headerSize = 27 + head[26], bodySize = head.subarray(27, headerSize).reduce((total, value) => total + value, 0);
      if (headerSize + bodySize <= size) return "audio/ogg";
    }
    if (head.toString("ascii", 0, 4) === "RIFF" && head.length >= 36 && head.toString("ascii", 8, 12) === "WAVE" && head.readUInt32LE(4) + 8 === size) {
      let offset = 12, inspected = head.length, format = false, data = false;
      const chunk = Buffer.alloc(16);
      while (offset + 8 <= size && inspected + 16 <= 8192) {
        if ((await file.read(chunk, 0, 8, offset)).bytesRead !== 8) fail("CHART_ASSET_INVALID"); inspected += 8;
        const length = chunk.readUInt32LE(4), tag = chunk.toString("ascii", 0, 4);
        if (offset + 8 + length > size) fail("CHART_ASSET_INVALID");
        if (tag === "fmt ") { if (length < 16 || (await file.read(chunk, 0, 16, offset + 8)).bytesRead !== 16) fail("CHART_ASSET_INVALID"); inspected += 16; format = [1, 3, 0xfffe].includes(chunk.readUInt16LE(0)) && chunk.readUInt16LE(2) > 0 && chunk.readUInt32LE(4) > 0; }
        if (tag === "data") data = length > 0;
        offset += 8 + length + (length & 1);
      }
      if (format && data && offset === size) return "audio/wav";
    }
    let start = 0;
    if (head.toString("ascii", 0, 3) === "ID3") {
      if (head.length < 10 || head[3] < 2 || head[3] > 4 || head.subarray(6, 10).some((value) => value >= 128)) fail("CHART_ASSET_INVALID");
      start = 10 + ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]) + ((head[5] & 0x10) ? 10 : 0);
    }
    const frame = Buffer.alloc(4);
    if (start + 4 <= size && (await file.read(frame, 0, 4, start)).bytesRead === 4 && frame[0] === 255 && (frame[1] & 0xe0) === 0xe0 && (frame[1] & 6) !== 0 && (frame[1] & 0x18) !== 8 && (frame[2] & 0xf0) !== 0 && (frame[2] & 0xf0) !== 0xf0 && (frame[2] & 0x0c) !== 0x0c) return "audio/mpeg";
    return fail("CHART_ASSET_INVALID");
  } finally { await file.close(); }
}
async function renderCover(path: string, output: string): Promise<void> {
  let bytes: Buffer;
  try {
    const format = await inspectContainer(path);
    if (!["jpeg", "png", "webp"].includes(format)) fail("CHART_ASSET_INVALID");
    const image = sharp(path, { failOn: "warning", limitInputPixels: 16000000 }), meta = await image.metadata();
    if (meta.format !== format || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height || meta.width > 8192 || meta.height > 8192 || meta.width * meta.height > 16000000) fail("CHART_ASSET_INVALID");
    bytes = await image.rotate().toColourspace("srgb").resize(1024, 1024, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 85, progressive: false }).toBuffer();
    if (bytes.length > 1048576) fail("CHART_ASSET_TOO_LARGE");
  } catch (error) {
    if (error instanceof ChartImportError) throw error;
    // Existing image container rejections are translated into this purpose's stable import code.
    if (error && typeof error === "object" && "code" in error && /^(EIO|ENOENT|ENOSPC|EACCES)$/.test(String(error.code))) throw error;
    return fail("CHART_ASSET_INVALID");
  }
  await writeFile(output, bytes, { mode: 0o600 });
}

/** No output is published until every entry, including ignored files, passes actual length and CRC. */
export async function inspectChartPackage(inputPath: string, outputPath: string, signal?: AbortSignal): Promise<ChartPackageInspection> {
  signal?.throwIfAborted();
  const inputSize = (await stat(inputPath)).size;
  if (inputSize < 1 || inputSize > MAX_SOURCE) fail("CHART_ASSET_TOO_LARGE");
  const zip = await openZip(inputPath);
  const closed = new Promise<void>((resolve) => zip.once("close", resolve));
  let scratch: string | undefined, active: Readable | undefined;
  const abort = () => active?.destroy(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
  const lateError = (error: Error) => active?.destroy(zipError(error));
  zip.on("error", lateError); signal?.addEventListener("abort", abort, { once: true });
  try {
    scratch = await mkdtemp(join(dirname(outputPath), ".chart-selected-"));
    const entries = await listEntries(zip, signal), files = entries.filter((entry) => !entry.directory && !entry.ignored);
    if (!files.length) fail("CHART_MAIDATA_MISSING");
    // Strip exactly one shared wrapping directory, never recursively guess a multi-song tree.
    const first = files[0].path.split("/")[0];
    const wrapped = files.every((entry) => entry.path.includes("/") && entry.path.split("/")[0] === first);
    const candidates = files.map((entry) => ({ ...entry, path: wrapped ? entry.path.slice(first.length + 1) : entry.path }));
    if (candidates.some((entry) => entry.path.includes("/"))) fail("CHART_PACKAGE_INVALID");
    const maidata = select(candidates, /^maidata\.txt$/i, /\.txt$/i, true)!;
    const audio = select(candidates, /^track\.(mp3|ogg|wav)$/i, /\.(mp3|ogg|wav)$/i);
    const cover = select(candidates, /^bg\.(jpe?g|png|webp)$/i, /\.(jpe?g|png|webp)$/i);
    const selected = new Map<yauzl.Entry, { path: string; limit: number }>([[maidata.entry, { path: join(scratch, "maidata"), limit: 1048576 }]]);
    if (audio) selected.set(audio.entry, { path: join(scratch, "audio"), limit: 33554432 });
    if (cover) selected.set(cover.entry, { path: join(scratch, "cover-source"), limit: 8388608 });
    let expanded = 0;
    for (const item of entries) {
      signal?.throwIfAborted();
      if (item.directory) continue;
      const target = selected.get(item.entry);
      if (target && (item.entry.uncompressedSize < 1 || item.entry.uncompressedSize > target.limit)) fail("CHART_ASSET_TOO_LARGE");
      const file = target ? await open(target.path, "wx", 0o600) : undefined;
      let size = 0, crc = 0xffffffff;
      try {
        active = await readEntry(zip, item.entry);
        if (signal?.aborted) abort();
        for await (const chunk of active) {
          signal?.throwIfAborted(); const bytes = Buffer.from(chunk);
          expanded += bytes.length; size += bytes.length;
          if (expanded > MAX_EXPANDED) fail("CHART_EXPANDED_LIMIT");
          if (target && size > target.limit) fail("CHART_ASSET_TOO_LARGE");
          if (size > item.entry.uncompressedSize) fail("CHART_PACKAGE_INVALID");
          crc = updateCrc(crc, bytes);
          if (file) { let offset = 0; while (offset < bytes.length) { const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset); if (!bytesWritten) throw new Error("entry write failed"); offset += bytesWritten; } }
        }
        if (size !== item.entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== item.entry.crc32) fail("CHART_PACKAGE_INVALID");
      } catch (error) { if (signal?.aborted) signal.throwIfAborted(); throw zipError(error); }
      finally { active?.destroy(); active = undefined; await file?.close(); }
    }
    const summary = summarizeMaidata(await readFile(selected.get(maidata.entry)!.path));
    const inputs: ChartArtifactInput[] = [{ role: "maidata", path: maidata.path, mime: "text/plain; charset=utf-8", inputPath: selected.get(maidata.entry)!.path }];
    if (audio) {
      const path = selected.get(audio.entry)!.path, mime = await sniffAudio(path), expected = audio.path.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : audio.path.toLowerCase().endsWith(".ogg") ? "audio/ogg" : "audio/wav";
      if (mime !== expected) fail("CHART_ASSET_INVALID");
      summary.audio = { mime, size: (await stat(path)).size }; inputs.push({ role: "audio", path: audio.path, mime, inputPath: path });
    } else if (summary.warnings.length < 63) summary.warnings.push({ code: "AUDIO_MISSING" });
    if (cover) { const path = join(scratch, "cover.jpg"); await renderCover(selected.get(cover.entry)!.path, path); summary.hasCover = true; inputs.push({ role: "cover", path: cover.path.replace(/\.[^.]+$/, ".jpg"), mime: "image/jpeg", inputPath: path }); }
    if (candidates.some((entry) => /\.(mp4|avi|webm|mov|mkv)$/i.test(entry.path)) && summary.warnings.length < 63) summary.warnings.push({ code: "ASSET_NOT_PREVIEWED" });
    const result = await writeChartArtifact(outputPath, summary, inputs, signal);
    return { summary, ...result };
  } finally {
    active?.destroy(); signal?.removeEventListener("abort", abort); zip.close(); await closed; zip.removeListener("error", lateError);
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}
