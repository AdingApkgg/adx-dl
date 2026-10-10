import { resetTestDatabase } from "../server/testing/test-db";
import { beforeAll, afterAll, expect, test } from "bun:test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  blobs,
  blobDerivatives,
  derivedObjects,
  files,
  user,
  userAvatars,
  storageBudget,
  storageUsage,
  uploadSessions,
  mediaPublications,
} from "../server/db/schema";
import { readyContext, readyFile, readyOwner } from "../../test/storage/ready-file";
import { storageFixtureConfig, cleanupStorageFixture } from "../../test/storage/fixture";
import { createS3Driver } from "../server/storage/s3";
import { setAvatar } from "../server/storage/avatars";
import { initUpload } from "../server/storage/uploads";
import { requestDeletion, cancelDeletion } from "../server/services/user-deletion";
import type { StorageContext } from "../server/storage/contracts";
let fixture: Awaited<ReturnType<typeof readyContext>>;
const owners: string[] = [];
beforeAll(async () => {
  await resetTestDatabase();
  fixture = await readyContext();
  fixture.ctx.driver = createS3Driver(await storageFixtureConfig("control"));
  await fixture.ctx.boss();
}, 30000);
afterAll(async () => {
  if (fixture)
    await cleanupStorageFixture(
      fixture.ctx.db,
      owners,
      [fixture.policy.id],
      process.env.STORAGE_TEST_FIXTURE_PATH ? fixture.ctx.driver : undefined,
      true,
    );
}, 30000);
async function own() {
  const id = await readyOwner(fixture.ctx);
  owners.push(id);
  return id;
}
async function implementation() {
  const mod = (await import("./storage-sweep").catch(
    () => ({}),
  )) as typeof import("./storage-sweep");
  expect(typeof mod.sweepStorage).toBe("function");
  return mod;
}
function at(ms: number): StorageContext {
  return { ...fixture.ctx, now: () => new Date(ms) };
}

test("unattached expiration respects 24h, suspended association pins files and objects", async () => {
  const { sweepStorage } = await implementation(),
    { ctx, policy } = fixture,
    id = await own(),
    a = await readyFile(ctx, policy.id, id);
  const expiry = new Date(Date.now() + 3600000);
  await ctx.db.update(files).set({ retainedUntil: expiry }).where(eq(files.id, a.file.id));
  await sweepStorage(at(expiry.getTime() - 1));
  expect((await ctx.db.select().from(files).where(eq(files.id, a.file.id)))[0].state).toBe("ready");
  await sweepStorage(at(expiry.getTime()));
  expect((await ctx.db.select().from(files).where(eq(files.id, a.file.id)))[0].state).toBe(
    "deleted",
  );
  expect(
    (await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, id)))[0].usedBytes,
  ).toBe(0);
  const b = await readyFile(ctx, policy.id, id);
  await setAvatar(ctx, id, { fileId: b.file.id, expectedRevision: 0 }, crypto.randomUUID());
  const { createStorageDeletionHandler } = await import("../server/storage/deletion");
  await requestDeletion(
    {
      db: ctx.db,
      boss: ctx.boss,
      handlers: [
        { name: "fixture", hasContent: async () => true, purge: async () => {} },
        createStorageDeletionHandler(ctx),
      ],
    },
    id,
    { deleteContent: false },
  );
  await sweepStorage(at(Date.now() + 9 * 86400000));
  expect((await ctx.db.select().from(files).where(eq(files.id, b.file.id)))[0].state).toBe("ready");
  expect((await ctx.db.select().from(blobs).where(eq(blobs.id, b.blob.id)))[0]).toMatchObject({
    state: "ready",
    orphanedAt: null,
  });
});

