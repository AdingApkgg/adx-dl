import { and, eq, inArray, sql, type SQLWrapper } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import {
  blobs,
  blobDerivatives,
  derivedObjects,
  files,
  mediaPublications,
  mediaPurgeRequests,
  storageBudget,
  storagePolicies,
  uploadSessions,
  userAvatars,
} from "../server/db/schema";
import { STORAGE_DELETE_QUEUE } from "../server/jobs/queues";
import type { DbTransaction, StorageContext } from "../server/storage/contracts";
import { StorageError } from "../server/storage/errors";
import {
  FILE_REFERENCES,
  hasFileReferences,
  hasPublicRepresentation,
  type FileReference,
} from "../server/storage/references";
import { withPurgeTransaction, type PurgeBudget } from "../server/storage/publication";
import { lockStorageAdmission, withStorageTransaction } from "../server/storage/transactions";
/** One configured driver may access only its recorded physical namespace. */
export function storageNamespaceCandidate(
  ctx: StorageContext,
  policyId: SQLWrapper,
  bucket: "original" | "derived",
) {
  const physicalBucket =
    bucket === "original" ? storagePolicies.originalBucket : storagePolicies.derivedBucket;
  const configuredBucket =
    bucket === "original" ? ctx.config.originalBucket : ctx.config.derivedBucket;
  return sql`exists(select 1 from ${storagePolicies} where ${storagePolicies.id}=${policyId} and ${storagePolicies.endpoint}=${ctx.config.endpoint} and ${storagePolicies.region}=${ctx.config.region} and ${physicalBucket}=${configuredBucket})`;
}
export async function assertStorageNamespace(
  tx: Pick<DbTransaction, "select">,
  ctx: StorageContext,
  policyId: string,
  bucket: "original" | "derived",
) {
  const physicalBucket =
    bucket === "original" ? storagePolicies.originalBucket : storagePolicies.derivedBucket;
  const configuredBucket =
    bucket === "original" ? ctx.config.originalBucket : ctx.config.derivedBucket;
  const [policy] = await tx
    .select({ id: storagePolicies.id })
    .from(storagePolicies)
    .where(
      and(
        eq(storagePolicies.id, policyId),
        eq(storagePolicies.endpoint, ctx.config.endpoint),
        eq(storagePolicies.region, ctx.config.region),
        eq(physicalBucket, configuredBucket),
      ),
    );
  if (!policy) throw new StorageError(503, "STORAGE_INCONSISTENT");
}
export type StorageDeleteData = { kind: "blob" | "derived"; id: string; generation: number };
type DeletionMarker = {
  generation: number;
  chargedFrom: "written";
  startedAt: string | null;
  uncertain: boolean;
  confirmed?: boolean;
};
const tableFor = (kind: StorageDeleteData["kind"]) => (kind === "blob" ? blobs : derivedObjects);
function marker(properties: Record<string, unknown>, generation: number): DeletionMarker {
  const m = properties.deletion as Partial<DeletionMarker> | undefined;
  if (
    !m ||
    m.generation !== generation ||
    m.chargedFrom !== "written" ||
    !(m.startedAt === null || typeof m.startedAt === "string") ||
    typeof m.uncertain !== "boolean"
  )
    throw new StorageError(503, "STORAGE_INCONSISTENT");
  return m as DeletionMarker;
}
/** Reference reads under budget coordination; background GC never takes a user lock. */
export async function originalHasDependencies(
  tx: DbTransaction,
  id: string,
  registry: readonly FileReference[] = FILE_REFERENCES,
): Promise<boolean> {
  const [blob] = await tx.select().from(blobs).where(eq(blobs.id, id));
  if (!blob) return true;
  if (blob.leaseUntil) return true; // Expiry is not proof an old PUT has finished.
  const logical = await tx.select().from(files).where(eq(files.blobId, id));
  for (const file of logical)
    if (file.state !== "deleted" || (await hasFileReferences(tx, file.id, registry))) return true;
  if (
    (
      await tx
        .select({ id: uploadSessions.id })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.expectedSha256, blob.sha256),
            inArray(uploadSessions.state, ["receiving", "processing"]),
          ),
        )
        .limit(1)
    ).length
  )
    return true;
  if (
    (
      await tx
        .select({ id: blobDerivatives.id })
        .from(blobDerivatives)
        .where(
          and(eq(blobDerivatives.sourceBlobId, id), sql`${blobDerivatives.leaseUntil} is not null`),
        )
        .limit(1)
    ).length
  )
    return true;
  return false;
}
export async function derivedHasDependencies(
  tx: DbTransaction,
  id: string,
  registry: readonly FileReference[] = FILE_REFERENCES,
): Promise<boolean> {
  const [object] = await tx.select().from(derivedObjects).where(eq(derivedObjects.id, id));
  if (!object || object.leaseUntil) return true;
  const recipes = await tx
    .select()
    .from(blobDerivatives)
    .where(eq(blobDerivatives.derivedObjectId, id));
  for (const recipe of recipes) {
    if (recipe.leaseUntil) return true;
    if (
      (await tx.select().from(userAvatars).where(eq(userAvatars.derivativeId, recipe.id)).limit(1))
        .length
    )
      return true;
    if (recipe.state === "ready" || recipe.state === "pending") {
      const [source] = await tx.select().from(blobs).where(eq(blobs.id, recipe.sourceBlobId));
      if (source && source.state !== "deleted" && source.state !== "deleting") return true;
      if (await originalHasDependencies(tx, recipe.sourceBlobId, registry)) return true;
    }
  }
  if (await hasPublicRepresentation(tx, object.outputSha256, registry)) return true;
  const [pub] = await tx
    .select()
    .from(mediaPublications)
    .where(eq(mediaPublications.outputSha256, object.outputSha256));
  if (pub && pub.state !== "private") return true;
  if (
    (
      await tx
        .select()
        .from(mediaPurgeRequests)
        .where(
          and(
            eq(mediaPurgeRequests.outputSha256, object.outputSha256),
            sql`${mediaPurgeRequests.state}<>'done'`,
          ),
        )
        .limit(1)
    ).length
  )
    return true;
  return false;
}
/** Seven-day candidate claim and outbox are one short transaction, independent of external IO. */
export async function claimStorageObjectDeletion(
  ctx: StorageContext,
  input: Omit<StorageDeleteData, "generation">,
  registry = FILE_REFERENCES,
  budget?: PurgeBudget,
): Promise<StorageDeleteData | null> {
  const boss = await ctx.boss();
  const run = <T>(fn: (tx: DbTransaction) => Promise<T>) =>
    budget ? withPurgeTransaction(ctx.db, budget, fn) : withStorageTransaction(ctx.db, fn);
  return run(async (tx) => {
    await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    const table = tableFor(input.kind);
    const [row] = await tx.select().from(table).where(eq(table.id, input.id)).for("update");
    const now = ctx.now?.() ?? new Date();
    if (
      row?.state !== "ready" ||
      !row.orphanedAt ||
      row.orphanedAt.getTime() + 7 * 86400000 > now.getTime()
    )
      return null;
    await assertStorageNamespace(
      tx,
      ctx,
      row.policyId,
      input.kind === "blob" ? "original" : "derived",
    );
    if (
      input.kind === "blob"
        ? await originalHasDependencies(tx, row.id, registry)
        : await derivedHasDependencies(tx, row.id, registry)
    ) {
      await tx.update(table).set({ orphanedAt: null }).where(eq(table.id, row.id));
      return null;
    }
    if (input.kind === "blob") {
      const recipes = await tx
        .select()
        .from(blobDerivatives)
        .where(eq(blobDerivatives.sourceBlobId, row.id))
        .orderBy(blobDerivatives.id)
        .for("update");
      for (const recipe of recipes)
        await tx
          .update(blobDerivatives)
          .set({ state: "retired", leaseUntil: null })
          .where(eq(blobDerivatives.id, recipe.id));
    }
    const generation = row.generation + 1;
    const deletion: DeletionMarker = {
      generation,
      chargedFrom: "written",
      startedAt: null,
      uncertain: false,
    };
    await tx
      .update(table)
      .set({ state: "deleting", generation, properties: { ...row.properties, deletion } })
      .where(eq(table.id, row.id));
    const data = { ...input, generation };
    await boss.send(STORAGE_DELETE_QUEUE, data, {
      singletonKey: `${input.kind}:${input.id}:${generation}`,
      db: fromDrizzle(tx, sql),
    });
    return data;
  });
}
/** A crashed/timed-out DELETE cannot be made quiescent by a retry204 or HEAD404.
 * Its durable started marker retains charge/key until operator-confirmed backend recovery.
 * No automatic recovery API can manufacture that external guarantee. */
