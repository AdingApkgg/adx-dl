import { createHash } from "node:crypto";
import { join } from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { chartEntryStagingPath, type ChartSourceEntry } from "../server/charts/package-validation";
import { blobs, blobBlocks, chartSourceEntries, storageBudget } from "../server/db/schema";
import type { StorageContext, StorageJobData } from "../server/storage/contracts";
import { StorageError, StorageUnavailableError } from "../server/storage/errors";
import { objectKey } from "../server/storage/keys";
import { assertOriginalKeyAvailable, withProcessingUpload } from "../server/storage/objects";
import { copyVerified } from "./avatar";
import { originalMime } from "./ingest";

const busy = () => new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 30);
const blocked = () => new StorageError(400, "HASH_BLOCKED");
type SourceBlob = typeof blobs.$inferSelect;
type Ref = ChartSourceEntry & { contentBlobId: string | null };

function inferredMime(header: Uint8Array) {
  try { return originalMime(header, "chart-source"); } catch {}
  try { return originalMime(header, "avatar"); } catch {}
  return "application/octet-stream";
}

async function storeEntry(
  ctx: StorageContext, data: StorageJobData, source: SourceBlob, entry: ChartSourceEntry,
  filePath: string, recoveryPath: string, signal: AbortSignal,
) {
  const body = Bun.file(filePath);
  const hash = createHash("sha256");
  let size = 0;
  for await (const bytes of body.stream()) { signal.throwIfAborted(); size += bytes.length; hash.update(bytes); }
  if (size !== entry.size || hash.digest("hex") !== entry.sha256) throw new StorageUnavailableError();
  const mime = inferredMime(new Uint8Array(await body.slice(0, 4096).arrayBuffer()));
  const key = objectKey(entry.sha256);
  const claim = await withProcessingUpload(ctx, data, async ({ tx, session, file, accounting: { budget }, now }) => {
    signal.throwIfAborted();
    if (session.expiresAt <= now || file.blobId !== source.id) throw busy();
    if ((await tx.select().from(blobBlocks).where(eq(blobBlocks.sha256, entry.sha256))).length) throw blocked();
    await assertOriginalKeyAvailable(tx, ctx, key);
    await tx.insert(blobs).values({ sha256: entry.sha256, key, size, policyId: source.policyId }).onConflictDoNothing();
    const [object] = await tx.select().from(blobs).where(eq(blobs.sha256, entry.sha256)).for("update");
    if (!object || object.id === source.id || object.policyId !== source.policyId || object.key !== key) throw new StorageUnavailableError();
    if (object.state === "blocked") throw blocked();
    if (object.state === "deleting" || (object.leaseUntil && object.leaseUntil > now)) throw busy();
    if (object.size !== size && (object.state !== "pending" || object.generation !== 0 || object.leaseUntil))
      throw new StorageUnavailableError();
    if (object.state === "ready") {
      if (object.orphanedAt) await tx.update(blobs).set({ orphanedAt: null }).where(eq(blobs.id, object.id));
      return { object, writer: false };
    }
    if (!object.leaseUntil) {
      if (budget.originalWritten + budget.originalReserved + size > ctx.config.limits.originalBudget)
        throw new StorageError(503, "STORAGE_BUDGET_EXCEEDED");
      await tx.update(storageBudget).set({ originalReserved: budget.originalReserved + size }).where(eq(storageBudget.id, "global"));
    }
    const [claimed] = await tx.update(blobs).set({
      state: "pending", size, generation: object.generation + 1,
      leaseUntil: new Date(now.getTime() + 120000), orphanedAt: null, detectedMime: null, verifiedAt: null,
    }).where(eq(blobs.id, object.id)).returning();
    return { object: claimed, writer: true };
  });
  if (!claim) throw busy();
  const existing = await ctx.driver.head({ bucket: "original", key, signal });
  const expectedMime = claim.writer ? mime : claim.object.detectedMime;
  if (existing) {
    if (existing.size !== size || existing.sha256 !== entry.sha256 || existing.mime !== expectedMime)
      throw new StorageUnavailableError();
    if (claim.writer) await copyVerified(ctx, "original", key, recoveryPath, size, entry.sha256, signal);
  } else if (claim.writer) {
    await ctx.driver.put({ bucket: "original", key, body: body.stream(), size, mime, sha256: entry.sha256, signal });
    const head = await ctx.driver.head({ bucket: "original", key, signal });
    if (!head || head.size !== size || head.sha256 !== entry.sha256 || head.mime !== mime)
      throw new StorageUnavailableError();
  } else throw new StorageUnavailableError();
  if (!claim.writer) return claim.object.id;

  const settled = await withProcessingUpload(ctx, data, async ({ tx, session, file, accounting: { budget }, now }) => {
    signal.throwIfAborted();
    if (session.expiresAt <= now || file.blobId !== source.id) throw busy();
    const [object] = await tx.select().from(blobs).where(eq(blobs.id, claim.object.id)).for("update");
    if (object?.state !== "pending" || object.generation !== claim.object.generation ||
      !object.leaseUntil || object.leaseUntil <= now) throw busy();
    if ((await tx.select().from(blobBlocks).where(eq(blobBlocks.sha256, entry.sha256))).length) throw blocked();
    await tx.update(blobs).set({ state: "ready", detectedMime: mime, verifiedAt: now, leaseUntil: null }).where(eq(blobs.id, object.id));
    await tx.update(storageBudget).set({
      originalReserved: budget.originalReserved - size,
      originalWritten: budget.originalWritten + size,
    }).where(eq(storageBudget.id, "global"));
    return true;
  });
  if (!settled) throw busy();
  return claim.object.id;
}

