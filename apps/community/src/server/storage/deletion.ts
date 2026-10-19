import {libraryDeletionHandler} from "../library/deletion";
import { followingDeletionHandler } from "../following/deletion";
import {discussionDeletionHandler} from "../discussions/deletion";
import { retentionFact } from "@/shared/chart-journal";
import { awaitChartJournal } from "../charts/publication-journal";
import { publicationDto } from "../charts/service";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss } from "pg-boss";
import {
  charts,
  chartPublications,
  chartPublicIds,
  blobs,
  blobBlocks,
  blobDerivatives,
  derivedObjects,
  files,
  mediaPublications,
  mediaPurgeRequests,
  storageBudget,
  storageTombstones,
  storageUsage,
  uploadSessions,
  user,
  userAvatars,
} from "../db/schema";
import {
  MEDIA_PURGE_QUEUE,
  STORAGE_INGEST_QUEUE,
  MEDIA_AVATAR_QUEUE,
  STORAGE_FINALIZE_QUEUE,
  STORAGE_CLEANUP_QUEUE,
} from "../jobs/queues";
import type { DeletionHandler } from "../services/user-deletion";
import type { DbTransaction, StorageContext } from "./contracts";
import {
  FILE_REFERENCES,
  hasFileReferences,
  hasPublicRepresentation,
  type FileReference,
} from "./references";
import { notifyPublicMedia } from "./avatars";
import { StorageError } from "./errors";
import { storageTime } from "./usage";
import { chartDeletionHandler } from "../charts/deletion";
import { storageFlowQueues } from "./flow";
import type { StoragePurpose } from "@/shared/storage";

