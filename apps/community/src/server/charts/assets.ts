import { and, eq, inArray, isNull } from "drizzle-orm";
import type { ChartAssetRole } from "@/shared/charts";
import { blobBlocks, blobDerivatives, blobs, chartVersions, charts, derivedObjects, files, user } from "../db/schema";
import type { StorageContext } from "../storage/contracts";
import { StorageError, StorageUnavailableError } from "../storage/errors";
import { mediaDenial } from "../storage/files";
import { parseRange } from "../storage/range";
import { UUID_PATTERN } from "../uuid";
import { chartArtifactDataStart, validateChartPreviewManifest } from "./artifact";
import { CHART_PREVIEW_MIME } from "./recipe";

export type ChartAssetRepresentation = {
  key: string; artifactSize: number; artifactSha256: string; artifactMime: string;
  start: number; size: number; mime: string; sha256: string;
};
/** This uses the version's recorded derivative/build, never the currently installed import recipe. */
export async function resolveChartAsset(ctx: StorageContext, userId: string, chartId: string, versionId: string, role: string): Promise<ChartAssetRepresentation> {
  const missing = () => new StorageError(404, "NOT_FOUND");
  if (!UUID_PATTERN.test(chartId) || !UUID_PATTERN.test(versionId) || !["maidata", "audio", "cover"].includes(role)) throw missing();
  const [row] = await ctx.db.select({ file: files, blob: blobs, recipe: blobDerivatives, output: derivedObjects, version: chartVersions })
    .from(charts).innerJoin(user, eq(user.id, charts.ownerId))
    .innerJoin(chartVersions, and(eq(chartVersions.chartId, charts.id), eq(chartVersions.id, versionId)))
    .innerJoin(files, eq(files.id, chartVersions.sourceFileId))
    .innerJoin(blobs, eq(blobs.id, files.blobId))
    .innerJoin(blobDerivatives, and(eq(blobDerivatives.id, chartVersions.previewDerivativeId), eq(blobDerivatives.sourceBlobId, blobs.id)))
    .innerJoin(derivedObjects, eq(derivedObjects.id, blobDerivatives.derivedObjectId))
    .where(and(eq(charts.id, chartId), eq(charts.ownerId, userId), eq(user.status, "active"),
      isNull(charts.deletedAt), isNull(chartVersions.deletedAt), eq(files.ownerId, userId),
      eq(files.purpose, "chart-source"), eq(files.state, "ready"), isNull(files.deletedAt), eq(blobs.state, "ready"),
      eq(blobDerivatives.state, "ready"), eq(blobDerivatives.recipe, "chart-preview-v1"), eq(derivedObjects.state, "ready")));
  if (!row || !row.recipe.recipeBuild || row.output.mime !== CHART_PREVIEW_MIME || row.file.size !== row.blob.size ||
    (await ctx.db.select().from(blobBlocks).where(inArray(blobBlocks.sha256, [row.blob.sha256, row.output.outputSha256]))).length) throw missing();
  try {
    const manifest = validateChartPreviewManifest(row.output.properties.chartPreview, row.output.size);
    const asset = manifest.assets.find(a => a.role === role as ChartAssetRole);
    if (!asset || manifest.summary.maidataMd5Base64 !== row.version.maidataMd5Base64) throw missing();
    return { key: row.output.key, artifactSize: row.output.size, artifactSha256: row.output.outputSha256,
      artifactMime: row.output.mime, start: chartArtifactDataStart(manifest) + asset.offset,
      size: asset.size, mime: asset.mime, sha256: asset.sha256 };
  } catch { throw missing(); }
}
function denial(status: number, code: string) {
  const response = mediaDenial(status, code);
  response.headers.set("x-content-type-options", "nosniff");
  return response;
}
/** Check the whole physical object's metadata, then map an asset Range without buffering or extracting. */
export async function chartAssetResponse(ctx: StorageContext, asset: ChartAssetRepresentation, request: Request,
  signal: AbortSignal = request.signal): Promise<Response> {
  try {
    signal.throwIfAborted();
    const head = await ctx.driver.head({ bucket: "derived", key: asset.key, signal });
    signal.throwIfAborted();
    if (!head || head.size !== asset.artifactSize || head.sha256 !== asset.artifactSha256 || head.mime !== asset.artifactMime)
      throw new StorageUnavailableError();
    const etag = `"sha256-${asset.sha256}"`;
    const headers = new Headers({ "content-type": asset.mime, "content-length": String(asset.size), etag,
      "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox", "cross-origin-resource-policy": "same-origin" });
    if (request.headers.get("if-none-match")?.split(",").some(v => v.trim() === "*" || v.trim().replace(/^W\//, "") === etag)) {
      headers.delete("content-length");
      return new Response(null, { status: 304, headers });
    }
    let range: { start: number; end: number } | undefined;
    const raw = request.headers.get("range"), ifRange = request.headers.get("if-range");
    if (raw && (!ifRange || ifRange === etag)) {
      try { range = parseRange(raw, asset.size); }
      catch {
        const response = denial(416, "INVALID_RANGE");
        response.headers.set("content-range", `bytes */${asset.size}`);
        return response;
      }
    }
    const local = range ?? { start: 0, end: asset.size - 1 };
    const count = local.end - local.start + 1;
    headers.set("content-length", String(count));
    if (range) headers.set("content-range", `bytes ${local.start}-${local.end}/${asset.size}`);
    if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
    const read = await ctx.driver.get({ bucket: "derived", key: asset.key,
      range: { start: asset.start + local.start, end: asset.start + local.end }, signal });
    if (signal.aborted) { await read.body.cancel().catch(() => {}); signal.throwIfAborted(); }
    if (read.size !== count || read.sha256 !== asset.artifactSha256 || read.mime !== asset.artifactMime) {
      await read.body.cancel(); throw new StorageUnavailableError();
    }
    const reader = read.body.getReader();
    let consumed = 0, ended = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const finish = () => { ended = true; signal.removeEventListener("abort", abort); };
    const abort = () => {
      if (ended) return;
      controller.error(new StorageUnavailableError());
      void reader.cancel().catch(() => {}); finish();
    };
    const body = new ReadableStream<Uint8Array>({
      start(c) { controller = c; signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); },
      async pull(c) {
        try {
          signal.throwIfAborted();
          const next = await reader.read();
          if (ended) return;
          if (next.done) {
            if (consumed !== count) throw new StorageUnavailableError();
            c.close(); finish(); return;
          }
          consumed += next.value.byteLength;
          if (consumed > count) throw new StorageUnavailableError();
          c.enqueue(next.value);
        } catch (error) {
          if (!ended) c.error(error);
          await reader.cancel().catch(() => {}); finish();
        }
      },
      async cancel(reason) { await reader.cancel(reason).catch(() => {}); finish(); },
    });
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch { return denial(503, "STORAGE_UNAVAILABLE"); }
}
