import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import type { ChartAssetRole, ChartImportSummary, ChartPreviewManifest } from "../../shared/charts";
import { ChartImportError } from "./errors";

export const CHART_ARTIFACT_MAGIC = Buffer.from("ADXCPV1\0", "ascii");
export const CHART_ARTIFACT_MIME = "application/vnd.astrodx.chart-preview";
const MAX_MANIFEST = 32_768, MAX_ARTIFACT = 50_331_648;
function invalid(): never { throw new ChartImportError("CHART_PACKAGE_INVALID"); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function chartManifestBytes(manifest: ChartPreviewManifest): Buffer { return Buffer.from(JSON.stringify(canonical(manifest)), "utf8"); }
export function chartArtifactDataStart(manifest: ChartPreviewManifest): number { return 12 + chartManifestBytes(manifest).length; }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const string = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key));
function validateSummary(value: unknown): asserts value is ChartImportSummary {
  if (!object(value) || !keys(value, ["title", "artist", "maidataMd5Base64", "difficulties", "warnings", "audio", "hasCover"]) || !string(value.title, 120) || !string(value.artist, 120) || typeof value.maidataMd5Base64 !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(value.maidataMd5Base64) || typeof value.hasCover !== "boolean") invalid();
  if (!Array.isArray(value.difficulties) || value.difficulties.length < 1 || value.difficulties.length > 7 || !Array.isArray(value.warnings) || value.warnings.length > 64) invalid();
  const seen = new Set<number>();
  for (const item of value.difficulties) {
    if (!object(item) || !keys(item, ["difficulty", "level", "designer", "noteCount", "durationMs", "previewSupported"]) || !(item.designer === undefined || string(item.designer, 240)) || !integer(item.difficulty, 1, 7) || seen.has(item.difficulty) || !(item.level === null || string(item.level, 120)) || !(item.noteCount === null || integer(item.noteCount, 0, 100000)) || !(item.durationMs === null || integer(item.durationMs, 0, 3600000)) || typeof item.previewSupported !== "boolean" || (item.previewSupported && (item.noteCount === null || item.durationMs === null))) invalid();
    seen.add(item.difficulty);
  }
  for (const item of value.warnings) if (!object(item) || !keys(item, ["code", "difficulty", "line"]) || typeof item.code !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(item.code) || !(item.difficulty === undefined || integer(item.difficulty, 1, 7)) || !(item.line === undefined || integer(item.line, 1, 1048576))) invalid();
  if (value.audio !== null && (!object(value.audio) || !keys(value.audio, ["mime", "size"]) || !["audio/mpeg", "audio/ogg", "audio/wav"].includes(value.audio.mime as string) || !integer(value.audio.size, 1, 33554432))) invalid();
}

/** Validate both the shape and byte segmentation before a DB manifest is used for a private Range. */
export function validateChartPreviewManifest(value: unknown, artifactSize?: number): ChartPreviewManifest {
  if (!object(value) || !keys(value, ["format", "assets", "summary"]) || value.format !== 1 || !Array.isArray(value.assets) || value.assets.length < 1 || value.assets.length > 3) invalid();
  validateSummary(value.summary);
  let offset = 0, previousRole = -1;
  for (const asset of value.assets) {
    if (!object(asset) || !keys(asset, ["role", "path", "mime", "size", "sha256", "offset"]) || typeof asset.role !== "string" || typeof asset.path !== "string" || typeof asset.mime !== "string" || !integer(asset.size, 1, 33554432) || asset.offset !== offset || typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256)) invalid();
    const role = ["maidata", "audio", "cover"].indexOf(asset.role);
    if (role <= previousRole || role < 0 || (previousRole < 0 && role !== 0)) invalid();
    previousRole = role;
    const parts = asset.path.split("/");
    if (asset.path.normalize("NFC") !== asset.path || Buffer.byteLength(asset.path) > 240 || parts.length > 8 || parts.some((part) => !part || part === "." || part === "..") || /[\\\p{Cc}]/u.test(asset.path) || /^[a-z]:/i.test(asset.path)) invalid();
    if (role === 0 && (asset.size > 1048576 || asset.mime !== "text/plain; charset=utf-8")) invalid();
    if (role === 1 && (!value.summary.audio || asset.mime !== value.summary.audio.mime || asset.size !== value.summary.audio.size)) invalid();
    if (role === 2 && (!value.summary.hasCover || asset.size > 1048576 || asset.mime !== "image/jpeg")) invalid();
    offset += asset.size;
  }
  if (value.assets.some((asset) => asset.role === "audio") !== (value.summary.audio !== null) || value.assets.some((asset) => asset.role === "cover") !== value.summary.hasCover) invalid();
  const manifest = value as unknown as ChartPreviewManifest, bytes = chartManifestBytes(manifest);
  if (bytes.length > MAX_MANIFEST || 12 + bytes.length + offset > MAX_ARTIFACT || (artifactSize !== undefined && (!integer(artifactSize, 12, MAX_ARTIFACT) || artifactSize !== 12 + bytes.length + offset))) invalid();
  return manifest;
}