test("original and shared output each get independent seven-day grace, one source never deletes shared bytes", async () => {
  const { sweepStorage } = await implementation(),
    { ctx, policy } = fixture,
    one = await own(),
    two = await own(),
    a = await readyFile(ctx, policy.id, one),
    b = await readyFile(ctx, policy.id, two, a.derived);
  await setAvatar(ctx, two, { fileId: b.file.id, expectedRevision: 0 }, crypto.randomUUID());
  const t = Date.now() + 2 * 86400000;
  await sweepStorage(at(t));
  const [orphan] = await ctx.db.select().from(blobs).where(eq(blobs.id, a.blob.id));
  expect(orphan.orphanedAt?.getTime()).toBe(t);
  await sweepStorage(at(t + 7 * 86400000 - 1));
  expect((await ctx.db.select().from(blobs).where(eq(blobs.id, a.blob.id)))[0].state).toBe("ready");
  await sweepStorage(at(t + 7 * 86400000));
  expect((await ctx.db.select().from(blobs).where(eq(blobs.id, a.blob.id)))[0].state).toBe(
    "deleting",
  );
  expect(
    (await ctx.db.select().from(blobDerivatives).where(eq(blobDerivatives.id, a.recipe.id)))[0]
      .state,
  ).toBe("retired");
  expect(
    (await ctx.db.select().from(derivedObjects).where(eq(derivedObjects.id, a.derived.id)))[0],
  ).toMatchObject({ state: "ready", orphanedAt: null });
});

test("absolute 24h upload expiry releases logical quota once and cancels descendants", async () => {
  const { sweepStorage } = await implementation(),
    { ctx } = fixture,
    id = await own();
  const upload = await initUpload(
    ctx,
    id,
    { purpose: "avatar", name: "expires.png", size: 5, sha256: "d".repeat(64) },
    crypto.randomUUID(),
  );
  const [s] = await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, upload.id));
  await sweepStorage(at(s.expiresAt.getTime() - 1));
  expect(
    (await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, upload.id)))[0].state,
  ).toBe("receiving");
  await sweepStorage(at(s.expiresAt.getTime()));
  await sweepStorage(at(s.expiresAt.getTime()));
  expect(
    (await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, upload.id)))[0],
  ).toMatchObject({ state: "expired", generation: 1, reservedBytes: 0 });
  expect(
    (await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, id)))[0],
  ).toMatchObject({ reservedBytes: 0, activeUploads: 0 });
});

test("cancel during revoking defers restoration until convergence and changed selection fences old intent", async () => {
  const { sweepStorage } = await implementation(),
    { ctx, policy } = fixture,
    id = await own(),
    a = await readyFile(ctx, policy.id, id);
  await setAvatar(ctx, id, { fileId: a.file.id, expectedRevision: 0 }, crypto.randomUUID());
  const { createStorageDeletionHandler } = await import("../server/storage/deletion");
  const deps = {
    db: ctx.db,
    boss: ctx.boss,
    handlers: [
      { name: "fixture", hasContent: async () => true, purge: async () => {} },
      createStorageDeletionHandler(ctx),
    ],
  };
  await requestDeletion(deps, id, { deleteContent: false });
  await cancelDeletion(deps, id);
  expect((await ctx.db.select().from(user).where(eq(user.id, id)))[0].image).toBeNull();
  await ctx.db
    .update(mediaPublications)
    .set({ state: "private" })
    .where(eq(mediaPublications.outputSha256, a.derived.outputSha256));
  const resumed: string[] = [];
  await sweepStorage({
    ...ctx,
    onMediaPublished: async (hash) => {
      resumed.push(hash);
    },
  });
  expect((await ctx.db.select().from(user).where(eq(user.id, id)))[0].image).toBe(
    `/media/${a.derived.outputSha256}.jpg`,
  );
  expect(resumed).toContain(a.derived.outputSha256);
  await requestDeletion(deps, id, { deleteContent: false });
  await cancelDeletion(deps, id);
  await setAvatar(ctx, id, { fileId: null, expectedRevision: 1 }, crypto.randomUUID());
  await ctx.db
    .update(mediaPublications)
    .set({ state: "private" })
    .where(eq(mediaPublications.outputSha256, a.derived.outputSha256));
  await sweepStorage(ctx);
  expect((await ctx.db.select().from(user).where(eq(user.id, id)))[0].image).toBeNull();
});

