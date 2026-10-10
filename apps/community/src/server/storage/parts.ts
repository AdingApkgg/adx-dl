import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  storageBudget,
  storagePolicies,
  uploadAttempts,
  uploadParts,
  uploadSessions,
} from "../db/schema";
import type { StorageContext } from "./contracts";
import { StorageError, StorageUnavailableError } from "./errors";
import { temporaryKey } from "./keys";
import { STORAGE_LIMITS } from "./rules";
import { withStorageTransaction } from "./transactions";
import { checkStorageDisk, lockUploadAccounting, storageTime } from "./usage";
import { ownedUpload, requireReceiving, SHA256_PATTERN, UUID_PATTERN } from "./uploads";

export function isUploadPartRequest(method: string, path: string): boolean {
  if (method !== "PUT") return false;
  const match = /^\/api\/v1\/uploads\/([^/]+)\/parts\/(0|[1-9][0-9]{0,2})$/.exec(path);
  return !!match && UUID_PATTERN.test(match[1]) && Number(match[2]) < STORAGE_LIMITS.maxParts;
}
const inFlight = new Map<string, number>();
let total = 0;
/** Covers body reception as well as the full service call; no waiting queue. */
export async function withUploadPartPermit<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const count = inFlight.get(userId) ?? 0;
  if (count >= STORAGE_LIMITS.partConcurrencyPerUser || total >= STORAGE_LIMITS.putConcurrency)
    throw new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 1);
  inFlight.set(userId, count + 1);
  total++;
  try {
    return await fn();
  } finally {
    total--;
    const remaining = (inFlight.get(userId) ?? 1) - 1;
    if (remaining) inFlight.set(userId, remaining);
    else inFlight.delete(userId);
  }
}
export async function putUploadPart(
  ctx: StorageContext,
  userId: string,
  id: string,
  index: number,
  bytes: Uint8Array,
  declaredHash: string,
): Promise<void> {
  if (!UUID_PATTERN.test(id)) throw new StorageError(404, "NOT_FOUND");
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= STORAGE_LIMITS.maxParts ||
    bytes.length < 1 ||
    bytes.length > STORAGE_LIMITS.partSize ||
    !SHA256_PATTERN.test(declaredHash)
  )
    throw new StorageError(400, "INVALID_UPLOAD");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== declaredHash) throw new StorageError(400, "PART_HASH_MISMATCH");
  await checkStorageDisk(ctx);
  const claim = await withStorageTransaction(ctx.db, async (tx) => {
    const { budget } = await lockUploadAccounting(tx, userId);
    const row = await ownedUpload(tx, userId, id);
    const now = await storageTime(tx);
    requireReceiving(row, now);
    if (
      index >= row.partCount ||
      bytes.length !== Math.min(row.partSize, row.expectedSize - index * row.partSize)
    )
      throw new StorageError(400, "INVALID_UPLOAD");
    const [part] = await tx
      .select()
      .from(uploadParts)
      .where(and(eq(uploadParts.uploadId, id), eq(uploadParts.index, index)))
      .for("update");
    if (part) {
      if (part.sha256 !== sha256 || part.size !== bytes.length)
        throw new StorageError(409, "PART_CONFLICT");
      if (part.state === "ready") return null;
      if (part.leaseUntil > now)
        throw new StorageError(
          409,
          "PART_BUSY",
          "PART_BUSY",
          Math.max(1, Math.ceil((part.leaseUntil.getTime() - now.getTime()) / 1000)),
        );
    }
    if (
      budget.temporaryWritten + budget.temporaryReserved + bytes.length >
      ctx.config.limits.temporaryBudget
    )
      throw new StorageError(503, "STORAGE_BUDGET_EXCEEDED");
    const [policy] = await tx
      .select()
      .from(storagePolicies)
      .where(
        and(
          eq(storagePolicies.enabled, true),
          eq(storagePolicies.endpoint, ctx.config.endpoint),
          eq(storagePolicies.originalBucket, ctx.config.originalBucket),
          eq(storagePolicies.derivedBucket, ctx.config.derivedBucket),
          eq(storagePolicies.region, ctx.config.region),
          eq(storagePolicies.credentialsRef, ctx.config.credentialsRef),
        ),
      )
      .orderBy(storagePolicies.id)
      .limit(1);
    if (!policy) throw new StorageUnavailableError();
    const attemptId = crypto.randomUUID();
    const tempKey = temporaryKey(row.id, index, attemptId);
    const leaseUntil = new Date(now.getTime() + STORAGE_LIMITS.partLeaseMs);
    const [attempt] = await tx
      .insert(uploadAttempts)
      .values({
        id: attemptId,
        uploadId: id,
        index,
        policyId: policy.id,
        tempKey,
        size: bytes.length,
        sha256,
        reservedBytes: bytes.length,
        generation: row.generation,
        leaseUntil,
      })
      .returning();
    const values = {
      uploadId: id,
      index,
      size: bytes.length,
      sha256,
      tempKey,
      attemptId,
      state: "writing" as const,
      leaseUntil,
    };
    await tx
      .insert(uploadParts)
      .values(values)
      .onConflictDoUpdate({
        target: [uploadParts.uploadId, uploadParts.index],
        set: values,
      });
    await tx
      .update(storageBudget)
      .set({ temporaryReserved: budget.temporaryReserved + bytes.length })
      .where(eq(storageBudget.id, "global"));
    return attempt;
  });
  if (!claim) return;
  try {
    await ctx.driver.put({
      bucket: "original",
      key: claim.tempKey,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      size: bytes.length,
      mime: "application/octet-stream",
      sha256,
    });
    await withStorageTransaction(ctx.db, async (tx) => {
      const { budget } = await lockUploadAccounting(tx, userId);
      const row = await ownedUpload(tx, userId, id);
      const now = await storageTime(tx);
      requireReceiving(row, now);
      const [part] = await tx
        .select()
        .from(uploadParts)
        .where(and(eq(uploadParts.uploadId, id), eq(uploadParts.index, index)))
        .for("update");
      const [attempt] = await tx
        .select()
        .from(uploadAttempts)
        .where(eq(uploadAttempts.id, claim.id))
        .for("update");
      if (
        !part ||
        part.attemptId !== claim.id ||
        part.state !== "writing" ||
        part.leaseUntil <= now ||
        row.generation !== claim.generation ||
        !attempt ||
        attempt.state !== "writing"
      )
        throw new StorageError(409, "PART_BUSY", "PART_BUSY", 1);
      await tx
        .update(uploadParts)
        .set({ state: "ready" })
        .where(and(eq(uploadParts.uploadId, id), eq(uploadParts.index, index)));
      await tx
        .update(uploadAttempts)
        .set({
          state: "ready",
          reservedBytes: 0,
          writtenBytes: claim.size,
          updatedAt: now,
        })
        .where(eq(uploadAttempts.id, claim.id));
      await tx
        .update(storageBudget)
        .set({
          temporaryReserved: budget.temporaryReserved - claim.size,
          temporaryWritten: budget.temporaryWritten + claim.size,
        })
        .where(eq(storageBudget.id, "global"));
    });
  } catch (error) {
    try {
      await cleanupSettledAttempt(ctx, claim.id);
    } catch {
      // Unconfirmed cleanup claims and closed maintenance retain accounting for repair.
      ctx.log.error("storage_attempt_cleanup_deferred", { uploadId: id });
    }
    throw error;
  }
}