/** Existing lifecycle already owns user; pending owners are valid here, never for uploads. */
export async function lockDeletionAccounting(tx: DbTransaction, userId: string) {
  await tx.insert(storageUsage).values({ userId }).onConflictDoNothing();
  const [usage] = await tx
    .select()
    .from(storageUsage)
    .where(eq(storageUsage.userId, userId))
    .for("update");
  await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
  return usage;
}
export async function cancelStorageFlow(boss: PgBoss, tx: DbTransaction, ids: string[], purpose: StoragePurpose = "avatar") {
  const queues = storageFlowQueues(purpose);
  for (const [i, queue] of queues.entries())
    if (ids[i]) await boss.cancel(queue, ids[i], { db: fromDrizzle(tx, sql) });
}
/** Caller holds owner/usage/budget; physical attempt charges deliberately survive cancellation. */
export async function stopStorageSessions(
  tx: DbTransaction,
  boss: PgBoss,
  userId: string,
  now: Date,
) {
  const sessions = await tx
    .select()
    .from(uploadSessions)
    .where(
      and(
        eq(uploadSessions.ownerId, userId),
        inArray(uploadSessions.state, ["receiving", "processing"]),
      ),
    )
    .orderBy(uploadSessions.id)
    .for("update");
  for (const session of sessions) {
    await tx
      .update(uploadSessions)
      .set({
        state: "cancelled",
        reservedBytes: 0,
        generation: session.generation + 1,
        errorCode: "UPLOAD_CANCELLED",
        updatedAt: now,
      })
      .where(eq(uploadSessions.id, session.id));
    await cancelStorageFlow(boss, tx, session.flowJobIds, session.purpose);
  }
  if (sessions.length)
    await tx
      .update(storageUsage)
      .set({
        reservedBytes: sql`${storageUsage.reservedBytes}-${sessions.reduce((n, s) => n + s.reservedBytes, 0)}`,
        activeUploads: sql`${storageUsage.activeUploads}-${sessions.length}`,
        updatedAt: now,
      })
      .where(eq(storageUsage.userId, userId));
  const ids = sessions
    .map((s) => s.fileId)
    .filter((id): id is string => !!id)
    .sort();
  if (ids.length)
    await tx
      .update(files)
      .set({ state: "rejected", retainedUntil: new Date(now.getTime() + 86400000) })
      .where(and(inArray(files.id, ids), eq(files.state, "processing")));
}
async function lockedAvatar(tx: DbTransaction, userId: string) {
  const [avatar] = await tx
    .select()
    .from(userAvatars)
    .where(eq(userAvatars.userId, userId))
    .for("update");
  if (!avatar?.fileId || !avatar.derivativeId) return null;
  const [file] = await tx.select().from(files).where(eq(files.id, avatar.fileId)).for("update");
  const [blob] = await tx.select().from(blobs).where(eq(blobs.id, file.blobId)).for("update");
  const [recipe] = await tx
    .select()
    .from(blobDerivatives)
    .where(eq(blobDerivatives.id, avatar.derivativeId))
    .for("update");
  if (!recipe.derivedObjectId) return null;
  const [output] = await tx
    .select()
    .from(derivedObjects)
    .where(eq(derivedObjects.id, recipe.derivedObjectId))
    .for("update");
  await tx
    .insert(mediaPublications)
    .values({ outputSha256: output.outputSha256 })
    .onConflictDoNothing();
  const [publication] = await tx
    .select()
    .from(mediaPublications)
    .where(eq(mediaPublications.outputSha256, output.outputSha256))
    .for("update");
  return { avatar, file, blob, recipe, output, publication };
}
async function withdraw(
  tx: DbTransaction,
  boss: PgBoss,
  hash: string,
  now: Date,
  registry: readonly FileReference[],
) {
  const [pub] = await tx
    .select()
    .from(mediaPublications)
    .where(eq(mediaPublications.outputSha256, hash))
    .for("update");
  if (pub?.state !== "public" || (await hasPublicRepresentation(tx, hash, registry))) return;
  const generation = pub.generation + 1;
  await tx
    .update(mediaPublications)
    .set({ state: "revoking", generation, updatedAt: now })
    .where(eq(mediaPublications.outputSha256, hash));
  await tx
    .insert(mediaPurgeRequests)
    .values({ outputSha256: hash, generation, nextAttemptAt: now })
    .onConflictDoNothing();
  await tx
    .insert(storageTombstones)
    .values({ kind: "media_revoked", sha256: hash, generation, createdAt: now });
  await boss.send(
    MEDIA_PURGE_QUEUE,
    { hash, generation },
    { singletonKey: `${hash}:${generation}`, db: fromDrizzle(tx, sql) },
  );
}
/** Same transaction as active-user restoration; suspendedAt is also deferred-repair intent. */
export async function restoreStorageAvatar(
  ctx: StorageContext,
  userId: string,
  tx: DbTransaction,
): Promise<string | null> {
  await lockDeletionAccounting(tx, userId);
  const a = await lockedAvatar(tx, userId);
  if (!a?.avatar.suspendedAt) return null;
  const [owner] = await tx.select({ status: user.status }).from(user).where(eq(user.id, userId));
  if (
    owner?.status !== "active" ||
    a.file.ownerId !== userId ||
    a.file.state !== "ready" ||
    a.file.purpose !== "avatar" ||
    a.blob.state !== "ready" ||
    a.recipe.sourceBlobId !== a.blob.id ||
    a.recipe.state !== "ready" ||
    a.recipe.recipe !== "avatar-v1" ||
    a.recipe.recipeBuild !== ctx.config.recipeBuild ||
    a.output.state !== "ready" ||
    a.publication.state === "revoking" ||
    a.publication.state === "blocked"
  )
    return null;
  if (
    (
      await tx
        .select()
        .from(blobBlocks)
        .where(inArray(blobBlocks.sha256, [a.blob.sha256, a.output.outputSha256]))
    ).length
  )
    return null;
  const now = await storageTime(tx);
  await tx
    .update(userAvatars)
    .set({ suspendedAt: null, revision: a.avatar.revision + 1, updatedAt: now })
    .where(
      and(
        eq(userAvatars.userId, userId),
        eq(userAvatars.revision, a.avatar.revision),
        eq(userAvatars.fileId, a.file.id),
      ),
    );
  if (a.publication.state !== "public")
    await tx
      .update(mediaPublications)
      .set({ state: "public", generation: a.publication.generation + 1, updatedAt: now })
      .where(eq(mediaPublications.outputSha256, a.output.outputSha256));
  await tx
    .update(user)
    .set({ image: `/media/${a.output.outputSha256}.jpg`, updatedAt: now })
    .where(eq(user.id, userId));
  return a.output.outputSha256;
}
export function createStorageDeletionHandler(
  ctx: StorageContext,
  registry = FILE_REFERENCES,
): DeletionHandler {
  let producer: PgBoss | undefined;
  const ready = async () => {
    producer = await ctx.boss();
  };
  const boss = () => {
    if (!producer)
      throw new Error("Storage deletion producer was not initialized outside transaction");
    return producer;
  };
  return {
    name: "storage",
    beforeTransaction: ready,
    afterPurge: async (userId) => {
      const [fact] = await ctx.db.select().from(storageTombstones)
        .where(and(eq(storageTombstones.kind, "user_deleted"), eq(storageTombstones.userId, userId)))
        .orderBy(desc(storageTombstones.sequence)).limit(1);
      // Public-content purges cross the same barrier on first execution and post-commit retry.
      if (fact?.payload && "retained" in fact.payload) await awaitChartJournal(ctx, fact.sequence);
    },
    hasContent: async () => false,
    prepare: async (userId, tx) => {
      await lockDeletionAccounting(tx, userId);
      const now = await storageTime(tx);
      await stopStorageSessions(tx, boss(), userId, now);
      const a = await lockedAvatar(tx, userId);
      await tx.update(user).set({ image: null, updatedAt: now }).where(eq(user.id, userId));
      if (a) {
        const revision = a.avatar.revision + (a.avatar.suspendedAt ? 0 : 1);
        if (!a.avatar.suspendedAt)
          await tx.insert(storageTombstones).values({
            kind: "media_revoked", userId, fileId: a.file.id,
            sha256: a.output.outputSha256, generation: revision, createdAt: now,
          });
        await tx
          .update(userAvatars)
          .set({ suspendedAt: a.avatar.suspendedAt ?? now, revision, updatedAt: now })
          .where(eq(userAvatars.userId, userId));
        await withdraw(tx, boss(), a.output.outputSha256, now, registry);
      }
    },
    restore: async (userId, tx) => {
      await restoreStorageAvatar(ctx, userId, tx);
    },
    purge: async (userId, _options, tx) => {
      await lockDeletionAccounting(tx, userId);
      const now = await storageTime(tx);
      await stopStorageSessions(tx, boss(), userId, now);
      const owned = await tx
        .select()
        .from(files)
        .where(eq(files.ownerId, userId))
        .orderBy(files.id)
        .for("update");
      const a = await lockedAvatar(tx, userId);
      await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
      if (a) await withdraw(tx, boss(), a.output.outputSha256, now, registry);
      for (const file of owned) {
        const retained =
          file.purpose !== "avatar" && (await hasFileReferences(tx, file.id, registry));
        await tx
          .update(files)
          .set({
            originalName: "removed",
            ...(!retained && file.state !== "deleted"
              ? {
                  state: "deleted" as const,
                  deletedAt: now,
                  retainedUntil: new Date(now.getTime() + 30 * 86400000),
                }
              : {}),
          })
          .where(eq(files.id, file.id));
        if (!retained && file.state !== "deleted") {
          if (file.state === "ready")
            await tx
              .update(storageUsage)
              .set({ usedBytes: sql`${storageUsage.usedBytes}-${file.size}`, updatedAt: now })
              .where(eq(storageUsage.userId, userId));
          await tx
            .insert(storageTombstones)
            .values({ kind: "file_deleted", fileId: file.id, userId, createdAt: now });
        }
      }
      await tx.delete(uploadSessions).where(eq(uploadSessions.ownerId, userId));
      const retained = await tx.select({ chart: charts, identity: chartPublicIds, publication: chartPublications }).from(charts)
        .leftJoin(chartPublicIds, eq(chartPublicIds.chartId, charts.id))
        .innerJoin(chartPublications, eq(chartPublications.chartId, charts.id))
        .where(and(eq(charts.ownerId, userId), isNull(charts.deletedAt)));
      const revocations = await tx.select({ sequence: storageTombstones.sequence }).from(storageTombstones)
        .where(and(eq(storageTombstones.kind, "chart_permission"), eq(storageTombstones.userId, userId)))
        .limit(1);
      const [fact] = await tx.insert(storageTombstones).values({
        kind: "user_deleted", userId, createdAt: now,
        payload: retained.length || revocations.length ? retentionFact.parse({
          version: 1,
          retained: retained.map(({ chart, identity, publication }) => ({
            ...(identity ? { publicId: identity.publicId.toString() } : {}),
            version: 1, chartId: chart.id, revision: chart.revision, publication: publicationDto(publication),
          })),
        }) : undefined,
      }).returning();
      if (retained.length) await tx.update(charts).set({ publicationSequence: fact.sequence })
        .where(inArray(charts.id, retained.map(r => r.chart.id)));
      await boss().send(STORAGE_CLEANUP_QUEUE, {}, { db: fromDrizzle(tx, sql) });
    },
  };
}
/** Every actual business FK has a deletion partner; business modules precede storage. */
export function createDeletionHandlers(
  ctx: StorageContext,
  business: readonly DeletionHandler[] = [],
  registry = FILE_REFERENCES,
): readonly DeletionHandler[] {
  const chartModules = business.some(h => h.name === "charts") ? business : [...business, chartDeletionHandler];
  const modules = chartModules.some(h=>h.name===discussionDeletionHandler.name)?chartModules:[...chartModules,discussionDeletionHandler];
  const following = followingDeletionHandler(ctx);
  const followedModules = modules.some(h=>h.name===following.name)?modules:[...modules,following];
  const library=libraryDeletionHandler(ctx);
  const allModules=followedModules.some(h=>h.name===library.name)?followedModules:[...followedModules,library];
  const names = new Set(allModules.map((h) => h.name));
  if (names.size !== allModules.length || names.has("storage"))
    throw new Error("Duplicate deletion registration");
  names.add("storage");
  for (const reference of registry)
    if (!names.has(reference.deletionPartner))
      throw new Error("Missing file reference deletion partner");
  return Object.freeze([...allModules, createStorageDeletionHandler(ctx, registry)]);
}

/** Retry only the user's CURRENT public association, never a captured old image/selection. */
export async function notifyCurrentUserAvatar(ctx: StorageContext, userId: string): Promise<void> {
  const [row] = await ctx.db
    .select({ image: user.image, status: user.status })
    .from(user)
    .where(eq(user.id, userId));
  if (row?.status !== "active" || !row.image) return;
  const match = /^\/media\/([a-f0-9]{64})\.jpg$/.exec(row.image);
  if (!match) return;
  const [publication] = await ctx.db
    .select()
    .from(mediaPublications)
    .where(eq(mediaPublications.outputSha256, match[1]));
  if (publication?.state !== "public" || !(await hasPublicRepresentation(ctx.db, match[1]))) return;
  await notifyPublicMedia(ctx, match[1]);
  if (!ctx.onMediaPublished) throw new StorageError(503, "STORAGE_UNAVAILABLE");
}