test("budget recalibration reports drift and ready S3 absence is failure without refund", async () => {
  const { sweepStorage } = await implementation(),
    { ctx, policy } = fixture,
    id = await own(),
    a = await readyFile(ctx, policy.id, id);
  await setAvatar(ctx, id, { fileId: a.file.id, expectedRevision: 0 }, crypto.randomUUID());
  const before = (await ctx.db.select().from(storageBudget))[0];
  await ctx.db
    .update(storageBudget)
    .set({ originalWritten: sql`${storageBudget.originalWritten}+1` });
  const result = await sweepStorage({ ...ctx, driver: { ...ctx.driver, head: async () => null } });
  expect(result.budgetDrift.originalWritten).toBe(1);
  expect(result.storageFailures).toBeGreaterThan(0);
  expect((await ctx.db.select().from(storageBudget))[0].originalWritten).toBe(
    before.originalWritten + 1,
  );
  await ctx.db
    .update(storageBudget)
    .set({ originalWritten: sql`${storageBudget.originalWritten}-1` });
});

test("real pg-boss dead parent records original identity, rejects once and cancels blocked descendants", async () => {
  const { recordStorageDead } = await implementation(),
    { ctx, policy } = fixture,
    id = await own(),
    a = await readyFile(ctx, policy.id, id);
  const upload = await initUpload(
    ctx,
    id,
    { purpose: "avatar", name: "flow.png", size: a.file.size, sha256: a.blob.sha256 },
    crypto.randomUUID(),
  );
  const [s] = await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, upload.id));
  expect(s.state).toBe("processing");
  const boss = await ctx.boss();
  await ctx.db.execute(
    sql`update pgboss.job set state='active',retry_limit=0 where id=${s.flowJobIds[0]}::uuid`,
  );
  await boss.fail("storage.ingest", s.flowJobIds[0], { message: "owned test" });
  const [dead] = await boss.findJobs("storage.dead", { key: `${upload.id}:0` });
  expect(dead.sourceId).toBe(s.flowJobIds[0]);
  expect(dead.sourceName).toBe("storage.ingest");
  expect(await recordStorageDead(ctx, dead as never)).toBe(true);
  expect(await recordStorageDead(ctx, dead as never)).toBe(false);
  expect(
    (await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, s.id)))[0],
  ).toMatchObject({ state: "rejected", reservedBytes: 0, generation: 1 });
  const descendants = await ctx.db.execute<{ state: string }>(
    sql`select state from pgboss.job where id=any(${sql.param(s.flowJobIds.slice(1))}::uuid[])`,
  );
  expect(descendants.rows.every((j) => j.state === "cancelled")).toBe(true);
  expect(
    (await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, id)))[0],
  ).toMatchObject({ reservedBytes: 0, activeUploads: 0 });
});