/** Never delete on an ambiguous ready/cleanup COMMIT; obtain a confirmed claim first. */
async function cleanupSettledAttempt(ctx: StorageContext, attemptId: string): Promise<void> {
  const claim = await withStorageTransaction(ctx.db, async (tx) => {
    const [budget] = await tx
      .select()
      .from(storageBudget)
      .where(eq(storageBudget.id, "global"))
      .for("update");
    if (!budget) throw new StorageUnavailableError();
    // This read only discovers lock identities. Re-read the attempt under its lock below.
    const [identity] = await tx
      .select()
      .from(uploadAttempts)
      .where(eq(uploadAttempts.id, attemptId));
    if (!identity) return null;
    await tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, identity.uploadId))
      .for("update");
    const [part] = await tx
      .select()
      .from(uploadParts)
      .where(
        and(eq(uploadParts.uploadId, identity.uploadId), eq(uploadParts.index, identity.index)),
      )
      .for("update");
    const [attempt] = await tx
      .select()
      .from(uploadAttempts)
      .where(eq(uploadAttempts.id, attemptId))
      .for("update");
    if (!attempt || attempt.state === "deleted" || attempt.state === "deleting") return null;
    // A commit may have succeeded even if its response was lost. Replay must retain ready bytes.
    if (part?.attemptId === attemptId && part.state === "ready") return null;
    const now = await storageTime(tx);
    const generation = attempt.generation + 1;
    await tx
      .update(uploadAttempts)
      .set({
        state: "deleting",
        generation,
        leaseUntil: new Date(now.getTime() + STORAGE_LIMITS.partLeaseMs),
        updatedAt: now,
      })
      .where(eq(uploadAttempts.id, attemptId));
    return { ...attempt, generation };
  });
  if (!claim) return;
  await ctx.driver.delete({ bucket: "original", key: claim.tempKey });
  await withStorageTransaction(ctx.db, async (tx) => {
    const [budget] = await tx
      .select()
      .from(storageBudget)
      .where(eq(storageBudget.id, "global"))
      .for("update");
    if (!budget) throw new StorageUnavailableError();
    await tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, claim.uploadId))
      .for("update");
    const [part] = await tx
      .select()
      .from(uploadParts)
      .where(and(eq(uploadParts.uploadId, claim.uploadId), eq(uploadParts.index, claim.index)))
      .for("update");
    const [attempt] = await tx
      .select()
      .from(uploadAttempts)
      .where(eq(uploadAttempts.id, attemptId))
      .for("update");
    if (attempt?.state !== "deleting" || attempt.generation !== claim.generation) return;
    if (part?.attemptId === attemptId)
      await tx
        .delete(uploadParts)
        .where(and(eq(uploadParts.uploadId, claim.uploadId), eq(uploadParts.index, claim.index)));
    await tx
      .update(uploadAttempts)
      .set({
        state: "deleted",
        reservedBytes: 0,
        writtenBytes: 0,
        updatedAt: await storageTime(tx),
      })
      .where(eq(uploadAttempts.id, attemptId));
    await tx
      .update(storageBudget)
      .set({
        temporaryReserved: budget.temporaryReserved - attempt.reservedBytes,
        temporaryWritten: budget.temporaryWritten - attempt.writtenBytes,
      })
      .where(eq(storageBudget.id, "global"));
  });
}