export async function readChartArtifactManifest(path: string): Promise<{ manifest: ChartPreviewManifest; dataStart: number }> {
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(12);
    if ((await file.read(header, 0, 12, 0)).bytesRead !== 12 || !header.subarray(0, 8).equals(CHART_ARTIFACT_MAGIC)) invalid();
    const size = header.readUInt32LE(8);
    if (!integer(size, 1, MAX_MANIFEST)) invalid();
    const bytes = Buffer.alloc(size);
    if ((await file.read(bytes, 0, size, 12)).bytesRead !== size) invalid();
    let decoded: unknown;
    try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return invalid(); }
    const manifest = validateChartPreviewManifest(decoded, (await file.stat()).size);
    if (!chartManifestBytes(manifest).equals(bytes)) invalid();
    return { manifest, dataStart: 12 + size };
  } finally { await file.close(); }
}

export type ChartArtifactInput = { role: ChartAssetRole; path: string; mime: string; inputPath: string };
/** Inputs are trusted selected scratch files; each remains disk backed and is rehashed while copied. */
export async function writeChartArtifact(outputPath: string, summary: ChartImportSummary, inputs: ChartArtifactInput[], signal?: AbortSignal): Promise<{ manifest: ChartPreviewManifest; artifact: { path: string; size: number; sha256: string } }> {
  const assets: ChartPreviewManifest["assets"] = []; let offset = 0;
  for (const input of inputs) {
    signal?.throwIfAborted();
    const size = (await stat(input.inputPath)).size, hash = createHash("sha256");
    if (!integer(size, 1, input.role === "audio" ? 33554432 : 1048576)) invalid();
    let total = 0;
    for await (const bytes of createReadStream(input.inputPath, { signal })) { total += bytes.length; if (total > size) invalid(); hash.update(bytes); }
    if (total !== size) invalid();
    assets.push({ role: input.role, path: input.path, mime: input.mime, size, sha256: hash.digest("hex"), offset }); offset += size;
  }
  const manifest = validateChartPreviewManifest({ format: 1, assets, summary }), manifestBytes = chartManifestBytes(manifest), header = Buffer.alloc(12);
  CHART_ARTIFACT_MAGIC.copy(header); header.writeUInt32LE(manifestBytes.length, 8);
  const file = await open(outputPath, "wx", 0o600), digest = createHash("sha256"); let written = 0, success = false;
  const write = async (bytes: Buffer) => {
    signal?.throwIfAborted(); written += bytes.length; if (written > MAX_ARTIFACT) invalid(); digest.update(bytes);
    let position = 0;
    while (position < bytes.length) { const { bytesWritten } = await file.write(bytes, position, bytes.length - position); if (!bytesWritten) throw new Error("artifact write failed"); position += bytesWritten; }
  };
  try {
    await write(header); await write(manifestBytes);
    for (let index = 0; index < inputs.length; index++) {
      const hash = createHash("sha256"); let size = 0;
      for await (const chunk of createReadStream(inputs[index].inputPath, { signal })) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > assets[index].size) invalid(); hash.update(bytes); await write(bytes); }
      if (size !== assets[index].size || hash.digest("hex") !== assets[index].sha256) invalid();
    }
    validateChartPreviewManifest(manifest, written); success = true;
    return { manifest, artifact: { path: outputPath, size: written, sha256: digest.digest("hex") } };
  } finally { await file.close(); if (!success) await rm(outputPath, { force: true }); }
}