test("15min stranded repair increments generation, preserves reservation and ignores delayed old dead delivery", async () => {
  const { sweepStorage, recordStorageDead } = await implementation(),
    { ctx, policy } = fixture,
    id = await own(),
    a = await readyFile(ctx, policy.id, id);
  const upload = await initUpload(
    ctx,
    id,
    { purpose: "avatar", name: "repair.png", size: a.file.size, sha256: a.blob.sha256 },
    crypto.randomUUID(),
  );
  const [s] = await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, upload.id));
  await ctx.db.execute(
    sql`delete from pgboss.job where id=any(${sql.param(s.flowJobIds)}::uuid[])`,
  );
  const t = Date.now() - 16 * 60000;
  await ctx.db
    .update(uploadSessions)
    .set({ updatedAt: new Date(t) })
    .where(eq(uploadSessions.id, s.id));
  await sweepStorage(at(t + 15 * 60000 - 1));
  expect(
    (await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, s.id)))[0].generation,
  ).toBe(0);
  await sweepStorage(at(t + 15 * 60000));
  const [repaired] = await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, s.id));
  expect(repaired).toMatchObject({
    state: "processing",
    generation: 1,
    reservedBytes: a.file.size,
  });
  expect(repaired.flowJobIds).not.toEqual(s.flowJobIds);
  expect(
    await recordStorageDead(ctx, {
      data: { uploadId: s.id, generation: 0 },
      sourceId: s.flowJobIds[0],
      sourceName: "storage.ingest",
    }),
  ).toBe(false);
  // An old identity cannot reject even a wire payload accidentally bearing the current generation.
  expect(
    await recordStorageDead(ctx, {
      data: { uploadId: s.id, generation: 1 },
      sourceId: s.flowJobIds[0],
      sourceName: "storage.ingest",
    }),
  ).toBe(false);
  expect(
    (await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, id)))[0],
  ).toMatchObject({ reservedBytes: a.file.size, activeUploads: 1 });
});

test("terminal temporary objects wait 1h and unknown attempts wait 48h; writing ambiguity is never refunded", async () => {
  const { sweepStorage } = await implementation(),
    { ctx, policy } = fixture,
    id = await own();
  const { uploadAttempts } = await import("../server/db/schema");
  const now = Date.now(),
    upload = await initUpload(
      ctx,
      id,
      { purpose: "avatar", name: "tmp.png", size: 3, sha256: "e".repeat(64) },
      crypto.randomUUID(),
    );
  await ctx.db
    .update(uploadSessions)
    .set({ state: "cancelled", reservedBytes: 0, updatedAt: new Date(now) })
    .where(eq(uploadSessions.id, upload.id));
  await ctx.db
    .update(storageUsage)
    .set({ reservedBytes: 0, activeUploads: 0 })
    .where(eq(storageUsage.userId, id));
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await ctx.db.insert(uploadAttempts).values(
    ids.map((attemptId, index) => ({
      id: attemptId,
      uploadId: index === 0 ? upload.id : crypto.randomUUID(),
      index: 0,
      policyId: policy.id,
      tempKey: `tmp/${crypto.randomUUID()}/0/${attemptId}`,
      size: 3,
      state: index === 2 ? ("writing" as const) : ("ready" as const),
      reservedBytes: index === 2 ? 3 : 0,
      writtenBytes: index === 2 ? 0 : 3,
      leaseUntil: new Date(now - 1),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })),
  );
  await ctx.db.update(storageBudget).set({
    temporaryWritten: sql`${storageBudget.temporaryWritten}+6`,
    temporaryReserved: sql`${storageBudget.temporaryReserved}+3`,
  });
  const scoped = { ...ctx, driver: { ...ctx.driver, delete: async () => {} } };
  await sweepStorage({ ...scoped, now: () => new Date(now + 3600000 - 1) });
  expect(
    (await ctx.db.select().from(uploadAttempts).where(eq(uploadAttempts.id, ids[0])))[0].state,
  ).toBe("ready");
  await sweepStorage({ ...scoped, now: () => new Date(now + 3600000) });
  expect(
    (await ctx.db.select().from(uploadAttempts).where(eq(uploadAttempts.id, ids[0])))[0],
  ).toMatchObject({ state: "deleted", writtenBytes: 0 });
  await sweepStorage({ ...scoped, now: () => new Date(now + 48 * 3600000 - 1) });
  expect(
    (await ctx.db.select().from(uploadAttempts).where(eq(uploadAttempts.id, ids[1])))[0].state,
  ).toBe("ready");
  await sweepStorage({ ...scoped, now: () => new Date(now + 48 * 3600000) });
  expect(
    (await ctx.db.select().from(uploadAttempts).where(eq(uploadAttempts.id, ids[1])))[0],
  ).toMatchObject({ state: "deleted", writtenBytes: 0 });
  expect(
    (await ctx.db.select().from(uploadAttempts).where(eq(uploadAttempts.id, ids[2])))[0],
  ).toMatchObject({ state: "writing", reservedBytes: 3 });
  // No FK to owner: explicit owned test teardown preserves the uncertainty until assertions finish.
  await ctx.db.delete(uploadAttempts).where(inArray(uploadAttempts.id, ids.slice(1)));
  await ctx.db
    .update(storageBudget)
    .set({ temporaryReserved: sql`${storageBudget.temporaryReserved}-3` });
});

