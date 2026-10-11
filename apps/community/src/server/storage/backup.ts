import { and, eq, inArray, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { MEDIA_PURGE_QUEUE } from "../jobs/queues";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  blobs,
  blobBlocks,
  blobDerivatives,
  derivedObjects,
  storageBudget,
  mediaPublications,
  mediaPurgeRequests,
  storageTombstones,
  user,
  userAvatars,
  storageUsage,
  files,
} from "../db/schema";
import type { StorageContext, DbTransaction } from "./contracts";
import { withStorageTransaction, lockStorageAdmission } from "./transactions";
import { storageTime } from "./usage";
import { StorageError } from "./errors";
import { objectKey } from "./keys";
import { processAvatar } from "../../media-worker/avatar";
import { RECIPE_BUILD } from "../../media-worker/image-child";
import { processChart } from "../../media-worker/chart-child";
import { currentChartRecipeBuild, CHART_PREVIEW_MIME } from "../charts/recipe";
import { chartManifestBytes, validateChartPreviewManifest } from "../charts/artifact";
import { assertStorageNamespace } from "../../worker/storage-delete";
import {
  type DerivedRebuildIntent,
  readDerivedRebuildIntents,
} from "../../worker/storage-reconcile";
import { stageOriginal } from "../../../ops/backup/export";
import { hasPublicRepresentation } from "./references";
import { notifyPublicMedia } from "./avatars";
const fail = () => new StorageError(503, "STORAGE_INCONSISTENT");
function sameIntent(value: unknown, expected: Record<string, unknown>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  return (
    Object.keys(marker).sort().join(",") === Object.keys(expected).sort().join(",") &&
    Object.keys(expected).every((key) => marker[key] === expected[key])
  );
}
type RebuildClaim = {
  intent: DerivedRebuildIntent;
  leaseOwner: string;
  sourceGeneration: number;
  recipeGeneration: number;
  publication: { generation: number; state: string } | null;
  leaseUntil: Date;
  output: typeof derivedObjects.$inferSelect;
  blob: typeof blobs.$inferSelect;
};
async function claimRebuild(
  ctx: StorageContext,
  intent: DerivedRebuildIntent,
): Promise<RebuildClaim | null> {
  return withStorageTransaction(ctx.db, async (tx) => {
    await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    const [blob] = await tx
      .select()
      .from(blobs)
      .where(eq(blobs.id, intent.sourceBlobId))
      .for("update");
    const [recipe] = await tx
      .select()
      .from(blobDerivatives)
      .where(eq(blobDerivatives.id, intent.recipeId))
      .for("update");
    const [output] = await tx
      .select()
      .from(derivedObjects)
      .where(eq(derivedObjects.id, intent.id))
      .for("update");
    if (
      !blob ||
      !recipe ||
      !output ||
      blob.state !== "ready" ||
      !blob.verifiedAt ||
      recipe.state !== "ready" ||
      recipe.sourceBlobId !== blob.id ||
      recipe.derivedObjectId !== output.id ||
      recipe.recipe !== intent.recipe ||
      recipe.recipeBuild !== intent.recipeBuild ||
      output.state !== "ready" ||
      output.generation !== intent.generation ||
      output.outputSha256 !== intent.expectedOutputSha256 ||
      !sameIntent(
        output.properties.rebuild,
        Object.fromEntries(Object.entries(intent).filter(([key]) => key !== "id")),
      )
    )
      return null;
    await assertStorageNamespace(tx, ctx, blob.policyId, "original");
    await assertStorageNamespace(tx, ctx, output.policyId, "derived");
    // A non-null lease (even expired) is uncertain physical IO. Only explicit confirmed cleanup can remove it.
    if (output.leaseUntil !== null) return null;
    if (
      (
        await tx
          .select()
          .from(blobBlocks)
          .where(inArray(blobBlocks.sha256, [blob.sha256, output.outputSha256]))
      ).length
    )
      return null;
    const [pub] = await tx
      .select()
      .from(mediaPublications)
      .where(eq(mediaPublications.outputSha256, output.outputSha256))
      .for("update");
    if (pub && (pub.state === "revoking" || pub.state === "blocked")) return null;
    const now = await storageTime(tx),
      leaseOwner = crypto.randomUUID(),
      generation = output.generation + 1,
      leaseUntil = new Date(now.getTime() + 120000);
    const claimedIntent = { ...intent, generation };
    const { id: _id, ...marker } = claimedIntent;
    await tx
      .update(derivedObjects)
      .set({
        generation,
        leaseUntil,
        properties: { ...output.properties, rebuild: { ...marker, leaseOwner } },
      })
      .where(eq(derivedObjects.id, output.id));
    return {
      intent: claimedIntent,
      leaseOwner,
      sourceGeneration: blob.generation,
      recipeGeneration: recipe.generation,
      publication: pub ? { generation: pub.generation, state: pub.state } : null,
      leaseUntil,
      output: { ...output, generation, leaseUntil },
      blob,
    };
  });
}
async function lockClaim(
  tx: DbTransaction,
  ctx: StorageContext,
  claim: RebuildClaim,
  additionalDerivedId?: string,
) {
  const [blob] = await tx.select().from(blobs).where(eq(blobs.id, claim.blob.id)).for("update");
  const [recipe] = await tx
    .select()
    .from(blobDerivatives)
    .where(eq(blobDerivatives.id, claim.intent.recipeId))
    .for("update");
  const lockedOutputs = await tx
    .select()
    .from(derivedObjects)
    .where(
      inArray(derivedObjects.id, [
        claim.output.id,
        ...(additionalDerivedId ? [additionalDerivedId] : []),
      ]),
    )
    .orderBy(derivedObjects.id)
    .for("update");
  const output = lockedOutputs.find((row) => row.id === claim.output.id);
  const now = await storageTime(tx);
  const marker = output?.properties.rebuild as
    | { generation?: number; leaseOwner?: string }
    | undefined;
  if (
    blob?.state !== "ready" ||
    blob.generation !== claim.sourceGeneration ||
    recipe?.state !== "ready" ||
    recipe.generation !== claim.recipeGeneration ||
    recipe.sourceBlobId !== blob.id ||
    recipe.recipe !== claim.intent.recipe ||
    recipe.recipeBuild !== claim.intent.recipeBuild ||
    recipe.derivedObjectId !== claim.output.id ||
    output?.state !== "ready" ||
    output.generation !== claim.output.generation ||
    output.leaseUntil === null ||
    output.leaseUntil <= now ||
    marker?.generation !== output.generation ||
    marker.leaseOwner !== claim.leaseOwner
  )
    return null;
  await assertStorageNamespace(tx, ctx, blob.policyId, "original");
  await assertStorageNamespace(tx, ctx, output.policyId, "derived");
  return { blob, recipe, output, now };
}
async function settleSameHash(ctx: StorageContext, claim: RebuildClaim): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    // Only this operation-specific completion path admits an already-owned live claim under maintenance.
    await lockStorageAdmission(tx);
    await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    const locked = await lockClaim(tx, ctx, claim);
    if (!locked) return false;
    const [pub] = await tx
      .select()
      .from(mediaPublications)
      .where(eq(mediaPublications.outputSha256, claim.output.outputSha256))
      .for("update");
    if (
      (pub?.generation ?? null) !== (claim.publication?.generation ?? null) ||
      (pub?.state ?? null) !== (claim.publication?.state ?? null)
    )
      return false;
    if (
      (
        await tx
          .select()
          .from(blobBlocks)
          .where(inArray(blobBlocks.sha256, [claim.blob.sha256, claim.output.outputSha256]))
      ).length
    )
      return false;
    const { rebuild: _rebuild, ...properties } = locked.output.properties;
    await tx
      .update(derivedObjects)
      .set({ leaseUntil: null, properties })
      .where(eq(derivedObjects.id, locked.output.id));
    return true;
  });
}
/** No output IO and no unreaped owned child: remove only this exact claim, preserving its charge and retry generation. */
async function releaseUnwrittenRebuild(ctx: StorageContext, claim: RebuildClaim) {
  await ctx.db.transaction(async (tx) => {
    await lockStorageAdmission(tx);
    await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    const [blob] = await tx.select().from(blobs).where(eq(blobs.id, claim.blob.id)).for("update");
    const [recipe] = await tx.select().from(blobDerivatives).where(eq(blobDerivatives.id, claim.intent.recipeId)).for("update");
    const [output] = await tx.select().from(derivedObjects).where(eq(derivedObjects.id, claim.output.id)).for("update");
    const [pub] = await tx.select().from(mediaPublications).where(eq(mediaPublications.outputSha256, claim.output.outputSha256)).for("update");
    const { id: _id, ...marker } = claim.intent;
    if (blob?.state !== "ready" || blob.generation !== claim.sourceGeneration ||
      blob.sha256 !== claim.blob.sha256 || blob.key !== claim.blob.key || blob.policyId !== claim.blob.policyId ||
      recipe?.state !== "ready" || recipe.generation !== claim.recipeGeneration ||
      recipe.recipe !== claim.intent.recipe || recipe.recipeBuild !== claim.intent.recipeBuild ||
      recipe.sourceBlobId !== blob.id || recipe.derivedObjectId !== claim.output.id ||
      output?.state !== "ready" || output.generation !== claim.output.generation ||
      output.outputSha256 !== claim.output.outputSha256 || output.key !== claim.output.key || output.policyId !== claim.output.policyId ||
      output.leaseUntil?.getTime() !== claim.leaseUntil.getTime() ||
      !sameIntent(output.properties.rebuild, { ...marker, leaseOwner: claim.leaseOwner }) ||
      (pub?.generation ?? null) !== (claim.publication?.generation ?? null) ||
      (pub?.state ?? null) !== (claim.publication?.state ?? null)) return;
    await assertStorageNamespace(tx, ctx, blob.policyId, "original");
    await assertStorageNamespace(tx, ctx, output.policyId, "derived");
    await tx.update(derivedObjects).set({ leaseUntil: null, properties: { ...output.properties, rebuild: marker } }).where(eq(derivedObjects.id, output.id));
  });
}
/** Independent of upload_sessions. Only current verified source/recipe/physical identities can repair bytes. */
export async function rebuildDerivedIntent(
  ctx: StorageContext,
  intent: DerivedRebuildIntent,
): Promise<boolean> {
  if (
    ctx.config.role !== "media" ||
    ctx.config.recipeBuild !== RECIPE_BUILD ||
    (intent.recipe === "avatar-v1" ? intent.recipeBuild !== RECIPE_BUILD : intent.recipeBuild !== currentChartRecipeBuild())
  )
    throw fail();
  const [snapshot] = await ctx.db
    .select()
    .from(derivedObjects)
    .where(eq(derivedObjects.id, intent.id));
  if (snapshot?.state !== "ready" || snapshot.generation !== intent.generation) return false;
  await assertStorageNamespace(ctx.db, ctx, snapshot.policyId, "derived");
  if (
    await ctx.driver.head({
      bucket: "derived",
      key: snapshot.key,
      signal: AbortSignal.timeout(10000),
    })
  )
    return false;
  const claim = await claimRebuild(ctx, intent);
  if (!claim) return false;
  let directory: string | undefined;
  let childUnreaped = false, outputClaimStarted = false;
  const signal = ctx.lifecycle ? AbortSignal.any([ctx.lifecycle.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
  try {
    directory = await mkdtemp(join(ctx.config.tempDir, "rebuild-"));
    const original = await stageOriginal(
      ctx,
      {
        id: claim.blob.id,
        sha256: claim.blob.sha256,
        key: claim.blob.key,
        size: claim.blob.size,
        mime: claim.blob.detectedMime!,
        policy: {
          id: claim.blob.policyId,
          endpoint: ctx.config.endpoint,
          region: ctx.config.region,
          originalBucket: ctx.config.originalBucket,
          derivedBucket: ctx.config.derivedBucket,
        },
        recipes: [],
      },
      directory,
      signal,
    );
    const outputPath = join(directory, "output");
    let result: { hash:string;size:number;mime:string };
    if(intent.recipe === "chart-preview-v1") {
      const inspection = await processChart(original.path,outputPath,signal);
      const expected = validateChartPreviewManifest(claim.output.properties.chartPreview,claim.output.size);
      if(!chartManifestBytes(expected).equals(chartManifestBytes(inspection.manifest))) throw fail();
      result = {hash:inspection.artifact.sha256,size:inspection.artifact.size,mime:CHART_PREVIEW_MIME};
    } else result = await processAvatar(original.path, outputPath, signal, (state) => {
      childUnreaped = state === "started";
    });
    if (result.hash !== claim.output.outputSha256) {
      // Private chart summaries/assets are immutable; a missing recorded build stays closed.
      if(intent.recipe === "chart-preview-v1") throw fail();
      // Drift allocates another physical claim; failures after this boundary remain conservatively owned.
      outputClaimStarted = true;
      return await rebuildDrift(ctx, claim, {...result,mime:"image/jpeg"}, outputPath, signal);
    }
    if (result.size !== claim.output.size || result.mime !== claim.output.mime) throw fail();
    // Recheck under the same owned physical claim before IO; no expired writer takeover.
    const valid = await withStorageTransaction(ctx.db, async (tx) => {
      await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
      return !!(await lockClaim(tx, ctx, claim));
    });
    if (!valid) return false;
    const present = await ctx.driver.head({ bucket: "derived", key: claim.output.key, signal });
    if (present) {
      const recovered = await ctx.driver.get({ bucket: "derived", key: claim.output.key, signal });
      const digest = new Bun.CryptoHasher("sha256");
      let count = 0;
      for await (const bytes of recovered.body) {
        count += bytes.length;
        if (count > result.size) throw fail();
        digest.update(bytes);
      }
      if (count !== result.size || digest.digest("hex") !== result.hash) throw fail();
    } else {
      outputClaimStarted = true;
      await ctx.driver.put({
        bucket: "derived",
        key: claim.output.key,
        body: Bun.file(outputPath).stream(),
        size: result.size,
        mime: result.mime,
        sha256: result.hash,
        signal,
      });
    }
    const head = await ctx.driver.head({ bucket: "derived", key: claim.output.key, signal });
    if (
      !head ||
      head.size !== result.size ||
      head.sha256 !== result.hash ||
      head.mime !== result.mime
    )
      throw fail();
    return settleSameHash(ctx, claim);
  } finally {
    try {
      if (directory && !childUnreaped) await rm(directory, { recursive: true, force: true });
    } finally {
      if (!childUnreaped && !outputClaimStarted) await releaseUnwrittenRebuild(ctx, claim);
    }
  }
}
async function rebuildDrift(
  ctx: StorageContext,
  claim: RebuildClaim,
  result: { hash: string; size: number; mime: "image/jpeg" },
  outputPath: string,
  signal: AbortSignal,
): Promise<boolean> {
  // Separate immutable identity. Existing old key is never written, even if recipe output drifted.
  const newClaim = await withStorageTransaction(ctx.db, async (tx) => {
    const [budget] = await tx
      .select()
      .from(storageBudget)
      .where(eq(storageBudget.id, "global"))
      .for("update");
    if (!budget) throw fail();
    await tx
      .insert(derivedObjects)
      .values({
        outputSha256: result.hash,
        key: objectKey(result.hash),
        policyId: claim.blob.policyId,
        size: result.size,
        mime: result.mime,
      })
      .onConflictDoNothing();
    const [obj] = await tx
      .select()
      .from(derivedObjects)
      .where(eq(derivedObjects.outputSha256, result.hash));
    if (!obj) throw fail();
    const old = await lockClaim(tx, ctx, claim, obj.id);
    if (!old) throw fail();
    if (
      !obj ||
      obj.policyId !== claim.blob.policyId ||
      obj.size !== result.size ||
      obj.state === "deleting" ||
      obj.state === "blocked" ||
      obj.leaseUntil !== null
    )
      throw fail();
    const deletion = obj.properties.deletion as
      | { generation?: number; confirmed?: boolean; uncertain?: boolean; startedAt?: string | null }
      | undefined;
    if (deletion?.uncertain || (deletion?.startedAt && deletion.confirmed !== true)) throw fail();
    if (obj.state === "ready") return { object: obj, ready: true };
    if (
      obj.state === "deleted"
        ? !(deletion?.confirmed === true && deletion.generation === obj.generation)
        : !(obj.state === "pending" && obj.generation === 0 && !deletion)
    )
      throw fail();
    if (
      budget.derivedReserved + budget.derivedWritten + result.size >
      ctx.config.limits.derivedBudget
    )
      throw new StorageError(503, "STORAGE_BUDGET_EXCEEDED");
    const now = await storageTime(tx);
    const [object] = await tx
      .update(derivedObjects)
      .set({
        state: "pending",
        generation: obj.generation + 1,
        leaseUntil: new Date(now.getTime() + 120000),
        properties: Object.fromEntries(
          Object.entries(obj.properties).filter(([key]) => key !== "deletion"),
        ),
      })
      .where(eq(derivedObjects.id, obj.id))
      .returning();
    await tx
      .update(storageBudget)
      .set({ derivedReserved: budget.derivedReserved + result.size })
      .where(eq(storageBudget.id, "global"));
    return { object, ready: false };
  });
  if (!newClaim) return false;
  const existing = await ctx.driver.head({ bucket: "derived", key: newClaim.object.key, signal });
  if (existing) {
    const data = await ctx.driver.get({ bucket: "derived", key: newClaim.object.key, signal });
    const h = new Bun.CryptoHasher("sha256");
    let size = 0;
    for await (const b of data.body) {
      size += b.length;
      if (size > result.size) throw fail();
      h.update(b);
    }
    if (size !== result.size || h.digest("hex") !== result.hash) throw fail();
  } else if (newClaim.ready) throw fail();
  else
    await ctx.driver.put({
      bucket: "derived",
      key: newClaim.object.key,
      body: Bun.file(outputPath).stream(),
      size: result.size,
      mime: result.mime,
      sha256: result.hash,
      signal,
    });
  const newHead = await ctx.driver.head({ bucket: "derived", key: newClaim.object.key, signal });
  if (
    !newHead ||
    newHead.size !== result.size ||
    newHead.sha256 !== result.hash ||
    newHead.mime !== result.mime
  )
    throw fail();
  const owners = (
    await ctx.db
      .select({ id: userAvatars.userId })
      .from(userAvatars)
      .where(eq(userAvatars.derivativeId, claim.intent.recipeId))
  )
    .map((r) => r.id)
    .sort();
  const boss = await ctx.boss();
  const changed = await withStorageTransaction(ctx.db, async (tx) => {
    // Projection changes are new business work, so admission stays closed under maintenance.
    if (owners.length) {
      await tx.select().from(user).where(inArray(user.id, owners)).orderBy(user.id).for("update");
      await tx
        .select()
        .from(storageUsage)
        .where(inArray(storageUsage.userId, owners))
        .orderBy(storageUsage.userId)
        .for("update");
    }
    const [budget] = await tx
      .select()
      .from(storageBudget)
      .where(eq(storageBudget.id, "global"))
      .for("update");
    const associations = await tx
      .select()
      .from(userAvatars)
      .where(eq(userAvatars.derivativeId, claim.intent.recipeId))
      .orderBy(userAvatars.userId)
      .for("update");
    if (associations.map((a) => a.userId).join(",") !== owners.join(",")) return false;
    const fileIds = associations
      .map((a) => a.fileId)
      .filter((id): id is string => !!id)
      .sort();
    const currentFiles = fileIds.length
      ? await tx
          .select()
          .from(files)
          .where(inArray(files.id, fileIds))
          .orderBy(files.id)
          .for("update")
      : [];
    const old = await lockClaim(tx, ctx, claim, newClaim.object.id);
    if (!old || !budget) return false;
    const [object] = await tx
      .select()
      .from(derivedObjects)
      .where(eq(derivedObjects.id, newClaim.object.id));
    const now = await storageTime(tx);
    if (
      !object ||
      object.generation !== newClaim.object.generation ||
      object.outputSha256 !== result.hash ||
      object.key !== objectKey(result.hash) ||
      object.size !== result.size ||
      object.mime !== result.mime ||
      object.policyId !== claim.blob.policyId ||
      (newClaim.ready && (object.state !== "ready" || object.leaseUntil !== null)) ||
      (!newClaim.ready &&
        (object.state !== "pending" || !object.leaseUntil || object.leaseUntil <= now))
    )
      return false;
    const hashes = [old.output.outputSha256, result.hash].sort();
    for (const hash of hashes)
      await tx.insert(mediaPublications).values({ outputSha256: hash }).onConflictDoNothing();
    const pubs = await tx
      .select()
      .from(mediaPublications)
      .where(inArray(mediaPublications.outputSha256, hashes))
      .orderBy(mediaPublications.outputSha256)
      .for("update");
    const oldPub = pubs.find((p) => p.outputSha256 === old.output.outputSha256),
      newPub = pubs.find((p) => p.outputSha256 === result.hash)!;
    if (
      (oldPub?.generation ?? null) !== (claim.publication?.generation ?? null) ||
      (oldPub?.state ?? null) !== (claim.publication?.state ?? null) ||
      newPub.state === "revoking" ||
      newPub.state === "blocked"
    )
      return false;
    if (
      (
        await tx
          .select()
          .from(blobBlocks)
          .where(inArray(blobBlocks.sha256, [old.blob.sha256, result.hash]))
      ).length
    )
      return false;
    if (!newClaim.ready) {
      await tx
        .update(derivedObjects)
        .set({ state: "ready", leaseUntil: null })
        .where(eq(derivedObjects.id, object.id));
      await tx
        .update(storageBudget)
        .set({
          derivedReserved: budget.derivedReserved - object.size,
          derivedWritten: budget.derivedWritten + object.size,
        })
        .where(eq(storageBudget.id, "global"));
    }
    await tx
      .update(blobDerivatives)
      .set({ derivedObjectId: object.id, generation: old.recipe.generation + 1 })
      .where(eq(blobDerivatives.id, old.recipe.id));
    for (const a of associations) {
      if (a.fileId)
        await tx
          .insert(storageTombstones)
          .values({
            kind: "media_revoked",
            userId: a.userId,
            fileId: a.fileId,
            sha256: old.output.outputSha256,
            generation: a.revision + 1,
          });
      await tx
        .update(userAvatars)
        .set({ revision: a.revision + 1, updatedAt: now })
        .where(eq(userAvatars.userId, a.userId));
      const f = currentFiles.find((f) => f.id === a.fileId);
      if (
        !a.suspendedAt &&
        f?.ownerId === a.userId &&
        f.state === "ready" &&
        f.purpose === "avatar" &&
        f.blobId === old.blob.id
      )
        await tx
          .update(user)
          .set({ image: `/media/${result.hash}.jpg`, updatedAt: now })
          .where(
            and(
              eq(user.id, a.userId),
              eq(user.status, "active"),
              eq(user.image, `/media/${old.output.outputSha256}.jpg`),
            ),
          );
    }
    const { rebuild: _rebuild, ...properties } = old.output.properties;
    await tx
      .update(derivedObjects)
      .set({ leaseUntil: null, properties, orphanedAt: now })
      .where(eq(derivedObjects.id, old.output.id));
    if (await hasPublicRepresentation(tx, result.hash)) {
      await tx
        .update(mediaPublications)
        .set({
          state: "public",
          generation: newPub.state === "public" ? newPub.generation : newPub.generation + 1,
          updatedAt: now,
        })
        .where(eq(mediaPublications.outputSha256, result.hash));
    }
    if (
      oldPub?.state === "public" &&
      !(await hasPublicRepresentation(tx, old.output.outputSha256))
    ) {
      const generation = oldPub.generation + 1;
      await tx
        .update(mediaPublications)
        .set({ state: "revoking", generation, updatedAt: now })
        .where(eq(mediaPublications.outputSha256, old.output.outputSha256));
      await tx
        .insert(mediaPurgeRequests)
        .values({ outputSha256: old.output.outputSha256, generation })
        .onConflictDoNothing();
      await tx
        .insert(storageTombstones)
        .values({ kind: "media_revoked", sha256: old.output.outputSha256, generation });
      await boss.send(
        MEDIA_PURGE_QUEUE,
        { hash: old.output.outputSha256, generation },
        { singletonKey: `${old.output.outputSha256}:${generation}`, db: fromDrizzle(tx, sql) },
      );
    }
    return true;
  });
  if (changed) await notifyPublicMedia(ctx, result.hash);
  return changed;
}
/** Durable requestedAt reordering gives bounded fair attempts; bad first-page intents do not starve later work. */
export async function rebuildMissingDerived(ctx: StorageContext, limit = 100) {
  const intents = await readDerivedRebuildIntents(ctx, limit);
  let repaired = 0;
  for (const intent of intents) {
    // Reorder BEFORE the attempt with an exact current-intent CAS. A late attempt never edits a newer marker.
    const current = await withStorageTransaction(ctx.db, async (tx) => {
      await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
      const [row] = await tx
        .select()
        .from(derivedObjects)
        .where(eq(derivedObjects.id, intent.id))
        .for("update");
      const { id: _id, ...expected } = intent;
      if (row?.generation !== intent.generation || !sameIntent(row.properties.rebuild, expected))
        return null;
      const next = { ...expected, requestedAt: (await storageTime(tx)).toISOString() };
      await tx
        .update(derivedObjects)
        .set({ properties: { ...row.properties, rebuild: next } })
        .where(eq(derivedObjects.id, row.id));
      return { ...next, id: intent.id } as DerivedRebuildIntent;
    });
    if (!current) continue;
    try {
      if (await rebuildDerivedIntent(ctx, current)) repaired++;
    } catch {
      ctx.log.error("storage_rebuild_failed", { id: intent.id });
    }
  }
  return repaired;
}
