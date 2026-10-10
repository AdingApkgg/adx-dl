import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { blobs, uploadParts } from "../server/db/schema";
import type { StorageContext, StorageJobData } from "../server/storage/contracts";
import { StorageError, StorageUnavailableError } from "../server/storage/errors";
import { claimOriginal, publishOriginal, withProcessingUpload } from "../server/storage/objects";
import { AVATAR_RULE } from "../server/storage/rules";
import { rejectUpload } from "../server/storage/uploads";
import { checkStorageDisk } from "../server/storage/usage";

type Source = { key: string; size: number; sha256: string };
/** Recognition only. Task5 performs bounded container/animation checks and complete decoding. */
export function originalMime(header: Uint8Array): string {
  const b = Buffer.from(header);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (
    b.length >= 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (b.length >= 16 && b.toString("ascii", 4, 8) === "ftyp") {
    const shortSize = b.readUInt32BE(0);
    const brandStart = shortSize === 1 ? 16 : 8;
    const size = shortSize === 1 ? b.readBigUInt64BE(8) : BigInt(shortSize);
    if (
      size >= BigInt(brandStart + 8) &&
      size <= BigInt(b.length) &&
      size <= 4096n &&
      (size - BigInt(brandStart)) % 4n === 0n
    ) {
      const brands = [brandStart];
      for (let offset = brandStart + 8; offset < Number(size); offset += 4) brands.push(offset);
      for (const offset of brands)
        if (["avif", "avis"].includes(b.toString("ascii", offset, offset + 4))) return "image/avif";
    }
  }
  throw new StorageError(400, "TYPE_NOT_ALLOWED");
}
/** A bounded disk sink, never Buffer.concat/full-file memory. Counts actual bytes independently of metadata. */
async function assemble(
  ctx: StorageContext,
  sources: Source[],
  path: string,
  expectedSize: number,
  expectedHash: string,
  signal: AbortSignal,
) {
  const output = await open(path, "wx", 0o600);
  const fullHash = createHash("sha256");
  let total = 0;
  const header = new Uint8Array(4096);
  let headerSize = 0;
  try {
    for (const source of sources) {
      signal.throwIfAborted();
      const object = await ctx.driver.get({ bucket: "original", key: source.key, signal });
      const reader = object.body.getReader();
      const partHash = createHash("sha256");
      let count = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const { value, done } = await reader.read();
          if (done) break;
          count += value.byteLength;
          total += value.byteLength;
          if (count > source.size || total > expectedSize)
            throw new StorageError(400, "HASH_MISMATCH");
          partHash.update(value);
          fullHash.update(value);
          const take = Math.min(header.length - headerSize, value.length);
          if (take) {
            header.set(value.subarray(0, take), headerSize);
            headerSize += take;
          }
          let offset = 0;
          while (offset < value.length) {
            const { bytesWritten } = await output.write(value, offset, value.length - offset);
            if (!bytesWritten) throw new StorageUnavailableError();
            offset += bytesWritten;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (count !== source.size || partHash.digest("hex") !== source.sha256)
        throw new StorageError(400, "PART_HASH_MISMATCH");
    }
    if (total !== expectedSize || fullHash.digest("hex") !== expectedHash)
      throw new StorageError(400, "HASH_MISMATCH");
    return originalMime(header.subarray(0, headerSize));
  } finally {
    await output.close();
  }
}
const permanent = new Set([
  "HASH_MISMATCH",
  "PART_HASH_MISMATCH",
  "TYPE_NOT_ALLOWED",
  "FILE_TOO_LARGE",
  "PURPOSE_NOT_AVAILABLE",
  "HASH_BLOCKED",
  "UPLOAD_EXPIRED",
  "UPLOAD_INCOMPLETE",
]);
let running = false;
/** The media process admits one ingest; lease CAS remains the protection across restarts/processes. */
export async function ingestUpload(ctx: StorageContext, data: StorageJobData): Promise<void> {
  const snapshot = await withProcessingUpload(ctx, data, async ({ tx, session, file, now }) => {
    const [blob] = await tx.select().from(blobs).where(eq(blobs.id, file.blobId));
    const parts = await tx
      .select()
      .from(uploadParts)
      .where(eq(uploadParts.uploadId, session.id))
      .orderBy(uploadParts.index);
    return { session, blob, parts, now };
  });
  if (!snapshot) return;
  if (running) throw new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 1);
  running = true;
  let directory: string | undefined;
  try {
    const { session, blob, parts, now } = snapshot;
    if (session.expiresAt <= now) throw new StorageError(410, "UPLOAD_EXPIRED");
    if (session.purpose !== "avatar") throw new StorageError(400, "PURPOSE_NOT_AVAILABLE");
    if (session.expectedSize > AVATAR_RULE.maxSize) throw new StorageError(413, "FILE_TOO_LARGE");
    const instant = parts.length === 0 && blob.state === "ready";
    if (
      !instant &&
      (parts.length !== session.partCount ||
        parts.some(
          (part, index) =>
            part.index !== index ||
            part.state !== "ready" ||
            part.size !==
              Math.min(session.partSize, session.expectedSize - index * session.partSize),
        ))
    )
      throw new StorageError(409, "UPLOAD_INCOMPLETE");
    await checkStorageDisk(ctx);
    directory = await mkdtemp(join(ctx.config.tempDir, "ingest-"));
    const path = join(directory, "original");
    const signal = ctx.lifecycle ? AbortSignal.any([ctx.lifecycle.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
    const sources = instant
      ? [{ key: blob.key, size: blob.size, sha256: blob.sha256 }]
      : parts.map((p) => ({ key: p.tempKey, size: p.size, sha256: p.sha256 }));
    const mime = await assemble(
      ctx,
      sources,
      path,
      session.expectedSize,
      session.expectedSha256,
      signal,
    );
    const claim = await claimOriginal(ctx, data);
    if (!claim || claim.kind === "ready") return;
    // A previous writer may have committed S3 but died before PG. Verify those bytes,
    // then publish with our new lease; never delete an uncertain or stale writer's key.
    const existing = await ctx.driver.head({ bucket: "original", key: claim.blob.key, signal });
    if (existing) {
      try {
        const recoveredMime = await assemble(
          ctx,
          [{ key: claim.blob.key, size: claim.blob.size, sha256: claim.blob.sha256 }],
          join(directory, "recovered"),
          claim.blob.size,
          claim.blob.sha256,
          signal,
        );
        if (recoveredMime !== mime) throw new StorageUnavailableError();
      } catch (error) {
        if (error instanceof StorageError && permanent.has(error.code))
          throw new StorageError(503, "STORAGE_INCONSISTENT");
        throw error;
      }
    } else {
      await ctx.driver.put({
        bucket: "original",
        key: claim.blob.key,
        body: Bun.file(path).stream(),
        size: claim.blob.size,
        mime,
        sha256: claim.blob.sha256,
        signal,
      });
    }
    const head = await ctx.driver.head({ bucket: "original", key: claim.blob.key, signal });
    if (
      !head ||
      head.size !== claim.blob.size ||
      head.sha256 !== claim.blob.sha256 ||
      head.mime !== mime
    )
      throw new StorageError(503, "STORAGE_INCONSISTENT");
    if (!(await publishOriginal(ctx, data, claim, mime))) {
      // Cancellation is a no-op, but an expired/stolen lease on an active upload must retry.
      const active = await withProcessingUpload(ctx, data, async () => true);
      if (active) throw new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 30);
    }
  } catch (error) {
    if (error instanceof StorageError && permanent.has(error.code)) {
      await rejectUpload(ctx, data, error.code);
      return;
    }
    throw error;
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      running = false;
    }
  }
}
