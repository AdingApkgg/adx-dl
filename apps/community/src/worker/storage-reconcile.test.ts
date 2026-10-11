import { beforeAll, afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { resetTestDatabase } from "../server/testing/test-db";
import { blobs, storageBudget, storageQuarantine } from "../server/db/schema";
import { readyContext, readyOwner } from "../../test/storage/ready-file";
import { cleanupStorageFixture, storageFixtureConfig } from "../../test/storage/fixture";
import { createS3Driver } from "../server/storage/s3";
import { digest } from "../../test/storage/ready-file";
import { Readable } from "node:stream";
import { objectKey } from "../server/storage/keys";
let fixture: Awaited<ReturnType<typeof readyContext>>, owner: string;
beforeAll(async () => {
  await resetTestDatabase();
  fixture = await readyContext();
  owner = await readyOwner(fixture.ctx);
  await fixture.ctx.boss();
}, 30000);
afterAll(async () => {
  if (fixture)
    await cleanupStorageFixture(fixture.ctx.db, [owner], [fixture.policy.id], undefined, true);
}, 30000);
async function implementation() {
  const mod = (await import("./storage-reconcile").catch(
    () => ({}),
  )) as typeof import("./storage-reconcile");
  expect(typeof mod.reconcileStorage).toBe("function");
  return mod;
}
test("unknown canonical originals quarantine then independently recheck after48h before delete/refund", async () => {
  const { reconcileStorage, cleanupStorageQuarantine } = await implementation(),
    { ctx } = fixture,
    now = Date.now(),
    hash = "1".repeat(64),
    key = objectKey(hash);
  let exists = true,
    deletes = 0;
  const scoped = {
    ...ctx,
    now: () => new Date(now),
    driver: {
      ...ctx.driver,
      list: async () => ({ objects: [{ key, size: 7, modifiedAt: new Date(now - 72 * 3600000) }] }),
      head: async () => (exists ? { size: 7, mime: "image/png", sha256: hash, etag: "v1" } : null),
      delete: async () => {
        deletes++;
        exists = false;
      },
    },
  };
  const before = (await ctx.db.select().from(storageBudget))[0].originalWritten;
  await reconcileStorage(scoped);
  expect(deletes).toBe(0);
  expect((await ctx.db.select().from(storageBudget))[0].originalWritten).toBe(before + 7);
  await cleanupStorageQuarantine({ ...scoped, now: () => new Date(now + 48 * 3600000 - 1) });
  expect(deletes).toBe(0);
  await cleanupStorageQuarantine({ ...scoped, now: () => new Date(now + 48 * 3600000) });
  expect(deletes).toBe(1);
  expect((await ctx.db.select().from(storageBudget))[0].originalWritten).toBe(before);
  await cleanupStorageQuarantine({ ...scoped, now: () => new Date(now + 49 * 3600000) });
  expect(deletes).toBe(1);
});
test("appearing authoritative identity prevents quarantine DELETE and conservatively retains observed charge", async () => {
  const { reconcileStorage, cleanupStorageQuarantine } = await implementation(),
    { ctx, policy } = fixture,
    now = Date.now(),
    hash = "2".repeat(64),
    key = objectKey(hash);
  let deletes = 0;
  const scoped = {
    ...ctx,
    now: () => new Date(now),
    driver: {
      ...ctx.driver,
      list: async () => ({ objects: [{ key, size: 9, modifiedAt: new Date(now) }] }),
      head: async () => ({ size: 9, mime: "image/png", sha256: hash, etag: "v1" }),
      delete: async () => {
        deletes++;
      },
    },
  };
  await reconcileStorage(scoped);
  await ctx.db.insert(blobs).values({
    sha256: hash,
    key,
    policyId: policy.id,
    size: 9,
    state: "ready",
    detectedMime: "image/png",
    verifiedAt: new Date(),
  });
  await ctx.db
    .update(storageBudget)
    .set({ originalWritten: sql`${storageBudget.originalWritten}+9` });
  const result = await cleanupStorageQuarantine({
    ...scoped,
    now: () => new Date(now + 48 * 3600000),
  });
  expect(result.storageFailures).toBeGreaterThan(0);
  expect(deletes).toBe(0);
});
test("quarantine DELETE failure retains charge and prevents a new canonical writer after absence/retry", async () => {
  const { reconcileStorage, cleanupStorageQuarantine } = await implementation(),
    { ctx } = fixture,
    now = Date.now(),
    hash = "4".repeat(64),
    key = objectKey(hash);
  let deletes = 0;
  const scoped = {
    ...ctx,
    now: () => new Date(now),
    driver: {
      ...ctx.driver,
      list: async () => ({ objects: [{ key, size: 5, modifiedAt: new Date(now) }] }),
      head: async () => ({ size: 5, mime: "image/png", sha256: hash, etag: "uncertain" }),
      delete: async () => {
        deletes++;
        throw new Error("remote completion unknown");
      },
    },
  };
  await reconcileStorage(scoped);
  const before = (await ctx.db.select().from(storageBudget))[0].originalWritten;
  await cleanupStorageQuarantine({ ...scoped, now: () => new Date(now + 48 * 3600000) });
  const row = (
    await ctx.db.select().from(storageQuarantine).where(eq(storageQuarantine.sha256, hash))
  )[0];
  expect(row).toMatchObject({ state: "deleting", deleteUncertain: true });
  const { assertOriginalKeyAvailable } = await import("../server/storage/objects"),
    { withStorageTransaction } = await import("../server/storage/transactions");
  await expect(
    withStorageTransaction(ctx.db, (tx) => assertOriginalKeyAvailable(tx, ctx, key)),
  ).rejects.toMatchObject({ code: "STORAGE_BUSY" });
  await cleanupStorageQuarantine({
    ...scoped,
    now: () => new Date(now + 49 * 3600000),
    driver: { ...scoped.driver, head: async () => null, delete: async () => {} },
  });
  expect(deletes).toBe(1);
  expect((await ctx.db.select().from(storageBudget))[0].originalWritten).toBe(before);
  await expect(
    withStorageTransaction(ctx.db, (tx) => assertOriginalKeyAvailable(tx, ctx, key)),
  ).rejects.toMatchObject({ code: "STORAGE_BUSY" });
});
test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "owned real S3 unknown original uses LIST/HEAD identity and is removed only after48h",
  async () => {
    const { reconcileStorage, cleanupStorageQuarantine } = await implementation(),
      { ctx } = fixture,
      now = Date.now(),
      bytes = new Uint8Array(Buffer.from(crypto.randomUUID())),
      hash = digest(bytes),
      key = objectKey(hash),
      driver = createS3Driver(await storageFixtureConfig("control"));
    await createS3Driver(await storageFixtureConfig("media")).put({
      bucket: "original",
      key,
      size: bytes.length,
      mime: "image/png",
      sha256: hash,
      body: Readable.toWeb(Readable.from([bytes])) as unknown as ReadableStream<Uint8Array>,
    });
    const scoped = {
      ...ctx,
      now: () => new Date(now),
      driver: {
        ...driver,
        list: (input: Parameters<typeof driver.list>[0]) => driver.list({ ...input, prefix: key }),
      },
    };
    try {
      expect((await reconcileStorage(scoped)).quarantined).toBe(1);
      expect((await driver.head({ bucket: "original", key }))?.sha256).toBe(hash);
      await cleanupStorageQuarantine({ ...scoped, now: () => new Date(now + 48 * 3600000 - 1) });
      expect(await driver.head({ bucket: "original", key })).not.toBeNull();
      await cleanupStorageQuarantine({ ...scoped, now: () => new Date(now + 48 * 3600000) });
      expect(await driver.head({ bucket: "original", key })).toBeNull();
      expect(
        (await ctx.db.select().from(storageQuarantine).where(eq(storageQuarantine.sha256, hash)))[0]
          .state,
      ).toBe("deleted");
    } finally {
      await driver.delete({ bucket: "original", key });
    }
  },
);
test("durable nightly continuation crosses>1000 canonical originals across process contexts", async () => {
  const { reconcileStorage } = await implementation(),
    { ctx } = fixture,
    base = Date.now(),
    keys = Array.from({ length: 1001 }, (_, i) => objectKey(i.toString(16).padStart(64, "3")));
  const make = () => ({
    ...ctx,
    now: () => new Date(base),
    driver: {
      ...ctx.driver,
      list: async (input: { cursor?: string; maxKeys?: number }) => {
        const start = Number(input.cursor ?? 0),
          end = Math.min(start + (input.maxKeys ?? 100), keys.length);
        return {
          objects: keys
            .slice(start, end)
            .map((key) => ({ key, size: 1, modifiedAt: new Date(base) })),
          cursor: end < keys.length ? String(end) : undefined,
        };
      },
      head: async (input: { key: string }) => ({
        size: 1,
        mime: "image/png",
        sha256: input.key.slice(-64),
        etag: "v1",
      }),
    },
  });
  const first = await reconcileStorage(make());
  expect(first.processed).toBe(1000);
  expect(first.complete).toBe(false);
  const restarted = await reconcileStorage(make());
  expect(restarted.processed).toBe(1);
  expect(restarted.complete).toBe(true);
}, 30000);

