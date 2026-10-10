import { beforeAll, expect, test } from "bun:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq, sql } from "drizzle-orm";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import { createLogger } from "../../shared/log";
import { storageFixtureConfig } from "../../../test/storage/fixture";
import { createS3Driver } from "./s3";
import {
  blobs,
  blobDerivatives,
  derivedObjects,
  mediaPublications,
  storagePolicies,
  storageBudget,
  user,
  userAvatars,
  files,
  storageUsage,
  mediaPurgeRequests,
  storageTombstones,
} from "../db/schema";
import { objectKey } from "./keys";
import { processAvatar } from "../../media-worker/avatar";
import { RECIPE_BUILD } from "../../media-worker/image-child";
import {
  requestMissingDerivedRebuild,
  readDerivedRebuildIntents,
} from "../../worker/storage-reconcile";
import { rebuildDerivedIntent, rebuildMissingDerived } from "./backup";
import { createHash } from "node:crypto";
import { testSender } from "../testing/test-boss";
beforeAll(async () => {
  await resetTestDatabase();
  await testSender();
}, 30000);
test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "actual native rebuild restores readable sessionless bytes; old intent cannot change newer generation; immutable output drift gets new object/key",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "rebuild-test-"));
    const { db } = testDbHandle();
    const config = { ...(await storageFixtureConfig("media")), recipeBuild: RECIPE_BUILD };
    const driver = createS3Driver(config);
    const cleanup = createS3Driver(await storageFixtureConfig("control"));
    const ctx = { db, config, driver, boss: testSender, log: createLogger(() => {}) };
    const bytes = await readFile(new URL("../../../test/storage/images/safe.png", import.meta.url));
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    const rendered = await processAvatar(
      new URL("../../../test/storage/images/safe.png", import.meta.url).pathname,
      join(dir, "reference.jpg"),
    );
    const [p] = await db
      .insert(storagePolicies)
      .values({
        name: crypto.randomUUID(),
        endpoint: config.endpoint,
        region: config.region,
        originalBucket: config.originalBucket,
        derivedBucket: config.derivedBucket,
        credentialsRef: config.credentialsRef,
      })
      .returning();
    const [source] = await db
      .insert(blobs)
      .values({
        sha256: sourceHash,
        key: objectKey(sourceHash),
        size: bytes.length,
        state: "ready",
        detectedMime: "image/png",
        verifiedAt: new Date(),
        policyId: p.id,
      })
      .returning();
    const [out] = await db
      .insert(derivedObjects)
      .values({
        outputSha256: rendered.hash,
        key: objectKey(rendered.hash),
        size: rendered.size,
        mime: "image/jpeg",
        state: "ready",
        policyId: p.id,
      })
      .returning();
    const [recipe] = await db
      .insert(blobDerivatives)
      .values({
        sourceBlobId: source.id,
        recipe: "avatar-v1",
        recipeBuild: RECIPE_BUILD,
        derivedObjectId: out.id,
        state: "ready",
      })
      .returning();
    await db.insert(mediaPublications).values({ outputSha256: out.outputSha256, state: "private" });
    const budgetBefore = (await db.select().from(storageBudget))[0];
    await db.update(storageBudget).set({
      derivedWritten: sql`${storageBudget.derivedWritten}+${rendered.size}`,
      originalWritten: sql`${storageBudget.originalWritten}+${bytes.length}`,
    });
    await driver.put({
      bucket: "original",
      key: source.key,
      body: new Blob([bytes]).stream(),
      size: bytes.length,
      mime: "image/png",
      sha256: sourceHash,
    });
    const driftOwners: string[] = [];
    try {
      await cleanup.delete({ bucket: "derived", key: out.key });
      expect(await requestMissingDerivedRebuild(ctx, { id: out.id, generation: 0 })).toBe(true);
      let [intent] = await readDerivedRebuildIntents(ctx);
      const row = async () => (await db.select().from(derivedObjects).where(eq(derivedObjects.id, out.id)))[0];
      const drained = () => import("../../../ops/backup/export").then(({ assertStorageDrained }) => assertStorageDrained(testDbHandle().pool));
      // No output IO or child exists when temporary-directory creation fails.
      await expect(rebuildDerivedIntent({ ...ctx, config: { ...config, tempDir: join(dir, "absent") } }, intent)).rejects.toThrow();
      expect((await row()).leaseUntil).toBeNull();
      expect((await row()).properties.rebuild).not.toHaveProperty("leaseOwner");
      await drained();
      [intent] = await readDerivedRebuildIntents(ctx);
      const failGet = { ...driver, get: async () => { throw new Error("original GET failed before output IO"); } };
      await expect(rebuildDerivedIntent({ ...ctx, driver: failGet }, intent)).rejects.toThrow("original GET failed");
      expect((await row()).leaseUntil).toBeNull();
      await drained();
      // The actual invalid-image child exits before error classification; its owned process is reaped.
      const invalid = Buffer.from("invalid native input"), invalidHash = createHash("sha256").update(invalid).digest("hex");
      await driver.put({ bucket: "original", key: objectKey(invalidHash), body: new Blob([invalid]).stream(), size: invalid.length, mime: "image/png", sha256: invalidHash });
      await db.update(blobs).set({ sha256: invalidHash, key: objectKey(invalidHash), size: invalid.length }).where(eq(blobs.id, source.id));
      [intent] = await readDerivedRebuildIntents(ctx);
      await expect(rebuildDerivedIntent(ctx, intent)).rejects.toThrow("TYPE_NOT_ALLOWED");
      expect((await row()).leaseUntil).toBeNull();
      await drained();
      await cleanup.delete({ bucket: "original", key: objectKey(invalidHash) });
      await db.update(blobs).set({ sha256: sourceHash, key: source.key, size: bytes.length }).where(eq(blobs.id, source.id));
      // A late pre-output failure must not clear a replacement owner's or newer generation's claim.
      for (const replace of ["owner", "generation"] as const) {
        [intent] = await readDerivedRebuildIntents(ctx);
        const hostile = { ...driver, get: async () => {
          const current = await row();
          await db.update(derivedObjects).set(replace === "owner"
            ? { properties: { ...current.properties, rebuild: { ...(current.properties.rebuild as object), leaseOwner: "replacement-owner" } } }
            : { generation: current.generation + 1 }).where(eq(derivedObjects.id, out.id));
          throw new Error("stale attempt failed");
        } };
        await expect(rebuildDerivedIntent({ ...ctx, driver: hostile }, intent)).rejects.toThrow("stale attempt failed");
        const current = await row();
        expect(current.leaseUntil).not.toBeNull();
        // Fixture-only cleanup: this intercepted GET never issued output IO or started a child.
        const marker = current.properties.rebuild as Record<string, unknown>;
        const { leaseOwner: _owner, ...pending } = marker;
        await db.update(derivedObjects).set({ leaseUntil: null, properties: { rebuild: { ...pending, generation: current.generation } } }).where(eq(derivedObjects.id, out.id));
      }
      [intent] = await readDerivedRebuildIntents(ctx);
      let puts = 0;
      const uncertain = { ...driver, put: async (input: Parameters<typeof driver.put>[0]) => {
        puts++; await driver.put(input); throw new Error("generic wrapper lost output PUT acknowledgement");
      } };
      await expect(rebuildDerivedIntent({ ...ctx, driver: uncertain }, intent)).rejects.toThrow("generic wrapper lost");
      expect(puts).toBe(1);
      expect((await row()).leaseUntil).not.toBeNull();
      await expect(drained()).rejects.toThrow("STORAGE_IO_UNCERTAIN");
      const retained = await row();
      await db.update(derivedObjects).set({ leaseUntil: new Date(0) }).where(eq(derivedObjects.id, out.id));
      await cleanup.delete({ bucket: "derived", key: out.key });
      const heldMarker = retained.properties.rebuild as Record<string, unknown>;
      const { leaseOwner: _owner, ...heldIntent } = heldMarker;
      expect(await rebuildDerivedIntent({ ...ctx, driver: uncertain }, { ...heldIntent, id: out.id } as typeof intent)).toBe(false);
      expect(puts).toBe(1);
      // Actual driver PUT has settled and owned key DELETE has completed; only this test resets its private fixture claim.
      await db.update(derivedObjects).set({ leaseUntil: null, properties: { rebuild: heldIntent } }).where(eq(derivedObjects.id, out.id));
      [intent] = await readDerivedRebuildIntents(ctx);
      expect(await rebuildDerivedIntent(ctx, intent)).toBe(true);
      await drained();
      const readable = await driver.get({ bucket: "derived", key: out.key });
      expect(
        createHash("sha256")
          .update(await new Response(readable.body).bytes())
          .digest("hex"),
      ).toBe(rendered.hash);
      expect((await db.select().from(storageBudget))[0].derivedWritten).toBe(
        budgetBefore.derivedWritten + rendered.size,
      );
      await db.update(derivedObjects).set({ generation: 5 }).where(eq(derivedObjects.id, out.id));
      await db
        .update(mediaPublications)
        .set({ generation: 7 })
        .where(eq(mediaPublications.outputSha256, out.outputSha256));
      expect(await rebuildDerivedIntent(ctx, intent)).toBe(false);
      expect(
        (
          await db
            .select()
            .from(mediaPublications)
            .where(eq(mediaPublications.outputSha256, out.outputSha256))
        )[0].generation,
      ).toBe(7);
      // A recorded recipe expected a different immutable output. Rebuild must publish the actual bytes under their actual new hash.
      await cleanup.delete({ bucket: "derived", key: out.key });
      await db
        .delete(mediaPublications)
        .where(eq(mediaPublications.outputSha256, out.outputSha256));
      await db.delete(blobDerivatives).where(eq(blobDerivatives.id, recipe.id));
      await db.delete(derivedObjects).where(eq(derivedObjects.id, out.id));
      const oldHash = "d".repeat(64);
      const [old] = await db
        .insert(derivedObjects)
        .values({
          outputSha256: oldHash,
          key: objectKey(oldHash),
          size: rendered.size,
          mime: "image/jpeg",
          state: "ready",
          policyId: p.id,
        })
        .returning();
      const [currentRecipe] = await db
        .insert(blobDerivatives)
        .values({
          sourceBlobId: source.id,
          recipe: "avatar-v1",
          recipeBuild: RECIPE_BUILD,
          derivedObjectId: old.id,
          state: "ready",
        })
        .returning();
      const [sharedRecipe] = await db
        .insert(blobDerivatives)
        .values({
          sourceBlobId: source.id,
          recipe: "avatar-v1",
          recipeBuild: `${RECIPE_BUILD}-prior-shared`,
          derivedObjectId: old.id,
          state: "ready",
        })
        .returning();
      for (const r of [currentRecipe, sharedRecipe]) {
        const id = crypto.randomUUID();
        driftOwners.push(id);
        await db.insert(user).values({
          id,
          name: "drift-shared-proof",
          email: `${id}@placeholder.invalid`,
          image: `/media/${oldHash}.jpg`,
        });
        await db.insert(storageUsage).values({ userId: id, usedBytes: bytes.length });
        const [file] = await db
          .insert(files)
          .values({
            ownerId: id,
            blobId: source.id,
            originalName: "proof.png",
            purpose: "avatar",
            size: bytes.length,
            state: "ready",
          })
          .returning();
        await db.insert(userAvatars).values({ userId: id, fileId: file.id, derivativeId: r.id });
      }
      await db
        .insert(mediaPublications)
        .values({ outputSha256: oldHash, state: "public", generation: 3 });
      expect(await requestMissingDerivedRebuild(ctx, { id: old.id, generation: 0 })).toBe(true);
      const [drift] = await readDerivedRebuildIntents(ctx);
      expect(await rebuildDerivedIntent(ctx, drift)).toBe(true);
      expect(await driver.head({ bucket: "derived", key: old.key })).toBeNull();
      expect((await db.select().from(user).where(eq(user.id, driftOwners[0])))[0].image).toBe(
        `/media/${rendered.hash}.jpg`,
      );
      expect((await db.select().from(user).where(eq(user.id, driftOwners[1])))[0].image).toBe(
        `/media/${oldHash}.jpg`,
      );
      expect(
        (await db.select().from(blobDerivatives).where(eq(blobDerivatives.id, sharedRecipe.id)))[0]
          .derivedObjectId,
      ).toBe(old.id);
      expect(
        (
          await db
            .select()
            .from(mediaPublications)
            .where(eq(mediaPublications.outputSha256, oldHash))
        )[0],
      ).toMatchObject({ state: "public", generation: 3 });
      expect(
        await db
          .select()
          .from(mediaPurgeRequests)
          .where(eq(mediaPurgeRequests.outputSha256, oldHash)),
      ).toHaveLength(0);
      expect(
        (await db.select().from(blobDerivatives).where(eq(blobDerivatives.id, currentRecipe.id)))[0]
          .derivedObjectId,
      ).not.toBe(old.id);
      expect(
        await driver.head({ bucket: "derived", key: objectKey(rendered.hash) }),
      ).not.toBeNull();
      const driftFacts = await db
        .select()
        .from(storageTombstones)
        .where(eq(storageTombstones.sha256, oldHash));
      expect(driftFacts).toHaveLength(1);
      expect(driftFacts[0]).toMatchObject({
        kind: "media_revoked",
        userId: driftOwners[0],
        fileId: (
          await db.select().from(userAvatars).where(eq(userAvatars.userId, driftOwners[0]))
        )[0].fileId,
        generation: 1,
      });
      // Persisted fair ordering reaches the real 101st repair even if the first page has unusable intents.
      const [realRecipe] = await db
        .select()
        .from(blobDerivatives)
        .where(eq(blobDerivatives.id, currentRecipe.id));
      const [realOutput] = await db
        .select()
        .from(derivedObjects)
        .where(eq(derivedObjects.id, realRecipe.derivedObjectId!));
      await cleanup.delete({ bucket: "derived", key: realOutput.key });
      await requestMissingDerivedRebuild(ctx, {
        id: realOutput.id,
        generation: realOutput.generation,
      });
      const fakeKeys = new Set<string>();
      const intake = [];
      for (let i = 0; i < 100; i++) {
        const h = createHash("sha256").update(crypto.randomUUID()).digest("hex");
        fakeKeys.add(objectKey(h));
        intake.push({
          outputSha256: h,
          key: objectKey(h),
          size: 1,
          mime: "image/jpeg",
          state: "ready" as const,
          policyId: p.id,
          properties: {
            rebuild: {
              state: "pending",
              generation: 0,
              sourceBlobId: crypto.randomUUID(),
              recipeId: crypto.randomUUID(),
              recipe: "avatar-v1",
              recipeBuild: RECIPE_BUILD,
              expectedOutputSha256: h,
              requestedAt: "2000-01-01T00:00:00.000Z",
            },
          },
        });
      }
      await db.insert(derivedObjects).values(intake);
      await db
        .update(storageBudget)
        .set({ derivedWritten: sql`${storageBudget.derivedWritten}+100` });
      const fair = {
        ...ctx,
        driver: {
          ...driver,
          head: async (input: Parameters<typeof driver.head>[0]) => {
            if (fakeKeys.has(input.key)) throw new Error("unusable first-page IO");
            return driver.head(input);
          },
        },
      };
      expect(await rebuildMissingDerived(fair, 100)).toBe(0);
      expect((await readDerivedRebuildIntents(ctx, 1))[0].id).toBe(realOutput.id);
      expect(await rebuildMissingDerived(fair, 1)).toBe(1);
      expect(await driver.head({ bucket: "derived", key: realOutput.key })).not.toBeNull();
    } finally {
      for (const id of driftOwners) {
        await db.delete(userAvatars).where(eq(userAvatars.userId, id));
        await db.delete(files).where(eq(files.ownerId, id));
        await db.delete(user).where(eq(user.id, id));
      }
      const outputs = await db
        .select()
        .from(derivedObjects)
        .where(eq(derivedObjects.policyId, p.id));
      for (const o of outputs) {
        await cleanup.delete({ bucket: "derived", key: o.key });
        await db
          .delete(mediaPublications)
          .where(eq(mediaPublications.outputSha256, o.outputSha256));
      }
      await cleanup.delete({ bucket: "original", key: source.key });
      await cleanup.delete({ bucket: "original", key: objectKey(createHash("sha256").update("invalid native input").digest("hex")) });
      await db.delete(blobDerivatives).where(eq(blobDerivatives.sourceBlobId, source.id));
      await db.delete(derivedObjects).where(eq(derivedObjects.policyId, p.id));
      await db.delete(blobs).where(eq(blobs.id, source.id));
      await db.delete(storagePolicies).where(eq(storagePolicies.id, p.id));
      await db.update(storageBudget).set({
        derivedWritten: budgetBefore.derivedWritten,
        originalWritten: budgetBefore.originalWritten,
      });
      await rm(dir, { recursive: true, force: true });
    }
  },
);
