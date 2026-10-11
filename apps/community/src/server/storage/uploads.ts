import { fromDrizzle, type PgBoss } from "pg-boss";
import { MEDIA_AVATAR_QUEUE, STORAGE_FINALIZE_QUEUE } from "../jobs/queues";
import { enqueueStorageFlow, storageFlowQueues } from "./flow";
import { ensureOriginal, withProcessingUpload } from "./objects";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { InitUploadInput, UploadDto, StorageErrorCode } from "@/shared/storage";
import { blobs, blobBlocks, files, storageUsage, uploadParts, uploadSessions } from "../db/schema";
import type { DbTransaction, StorageContext, StorageJobData } from "./contracts";
import { StorageError } from "./errors";
import { normalizeOriginalName } from "./keys";
import { purposeRule, STORAGE_LIMITS } from "./rules";
import { usageByPurpose } from "../charts/upload-rules";
import { withStorageTransaction } from "./transactions";
import { checkStorageDisk, lockUploadAccounting, storageTime } from "./usage";
import { cancelStorageFlow } from "./deletion";
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
type Session = typeof uploadSessions.$inferSelect;
export function uploadDto(
  row: Session,
  parts: UploadDto["receivedParts"] = [],
  now = new Date(),
): UploadDto {
  const expired = row.state === "receiving" && row.expiresAt <= now;
  return {
    id: row.id,
    state: expired ? "expired" : row.state,
    expiresAt: row.expiresAt.toISOString(),
    partSize: row.partSize,
    partCount: row.partCount,
    receivedParts: parts,
    ...(row.fileId ? { fileId: row.fileId } : {}),
    ...(expired
      ? { errorCode: "UPLOAD_EXPIRED" as const }
      : row.errorCode
        ? { errorCode: row.errorCode }
        : {}),
  };
}
export async function ownedUpload(tx: DbTransaction, userId: string, id: string) {
  const [row] = await tx
    .select()
    .from(uploadSessions)
    .where(and(eq(uploadSessions.id, id), eq(uploadSessions.ownerId, userId)))
    .for("update");
  if (!row) throw new StorageError(404, "NOT_FOUND");
  return row;
}
export function requireReceiving(row: Session, now: Date) {
  if (row.state === "cancelled") throw new StorageError(409, "UPLOAD_CANCELLED");
  if (row.state === "expired" || row.expiresAt <= now)
    throw new StorageError(410, "UPLOAD_EXPIRED");
  if (row.state !== "receiving")
    throw new StorageError(409, row.errorCode ?? "UPLOAD_ALREADY_COMPLETED");
}
/** Task4 may reuse only an owner's undeleted ready original; public derivatives grant no rights. */
export async function qualifiedOriginal(
  tx: DbTransaction,
  userId: string,
  sha256: string,
  size: number,
) {
  const [row] = await tx
    .select({ blob: blobs })
    .from(files)
    .innerJoin(blobs, eq(files.blobId, blobs.id))
    .where(
      and(
        eq(files.ownerId, userId),
        eq(files.state, "ready"),
        isNull(files.deletedAt),
        eq(blobs.sha256, sha256),
        eq(blobs.size, size),
        eq(blobs.state, "ready"),
      ),
    )
    .limit(1);
  return row?.blob ?? null;
}
export async function initUpload(
  ctx: StorageContext,
  userId: string,
  input: InitUploadInput,
  idempotencyKey: string,
): Promise<UploadDto> {
  if (input?.purpose !== "avatar" && input?.purpose !== "chart-source") throw new StorageError(400, "PURPOSE_NOT_AVAILABLE");
  const rule = purposeRule(input.purpose);
  if (
    !Number.isSafeInteger(input.size) ||
    input.size < 1 ||
    typeof input.name !== "string" ||
    typeof input.sha256 !== "string" ||
    !SHA256_PATTERN.test(input.sha256) ||
    !UUID_PATTERN.test(idempotencyKey)
  )
    throw new StorageError(400, "INVALID_UPLOAD");
  if (input.size > rule.maxSize) throw new StorageError(413, "FILE_TOO_LARGE");
  let name: string;
  try {
    name = normalizeOriginalName(input.name);
  } catch {
    throw new StorageError(400, "INVALID_UPLOAD");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([input.purpose, input.name, input.size, input.sha256]))
    .digest("hex");
  await checkStorageDisk(ctx);
  const boss = await ctx.boss();
  return withStorageTransaction(ctx.db, async (tx) => {
    const { usage, budget } = await lockUploadAccounting(tx, userId);
    const now = await storageTime(tx);
    const [prior] = await tx
      .select()
      .from(uploadSessions)
      .where(
        and(eq(uploadSessions.ownerId, userId), eq(uploadSessions.idempotencyKey, idempotencyKey)),
      )
      .for("update");
    if (prior) {
      if (prior.requestDigest !== digest) throw new StorageError(409, "IDEMPOTENCY_CONFLICT");
      const parts = await readyParts(tx, prior.id);
      return uploadDto(prior, parts, now);
    }
    if ((await tx.select().from(blobBlocks).where(eq(blobBlocks.sha256, input.sha256))).length)
      throw new StorageError(400, "HASH_BLOCKED");
    const purposeUsage = await usageByPurpose(tx,userId,input.purpose);
    if (purposeUsage.usedBytes + purposeUsage.reservedBytes + input.size > rule.quota)
      throw new StorageError(409, "QUOTA_EXCEEDED");
    const active = await tx.execute<{ n: string }>(
      sql`select count(*) as n from upload_sessions where state in ('receiving','processing')`,
    );
    if (
      usage.activeUploads >= STORAGE_LIMITS.activeUploadsPerUser ||
      Number(active.rows[0].n) >= STORAGE_LIMITS.activeUploadsGlobal
    )
      throw new StorageError(409, "TOO_MANY_UPLOADS");
    const reusable = await qualifiedOriginal(tx, userId, input.sha256, input.size);
    if (
      (!reusable &&
        budget.originalWritten + budget.originalReserved + input.size >
          ctx.config.limits.originalBudget) ||
      budget.derivedWritten + budget.derivedReserved >= ctx.config.limits.derivedBudget ||
      budget.temporaryWritten + budget.temporaryReserved + input.size >
        ctx.config.limits.temporaryBudget
    )
      throw new StorageError(503, "STORAGE_BUDGET_EXCEEDED");
    const [row] = await tx
      .insert(uploadSessions)
      .values({
        ownerId: userId,
        purpose: input.purpose,
        originalName: name,
        expectedSha256: input.sha256,
        expectedSize: input.size,
        partSize: rule.partSize,
        partCount: Math.ceil(input.size / rule.partSize),
        expiresAt: new Date(now.getTime() + STORAGE_LIMITS.uploadTtlMs),
        reservedBytes: input.size,
        idempotencyKey,
        requestDigest: digest,
      })
      .returning();
    await tx
      .update(storageUsage)
      .set({
        reservedBytes: usage.reservedBytes + input.size,
        activeUploads: usage.activeUploads + 1,
        updatedAt: now,
      })
      .where(eq(storageUsage.userId, userId));
    return reusable ? beginProcessing(ctx, boss, tx, row, now) : uploadDto(row, [], now);
  });
}
async function readyParts(db: Pick<StorageContext["db"], "select">, id: string) {
  return db
    .select({
      index: uploadParts.index,
      size: uploadParts.size,
      sha256: uploadParts.sha256,
    })
    .from(uploadParts)
    .where(and(eq(uploadParts.uploadId, id), eq(uploadParts.state, "ready")))
    .orderBy(uploadParts.index);
}
export async function getUpload(
  ctx: StorageContext,
  userId: string,
  id: string,
): Promise<UploadDto> {
  if (!UUID_PATTERN.test(id)) throw new StorageError(404, "NOT_FOUND");
  const [row] = await ctx.db
    .select()
    .from(uploadSessions)
    .where(and(eq(uploadSessions.id, id), eq(uploadSessions.ownerId, userId)));
  if (!row) throw new StorageError(404, "NOT_FOUND");
  return uploadDto(row, await readyParts(ctx.db, id), await storageTime(ctx.db));
}
export async function cancelUpload(ctx: StorageContext, userId: string, id: string): Promise<void> {
  if (!UUID_PATTERN.test(id)) throw new StorageError(404, "NOT_FOUND");
  await withStorageTransaction(ctx.db, async (tx) => {
    const { usage } = await lockUploadAccounting(tx, userId);
    const row = await ownedUpload(tx, userId, id);
    if (row.state === "ready") throw new StorageError(409, "UPLOAD_ALREADY_COMPLETED");
    if (["cancelled", "expired", "rejected"].includes(row.state)) return;
    const now = await storageTime(tx);
    await cancelStorageFlow(await ctx.boss(), tx, row.flowJobIds, row.purpose);
    if (row.fileId) await tx.update(files)
      .set({ state: "rejected", retainedUntil: new Date(now.getTime() + 86400000) })
      .where(and(eq(files.id, row.fileId), eq(files.state, "processing")));
    await tx
      .update(uploadSessions)
      .set({
        state: "cancelled",
        reservedBytes: 0,
        generation: row.generation + 1,
        updatedAt: now,
        errorCode: "UPLOAD_CANCELLED",
      })
      .where(eq(uploadSessions.id, id));
    await tx
      .update(storageUsage)
      .set({
        reservedBytes: usage.reservedBytes - row.reservedBytes,
        activeUploads: usage.activeUploads - 1,
        updatedAt: now,
      })
      .where(eq(storageUsage.userId, userId));
  });
}