test("missing derived bytes produce a durable fixed-recipe intent without changing quota/publication; stale generation never repairs", async () => {
  const { requestMissingDerivedRebuild, readDerivedRebuildIntents } = await implementation(),
    { ctx, policy } = fixture;
  const { readyFile } = await import("../../test/storage/ready-file"),
    { derivedObjects } = await import("../server/db/schema");
  const a = await readyFile(ctx, policy.id, owner);
  const before = await ctx.db.select().from(storageBudget);
  const present = {
    ...ctx,
    driver: {
      ...ctx.driver,
      head: async () => ({
        size: a.derived.size,
        mime: a.derived.mime,
        sha256: a.derived.outputSha256,
      }),
    },
  };
  expect(
    await requestMissingDerivedRebuild(present, {
      id: a.derived.id,
      generation: a.derived.generation,
    }),
  ).toBe(false);
  if (process.env.STORAGE_TEST_FIXTURE_PATH)
    await createS3Driver(await storageFixtureConfig("control")).delete({
      bucket: "derived",
      key: a.derived.key,
    });
  const missing = process.env.STORAGE_TEST_FIXTURE_PATH
    ? ctx
    : { ...ctx, driver: { ...ctx.driver, head: async () => null } };
  expect(
    await requestMissingDerivedRebuild(missing, {
      id: a.derived.id,
      generation: a.derived.generation + 1,
    }),
  ).toBe(false);
  expect(
    await requestMissingDerivedRebuild(missing, {
      id: a.derived.id,
      generation: a.derived.generation,
    }),
  ).toBe(true);
  const intents = await readDerivedRebuildIntents(ctx);
  expect(intents.find((i) => i.id === a.derived.id)).toMatchObject({
    state: "pending",
    generation: a.derived.generation,
    sourceBlobId: a.blob.id,
    recipeId: a.recipe.id,
    recipeBuild: ctx.config.recipeBuild,
    expectedOutputSha256: a.derived.outputSha256,
  });
  expect(await ctx.db.select().from(storageBudget)).toEqual(before);
  expect(
    (await ctx.db.select().from(derivedObjects).where(eq(derivedObjects.id, a.derived.id)))[0]
      .state,
  ).toBe("ready");
  for (const limit of [0, 101, 1.5])
    await expect(readDerivedRebuildIntents(ctx, limit)).rejects.toThrow();
});

