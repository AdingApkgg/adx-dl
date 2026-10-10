import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import type { AvatarDto } from "@/shared/storage";
import {
  avatarMutations,
  blobs,
  blobBlocks,
  files,
  blobDerivatives,
  derivedObjects,
  mediaPublications,
  mediaPurgeRequests,
  storageTombstones,
  user,
  userAvatars,
} from "../db/schema";
import { MEDIA_PURGE_QUEUE } from "../jobs/queues";
import { withPurgeTransaction, type PurgeBudget } from "./publication";
import type { StorageContext } from "./contracts";
import { StorageError } from "./errors";
import { hasPublicRepresentation, type ReferenceDb } from "./references";
import { withStorageTransaction } from "./transactions";
import { lockUploadAccounting, storageTime } from "./usage";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type MediaPurgeJobData = { hash: string; generation: number };
export async function setAvatar(
  ctx: StorageContext,
  userId: string,
  input: { fileId: string | null; expectedRevision: number },
  idempotencyKey: string,
): Promise<AvatarDto> {
  if (
    !uuid.test(idempotencyKey) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    (input.fileId !== null && !uuid.test(input.fileId))
  )
    throw new StorageError(400, "INVALID_UPLOAD");
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        input.fileId === null ? "DELETE" : "PUT",
        input.fileId,
        input.expectedRevision,
      ]),
    )
    .digest("hex");
  const boss = await ctx.boss();
  const result = await withStorageTransaction(ctx.db, async (tx) => {
    await lockUploadAccounting(tx, userId);
    const [replay] = await tx
      .select()
      .from(avatarMutations)
      .where(
        and(eq(avatarMutations.userId, userId), eq(avatarMutations.idempotencyKey, idempotencyKey)),
      );
    if (replay) {
      if (replay.requestDigest !== digest) throw new StorageError(409, "IDEMPOTENCY_CONFLICT");
      return { image: replay.resultImage, avatarRevision: replay.resultRevision };
    }
    const [current] = await tx
      .select()
      .from(userAvatars)
      .where(eq(userAvatars.userId, userId))
      .for("update");
    const revision = current?.revision ?? 0;
    if (revision !== input.expectedRevision) throw new StorageError(409, "AVATAR_CHANGED");
    const ids = [current?.fileId, input.fileId].filter((id): id is string => !!id).sort();
    const lockedFiles = ids.length
      ? await tx.select().from(files).where(inArray(files.id, ids)).orderBy(files.id).for("update")
      : [];
    const target = input.fileId ? lockedFiles.find((f) => f.id === input.fileId) : null;
    if (
      input.fileId &&
      (!target ||
        target.ownerId !== userId ||
        target.state !== "ready" ||
        target.purpose !== "avatar")
    )
      throw new StorageError(404, "NOT_FOUND");
    const blobIds = [...new Set(lockedFiles.map((f) => f.blobId))].sort();
    const originals = blobIds.length
      ? await tx
          .select()
          .from(blobs)
          .where(inArray(blobs.id, blobIds))
          .orderBy(blobs.id)
          .for("update")
      : [];
    const recipes = blobIds.length
      ? await tx
          .select()
          .from(blobDerivatives)
          .where(
            and(
              inArray(blobDerivatives.sourceBlobId, blobIds),
              eq(blobDerivatives.recipe, "avatar-v1"),
            ),
          )
          .orderBy(blobDerivatives.id)
          .for("update")
      : [];
    const recipe = target
      ? recipes.find(
          (r) =>
            r.sourceBlobId === target.blobId &&
            r.recipeBuild === ctx.config.recipeBuild &&
            r.state === "ready",
        )
      : null;
    const outputIds = [
      ...new Set(recipes.map((r) => r.derivedObjectId).filter((id): id is string => !!id)),
    ].sort();
    const outputs = outputIds.length
      ? await tx
          .select()
          .from(derivedObjects)
          .where(inArray(derivedObjects.id, outputIds))
          .orderBy(derivedObjects.id)
          .for("update")
      : [];
    const output = recipe ? outputs.find((o) => o.id === recipe.derivedObjectId) : null;
    const original = target ? originals.find((b) => b.id === target.blobId) : null;
    if (target && (!recipe || !output || output.state !== "ready" || original?.state !== "ready"))
      throw new StorageError(409, "PROCESSING_FAILED");
    if (
      output &&
      original &&
      (
        await tx
          .select()
          .from(blobBlocks)
          .where(inArray(blobBlocks.sha256, [original.sha256, output.outputSha256]))
      ).length
    )
      throw new StorageError(404, "NOT_FOUND");
    const oldRecipe = current?.derivativeId
      ? recipes.find((r) => r.id === current.derivativeId)
      : null;
    const oldOutput = oldRecipe ? outputs.find((o) => o.id === oldRecipe.derivedObjectId) : null;
    const hashes = [
      ...new Set([output?.outputSha256, oldOutput?.outputSha256].filter((h): h is string => !!h)),
    ].sort();
    for (const hash of hashes)
      await tx.insert(mediaPublications).values({ outputSha256: hash }).onConflictDoNothing();
    const pubs = hashes.length
      ? await tx
          .select()
          .from(mediaPublications)
          .where(inArray(mediaPublications.outputSha256, hashes))
          .orderBy(mediaPublications.outputSha256)
          .for("update")
      : [];
    const pub = output ? pubs.find((p) => p.outputSha256 === output.outputSha256) : null;
    if (pub?.state === "revoking") throw new StorageError(409, "MEDIA_REVOCATION_PENDING");
    if (pub?.state === "blocked") throw new StorageError(404, "NOT_FOUND");
    const same = input.fileId !== null && current?.fileId === input.fileId;
    const now = await storageTime(tx);
    const result = {
      image: output ? `/media/${output.outputSha256}.jpg` : null,
      avatarRevision: revision + (same ? 0 : 1),
    };
    if (!same) {
      // Individual withdrawal remains durable even when another account keeps this hash public.
      if (current?.fileId && oldOutput)
        await tx
          .insert(storageTombstones)
          .values({
            kind: "media_revoked",
            userId,
            fileId: current.fileId,
            sha256: oldOutput.outputSha256,
            generation: result.avatarRevision,
          });
      if (current?.fileId)
        await tx
          .update(files)
          .set({ retainedUntil: new Date(now.getTime() + 86400000) })
          .where(eq(files.id, current.fileId));
      await tx
        .insert(userAvatars)
        .values({
          userId,
          fileId: input.fileId,
          derivativeId: recipe?.id ?? null,
          revision: result.avatarRevision,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userAvatars.userId,
          set: {
            fileId: input.fileId,
            derivativeId: recipe?.id ?? null,
            revision: result.avatarRevision,
            suspendedAt: null,
            updatedAt: now,
          },
        });
      await tx.update(user).set({ image: result.image, updatedAt: now }).where(eq(user.id, userId));
      if (pub && pub.state !== "public")
        await tx
          .update(mediaPublications)
          .set({ state: "public", generation: pub.generation + 1, updatedAt: now })
          .where(eq(mediaPublications.outputSha256, pub.outputSha256));
      if (
        oldOutput &&
        oldOutput.outputSha256 !== output?.outputSha256 &&
        !(await hasPublicRepresentation(tx, oldOutput.outputSha256))
      ) {
        const oldPub = pubs.find((p) => p.outputSha256 === oldOutput.outputSha256)!;
        if (oldPub.state === "public") {
          const generation = oldPub.generation + 1;
          await tx
            .update(mediaPublications)
            .set({ state: "revoking", generation, updatedAt: now })
            .where(eq(mediaPublications.outputSha256, oldOutput.outputSha256));
          await tx
            .insert(mediaPurgeRequests)
            .values({ outputSha256: oldOutput.outputSha256, generation })
            .onConflictDoNothing();
          await tx
            .insert(storageTombstones)
            .values({ kind: "media_revoked", sha256: oldOutput.outputSha256, generation });
          await boss.send(
            MEDIA_PURGE_QUEUE,
            { hash: oldOutput.outputSha256, generation } satisfies MediaPurgeJobData,
            { singletonKey: `${oldOutput.outputSha256}:${generation}`, db: fromDrizzle(tx, sql) },
          );
        }
      }
    }
    await tx.insert(avatarMutations).values({
      userId,
      idempotencyKey,
      requestDigest: digest,
      resultImage: result.image,
      resultRevision: result.avatarRevision,
      createdAt: now,
    });
    return result;
  });
  if (result.image) await notifyPublicMedia(ctx, result.image.slice(7, -4));
  return result;
}
/** Task8 restores call this only after their outer transaction commits. Old replay is a no-op. */
export async function notifyPublicMedia(
  ctx: StorageContext,
  hash: string,
  budget?: PurgeBudget,
): Promise<void> {
  if (!ctx.onMediaPublished) return;
  const read = async (tx: ReferenceDb) => {
    const [pub] = await tx
      .select()
      .from(mediaPublications)
      .where(eq(mediaPublications.outputSha256, hash));
    return pub?.state === "public" && (await hasPublicRepresentation(tx, hash)) ? pub : null;
  };
  const current = () => (budget ? withPurgeTransaction(ctx.db, budget, read) : read(ctx.db));
  const pub = await current();
  if (!pub) return;
  budget?.check();
  try {
    await ctx.onMediaPublished(hash, pub.generation);
    budget?.check();
  } catch {
    const latest = await current();
    if (!latest || latest.generation !== pub.generation) return;
    throw new StorageError(503, "STORAGE_UNAVAILABLE");
  }
}
