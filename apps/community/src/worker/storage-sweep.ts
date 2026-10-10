import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { fromDrizzle, type JobWithMetadata, type PgBoss } from "pg-boss";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  blobs,
  derivedObjects,
  files,
  mediaPublications,
  storageBudget,
  storagePolicies,
  storageInventoryProgress,
  storageTombstones,
  storageUsage,
  uploadAttempts,
  uploadParts,
  uploadSessions,
  user,
  userAvatars,
} from "../server/db/schema";
import {
  STORAGE_DEAD_QUEUE,
  STORAGE_DELETE_QUEUE,
  STORAGE_SWEEP_QUEUE,
  STORAGE_CLEANUP_QUEUE,
  STORAGE_RECONCILE_QUEUE,
} from "../server/jobs/queues";
import type { StorageContext, StorageJobData, DbTransaction } from "../server/storage/contracts";
import {
  lockDeletionAccounting,
  cancelStorageFlow,
  restoreStorageAvatar,
} from "../server/storage/deletion";
import { enqueueStorageFlow } from "../server/storage/flow";
import { notifyPublicMedia } from "../server/storage/avatars";
import { FILE_REFERENCES, hasFileReferences } from "../server/storage/references";
import { temporaryKey } from "../server/storage/keys";
import { StorageError } from "../server/storage/errors";
import { withPurgeTransaction, type PurgeBudget } from "../server/storage/publication";
import {
  createStorageWorkBudget,
  cleanupStorageQuarantine,
  requestMissingDerivedRebuild,
  reconcileStorage,
} from "./storage-reconcile";
import { withStorageTransaction } from "../server/storage/transactions";
import {
  claimStorageObjectDeletion,
  deleteStorageObject,
  originalHasDependencies,
  derivedHasDependencies,
  type StorageDeleteData,
} from "./storage-delete";
const HOUR = 3600000,
  DAY = 24 * HOUR;
const workBudgets = new WeakMap<StorageContext, PurgeBudget>();
const sweepTransaction = <T>(ctx: StorageContext, fn: (tx: DbTransaction) => Promise<T>) => {
  const b = workBudgets.get(ctx);
  return b ? withPurgeTransaction(ctx.db, b, fn) : withStorageTransaction(ctx.db, fn);
};
export const STORAGE_SWEEP_CRON = "29 * * * *";
export const STORAGE_SWEEP_BATCH = 100,
  STORAGE_SWEEP_MAX = 1000;
export type SweepResult = {
  processed: number;
  expired: number;
  repaired: number;
  dead: number;
  temporaryDeleted: number;
  filesDeleted: number;
  objectsClaimed: number;
  restored: number;
  storageFailures: number;
  uncertainWrites: number;
  budgetDrift: Record<string, number>;
  limited: boolean;
};