/** Caller holds accounting and the session lock; both ordinary and instant uploads use this transition. */
async function beginProcessing(
  ctx: StorageContext,
  boss: PgBoss,
  tx: DbTransaction,
  row: Session,
  now: Date,
): Promise<UploadDto> {
  const blob = await ensureOriginal(ctx, tx, row);
  const [file] = await tx
    .insert(files)
    .values({
      ownerId: row.ownerId,
      blobId: blob.id,
      originalName: row.originalName,
      purpose: row.purpose,
      size: row.expectedSize,
      state: "processing",
    })
    .returning();
  const flowJobIds = await enqueueStorageFlow(boss, tx, {
    uploadId: row.id,
    generation: row.generation,
  },row.purpose);
  const [processing] = await tx
    .update(uploadSessions)
    .set({ state: "processing", fileId: file.id, flowJobIds, updatedAt: now })
    .where(eq(uploadSessions.id, row.id))
    .returning();
  return uploadDto(processing, await readyParts(tx, row.id), now);
}
export async function completeUpload(
  ctx: StorageContext,
  userId: string,
  id: string,
): Promise<UploadDto> {
  if (!UUID_PATTERN.test(id)) throw new StorageError(404, "NOT_FOUND");
  const boss = await ctx.boss();
  return withStorageTransaction(ctx.db, async (tx) => {
    await lockUploadAccounting(tx, userId);
    const row = await ownedUpload(tx, userId, id);
    const now = await storageTime(tx);
    if (row.state === "processing" || row.state === "ready")
      return uploadDto(row, await readyParts(tx, row.id), now);
    requireReceiving(row, now);
    if (
      (await tx.select().from(blobBlocks).where(eq(blobBlocks.sha256, row.expectedSha256))).length
    )
      throw new StorageError(400, "HASH_BLOCKED");
    const parts = await tx
      .select()
      .from(uploadParts)
      .where(eq(uploadParts.uploadId, row.id))
      .orderBy(uploadParts.index)
      .for("update");
    if (
      parts.length !== row.partCount ||
      parts.some(
        (part, index) =>
          part.index !== index ||
          part.state !== "ready" ||
          part.size !== Math.min(row.partSize, row.expectedSize - index * row.partSize),
      )
    )
      throw new StorageError(409, "UPLOAD_INCOMPLETE");
    return beginProcessing(ctx, boss, tx, row, now);
  });
}
/** Permanent input failure, quota release and descendant cancellation commit together. */
export async function rejectUpload(
  ctx: StorageContext,
  data: StorageJobData,
  code: StorageErrorCode,
): Promise<void> {
  const boss = await ctx.boss();
  await withProcessingUpload(
    ctx,
    data,
    async ({ tx, session, file, accounting: { usage }, now }) => {
      await tx
        .update(uploadSessions)
        .set({
          state: "rejected",
          errorCode: code,
          reservedBytes: 0,
          generation: session.generation + 1,
          updatedAt: now,
        })
        .where(eq(uploadSessions.id, session.id));
      await tx
        .update(files)
        .set({
          state: "rejected",
          retainedUntil: new Date(now.getTime() + STORAGE_LIMITS.fileRetentionMs),
        })
        .where(eq(files.id, file.id));
      await tx
        .update(storageUsage)
        .set({
          reservedBytes: usage.reservedBytes - session.reservedBytes,
          activeUploads: usage.activeUploads - 1,
          updatedAt: now,
        })
        .where(eq(storageUsage.userId, session.ownerId));
      const db = fromDrizzle(tx, sql);
      if (session.flowJobIds[1])
        await boss.cancel(storageFlowQueues(session.purpose)[1], session.flowJobIds[1], { db });
      if (session.flowJobIds[2])
        await boss.cancel(STORAGE_FINALIZE_QUEUE, session.flowJobIds[2], { db });
    },
  );
}