test("quarantine and inventory migrations reject invalid identities and preserve restrictive policy FK", async () => {
  const { ctx, policy } = fixture,
    { storageInventoryProgress, storagePolicies } = await import("../server/db/schema"),
    hash = "5".repeat(64),
    base = { policyId: policy.id, sha256: hash, key: objectKey(hash), size: 1, observedEtag: "v1" };
  for (const patch of [
    { sha256: "INVALID" },
    { key: "unowned/path" },
    { size: 0 },
    { generation: -1 },
    { observedEtag: "" },
    { state: "deleted", deleteStartedAt: null },
    { deleteUncertain: true, deleteStartedAt: null },
  ])
    await expect(
      Promise.resolve(
        ctx.db
          .insert(storageQuarantine)
          .values({ ...base, ...patch } as typeof storageQuarantine.$inferInsert),
      ),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  await expect(
    Promise.resolve(
      ctx.db
        .insert(storageInventoryProgress)
        .values({ policyId: policy.id, cursor: "" })
        .onConflictDoUpdate({ target: storageInventoryProgress.policyId, set: { cursor: "" } }),
    ),
  ).rejects.toMatchObject({ cause: { code: "23514" } });
  let code: string | undefined;
  try {
    await ctx.db.delete(storagePolicies).where(eq(storagePolicies.id, policy.id));
  } catch (error) {
    code = (error as { cause?: { code?: string } }).cause?.code;
  }
  expect(code).toBe("23001");
});

test("review: 101 quarantined keys advance past first100 HEAD failures without identity ACK or refund", async () => {
  const { ctx, policy } = fixture,
    { cleanupStorageQuarantine } = await implementation(),
    now = Date.now(),
    rows = await ctx.db
      .insert(storageQuarantine)
      .values(
        Array.from({ length: 101 }, () => {
          const hash = crypto.randomUUID().replaceAll("-", "").repeat(2);
          return {
            policyId: policy.id,
            sha256: hash,
            key: objectKey(hash),
            size: 1,
            observedEtag: "same",
            firstSeenAt: new Date(now - 49 * 3600000),
            lastObservedAt: new Date(now - 49 * 3600000),
          };
        }),
      )
      .returning();
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const last = rows[100];
  let deletes = 0;
  await ctx.db
    .update(storageBudget)
    .set({ originalWritten: sql`${storageBudget.originalWritten}+101` });
  const before = (await ctx.db.select().from(storageBudget))[0].originalWritten;
  const scoped = {
    ...ctx,
    now: () => new Date(now),
    driver: {
      ...ctx.driver,
      head: async (input: Parameters<typeof ctx.driver.head>[0]) => {
        if (input.key !== last.key) throw new Error("HEAD unavailable");
        return { size: 1, mime: "image/png", sha256: last.sha256, etag: "same" };
      },
      delete: async () => {
        deletes++;
      },
    },
  };
  expect((await cleanupStorageQuarantine(scoped)).deleted).toBe(0);
  expect((await ctx.db.select().from(storageBudget))[0].originalWritten).toBe(before);
  expect(
    (await cleanupStorageQuarantine({ ...scoped, now: () => new Date(now + 1) })).deleted,
  ).toBe(1);
  expect(deletes).toBe(1);
  const current = await ctx.db.select().from(storageQuarantine);
  for (const row of rows.slice(0, 100)) {
    const a = current.find((q) => q.id === row.id)!;
    expect(a).toMatchObject({
      state: "quarantined",
      generation: 0,
      observedEtag: "same",
      size: 1,
      deleteStartedAt: null,
      deleteUncertain: false,
    });
    expect(a.firstSeenAt).toEqual(row.firstSeenAt);
  }
  expect((await ctx.db.select().from(storageBudget))[0].originalWritten).toBe(before - 1);
});
test("review: nightly inventory stops at100 empty continuation pages and resumes durable cursor", async () => {
  const { ctx, policy } = fixture,
    { storageInventoryProgress } = await import("../server/db/schema"),
    { reconcileStorage } = await implementation();
  await ctx.db
    .insert(storageInventoryProgress)
    .values({ policyId: policy.id })
    .onConflictDoUpdate({ target: storageInventoryProgress.policyId, set: { cursor: null } });
  let calls = 0;
  const scoped = {
    ...ctx,
    driver: {
      ...ctx.driver,
      list: async (input: Parameters<typeof ctx.driver.list>[0]) => {
        calls++;
        const next = Number(input.cursor ?? 0) + 1;
        return { objects: [], cursor: next < 200 ? String(next) : undefined };
      },
    },
  };
  const first = await reconcileStorage(scoped);
  expect(calls).toBe(100);
  expect(first.complete).toBe(false);
  expect(
    (
      await ctx.db
        .select()
        .from(storageInventoryProgress)
        .where(eq(storageInventoryProgress.policyId, policy.id))
    )[0].cursor,
  ).toBe("100");
  expect((await reconcileStorage({ ...scoped })).complete).toBe(true);
  expect(calls).toBe(200);
});