/** Exact deadletter origin identity + current flow generation; obsolete deliveries are no-ops. */
export async function recordStorageDead(
  ctx: StorageContext,
  job: Pick<JobWithMetadata<StorageJobData>, "data" | "sourceId" | "sourceName">,
): Promise<boolean> {
  if (
    !job.sourceId ||
    !["storage.ingest", "media.avatar", "storage.finalize"].includes(job.sourceName ?? "")
  )
    return false;
  return changeUpload(ctx, job.data, "dead", job.sourceId);
}
async function changeUpload(
  ctx: StorageContext,
  data: StorageJobData,
  mode: "dead" | "expire" | "repair",
  sourceId?: string,
): Promise<boolean> {
  const [snapshot] = await sweepTransaction(ctx, (tx) =>
    tx.select().from(uploadSessions).where(eq(uploadSessions.id, data.uploadId)),
  );
  if (!snapshot) return false;
  const boss = await ctx.boss();
  return sweepTransaction(ctx, async (tx) => {
    const [owner] = await tx.select().from(user).where(eq(user.id, snapshot.ownerId)).for("update");
    if (!owner) return false;
    const usage = await lockDeletionAccounting(tx, owner.id);
    const [s] = await tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, data.uploadId))
      .for("update");
    if (!s || !["receiving", "processing"].includes(s.state) || s.generation !== data.generation)
      return false;
    const now = ctx.now?.() ?? new Date();
    if (
      mode === "dead" &&
      (s.state !== "processing" || !sourceId || !s.flowJobIds.includes(sourceId))
    )
      return false;
    if (mode === "expire" && s.expiresAt > now) return false;
    if (mode === "repair") {
      if (
        owner.status !== "active" ||
        s.state !== "processing" ||
        s.expiresAt <= now ||
        s.updatedAt.getTime() + 15 * 60000 > now.getTime()
      )
        return false;
      const alive = s.flowJobIds.length
        ? await tx.execute(
            sql`select 1 from pgboss.job where id=any(${sql.param(s.flowJobIds)}::uuid[]) and state in ('created','retry','active') limit 1`,
          )
        : { rows: [] };
      if (alive.rows.length) {
        await tx.update(uploadSessions).set({ updatedAt: now }).where(eq(uploadSessions.id, s.id));
        return false;
      }
      await cancelStorageFlow(boss, tx, s.flowJobIds);
      const generation = s.generation + 1;
      const ids = await enqueueStorageFlow(boss, tx, { uploadId: s.id, generation });
      await tx
        .update(uploadSessions)
        .set({ generation, flowJobIds: ids, updatedAt: now })
        .where(eq(uploadSessions.id, s.id));
      return true;
    }
    await cancelStorageFlow(boss, tx, s.flowJobIds);
    await tx
      .update(uploadSessions)
      .set({
        state: mode === "expire" ? "expired" : "rejected",
        errorCode: mode === "expire" ? "UPLOAD_EXPIRED" : "PROCESSING_FAILED",
        generation: s.generation + 1,
        reservedBytes: 0,
        updatedAt: now,
      })
      .where(eq(uploadSessions.id, s.id));
    await tx
      .update(storageUsage)
      .set({
        reservedBytes: usage.reservedBytes - s.reservedBytes,
        activeUploads: usage.activeUploads - 1,
        updatedAt: now,
      })
      .where(eq(storageUsage.userId, s.ownerId));
    if (s.fileId)
      await tx
        .update(files)
        .set({ state: "rejected", retainedUntil: new Date(now.getTime() + DAY) })
        .where(and(eq(files.id, s.fileId), eq(files.state, "processing")));
    return true;
  });
}
async function cleanupAttempt(ctx: StorageContext, id: string): Promise<boolean> {
  const claim = await sweepTransaction(ctx, async (tx) => {
    await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    const [identity] = await tx.select().from(uploadAttempts).where(eq(uploadAttempts.id, id));
    if (!identity) return null;
    const [session] = await tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, identity.uploadId))
      .for("update");
    const [part] = await tx
      .select()
      .from(uploadParts)
      .where(eq(uploadParts.attemptId, id))
      .for("update");
    const [attempt] = await tx
      .select()
      .from(uploadAttempts)
      .where(eq(uploadAttempts.id, id))
      .for("update");
    const now = ctx.now?.() ?? new Date();
    if (
      !attempt ||
      attempt.state === "deleted" ||
      attempt.state === "writing" ||
      attempt.leaseUntil > now
    )
      return null;
    if (session && ["receiving", "processing"].includes(session.state) && part?.state === "ready")
      return null;
    if (
      session
        ? session.updatedAt.getTime() + HOUR > now.getTime()
        : attempt.updatedAt.getTime() + 2 * DAY > now.getTime()
    )
      return null;
    if (attempt.state !== "deleting")
      await tx
        .update(uploadAttempts)
        .set({ state: "deleting", generation: attempt.generation + 1, updatedAt: now })
        .where(eq(uploadAttempts.id, id));
    return { ...attempt, generation: attempt.generation + (attempt.state === "deleting" ? 0 : 1) };
  });
  if (!claim) return false;
  // Attempt keys are unique and never reincarnated: retry DELETE is safe here.
  await ctx.driver.delete({ bucket: "original", key: claim.tempKey });
  await sweepTransaction(ctx, async (tx) => {
    const [budget] = await tx
      .select()
      .from(storageBudget)
      .where(eq(storageBudget.id, "global"))
      .for("update");
    await tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, claim.uploadId))
      .for("update");
    const parts = await tx
      .select()
      .from(uploadParts)
      .where(eq(uploadParts.attemptId, id))
      .for("update");
    const [attempt] = await tx
      .select()
      .from(uploadAttempts)
      .where(eq(uploadAttempts.id, id))
      .for("update");
    if (attempt?.state !== "deleting" || attempt.generation !== claim.generation) return;
    if (parts.length) await tx.delete(uploadParts).where(eq(uploadParts.attemptId, id));
    await tx
      .update(uploadAttempts)
      .set({
        state: "deleted",
        reservedBytes: 0,
        writtenBytes: 0,
        updatedAt: ctx.now?.() ?? new Date(),
      })
      .where(eq(uploadAttempts.id, id));
    await tx
      .update(storageBudget)
      .set({
        temporaryReserved: budget.temporaryReserved - attempt.reservedBytes,
        temporaryWritten: budget.temporaryWritten - attempt.writtenBytes,
      })
      .where(eq(storageBudget.id, "global"));
  });
  return true;
}
async function cleanupUnknownTemporary(
  ctx: StorageContext,
  entry: { key: string; size: number; modifiedAt: Date },
  policyId: string,
): Promise<boolean> {
  const parts = entry.key.split("/");
  if (
    parts.length !== 4 ||
    parts[0] !== "tmp" ||
    !/^[0-9a-f-]{36}$/.test(parts[1]) ||
    !/^[0-9a-f-]{36}$/.test(parts[3]) ||
    !/^\d+$/.test(parts[2]) ||
    entry.size < 1 ||
    entry.size > 4194304
  )
    return false;
  const index = Number(parts[2]);
  try {
    if (temporaryKey(parts[1], index, parts[3]) !== entry.key) return false;
  } catch {
    return false;
  }
  const now = ctx.now?.() ?? new Date();
  const admitted = await sweepTransaction(ctx, async (tx) => {
    const [budget] = await tx
      .select()
      .from(storageBudget)
      .where(eq(storageBudget.id, "global"))
      .for("update");
    const [session] = await tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, parts[1]))
      .for("update");
    await tx
      .select()
      .from(uploadParts)
      .where(and(eq(uploadParts.uploadId, parts[1]), eq(uploadParts.index, index)))
      .for("update");
    const [attempt] = await tx
      .select()
      .from(uploadAttempts)
      .where(eq(uploadAttempts.tempKey, entry.key))
      .for("update");
    if (attempt && attempt.state !== "deleted") return false; // Especially never treat uncertain writing as remotely finished.
    if (session && ["receiving", "processing"].includes(session.state)) return false;
    const grace = session ? HOUR : 2 * DAY;
    if (
      entry.modifiedAt.getTime() + grace > now.getTime() ||
      (session && session.updatedAt.getTime() + HOUR > now.getTime())
    )
      return false;
    if (attempt) {
      if (attempt.size !== entry.size) return false;
      await tx
        .update(uploadAttempts)
        .set({
          state: "ready",
          writtenBytes: entry.size,
          reservedBytes: 0,
          generation: attempt.generation + 1,
          leaseUntil: entry.modifiedAt,
          updatedAt: entry.modifiedAt,
        })
        .where(eq(uploadAttempts.id, attempt.id));
    } else
      await tx.insert(uploadAttempts).values({
        id: parts[3],
        uploadId: parts[1],
        index,
        policyId,
        tempKey: entry.key,
        size: entry.size,
        state: "ready",
        writtenBytes: entry.size,
        leaseUntil: entry.modifiedAt,
        createdAt: entry.modifiedAt,
        updatedAt: entry.modifiedAt,
      });
    await tx
      .update(storageBudget)
      .set({ temporaryWritten: budget.temporaryWritten + entry.size })
      .where(eq(storageBudget.id, "global"));
    return true;
  });
  return admitted && cleanupAttempt(ctx, parts[3]);
}
async function temporaryInventory(
  ctx: StorageContext,
  visit: () => boolean,
): Promise<{ deleted: number; failures: number }> {
  const result = { deleted: 0, failures: 0 };
  const [policy] = await sweepTransaction(ctx, (tx) =>
    tx
      .select()
      .from(storagePolicies)
      .where(
        and(
          eq(storagePolicies.enabled, true),
          eq(storagePolicies.endpoint, ctx.config.endpoint),
          eq(storagePolicies.region, ctx.config.region),
          eq(storagePolicies.originalBucket, ctx.config.originalBucket),
        ),
      )
      .orderBy(storagePolicies.id)
      .limit(1),
  );
  if (!policy) return result;
  const [progress] = await sweepTransaction(ctx, async (tx) => {
    await tx.insert(storageInventoryProgress).values({ policyId: policy.id }).onConflictDoNothing();
    return tx
      .select()
      .from(storageInventoryProgress)
      .where(eq(storageInventoryProgress.policyId, policy.id));
  });
  try {
    const page = await ctx.driver.list({
      bucket: "original",
      prefix: "tmp/",
      maxKeys: 50,
      cursor: progress.temporaryCursor ?? undefined,
    });
    let complete = true;
    for (const entry of page.objects.slice(0, 50)) {
      if (!visit()) {
        complete = false;
        break;
      }
      try {
        if (await cleanupUnknownTemporary(ctx, entry, policy.id)) result.deleted++;
      } catch {
        result.failures++;
      }
    }
    if (complete)
      await sweepTransaction(ctx, async (tx) => {
        await tx
          .select()
          .from(storageInventoryProgress)
          .where(eq(storageInventoryProgress.policyId, policy.id))
          .for("update");
        await tx
          .update(storageInventoryProgress)
          .set({ temporaryCursor: page.cursor ?? null })
          .where(
            and(
              eq(storageInventoryProgress.policyId, policy.id),
              sql`${storageInventoryProgress.temporaryCursor} is not distinct from ${progress.temporaryCursor}`,
            ),
          );
      });
  } catch {
    result.failures++;
  }
  return result;
}
async function expireFile(
  ctx: StorageContext,
  id: string,
  registry = FILE_REFERENCES,
): Promise<boolean> {
  const [snapshot] = await sweepTransaction(ctx, (tx) =>
    tx.select().from(files).where(eq(files.id, id)),
  );
  if (!snapshot) return false;
  return sweepTransaction(ctx, async (tx) => {
    if (snapshot.ownerId) {
      const [owner] = await tx
        .select()
        .from(user)
        .where(eq(user.id, snapshot.ownerId))
        .for("update");
      if (owner) await lockDeletionAccounting(tx, owner.id);
      else
        await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    } else
      await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    const terminalSessions = await tx
      .select()
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.fileId, id),
          inArray(uploadSessions.state, ["ready", "cancelled", "expired", "rejected"]),
        ),
      )
      .orderBy(uploadSessions.id)
      .for("update");
    const [f] = await tx.select().from(files).where(eq(files.id, id)).for("update");
    const now = ctx.now?.() ?? new Date();
    if (!f || (await hasFileReferences(tx, id, registry))) return false;
    if (f.state === "deleted") {
      if (
        !f.deletedAt ||
        f.deletedAt.getTime() + 30 * DAY > now.getTime() ||
        (f.retainedUntil && f.retainedUntil > now)
      )
        return false;
      if (
        (
          await tx
            .select()
            .from(uploadSessions)
            .where(
              and(
                eq(uploadSessions.fileId, id),
                inArray(uploadSessions.state, ["receiving", "processing"]),
              ),
            )
            .limit(1)
        ).length
      )
        return false;
      if (terminalSessions.length)
        await tx
          .update(uploadSessions)
          .set({ fileId: null })
          .where(
            inArray(
              uploadSessions.id,
              terminalSessions.map((s) => s.id),
            ),
          );
      await tx.delete(files).where(eq(files.id, id));
      return true;
    }
    if (!f.retainedUntil || f.retainedUntil > now || f.state === "processing") return false;
    await tx
      .update(files)
      .set({
        state: "deleted",
        deletedAt: now,
        retainedUntil: new Date(now.getTime() + 30 * DAY),
        originalName: "removed",
      })
      .where(eq(files.id, id));
    if (f.ownerId && f.state === "ready")
      await tx
        .update(storageUsage)
        .set({ usedBytes: sql`${storageUsage.usedBytes}-${f.size}`, updatedAt: now })
        .where(eq(storageUsage.userId, f.ownerId));
    await tx.insert(storageTombstones).values({ kind: "file_deleted", fileId: id, createdAt: now });
    return true;
  });
}
async function scanOrphan(
  ctx: StorageContext,
  kind: StorageDeleteData["kind"],
  id: string,
  registry = FILE_REFERENCES,
): Promise<boolean> {
  const table = kind === "blob" ? blobs : derivedObjects;
  const eligible = await sweepTransaction(ctx, async (tx) => {
    await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    const [row] = await tx.select().from(table).where(eq(table.id, id)).for("update");
    if (row?.state !== "ready") return false;
    await tx
      .update(table)
      .set({
        properties: { ...row.properties, gcCheckedAt: (ctx.now?.() ?? new Date()).toISOString() },
      })
      .where(and(eq(table.id, id), eq(table.generation, row.generation)));
    const dependent =
      kind === "blob"
        ? await originalHasDependencies(tx, id, registry)
        : await derivedHasDependencies(tx, id, registry);
    const now = ctx.now?.() ?? new Date();
    if (dependent) {
      if (row.orphanedAt) await tx.update(table).set({ orphanedAt: null }).where(eq(table.id, id));
      return false;
    }
    if (!row.orphanedAt) {
      await tx.update(table).set({ orphanedAt: now }).where(eq(table.id, id));
      return false;
    }
    return row.orphanedAt.getTime() + 7 * DAY <= now.getTime();
  });
  return (
    eligible &&
    !!(await claimStorageObjectDeletion(ctx, { kind, id }, registry, workBudgets.get(ctx)))
  );
}
async function drift(ctx: StorageContext): Promise<Record<string, number>> {
  return sweepTransaction(ctx, async (tx) => {
    const [budget] = await tx
      .select()
      .from(storageBudget)
      .where(eq(storageBudget.id, "global"))
      .for("update");
    const sum = await tx.execute<Record<string, string>>(sql`select
    (select coalesce(sum(reserved_bytes),0) from upload_attempts) as "temporaryReserved",
    (select coalesce(sum(written_bytes),0) from upload_attempts) as "temporaryWritten",
    (select coalesce(sum(size),0) from blobs where state='pending' and lease_until is not null) as "originalReserved",
    (select coalesce(sum(size),0) from blobs where state='ready' or (state='deleting' and properties->'deletion'->>'chargedFrom'='written'))+(select coalesce(sum(size),0) from storage_quarantine where state<>'deleted') as "originalWritten",
    (select coalesce(sum(size),0) from derived_objects where state='pending' and lease_until is not null) as "derivedReserved",
    (select coalesce(sum(size),0) from derived_objects where state='ready' or (state='deleting' and properties->'deletion'->>'chargedFrom'='written')) as "derivedWritten"`);
    const values = sum.rows[0],
      result: Record<string, number> = {};
    for (const key of Object.keys(values))
      result[key] = Number(budget[key as keyof typeof budget]) - Number(values[key]);
    return result;
  });
}
export async function sweepStorage(
  original: StorageContext,
  registry = FILE_REFERENCES,
  maxDurationMs = 600000,
): Promise<SweepResult> {
  const work = createStorageWorkBudget(original, maxDurationMs),
    ctx = work.ctx;
  workBudgets.set(ctx, work);
  const boss = await ctx.boss(),
    now = ctx.now?.() ?? new Date();
  const result: SweepResult = {
    processed: 0,
    expired: 0,
    repaired: 0,
    dead: 0,
    temporaryDeleted: 0,
    filesDeleted: 0,
    objectsClaimed: 0,
    restored: 0,
    storageFailures: 0,
    uncertainWrites: 0,
    budgetDrift: {},
    limited: false,
  };
  const available = () => result.processed < STORAGE_SWEEP_MAX && work.available();
  const visit = () => {
    if (!available()) {
      result.limited = true;
      return false;
    }
    result.processed++;
    return true;
  };
  try {
    const pending = await sweepTransaction(ctx, (tx) =>
      tx
        .select({
          id: user.id,
          revision: userAvatars.revision,
          fileId: userAvatars.fileId,
          derivativeId: userAvatars.derivativeId,
        })
        .from(user)
        .innerJoin(userAvatars, eq(user.id, userAvatars.userId))
        .where(and(eq(user.status, "active"), sql`${userAvatars.suspendedAt} is not null`))
        .orderBy(userAvatars.updatedAt, user.id)
        .limit(50),
    );
    for (const p of pending) {
      if (!visit()) break;
      const hash = await sweepTransaction(ctx, async (tx) => {
        const [owner] = await tx.select().from(user).where(eq(user.id, p.id)).for("update");
        if (owner?.status !== "active") return null;
        const [association] = await tx
          .select()
          .from(userAvatars)
          .where(eq(userAvatars.userId, p.id))
          .for("update");
        if (
          !association?.suspendedAt ||
          association.revision !== p.revision ||
          association.fileId !== p.fileId ||
          association.derivativeId !== p.derivativeId
        )
          return null;
        const hash = await restoreStorageAvatar(ctx, p.id, tx);
        // A still-revoking association must rotate behind untouched candidates, even with a fixed clock.
        await tx
          .update(userAvatars)
          .set({
            updatedAt: new Date(
              Math.max((ctx.now?.() ?? new Date()).getTime(), association.updatedAt.getTime() + 1),
            ),
          })
          .where(
            and(
              eq(userAvatars.userId, p.id),
              eq(userAvatars.revision, association.revision),
              sql`${userAvatars.suspendedAt} is not null`,
            ),
          );
        return hash;
      });
      if (hash) result.restored++;
    }
    // Attempt timestamps rotate successes and failures; they do not acknowledge delivery.
    const resumes = await sweepTransaction(ctx, (tx) =>
      tx
        .select({ hash: mediaPublications.outputSha256, generation: mediaPublications.generation })
        .from(mediaPublications)
        .where(eq(mediaPublications.state, "public"))
        .orderBy(mediaPublications.updatedAt, mediaPublications.outputSha256)
        .limit(100),
    );
    for (const pub of resumes) {
      if (!visit()) break;
      try {
        await notifyPublicMedia(ctx, pub.hash);
        if (!ctx.onMediaPublished) throw new StorageError(503, "STORAGE_UNAVAILABLE");
      } catch {
        result.storageFailures++;
      }
      await sweepTransaction(ctx, async (tx) => {
        await tx
          .update(mediaPublications)
          .set({ updatedAt: ctx.now?.() ?? new Date() })
          .where(
            and(
              eq(mediaPublications.outputSha256, pub.hash),
              eq(mediaPublications.generation, pub.generation),
              eq(mediaPublications.state, "public"),
            ),
          );
      });
    }

    const dead = await sweepTransaction(ctx, (tx) =>
      tx.execute<{
        id: string;
        data: StorageJobData;
        sourceId: string | null;
        sourceName: string | null;
      }>(
        sql`select id,data,source_id as "sourceId",source_name as "sourceName" from pgboss.job where name=${STORAGE_DEAD_QUEUE} and state in ('created','retry') order by created_on limit 100`,
      ),
    );
    for (const job of dead.rows) {
      if (!visit()) break;
      if (await recordStorageDead(ctx, job)) result.dead++;
      await sweepTransaction(ctx, (tx) =>
        boss.complete(STORAGE_DEAD_QUEUE, job.id, undefined, {
          db: fromDrizzle(tx, sql),
          includeQueued: true,
        }),
      );
    }
    // Each phase takes one bounded batch; decisions rotate physical candidates persistently.
    let cursor: string | undefined;
    while (available()) {
      const sessions = await sweepTransaction(ctx, (tx) =>
        tx
          .select()
          .from(uploadSessions)
          .where(
            and(
              inArray(uploadSessions.state, ["receiving", "processing"]),
              or(
                lte(uploadSessions.expiresAt, now),
                and(
                  eq(uploadSessions.state, "processing"),
                  lte(uploadSessions.updatedAt, new Date(now.getTime() - 15 * 60000)),
                ),
              ),
              cursor ? gt(uploadSessions.id, cursor) : undefined,
            ),
          )
          .orderBy(uploadSessions.updatedAt, uploadSessions.id)
          .limit(100),
      );
      if (!sessions.length) break;
      for (const s of sessions) {
        if (!visit()) break;
        if (s.expiresAt <= now) {
          if (await changeUpload(ctx, { uploadId: s.id, generation: s.generation }, "expire"))
            result.expired++;
        } else if (await changeUpload(ctx, { uploadId: s.id, generation: s.generation }, "repair"))
          result.repaired++;
        cursor = s.id;
      }
      break;
    }
    cursor = undefined;
    while (available()) {
      const rows = await sweepTransaction(ctx, (tx) =>
        tx
          .select()
          .from(uploadAttempts)
          .where(
            and(
              inArray(uploadAttempts.state, ["ready", "deleting"]),
              lte(uploadAttempts.leaseUntil, now),
              sql`not exists(select 1 from upload_sessions s where s.id=${uploadAttempts.uploadId} and s.state in ('receiving','processing'))`,
              sql`(exists(select 1 from upload_sessions s where s.id=${uploadAttempts.uploadId} and s.updated_at<=${new Date(now.getTime() - HOUR)}) or (not exists(select 1 from upload_sessions s where s.id=${uploadAttempts.uploadId}) and ${uploadAttempts.updatedAt}<=${new Date(now.getTime() - 2 * DAY)}))`,
              cursor ? gt(uploadAttempts.id, cursor) : undefined,
            ),
          )
          .orderBy(uploadAttempts.id)
          .limit(100),
      );
      if (!rows.length) break;
      for (const a of rows) {
        if (!visit()) break;
        cursor = a.id;
        try {
          if (await cleanupAttempt(ctx, a.id)) result.temporaryDeleted++;
        } catch {
          result.storageFailures++;
        }
      }
      break;
    }
    cursor = undefined;
    while (available()) {
      const unreferenced = registry.flatMap((entry) =>
        getTableConfig(entry.referenceTable)
          .foreignKeys.filter((fk) => fk.reference().foreignTable === files)
          .map((fk) => {
            const reference = fk.reference();
            return sql`not exists(select 1 from ${entry.referenceTable} where ${reference.columns[0]}=${files.id})`;
          }),
      );
      const rows = await sweepTransaction(ctx, (tx) =>
        tx
          .select()
          .from(files)
          .where(
            and(
              lte(files.retainedUntil, now),
              sql`${files.state}<>'processing'`,
              ...unreferenced,
              cursor ? gt(files.id, cursor) : undefined,
            ),
          )
          .orderBy(files.id)
          .limit(100),
      );
      if (!rows.length) break;
      for (const f of rows) {
        if (!visit()) break;
        cursor = f.id;
        if (await expireFile(ctx, f.id, registry)) result.filesDeleted++;
      }
      break;
    }
    for (const kind of ["blob", "derived"] as const) {
      cursor = undefined;
      const table = kind === "blob" ? blobs : derivedObjects;
      while (available()) {
        const rows = await sweepTransaction(ctx, (tx) =>
          tx
            .select()
            .from(table)
            .where(and(eq(table.state, "ready"), cursor ? gt(table.id, cursor) : undefined))
            .orderBy(
              sql`case when ${table.properties}->>'gcCheckedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then ${table.properties}->>'gcCheckedAt' else '1970-01-01T00:00:00.000Z' end`,
              table.id,
            )
            .limit(100),
        );
        if (!rows.length) break;
        for (const o of rows) {
          if (!visit()) break;
          cursor = o.id;
          if (await scanOrphan(ctx, kind, o.id, registry)) result.objectsClaimed++;
          else
            try {
              const head = await ctx.driver.head({
                bucket: kind === "blob" ? "original" : "derived",
                key: o.key,
              });
              if (!head || head.size !== o.size) {
                result.storageFailures++;
                if (!head && kind === "derived" && work.available())
                  await requestMissingDerivedRebuild(
                    ctx,
                    { id: o.id, generation: o.generation },
                    work,
                  );
              }
            } catch {
              result.storageFailures++;
            }
        }
        break;
      }
    }
    // Requeue safe, not-yet-started deletes only. Started/uncertain operations retain their durable claim.
    for (const kind of ["blob", "derived"] as const) {
      const table = kind === "blob" ? blobs : derivedObjects;
      const rows = await sweepTransaction(ctx, (tx) =>
        tx
          .select()
          .from(table)
          .where(
            and(
              eq(table.state, "deleting"),
              sql`${table.properties}->'deletion'->>'startedAt' is null`,
            ),
          )
          .orderBy(table.id)
          .limit(50),
      );
      for (const row of rows) {
        if (!visit()) break;
        await sweepTransaction(ctx, (tx) =>
          boss.send(
            STORAGE_DELETE_QUEUE,
            { kind, id: row.id, generation: row.generation },
            { singletonKey: `${kind}:${row.id}:${row.generation}`, db: fromDrizzle(tx, sql) },
          ),
        );
      }
    }
    if (available()) {
      const tmp = await temporaryInventory(ctx, visit);
      result.temporaryDeleted += tmp.deleted;
      result.storageFailures += tmp.failures;
    }
    if (available()) {
      const quarantine = await cleanupStorageQuarantine(
        ctx,
        Math.min(100, 1000 - result.processed),
        work,
      );
      result.processed += quarantine.processed;
      result.storageFailures += quarantine.storageFailures;
    }
    result.uncertainWrites = await sweepTransaction(ctx, (tx) =>
      tx.$count(
        uploadAttempts,
        and(eq(uploadAttempts.state, "writing"), lte(uploadAttempts.leaseUntil, now)),
      ),
    );
    if (available()) result.budgetDrift = await drift(ctx);
  } catch (error) {
    if (work.available()) throw error;
    result.limited = true;
  }
  result.limited ||= !available();
  const { budgetDrift, ...counts } = result;
  ctx.log.info("storage_sweep", {
    ...counts,
    driftFields: Object.values(budgetDrift).filter((n) => n !== 0).length,
  });
  return result;
}