export async function deleteStorageObject(
  ctx: StorageContext,
  data: StorageDeleteData,
): Promise<void> {
  const table = tableFor(data.kind);
  const claim = await withStorageTransaction(ctx.db, async (tx) => {
    await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    const [row] = await tx.select().from(table).where(eq(table.id, data.id)).for("update");
    if (row?.state !== "deleting" || row.generation !== data.generation) return null;
    await assertStorageNamespace(
      tx,
      ctx,
      row.policyId,
      data.kind === "blob" ? "original" : "derived",
    );
    const m = marker(row.properties, data.generation);
    if (m.startedAt || m.uncertain)
      throw new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 3600);
    const startedAt = new Date().toISOString();
    await tx
      .update(table)
      .set({ properties: { ...row.properties, deletion: { ...m, startedAt } } })
      .where(eq(table.id, row.id));
    return { row, startedAt };
  });
  if (!claim) return;
  try {
    await ctx.driver.delete({
      bucket: data.kind === "blob" ? "original" : "derived",
      key: claim.row.key,
    });
    // Only this invocation's completed DELETE may settle behind the maintenance gate.
    await ctx.db.transaction(async (tx) => {
      await lockStorageAdmission(tx);
      const [budget] = await tx
        .select()
        .from(storageBudget)
        .where(eq(storageBudget.id, "global"))
        .for("update");
      const [row] = await tx.select().from(table).where(eq(table.id, data.id)).for("update");
      if (row?.state !== "deleting" || row.generation !== data.generation) return;
      const m = marker(row.properties, data.generation);
      if (m.startedAt !== claim.startedAt || m.uncertain) return;
      await tx
        .update(table)
        .set({
          state: "deleted",
          leaseUntil: null,
          properties: { ...row.properties, deletion: { ...m, confirmed: true } },
        })
        .where(eq(table.id, row.id));
      await tx
        .update(storageBudget)
        .set(
          data.kind === "blob"
            ? { originalWritten: budget.originalWritten - row.size }
            : { derivedWritten: budget.derivedWritten - row.size },
        )
        .where(eq(storageBudget.id, "global"));
    });
  } catch (error) {
    // Even a failed completion transaction is ambiguous; never refund from HEAD.
    await withStorageTransaction(ctx.db, async (tx) => {
      await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
      const [row] = await tx.select().from(table).where(eq(table.id, data.id)).for("update");
      if (row?.state !== "deleting" || row.generation !== data.generation) return;
      const m = marker(row.properties, data.generation);
      if (m.startedAt === claim.startedAt)
        await tx
          .update(table)
          .set({ properties: { ...row.properties, deletion: { ...m, uncertain: true } } })
          .where(eq(table.id, row.id));
    });
    throw error;
  }
}