export async function saveChartSourceFiles(
  ctx: StorageContext, data: StorageJobData, source: SourceBlob, entries: ChartSourceEntry[],
  directory: string, signal: AbortSignal,
) {
  const previous = await ctx.db.select().from(chartSourceEntries)
    .where(eq(chartSourceEntries.sourceBlobId, source.id)).orderBy(asc(chartSourceEntries.ordinal));
  if (previous.length && (previous.length !== entries.length || previous.some((row, index) => {
    const entry = entries[index];
    return !entry || row.path !== entry.path || row.size !== entry.size || row.sha256 !== entry.sha256;
  }))) throw new StorageUnavailableError();

  const nonempty = new Map(entries.filter(entry => entry.size > 0).map(entry => [entry.sha256, entry.size]));
  const budgetChecked = await withProcessingUpload(ctx, data, async ({ tx, session, file, accounting: { budget }, now }) => {
    if (session.expiresAt <= now || file.blobId !== source.id) throw busy();
    const digests = [...nonempty.keys()];
    const known = await tx.select().from(blobs).where(inArray(blobs.sha256, digests));
    for (const object of known) {
      if (object.state === "ready" || object.state === "pending" && object.leaseUntil) nonempty.delete(object.sha256);
    }
    const additional = [...nonempty.values()].reduce((total, size) => total + size, 0);
    if (budget.originalWritten + budget.originalReserved + additional > ctx.config.limits.originalBudget)
      throw new StorageError(503, "STORAGE_BUDGET_EXCEEDED");
    return true;
  });
  if (!budgetChecked) throw busy();

  const refs: Ref[] = [];
  const stored = new Map<string, string>();
  for (const [index, entry] of entries.entries()) {
    signal.throwIfAborted();
    let contentBlobId = stored.get(entry.sha256) ?? null;
    if (entry.size && !contentBlobId) {
      contentBlobId = await storeEntry(ctx, data, source, entry, chartEntryStagingPath(directory, index),
        join(directory, `verified-${index}`), signal);
      stored.set(entry.sha256, contentBlobId);
    }
    refs.push({ ...entry, contentBlobId });
  }
  const committed = await withProcessingUpload(ctx, data, async ({ tx, session, file, now }) => {
    signal.throwIfAborted();
    if (session.expiresAt <= now || file.blobId !== source.id) throw busy();
    const [parent] = await tx.select().from(blobs).where(eq(blobs.id, source.id)).for("update");
    if (parent?.state !== "ready") throw busy();
    const ids = [...stored.values()];
    const children = await tx.select().from(blobs).where(inArray(blobs.id, ids)).orderBy(asc(blobs.id)).for("update");
    if (children.length !== ids.length || children.some(child => child.state !== "ready" || stored.get(child.sha256) !== child.id))
      throw busy();
    if ((await tx.select({ sha: blobBlocks.sha256 }).from(blobBlocks).where(inArray(blobBlocks.sha256, [source.sha256, ...stored.keys()]))).length)
      throw blocked();
    const current = await tx.select().from(chartSourceEntries).where(eq(chartSourceEntries.sourceBlobId, source.id)).orderBy(asc(chartSourceEntries.ordinal));
    if (!current.length) await tx.insert(chartSourceEntries).values(refs.map((entry, ordinal) => ({ ...entry, ordinal, sourceBlobId: source.id })));
    else if (current.length !== refs.length || current.some((row, index) => {
      const entry = refs[index];
      return !entry || row.path !== entry.path || row.sha256 !== entry.sha256 || row.size !== entry.size || row.contentBlobId !== entry.contentBlobId;
    })) throw new StorageUnavailableError();
    return true;
  });
  if (!committed) throw busy();
}