/** Control-only consumers; NapCat realtime handlers/connection are independent. */
export async function registerStorageWorkers(ctx: StorageContext, boss: PgBoss) {
  await boss.work<StorageJobData, void, { includeMetadata: true }>(
    STORAGE_DEAD_QUEUE,
    { includeMetadata: true },
    async (jobs) => {
      for (const job of jobs) await recordStorageDead(ctx, job);
    },
  );
  await boss.work<StorageDeleteData>(STORAGE_DELETE_QUEUE, async (jobs) => {
    for (const job of jobs) {
      const data = job.data;
      if (
        !data ||
        !["blob", "derived"].includes(data.kind) ||
        !/^[0-9a-f-]{36}$/.test(data.id) ||
        !Number.isSafeInteger(data.generation) ||
        data.generation < 0
      )
        throw new Error("Invalid storage deletion job");
      await deleteStorageObject(ctx, data);
    }
  });
  await boss.work(STORAGE_SWEEP_QUEUE, async () => {
    await sweepStorage(ctx);
  });
  await boss.work(STORAGE_CLEANUP_QUEUE, async () => {
    await sweepStorage(ctx);
  });
  await boss.work(STORAGE_RECONCILE_QUEUE, async () => {
    await reconcileStorage(ctx);
  });
  await boss.schedule(
    STORAGE_RECONCILE_QUEUE,
    "13 2 * * *",
    {},
    { tz: "Asia/Shanghai", missed: "once" },
  );
  await boss.schedule(
    STORAGE_SWEEP_QUEUE,
    STORAGE_SWEEP_CRON,
    {},
    { tz: "Asia/Shanghai", missed: "once" },
  );
}
