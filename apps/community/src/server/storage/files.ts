import { and, eq, inArray, sql } from "drizzle-orm";
import type { FileDto } from "@/shared/storage";
import type { ChartImportSummary } from "@/shared/charts";
import { validateChartPreviewManifest } from "../charts/artifact";
import { CHART_PREVIEW_MIME, recipeBuildFor } from "../charts/recipe";
import {
  blobs,
  files,
  blobBlocks,
  blobDerivatives,
  derivedObjects,
  storageUsage,
  storageTombstones,
} from "../db/schema";
import type { StorageContext, ObjectBucket, DbTransaction } from "./contracts";
import { StorageError, StorageUnavailableError } from "./errors";
import { hasFileReferences } from "./references";
import { withStorageTransaction } from "./transactions";
import { lockUploadAccounting, storageTime } from "./usage";
import { parseRange } from "./range";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function owned(ctx: StorageContext, userId: string, id: string) {
  if (!uuid.test(id)) throw new StorageError(404, "NOT_FOUND");
  const [row] = await ctx.db
    .select({ file: files, blob: blobs })
    .from(files)
    .innerJoin(blobs, eq(blobs.id, files.blobId))
    .where(and(eq(files.id, id), eq(files.ownerId, userId)));
  if (
    !row ||
    row.file.state === "deleted" || row.file.deletedAt !== null ||
    row.blob.state !== "ready" ||
    (await ctx.db.select().from(blobBlocks).where(eq(blobBlocks.sha256, row.blob.sha256))).length
  )
    throw new StorageError(404, "NOT_FOUND");
  return row;
}
export async function getFile(ctx: StorageContext, userId: string, id: string): Promise<FileDto> {
  const { file, blob } = await owned(ctx, userId, id);
  let preview = false;
  let chart: ChartImportSummary | undefined;
  if (file.state === "ready" && file.purpose === "avatar") {
    try {
      await resolvePrivateFile(ctx, userId, id, "preview");
      preview = true;
    } catch (e) {
      if (!(e instanceof StorageError) || e.status !== 404) throw e;
    }
  }
  if (file.state === "ready" && file.purpose === "chart-source") {
    const [row] = await ctx.db.select({ output: derivedObjects }).from(blobDerivatives)
      .innerJoin(derivedObjects, eq(derivedObjects.id, blobDerivatives.derivedObjectId))
      .where(and(eq(blobDerivatives.sourceBlobId, blob.id), eq(blobDerivatives.recipe, "chart-preview-v1"),
        eq(blobDerivatives.recipeBuild, recipeBuildFor(ctx, "chart-source")), eq(blobDerivatives.state, "ready"), eq(derivedObjects.state, "ready")));
    if (row?.output.mime === CHART_PREVIEW_MIME && !(await ctx.db.select().from(blobBlocks).where(eq(blobBlocks.sha256, row.output.outputSha256))).length) {
      try { chart = validateChartPreviewManifest(row.output.properties.chartPreview, row.output.size).summary; }
      catch { throw new StorageError(503, "STORAGE_INCONSISTENT"); }
    }
  }
  return {
    id: file.id,
    purpose: file.purpose,
    name: file.originalName,
    size: file.size,
    state: file.state,
    createdAt: file.createdAt.toISOString(),
    ...(preview ? { previewUrl: `/api/v1/files/${file.id}/preview` } : {}),
    ...(chart ? { chart } : {}),
  };
}
export async function deleteFile(ctx: StorageContext, userId: string, id: string): Promise<void> {
  if (!uuid.test(id)) throw new StorageError(404, "NOT_FOUND");
  await withStorageTransaction(ctx.db, async (tx) => {
    await lockUploadAccounting(tx, userId);
    await deleteFileInTransaction(tx, userId, id);
  });
}
/** Caller owns user/usage/budget locks and has withdrawn business references in this transaction. */
export async function deleteFileInTransaction(tx: DbTransaction, userId: string, id: string): Promise<void> {
    const [file] = await tx
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.ownerId, userId)))
      .for("update");
    if (!file) throw new StorageError(404, "NOT_FOUND");
    if (file.state === "deleted") return;
    if (await hasFileReferences(tx, id)) throw new StorageError(409, "FILE_IN_USE");
    // Only ready files contribute used bytes. Processing sessions own reservations.
    if (file.state === "processing") throw new StorageError(409, "PROCESSING_FAILED");
    const now = await storageTime(tx);
    await tx
      .update(files)
      .set({ state: "deleted", deletedAt: now, retainedUntil: new Date(now.getTime() + 86400000) })
      .where(eq(files.id, id));
    await tx.insert(storageTombstones).values({ kind: "file_deleted", fileId: id, createdAt: now });
    if (file.state === "ready") {
      const [usage] = await tx.select().from(storageUsage).where(eq(storageUsage.userId, userId)).for("update");
      if (!usage || usage.usedBytes < file.size) throw new StorageError(503, "STORAGE_INCONSISTENT");
      await tx
        .update(storageUsage)
        .set({ usedBytes: sql`${storageUsage.usedBytes}-${file.size}`, updatedAt: now })
        .where(eq(storageUsage.userId, userId));
    }
}
export type FileRepresentation = {
  bucket: ObjectBucket;
  key: string;
  size: number;
  mime: string;
  sha256: string;
  name?: string;
};
export async function resolvePrivateFile(
  ctx: StorageContext,
  userId: string,
  id: string,
  representation: "content" | "preview",
): Promise<FileRepresentation> {
  const { file, blob } = await owned(ctx, userId, id);
  if (file.state !== "ready") throw new StorageError(404, "NOT_FOUND");
  if (representation === "content")
    return {
      bucket: "original",
      key: blob.key,
      size: blob.size,
      mime: blob.detectedMime!,
      sha256: blob.sha256,
      name: file.originalName,
    };
  const [row] = await ctx.db
    .select({ output: derivedObjects })
    .from(blobDerivatives)
    .innerJoin(derivedObjects, eq(derivedObjects.id, blobDerivatives.derivedObjectId))
    .where(
      and(
        eq(blobDerivatives.sourceBlobId, blob.id),
        eq(blobDerivatives.recipe, "avatar-v1"),
        eq(blobDerivatives.recipeBuild, ctx.config.recipeBuild),
        eq(blobDerivatives.state, "ready"),
        eq(derivedObjects.state, "ready"),
      ),
    );
  if (
    file.purpose !== "avatar" ||
    !row ||
    (
      await ctx.db
        .select()
        .from(blobBlocks)
        .where(inArray(blobBlocks.sha256, [blob.sha256, row.output.outputSha256]))
    ).length
  )
    throw new StorageError(404, "NOT_FOUND");
  return {
    bucket: "derived",
    key: row.output.key,
    size: row.output.size,
    mime: row.output.mime,
    sha256: row.output.outputSha256,
  };
}
export function mediaDenial(status = 404, code = "NOT_FOUND") {
  return Response.json(
    { error: { code, message: code } },
    { status, headers: { "cache-control": "private, no-store", "cdn-cache-control": "no-store" } },
  );
}
function disposition(name: string) {
  const clean = Array.from(name.toWellFormed())
    .map((c) =>
      c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === "/" || c === "\\" ? "_" : c,
    )
    .join("");
  const ascii = clean.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(clean).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
/** No buffering: permissions have resolved, then storage existence precedes validators. */
export async function representationResponse(
  ctx: StorageContext,
  file: FileRepresentation,
  request: Request,
  signal: AbortSignal,
  onEnd = () => {},
  isPublic = false,
): Promise<Response> {
  let streaming = false;
  try {
    signal.throwIfAborted();
    const head = await ctx.driver.head({ bucket: file.bucket, key: file.key, signal });
    signal.throwIfAborted();
    if (!head || head.size !== file.size || head.mime !== file.mime || head.sha256 !== file.sha256)
      throw new StorageUnavailableError();
    const etag = `"sha256-${file.sha256}"`;
    const headers = new Headers({
      "content-type": file.mime,
      "content-length": String(file.size),
      etag,
      "accept-ranges": "bytes",
      "cache-control": isPublic ? "private, max-age=86400, immutable" : "private, no-store",
      "cdn-cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
    });
    if (file.name) headers.set("content-disposition", disposition(file.name));
    const match = request.headers.get("if-none-match");
    if (match?.split(",").some((v) => v.trim() === "*" || v.trim().replace(/^W\//, "") === etag)) {
      headers.delete("content-length");
      return new Response(null, { status: 304, headers });
    }
    let range: { start: number; end: number } | undefined;
    const raw = request.headers.get("range"),
      ifRange = request.headers.get("if-range");
    if (raw && (!ifRange || ifRange === etag)) {
      try {
        range = parseRange(raw, file.size);
      } catch {
        const response = mediaDenial(416, "INVALID_RANGE");
        response.headers.set("content-range", `bytes */${file.size}`);
        return response;
      }
    }
    const count = range ? range.end - range.start + 1 : file.size;
    headers.set("content-length", String(count));
    if (range) headers.set("content-range", `bytes ${range.start}-${range.end}/${file.size}`);
    if (request.method === "HEAD")
      return new Response(null, { status: range ? 206 : 200, headers });
    const read = await ctx.driver.get({ bucket: file.bucket, key: file.key, range, signal });
    signal.throwIfAborted();
    if (read.size !== count || read.sha256 !== file.sha256 || read.mime !== file.mime) {
      await read.body.cancel();
      throw new StorageUnavailableError();
    }
    const reader = read.body.getReader();
    let consumed = 0,
      ended = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const finish = () => {
      if (ended) return;
      ended = true;
      signal.removeEventListener("abort", abort);
      onEnd();
    };
    const abort = () => {
      if (ended) return;
      controller.error(new StorageUnavailableError());
      void reader.cancel().catch(() => {});
      finish();
    };
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      },
      async pull(c) {
        try {
          signal.throwIfAborted();
          const next = await reader.read();
          if (ended) return;
          if (next.done) {
            if (consumed !== count) throw new StorageUnavailableError();
            c.close();
            finish();
            return;
          }
          consumed += next.value.length;
          if (consumed > count) throw new StorageUnavailableError();
          c.enqueue(next.value);
        } catch (e) {
          if (!ended) c.error(e);
          await reader.cancel().catch(() => {});
          finish();
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => {});
        finish();
      },
    });
    streaming = true;
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch {
    return mediaDenial(503, "STORAGE_UNAVAILABLE");
  } finally {
    if (!streaming) onEnd();
  }
}
