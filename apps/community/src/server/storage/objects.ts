import { and, eq } from "drizzle-orm";
import {
  blobs,
  blobDerivatives,
  derivedObjects,
  blobBlocks,
  files,
  storageBudget,
  storagePolicies,
  uploadSessions,
} from "../db/schema";
import type { DbTransaction, StorageContext, StorageJobData } from "./contracts";
import { StorageError, StorageUnavailableError } from "./errors";
import { objectKey } from "./keys";
import { withStorageTransaction } from "./transactions";
import { lockUploadAccounting, storageTime } from "./usage";

type Session = typeof uploadSessions.$inferSelect;
type BlobRow = typeof blobs.$inferSelect;
/** Only this state has never reserved capacity or started a physical write. */
function isUnclaimedOriginal(blob: BlobRow): boolean {
  return (
    blob.state === "pending" &&
    blob.generation === 0 &&
    blob.leaseUntil === null &&
    blob.verifiedAt === null &&
    blob.detectedMime === null
  );
}
export type ProcessingUpload = {
  tx: DbTransaction;
  session: Session;
  file: typeof files.$inferSelect;
  accounting: Awaited<ReturnType<typeof lockUploadAccounting>>;
  now: Date;
};
/** Common worker admission and lock order. A stale/terminal/inactive job is a successful no-op. */
export async function withProcessingUpload<T>(
  ctx: StorageContext,
  data: StorageJobData,
  fn: (locked: ProcessingUpload) => Promise<T>,
): Promise<T | null> {
  const [snapshot] = await ctx.db
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.id, data.uploadId));
  if (snapshot?.state !== "processing" || snapshot.generation !== data.generation) return null;
  try {
    return await withStorageTransaction(ctx.db, async (tx) => {
      const accounting = await lockUploadAccounting(tx, snapshot.ownerId);
      const [session] = await tx
        .select()
        .from(uploadSessions)
        .where(eq(uploadSessions.id, data.uploadId))
        .for("update");
      if (
        session?.state !== "processing" ||
        session.generation !== data.generation ||
        !session.fileId
      )
        return null;
      const [file] = await tx
        .select()
        .from(files)
        .where(eq(files.id, session.fileId))
        .for("update");
      if (file?.state !== "processing" || file.ownerId !== session.ownerId || file.deletedAt)
        return null;
      return fn({ tx, session, file, accounting, now: await storageTime(tx) });
    });
  } catch (error) {
    if (error instanceof StorageError && error.code === "ACCOUNT_INACTIVE") return null;
    throw error;
  }
}
/** Requires upload accounting locks. Creating this identity does not reserve physical bytes. */
export async function ensureOriginal(
  ctx: StorageContext,
  tx: DbTransaction,
  session: Session,
): Promise<BlobRow> {
  const [policy] = await tx
    .select()
    .from(storagePolicies)
    .where(
      and(
        eq(storagePolicies.enabled, true),
        eq(storagePolicies.endpoint, ctx.config.endpoint),
        eq(storagePolicies.region, ctx.config.region),
        eq(storagePolicies.originalBucket, ctx.config.originalBucket),
        eq(storagePolicies.derivedBucket, ctx.config.derivedBucket),
        eq(storagePolicies.credentialsRef, ctx.config.credentialsRef),
      ),
    )
    .orderBy(storagePolicies.id)
    .limit(1);
  if (!policy) throw new StorageUnavailableError();
  await tx
    .insert(blobs)
    .values({
      sha256: session.expectedSha256,
      size: session.expectedSize,
      policyId: policy.id,
      key: objectKey(session.expectedSha256),
    })
    .onConflictDoNothing();
  const [blob] = await tx
    .select()
    .from(blobs)
    .where(eq(blobs.sha256, session.expectedSha256))
    .for("update");
  // Pending declarations are untrusted. Keep their per-session sizes until a
  // verified ingest takes the first physical claim; completion cannot pin size.
  if (
    !blob ||
    blob.policyId !== policy.id ||
    (blob.size !== session.expectedSize && !isUnclaimedOriginal(blob))
  )
    throw new StorageError(503, "STORAGE_INCONSISTENT");
  if (blob.state === "blocked") throw new StorageError(400, "HASH_BLOCKED");
  if (blob.state === "deleting") throw new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 30);
  return blob;
}
export type OriginalClaim = { kind: "ready" | "writer"; blob: BlobRow };
/** Called only after local bytes/hash/purpose verification, immediately before remote IO. */
export async function claimOriginal(
  ctx: StorageContext,
  data: StorageJobData,
): Promise<OriginalClaim | null> {
  return withProcessingUpload(
    ctx,
    data,
    async ({ tx, session, file, accounting: { budget }, now }) => {
      if (session.expiresAt <= now) throw new StorageError(410, "UPLOAD_EXPIRED");
      if (
        (await tx.select().from(blobBlocks).where(eq(blobBlocks.sha256, session.expectedSha256)))
          .length
      )
        throw new StorageError(400, "HASH_BLOCKED");
      const [blob] = await tx.select().from(blobs).where(eq(blobs.id, file.blobId)).for("update");
      if (blob.size !== session.expectedSize && !isUnclaimedOriginal(blob))
        throw new StorageError(503, "STORAGE_INCONSISTENT");
      // The caller has verified this session's actual bytes. Correct only an
      // identity that has never owned a lease/charge; uncertain writes stay fixed.
      const size = session.expectedSize;
      if (blob.state === "ready") return { kind: "ready" as const, blob };
      if (blob.state === "blocked") throw new StorageError(400, "HASH_BLOCKED");
      if (blob.state === "deleting" || (blob.leaseUntil && blob.leaseUntil > now))
        throw new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 30);
      // pending+lease means a previous PUT may still settle. Never delete or refund it.
      // A deleted row is a Task8 confirmation that the old DELETE has finished.
      const reserve = blob.state === "deleted" || !blob.leaseUntil;
      if (reserve) {
        if (
          budget.originalWritten + budget.originalReserved + size >
          ctx.config.limits.originalBudget
        )
          throw new StorageError(503, "STORAGE_BUDGET_EXCEEDED");
        await tx
          .update(storageBudget)
          .set({ originalReserved: budget.originalReserved + size })
          .where(eq(storageBudget.id, "global"));
      }
      const [claimed] = await tx
        .update(blobs)
        .set({
          state: "pending",
          size,
          generation: blob.generation + 1,
          leaseUntil: new Date(now.getTime() + 120000),
          verifiedAt: null,
          detectedMime: null,
          orphanedAt: null,
        })
        .where(eq(blobs.id, blob.id))
        .returning();
      return { kind: "writer" as const, blob: claimed };
    },
  );
}
/** Successful PUT/head is insufficient: publication also requires the still-live independent lease and session. */
export async function publishOriginal(
  ctx: StorageContext,
  data: StorageJobData,
  claim: OriginalClaim,
  mime: string,
): Promise<boolean> {
  const result = await withProcessingUpload(
    ctx,
    data,
    async ({ tx, session, file, accounting: { budget }, now }) => {
      if (session.expiresAt <= now) return false;
      if (
        (await tx.select().from(blobBlocks).where(eq(blobBlocks.sha256, session.expectedSha256)))
          .length
      )
        return false;
      const [blob] = await tx.select().from(blobs).where(eq(blobs.id, file.blobId)).for("update");
      if (
        blob.id !== claim.blob.id ||
        blob.state !== "pending" ||
        blob.generation !== claim.blob.generation ||
        !blob.leaseUntil ||
        blob.leaseUntil <= now
      )
        return false;
      await tx
        .update(blobs)
        .set({ state: "ready", detectedMime: mime, verifiedAt: now, leaseUntil: null })
        .where(eq(blobs.id, blob.id));
      await tx
        .update(storageBudget)
        .set({
          originalReserved: budget.originalReserved - blob.size,
          originalWritten: budget.originalWritten + blob.size,
        })
        .where(eq(storageBudget.id, "global"));
      return true;
    },
  );
  return result === true;
}

