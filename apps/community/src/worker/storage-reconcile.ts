import { and, eq, sql } from "drizzle-orm";
import {
  blobs,
  blobDerivatives,
  derivedObjects,
  storageBudget,
  storageInventoryProgress,
  storagePolicies,
  storageQuarantine,
  uploadAttempts,
} from "../server/db/schema";
import type { DbTransaction, StorageContext } from "../server/storage/contracts";
import { StorageError } from "../server/storage/errors";
import { objectKey } from "../server/storage/keys";
import { withStorageTransaction } from "../server/storage/transactions";
import { settleSuccessfulQuarantineDelete, withPurgeTransaction, type PurgeBudget } from "../server/storage/publication";
import { assertStorageNamespace, storageNamespaceCandidate } from "./storage-delete";
const DAY = 86400000;
export type StorageWorkBudget = PurgeBudget & { available(): boolean; ctx: StorageContext };
/** Reuse the existing bounded pool/BEGIN/statement/COMMIT helper and driver's AbortSignal. */
export function createStorageWorkBudget(
  ctx: StorageContext,
  maxDurationMs = 600000,
): StorageWorkBudget {
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 600000)
    throw new Error("Invalid storage work deadline");
  const deadline = performance.now() + maxDurationMs;
  const budget = {
    remaining: () => Math.max(0, deadline - performance.now()),
    available: () => performance.now() < deadline,
    check: () => {
      if (performance.now() >= deadline) throw new StorageError(503, "STORAGE_BUSY");
    },
  };
  const bounded = async <T>(
    signal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ) => {
    budget.check();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          controller.abort();
          reject(new StorageError(503, "STORAGE_BUSY"));
        },
        Math.max(1, budget.remaining()),
      );
    });
    try {
      const value = await Promise.race([
        fn(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal),
        timeout,
      ]);
      budget.check();
      return value;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    ...budget,
    ctx: {
      ...ctx,
      onMediaPublished: ctx.onMediaPublished
        ? (hash, generation) => bounded(undefined, () => ctx.onMediaPublished!(hash, generation))
        : undefined,
      driver: {
        ...ctx.driver,
        head: (input) => bounded(input.signal, (signal) => ctx.driver.head({ ...input, signal })),
        list: (input) => bounded(input.signal, (signal) => ctx.driver.list({ ...input, signal })),
        delete: (input) =>
          bounded(input.signal, (signal) => ctx.driver.delete({ ...input, signal })),
      },
    },
  };
}
async function matchingPolicy(ctx: StorageContext, budget?: PurgeBudget) {
  const query = (tx: Pick<DbTransaction, "select">) =>
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
      .limit(1);
  const [policy] = budget ? await withPurgeTransaction(ctx.db, budget, query) : await query(ctx.db);
  if (!policy) throw new StorageError(503, "STORAGE_INCONSISTENT");
  return policy;
}
async function known(tx: DbTransaction, key: string, hash: string) {
  // Global content identities are unique; an authoritative row always wins quarantine.
  return (
    (
      await tx
        .select({ id: blobs.id })
        .from(blobs)
        .where(sql`${blobs.key}=${key} or ${blobs.sha256}=${hash}`)
        .limit(1)
    ).length > 0 ||
    (
      await tx
        .select({ id: uploadAttempts.id })
        .from(uploadAttempts)
        .where(eq(uploadAttempts.tempKey, key))
        .limit(1)
    ).length > 0
  );
}
export type ReconcileResult = {
  processed: number;
  quarantined: number;
  storageFailures: number;
  complete: boolean;
};
export async function reconcileStorage(
  original: StorageContext,
  maxDurationMs = 600000,
): Promise<ReconcileResult> {
  const work = createStorageWorkBudget(original, maxDurationMs),
    ctx = work.ctx,
    policy = await matchingPolicy(ctx, work),
    now = ctx.now?.() ?? new Date();
  const result: ReconcileResult = {
    processed: 0,
    quarantined: 0,
    storageFailures: 0,
    complete: false,
  };
  await withPurgeTransaction(ctx.db, work, async (tx) => {
    await tx.insert(storageInventoryProgress).values({ policyId: policy.id }).onConflictDoNothing();
  });
  let listRequests = 0;
  while (work.available() && result.processed < 1000 && listRequests < 100) {
    const [progress] = await withPurgeTransaction(ctx.db, work, (tx) =>
      tx
        .select()
        .from(storageInventoryProgress)
        .where(eq(storageInventoryProgress.policyId, policy.id)),
    );
    let page: Awaited<ReturnType<StorageContext["driver"]["list"]>>;
    try {
      listRequests++;
      page = await ctx.driver.list({
        bucket: "original",
        prefix: "sha256/",
        cursor: progress.cursor ?? undefined,
        maxKeys: Math.min(100, 1000 - result.processed),
      });
    } catch {
      result.storageFailures++;
      break;
    }
    let completePage = true;
    for (const entry of page.objects) {
      if (!work.available() || result.processed >= 1000) {
        completePage = false;
        break;
      }
      result.processed++;
      const hash = entry.key.slice(-64);
      if (
        !/^[a-f0-9]{64}$/.test(hash) ||
        entry.key !== objectKey(hash) ||
        !Number.isSafeInteger(entry.size) ||
        entry.size < 1 ||
        entry.size > 480000000
      ) {
        result.storageFailures++;
        continue;
      }
      const [identity] = await withPurgeTransaction(ctx.db, work, (tx) =>
        tx.select().from(blobs).where(eq(blobs.sha256, hash)),
      );
      if (identity) {
        if (identity.state === "ready")
          try {
            await withPurgeTransaction(ctx.db, work, (tx) =>
              assertStorageNamespace(tx, ctx, identity.policyId, "original"),
            );
            const head = await ctx.driver.head({ bucket: "original", key: entry.key });
            if (!head || head.size !== identity.size || head.sha256 !== identity.sha256)
              result.storageFailures++;
          } catch {
            result.storageFailures++;
          }
        continue;
      }
      try {
        const head = await ctx.driver.head({ bucket: "original", key: entry.key });
        if (!head?.etag || head.size !== entry.size || head.sha256 !== hash) {
          result.storageFailures++;
          continue;
        }
        const added = await withPurgeTransaction(ctx.db, work, async (tx) => {
          const [budget] = await tx
            .select()
            .from(storageBudget)
            .where(eq(storageBudget.id, "global"))
            .for("update");
          if (await known(tx, entry.key, hash)) return false;
          const [prior] = await tx
            .select()
            .from(storageQuarantine)
            .where(
              and(eq(storageQuarantine.policyId, policy.id), eq(storageQuarantine.key, entry.key)),
            )
            .for("update");
          if (prior) {
            if (prior.state !== "deleted") return false;
            // A previously deleted key reappeared; a fresh observation must start a new 48h quarantine.
            await tx
              .update(storageQuarantine)
              .set({
                state: "quarantined",
                size: head.size,
                observedEtag: head.etag!,
                firstSeenAt: now,
                lastObservedAt: now,
                generation: prior.generation + 1,
                deleteStartedAt: null,
                deleteUncertain: false,
              })
              .where(eq(storageQuarantine.id, prior.id));
          } else
            await tx.insert(storageQuarantine).values({
              policyId: policy.id,
              sha256: hash,
              key: entry.key,
              size: head.size,
              observedEtag: head.etag!,
              firstSeenAt: now,
              lastObservedAt: now,
            });
          await tx
            .update(storageBudget)
            .set({ originalWritten: budget.originalWritten + head.size })
            .where(eq(storageBudget.id, "global"));
          return true;
        });
        if (added) result.quarantined++;
      } catch {
        result.storageFailures++;
      }
    }
    if (!completePage || !work.available()) break;
    const advanced = await withPurgeTransaction(ctx.db, work, async (tx) => {
      const [locked] = await tx
        .select()
        .from(storageInventoryProgress)
        .where(eq(storageInventoryProgress.policyId, policy.id))
        .for("update");
      if (locked.cursor !== progress.cursor) return false;
      await tx
        .update(storageInventoryProgress)
        .set({
          cursor: page.cursor ?? null,
          lastCompletedAt: page.cursor ? locked.lastCompletedAt : now,
          updatedAt: now,
        })
        .where(eq(storageInventoryProgress.policyId, policy.id));
      return true;
    });
    if (advanced && !page.cursor) {
      result.complete = true;
      break;
    }
  }
  ctx.log.info("storage_reconcile", { ...result });
  return result;
}
export async function cleanupStorageQuarantine(
  ctx: StorageContext,
  limit = 100,
  budget?: PurgeBudget,
): Promise<{ processed: number; deleted: number; storageFailures: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid quarantine batch");
  const run = <T>(fn: (tx: DbTransaction) => Promise<T>) =>
    budget ? withPurgeTransaction(ctx.db, budget, fn) : withStorageTransaction(ctx.db, fn);
  const now = ctx.now?.() ?? new Date(),
    result = { processed: 0, deleted: 0, storageFailures: 0 };
  const rows = await run((tx) =>
    tx
      .select()
      .from(storageQuarantine)
      .where(
        and(
          storageNamespaceCandidate(ctx, storageQuarantine.policyId, "original"),
          eq(storageQuarantine.state, "quarantined"),
          sql`${storageQuarantine.lastObservedAt}<=${new Date(now.getTime() - 2 * DAY)}`,
        ),
      )
      .orderBy(storageQuarantine.lastObservedAt, storageQuarantine.id)
      .limit(limit),
  );
  for (const row of rows) {
    if (budget && budget.remaining() <= 0) break;
    result.processed++;
    try {
      await run((tx) => assertStorageNamespace(tx, ctx, row.policyId, "original"));
      const head = await ctx.driver.head({ bucket: "original", key: row.key });
      if (
        !head ||
        head.size !== row.size ||
        head.etag !== row.observedEtag ||
        head.sha256 !== row.sha256
      ) {
        // Absence cannot settle any DELETE; changed identity restarts observation without guessing a refund.
        result.storageFailures++;
        await run(async (tx) => {
          await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
          await tx
            .update(storageQuarantine)
            .set({ lastObservedAt: now })
            .where(
              and(
                eq(storageQuarantine.id, row.id),
                eq(storageQuarantine.generation, row.generation),
                eq(storageQuarantine.state, "quarantined"),
              ),
            );
        });
        continue;
      }
      const claim = await run(async (tx) => {
        await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
        const [current] = await tx
          .select()
          .from(storageQuarantine)
          .where(eq(storageQuarantine.id, row.id))
          .for("update");
        if (current?.state !== "quarantined" || current.generation !== row.generation) return null;
        await assertStorageNamespace(tx, ctx, current.policyId, "original");
        if (await known(tx, row.key, row.sha256)) {
          await tx
            .update(storageQuarantine)
            .set({ lastObservedAt: now })
            .where(eq(storageQuarantine.id, row.id));
          return null;
        }
        const generation = row.generation + 1;
        await tx
          .update(storageQuarantine)
          .set({ state: "deleting", generation, deleteStartedAt: now, lastObservedAt: now })
          .where(eq(storageQuarantine.id, row.id));
        return generation;
      });
      if (claim === null) {
        result.storageFailures++;
        continue;
      }
      try {
        await ctx.driver.delete({ bucket: "original", key: row.key });
        // The production budget still covers pool admission, BEGIN, COMMIT and lost ACKs.
        const settled = await settleSuccessfulQuarantineDelete(ctx, {
          id: row.id, generation: claim, deleteStartedAt: now,
          policyId: row.policyId, key: row.key, sha256: row.sha256, size: row.size,
        }, budget);
        if (settled) result.deleted++;
      } catch {
        // Best-effort uncertainty flag; durable started state alone already prevents every retry/reincarnation.
        if (!budget || budget.remaining() > 0)
          await run(async (tx) => {
            await tx
              .select()
              .from(storageBudget)
              .where(eq(storageBudget.id, "global"))
              .for("update");
            await tx
              .update(storageQuarantine)
              .set({ deleteUncertain: true })
              .where(
                and(
                  eq(storageQuarantine.id, row.id),
                  eq(storageQuarantine.generation, claim),
                  eq(storageQuarantine.state, "deleting"),
                ),
              );
          });
        result.storageFailures++;
      }
    } catch {
      result.storageFailures++;
      // Failure rotates the scan only. Keep first observation, identity, uncertainty and charge intact.
      if (!budget || budget.remaining() > 0)
        await run(async (tx) => {
          await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
          await tx
            .update(storageQuarantine)
            .set({
              lastObservedAt: sql`greatest(${now}, ${storageQuarantine.lastObservedAt} + interval '1 millisecond')`,
            })
            .where(
              and(
                eq(storageQuarantine.id, row.id),
                eq(storageQuarantine.generation, row.generation),
                eq(storageQuarantine.state, "quarantined"),
              ),
            );
        });
    }
  }
  return result;
}
export type DerivedRebuildIntent = {
  state: "pending";
  generation: number;
  sourceBlobId: string;
  recipeId: string;
  recipe: "avatar-v1";
  recipeBuild: string;
  expectedOutputSha256: string;
  requestedAt: string;
  id: string;
};
export async function requestMissingDerivedRebuild(
  ctx: StorageContext,
  data: { id: string; generation: number },
  budget?: PurgeBudget,
): Promise<boolean> {
  const identity = (tx: Pick<DbTransaction, "select">) =>
    tx.select().from(derivedObjects).where(eq(derivedObjects.id, data.id));
  const [snapshot] = budget
    ? await withPurgeTransaction(ctx.db, budget, identity)
    : await identity(ctx.db);
  if (snapshot?.state !== "ready" || snapshot.generation !== data.generation) return false;
  const guard = (tx: Pick<DbTransaction, "select">) =>
    assertStorageNamespace(tx, ctx, snapshot.policyId, "derived");
  if (budget) await withPurgeTransaction(ctx.db, budget, guard);
  else await guard(ctx.db);
  budget?.check();
  // The exported producer enforces definitive absence itself; no network work holds business locks.
  const head = await ctx.driver.head({
    bucket: "derived",
    key: snapshot.key,
    signal: budget ? AbortSignal.timeout(Math.max(1, Math.ceil(budget.remaining()))) : undefined,
  });
  budget?.check();
  if (head) return false;
  const query = (tx: Pick<DbTransaction, "select">) =>
    tx
      .select({ recipe: blobDerivatives, blob: blobs })
      .from(blobDerivatives)
      .innerJoin(blobs, eq(blobs.id, blobDerivatives.sourceBlobId))
      .where(
        and(
          eq(blobDerivatives.derivedObjectId, data.id),
          eq(blobDerivatives.state, "ready"),
          eq(blobDerivatives.recipe, "avatar-v1"),
          eq(blobs.state, "ready"),
        ),
      )
      .orderBy(blobDerivatives.id)
      .limit(1);
  const [source] = budget ? await withPurgeTransaction(ctx.db, budget, query) : await query(ctx.db);
  if (!source) return false;
  const fn = async (tx: DbTransaction) => {
    await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    const [blob] = await tx.select().from(blobs).where(eq(blobs.id, source.blob.id)).for("update");
    const [recipe] = await tx
      .select()
      .from(blobDerivatives)
      .where(eq(blobDerivatives.id, source.recipe.id))
      .for("update");
    const [output] = await tx
      .select()
      .from(derivedObjects)
      .where(eq(derivedObjects.id, data.id))
      .for("update");
    if (
      blob.state !== "ready" ||
      recipe.state !== "ready" ||
      recipe.derivedObjectId !== data.id ||
      output?.state !== "ready" ||
      output.generation !== data.generation
    )
      return false;
    const current = output.properties.rebuild as Partial<DerivedRebuildIntent> | undefined;
    if (current?.state === "pending" && current.generation === data.generation) return true;
    const { id, ...rebuild }: DerivedRebuildIntent = {
      id: output.id,
      state: "pending",
      generation: data.generation,
      sourceBlobId: blob.id,
      recipeId: recipe.id,
      recipe: "avatar-v1",
      recipeBuild: recipe.recipeBuild,
      expectedOutputSha256: output.outputSha256,
      requestedAt: (ctx.now?.() ?? new Date()).toISOString(),
    };
    await tx
      .update(derivedObjects)
      .set({ properties: { ...output.properties, rebuild } })
      .where(eq(derivedObjects.id, id));
    return true;
  };
  return budget ? withPurgeTransaction(ctx.db, budget, fn) : withStorageTransaction(ctx.db, fn);
}
export async function readDerivedRebuildIntents(
  ctx: StorageContext,
  limit = 100,
): Promise<DerivedRebuildIntent[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid rebuild batch");
  const rows = await ctx.db
    .select()
    .from(derivedObjects)
    .where(
      and(
        eq(derivedObjects.state, "ready"),
        sql`${derivedObjects.properties}->'rebuild'->>'state'='pending'`,
      ),
    )
    .orderBy(sql`${derivedObjects.properties}->'rebuild'->>'requestedAt'`, derivedObjects.id)
    .limit(limit);
  return rows.flatMap((row) => {
    const i = row.properties.rebuild as Partial<DerivedRebuildIntent> | undefined;
    return i?.state === "pending" &&
      i.generation === row.generation &&
      i.recipe === "avatar-v1" &&
      i.expectedOutputSha256 === row.outputSha256 &&
      typeof i.recipeBuild === "string" &&
      typeof i.sourceBlobId === "string" &&
      typeof i.recipeId === "string" &&
      typeof i.requestedAt === "string"
      ? [{ ...i, id: row.id } as DerivedRebuildIntent]
      : [];
  });
}