test("file tombstone cannot be removed before day30", async () => {
  const { sweepStorage } = await implementation(),
    { ctx, policy } = fixture,
    id = await own(),
    a = await readyFile(ctx, policy.id, id),
    t = Date.now();
  await ctx.db
    .update(files)
    .set({ state: "deleted", deletedAt: new Date(t), retainedUntil: new Date(t + 30 * 86400000) })
    .where(eq(files.id, a.file.id));
  await sweepStorage(at(t + 30 * 86400000 - 1));
  expect(await ctx.db.select().from(files).where(eq(files.id, a.file.id))).toHaveLength(1);
  await sweepStorage(at(t + 30 * 86400000));
  expect(await ctx.db.select().from(files).where(eq(files.id, a.file.id))).toHaveLength(0);
});

test("remaining sweep deadline aborts actual pending driver read and forbids late continuation", async () => {
  const { sweepStorage } = await implementation(),
    { ctx, policy } = fixture,
    id = await own(),
    a = await readyFile(ctx, policy.id, id);
  let aborted = false;
  const delayed = {
    ...ctx,
    driver: {
      ...ctx.driver,
      list: async () => ({ objects: [] }),
      head: async (input: Parameters<typeof ctx.driver.head>[0]) =>
        new Promise<never>((_, reject) => {
          input.signal?.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    },
  };
  const before = performance.now(),
    result = await sweepStorage(delayed, undefined, 500);
  expect(performance.now() - before).toBeLessThan(1500);
  expect(result.limited).toBe(true);
  expect(aborted).toBe(true);
  expect((await ctx.db.select().from(blobs).where(eq(blobs.id, a.blob.id)))[0].state).toBe("ready");
});

test("physical scans rotate beyond batch100 and failed resume batches cannot starve later generations", async () => {
  const { sweepStorage } = await implementation(),
    { ctx, policy } = fixture,
    base = Date.now();
  const rows = await ctx.db
    .insert(blobs)
    .values(
      Array.from({ length: 101 }, () => ({
        sha256: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"),
        policyId: policy.id,
        key: `rotation/${crypto.randomUUID()}`,
        size: 1,
        state: "ready" as const,
        detectedMime: "image/png",
        verifiedAt: new Date(),
        properties: { gcCheckedAt: "malformed" },
      })),
    )
    .returning();
  await ctx.db
    .update(storageBudget)
    .set({ originalWritten: sql`${storageBudget.originalWritten}+101` });
  const scanning = {
    ...ctx,
    driver: {
      ...ctx.driver,
      head: async () => ({ size: 1, mime: "image/png", sha256: "a".repeat(64) }),
    },
  };
  const first = await sweepStorage({ ...scanning, now: () => new Date(base) });
  expect(first.processed).toBeLessThanOrEqual(1000);
  const once = await ctx.db
    .select()
    .from(blobs)
    .where(
      inArray(
        blobs.id,
        rows.map((r) => r.id),
      ),
    );
  expect(once.filter((r) => r.orphanedAt !== null).length).toBeLessThan(101);
  await sweepStorage({ ...scanning, now: () => new Date(base + 1) });
  const twice = await ctx.db
    .select()
    .from(blobs)
    .where(
      inArray(
        blobs.id,
        rows.map((r) => r.id),
      ),
    );
  expect(twice.every((r) => r.orphanedAt !== null)).toBe(true);
  const outputs = await ctx.db
    .insert(derivedObjects)
    .values(
      Array.from({ length: 101 }, () => {
        const hash = crypto.randomUUID().replaceAll("-", "").padEnd(64, "1");
        return {
          outputSha256: hash,
          policyId: policy.id,
          key: `rotation/${hash}`,
          size: 1,
          mime: "image/jpeg",
          state: "ready" as const,
        };
      }),
    )
    .returning();
  await ctx.db
    .update(storageBudget)
    .set({ derivedWritten: sql`${storageBudget.derivedWritten}+101` });
  await ctx.db.insert(mediaPublications).values(
    outputs.map((o) => ({
      outputSha256: o.outputSha256,
      state: "public" as const,
      generation: 1,
      updatedAt: new Date(base - 1),
    })),
  );
  const attempts = new Set<string>();
  for (const o of outputs) {
    const owner = await own();
    const [f] = await ctx.db
      .insert(files)
      .values({
        ownerId: owner,
        blobId: rows[0].id,
        purpose: "avatar",
        originalName: "fair.png",
        size: 1,
        state: "ready",
      })
      .returning();
    const [recipe] = await ctx.db
      .insert(blobDerivatives)
      .values({
        sourceBlobId: rows[0].id,
        recipe: "avatar-v1",
        recipeBuild: `fair-${o.id}`,
        state: "ready",
        derivedObjectId: o.id,
      })
      .returning();
    await ctx.db
      .insert(userAvatars)
      .values({ userId: owner, fileId: f.id, derivativeId: recipe.id, revision: 1 });
    await ctx.db
      .insert(storageUsage)
      .values({ userId: owner, usedBytes: 1 })
      .onConflictDoUpdate({ target: storageUsage.userId, set: { usedBytes: 1 } });
  }
  const failing = {
    ...scanning,
    onMediaPublished: async (hash: string) => {
      if (outputs.some((o) => o.outputSha256 === hash)) attempts.add(hash);
      throw new Error("resume unavailable");
    },
  };
  await sweepStorage({ ...failing, now: () => new Date(base + 2) });
  const pubs1 = await ctx.db
    .select()
    .from(mediaPublications)
    .where(
      inArray(
        mediaPublications.outputSha256,
        outputs.map((o) => o.outputSha256),
      ),
    );
  expect(pubs1.filter((p) => p.updatedAt.getTime() === base - 1)).toHaveLength(1);
  await sweepStorage({ ...failing, now: () => new Date(base + 3) });
  const pubs2 = await ctx.db
    .select()
    .from(mediaPublications)
    .where(
      inArray(
        mediaPublications.outputSha256,
        outputs.map((o) => o.outputSha256),
      ),
    );
  expect(pubs2.every((p) => p.updatedAt.getTime() > base - 1)).toBe(true);
  expect(attempts.size).toBe(101);
}, 30000);

test("unknown physical temporary prefix waits48h and accounts once before deletion", async () => {
  const { sweepStorage } = await implementation(),
    { ctx } = fixture,
    now = Date.now(),
    { uploadAttempts } = await import("../server/db/schema");
  const { temporaryKey } = await import("../server/storage/keys");
  const uploadId = crypto.randomUUID(),
    attemptId = crypto.randomUUID(),
    key = temporaryKey(uploadId, 0, attemptId);
  let deleted = 0;
  const scoped = {
    ...ctx,
    driver: {
      ...ctx.driver,
      list: async () => ({ objects: [{ key, size: 3, modifiedAt: new Date(now) }] }),
      delete: async (input: Parameters<typeof ctx.driver.delete>[0]) => {
        if (input.key === key) deleted++;
      },
      head: async () => ({ size: 1, mime: "image/png", sha256: "a".repeat(64) }),
    },
  };
  await sweepStorage({ ...scoped, now: () => new Date(now + 48 * 3600000 - 1) });
  expect(deleted).toBe(0);
  await sweepStorage({ ...scoped, now: () => new Date(now + 48 * 3600000) });
  expect(deleted).toBe(1);
  const row = (
    await ctx.db.select().from(uploadAttempts).where(eq(uploadAttempts.id, attemptId))
  )[0];
  expect(row).toMatchObject({ state: "deleted", writtenBytes: 0, reservedBytes: 0 });
});

test("51 deferred avatars rotate past still-revoking first50 with a nonadvancing clock", async () => {
  const { sweepStorage } = await implementation(),
    { ctx, policy } = fixture,
    now = Date.now(),
    ids: string[] = [];
  for (let i = 0; i < 51; i++) ids.push(await own());
  ids.sort();
  const sourceRows = await ctx.db
    .insert(blobs)
    .values(
      ids.map(() => {
        const hash = crypto.randomUUID().replaceAll("-", "").repeat(2);
        return {
          sha256: hash,
          key: `rotation/${hash}`,
          policyId: policy.id,
          size: 1,
          state: "ready" as const,
          detectedMime: "image/png",
          verifiedAt: new Date(),
        };
      }),
    )
    .returning();
  const outputRows = await ctx.db
    .insert(derivedObjects)
    .values(
      ids.map(() => {
        const hash = crypto.randomUUID().replaceAll("-", "").repeat(2);
        return {
          outputSha256: hash,
          key: `rotation/${hash}`,
          policyId: policy.id,
          size: 1,
          state: "ready" as const,
          mime: "image/jpeg",
        };
      }),
    )
    .returning();
  for (const [i, id] of ids.entries()) {
    const [file] = await ctx.db
      .insert(files)
      .values({
        ownerId: id,
        blobId: sourceRows[i].id,
        purpose: "avatar",
        originalName: "deferred.png",
        state: "ready",
        size: 1,
      })
      .returning();
    const [recipe] = await ctx.db
      .insert(blobDerivatives)
      .values({
        sourceBlobId: sourceRows[i].id,
        recipe: "avatar-v1",
        recipeBuild: ctx.config.recipeBuild,
        state: "ready",
        derivedObjectId: outputRows[i].id,
      })
      .returning();
    await ctx.db
      .insert(userAvatars)
      .values({
        userId: id,
        fileId: file.id,
        derivativeId: recipe.id,
        revision: 1,
        suspendedAt: new Date(now),
        updatedAt: new Date(now + 1),
      });
    await ctx.db
      .insert(storageUsage)
      .values({ userId: id, usedBytes: 1 })
      .onConflictDoUpdate({ target: storageUsage.userId, set: { usedBytes: 1 } });
  }
  await ctx.db
    .update(storageBudget)
    .set({
      originalWritten: sql`${storageBudget.originalWritten}+51`,
      derivedWritten: sql`${storageBudget.derivedWritten}+51`,
    });
  await ctx.db
    .insert(mediaPublications)
    .values(
      outputRows.map((o, i) => ({
        outputSha256: o.outputSha256,
        state: i === 50 ? ("private" as const) : ("revoking" as const),
        generation: 1,
      })),
    );
  const bounded = {
    ...ctx,
    now: () => new Date(now),
    driver: {
      ...ctx.driver,
      head: async () => ({ size: 1, mime: "image/png", sha256: "a".repeat(64) }),
      list: async () => ({ objects: [] }),
    },
  };
  const first = await sweepStorage(bounded);
  expect(first.restored).toBe(0);
  expect(first.processed).toBeLessThanOrEqual(1000);
  const second = await sweepStorage(bounded);
  expect(second.restored).toBe(1);
  expect(second.processed).toBeLessThanOrEqual(1000);
  expect((await ctx.db.select().from(user).where(eq(user.id, ids[50])))[0].image).toBe(
    `/media/${outputRows[50].outputSha256}.jpg`,
  );
}, 30000);