export type RecipeClaim = {
  blob: BlobRow;
  recipe: typeof blobDerivatives.$inferSelect;
};
const busy = () => new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 30);
/** Locks follow original -> recipe -> derived; all IO happens after this transaction. */
export async function claimAvatarRecipe(
  ctx: StorageContext,
  data: StorageJobData,
): Promise<RecipeClaim | null> {
  return withProcessingUpload(ctx, data, async ({ tx, session, file, now }) => {
    if (session.expiresAt <= now) throw new StorageError(410, "UPLOAD_EXPIRED");
    if (session.purpose !== "avatar")
      throw new StorageError(400, "PURPOSE_NOT_AVAILABLE");
    if (
      (
        await tx
          .select()
          .from(blobBlocks)
          .where(eq(blobBlocks.sha256, session.expectedSha256))
      ).length
    )
      throw new StorageError(400, "HASH_BLOCKED");
    const [blob] = await tx
      .select()
      .from(blobs)
      .where(eq(blobs.id, file.blobId))
      .for("update");
    if (blob.state !== "ready") throw busy();
    await tx
      .insert(blobDerivatives)
      .values({
        sourceBlobId: blob.id,
        recipe: "avatar-v1",
        recipeBuild: ctx.config.recipeBuild,
      })
      .onConflictDoNothing();
    const [recipe] = await tx
      .select()
      .from(blobDerivatives)
      .where(
        and(
          eq(blobDerivatives.sourceBlobId, blob.id),
          eq(blobDerivatives.recipe, "avatar-v1"),
          eq(blobDerivatives.recipeBuild, ctx.config.recipeBuild),
        ),
      )
      .for("update");
    if (recipe.state === "ready") return { blob, recipe };
    if (recipe.state === "rejected")
      throw new StorageError(400, recipe.errorCode ?? "IMAGE_INVALID");
    if (
      recipe.state === "retired" ||
      (recipe.leaseUntil && recipe.leaseUntil > now)
    )
      throw busy();
    const [claimed] = await tx
      .update(blobDerivatives)
      .set({
        generation: recipe.generation + 1,
        leaseUntil: new Date(now.getTime() + 120000),
      })
      .where(eq(blobDerivatives.id, recipe.id))
      .returning();
    return { blob, recipe: claimed };
  });
}
export type DerivedClaim = {
  kind: "ready" | "writer";
  object: typeof derivedObjects.$inferSelect;
};
/** Never replaces an uncertain charge; source/recipe and physical generations are independent. */
export async function claimAvatarOutput(
  ctx: StorageContext,
  data: StorageJobData,
  source: RecipeClaim,
  output: { hash: string; size: number },
): Promise<DerivedClaim | null> {
  return withProcessingUpload(
    ctx,
    data,
    async ({ tx, session, file, accounting: { budget }, now }) => {
      if (session.expiresAt <= now)
        throw new StorageError(410, "UPLOAD_EXPIRED");
      if (
        (
          await tx
            .select()
            .from(blobBlocks)
            .where(eq(blobBlocks.sha256, session.expectedSha256))
        ).length
      )
        throw new StorageError(400, "HASH_BLOCKED");
      const [blob] = await tx
        .select()
        .from(blobs)
        .where(eq(blobs.id, file.blobId))
        .for("update");
      if (blob.id !== source.blob.id || blob.state !== "ready") throw busy();
      const [recipe] = await tx
        .select()
        .from(blobDerivatives)
        .where(eq(blobDerivatives.id, source.recipe.id))
        .for("update");
      if (
        recipe.state !== "pending" ||
        recipe.generation !== source.recipe.generation ||
        !recipe.leaseUntil ||
        recipe.leaseUntil <= now
      )
        throw busy();
      await tx
        .insert(derivedObjects)
        .values({
          outputSha256: output.hash,
          size: output.size,
          mime: "image/jpeg",
          policyId: blob.policyId,
          key: objectKey(output.hash),
        })
        .onConflictDoNothing();
      const [object] = await tx
        .select()
        .from(derivedObjects)
        .where(eq(derivedObjects.outputSha256, output.hash))
        .for("update");
      if (
        object.size !== output.size ||
        object.mime !== "image/jpeg" ||
        object.policyId !== blob.policyId
      )
        throw new StorageError(503, "STORAGE_INCONSISTENT");
      if (object.state === "blocked")
        throw new StorageError(400, "HASH_BLOCKED");
      if (
        object.state === "deleting" ||
        (object.leaseUntil && object.leaseUntil > now)
      )
        throw busy();
      if (object.state === "ready") {
        await tx
          .update(blobDerivatives)
          .set({ state: "ready", derivedObjectId: object.id, leaseUntil: null })
          .where(eq(blobDerivatives.id, recipe.id));
        return { kind: "ready" as const, object };
      }
      if (object.state === "deleted" || !object.leaseUntil) {
        if (
          budget.derivedReserved + budget.derivedWritten + object.size >
          ctx.config.limits.derivedBudget
        )
          throw new StorageError(503, "STORAGE_BUDGET_EXCEEDED");
        await tx
          .update(storageBudget)
          .set({ derivedReserved: budget.derivedReserved + object.size })
          .where(eq(storageBudget.id, "global"));
      }
      const [claimed] = await tx
        .update(derivedObjects)
        .set({
          state: "pending",
          generation: object.generation + 1,
          leaseUntil: new Date(now.getTime() + 120000),
          orphanedAt: null,
        })
        .where(eq(derivedObjects.id, object.id))
        .returning();
      await tx
        .update(blobDerivatives)
        .set({ derivedObjectId: object.id })
        .where(eq(blobDerivatives.id, recipe.id));
      return { kind: "writer" as const, object: claimed };
    },
  );
}
export async function publishAvatarOutput(
  ctx: StorageContext,
  data: StorageJobData,
  source: RecipeClaim,
  claim: DerivedClaim,
): Promise<boolean> {
  return (
    (await withProcessingUpload(
      ctx,
      data,
      async ({ tx, session, file, accounting: { budget }, now }) => {
        if (session.expiresAt <= now) return false;
        if (
          (
            await tx
              .select()
              .from(blobBlocks)
              .where(eq(blobBlocks.sha256, session.expectedSha256))
          ).length
        )
          return false;
        const [blob] = await tx
          .select()
          .from(blobs)
          .where(eq(blobs.id, file.blobId))
          .for("update");
        const [recipe] = await tx
          .select()
          .from(blobDerivatives)
          .where(eq(blobDerivatives.id, source.recipe.id))
          .for("update");
        const [object] = await tx
          .select()
          .from(derivedObjects)
          .where(eq(derivedObjects.id, claim.object.id))
          .for("update");
        if (
          blob.id !== source.blob.id ||
          blob.state !== "ready" ||
          recipe.state !== "pending" ||
          recipe.generation !== source.recipe.generation ||
          !recipe.leaseUntil ||
          recipe.leaseUntil <= now ||
          object.state !== "pending" ||
          object.generation !== claim.object.generation ||
          !object.leaseUntil ||
          object.leaseUntil <= now
        )
          return false;
        await tx
          .update(derivedObjects)
          .set({ state: "ready", leaseUntil: null })
          .where(eq(derivedObjects.id, object.id));
        await tx
          .update(blobDerivatives)
          .set({ state: "ready", derivedObjectId: object.id, leaseUntil: null })
          .where(eq(blobDerivatives.id, recipe.id));
        await tx
          .update(storageBudget)
          .set({
            derivedReserved: budget.derivedReserved - object.size,
            derivedWritten: budget.derivedWritten + object.size,
          })
          .where(eq(storageBudget.id, "global"));
        return true;
      },
    )) === true
  );
}
