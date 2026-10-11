import { beforeAll, afterAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  user,
  userAvatars,
  avatarMutations,
  files,
  mediaPublications,
  mediaPurgeRequests,
  storageUsage,
  blobBlocks,
  storageMaintenance,
  storageTombstones,
} from "../db/schema";
import { resetTestDatabase } from "../testing/test-db";
import { readyContext, readyOwner, readyFile } from "../../../test/storage/ready-file";
import { cleanupStorageFixture, storageFixtureConfig } from "../../../test/storage/fixture";
import { createS3Driver } from "./s3";
import { setAvatar } from "./avatars";
import { deleteFile } from "./files";
let fixture: Awaited<ReturnType<typeof readyContext>>;
const owners: string[] = [];
beforeAll(async () => {
  await resetTestDatabase();
  fixture = await readyContext();
}, 30000);
afterAll(async () => {
  if (fixture)
    await cleanupStorageFixture(
      fixture.ctx.db,
      owners,
      [fixture.policy.id],
      process.env.STORAGE_TEST_FIXTURE_PATH
        ? createS3Driver(await storageFixtureConfig("control"))
        : undefined,
      true,
    );
}, 30000);
async function own() {
  const id = await readyOwner(fixture.ctx);
  owners.push(id);
  return id;
}
test("revision, lost-response replay, distinct remove digest, same-file no-op and 24h retention", async () => {
  const { ctx, policy } = fixture;
  const id = await own();
  const a = await readyFile(ctx, policy.id, id),
    b = await readyFile(ctx, policy.id, id);
  const key = crypto.randomUUID();
  const input = { fileId: a.file.id, expectedRevision: 0 };
  const result = await setAvatar(ctx, id, input, key);
  expect(result).toEqual({ image: `/media/${a.derived.outputSha256}.jpg`, avatarRevision: 1 });
  expect(await setAvatar(ctx, id, input, key)).toEqual(result);
  await expect(
    setAvatar(ctx, id, { fileId: null, expectedRevision: 0 }, key),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  await expect(
    setAvatar(ctx, id, { fileId: b.file.id, expectedRevision: 0 }, crypto.randomUUID()),
  ).rejects.toMatchObject({ code: "AVATAR_CHANGED" });
  expect(
    await setAvatar(ctx, id, { fileId: a.file.id, expectedRevision: 1 }, crypto.randomUUID()),
  ).toEqual(result);
  await expect(deleteFile(ctx, id, a.file.id)).rejects.toMatchObject({ code: "FILE_IN_USE" });
  await setAvatar(ctx, id, { fileId: b.file.id, expectedRevision: 1 }, crypto.randomUUID());
  const [old] = await ctx.db.select().from(files).where(eq(files.id, a.file.id));
  expect(old.retainedUntil!.getTime()).toBeGreaterThan(Date.now() + 86300000);
  expect(
    await setAvatar(ctx, id, { fileId: null, expectedRevision: 2 }, crypto.randomUUID()),
  ).toEqual({ image: null, avatarRevision: 3 });
  const [row] = await ctx.db.select().from(user).where(eq(user.id, id));
  expect(row.image).toBeNull();
  await deleteFile(ctx, id, a.file.id);
  await deleteFile(ctx, id, a.file.id);
  const [usage] = await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, id));
  expect(usage.usedBytes).toBe(b.file.size);
  expect(
    (await ctx.db.select().from(avatarMutations).where(eq(avatarMutations.userId, id))).length,
  ).toBe(4);
});
test("shared physical output remains public until the last active reference then outbox/job commit together", async () => {
  const { ctx, policy } = fixture;
  const one = await own(),
    two = await own();
  const a = await readyFile(ctx, policy.id, one),
    b = await readyFile(ctx, policy.id, two, a.derived);
  await setAvatar(ctx, one, { fileId: a.file.id, expectedRevision: 0 }, crypto.randomUUID());
  await setAvatar(ctx, two, { fileId: b.file.id, expectedRevision: 0 }, crypto.randomUUID());
  await setAvatar(ctx, one, { fileId: null, expectedRevision: 1 }, crypto.randomUUID());
  expect(
    (
      await ctx.db
        .select()
        .from(mediaPublications)
        .where(eq(mediaPublications.outputSha256, a.derived.outputSha256))
    )[0].state,
  ).toBe("public");
  const facts = await ctx.db
    .select()
    .from(storageTombstones)
    .where(eq(storageTombstones.sha256, a.derived.outputSha256));
  expect(facts.map((r) => [r.userId, r.fileId, r.generation])).toEqual([[one, a.file.id, 2]]);
  await setAvatar(ctx, two, { fileId: null, expectedRevision: 1 }, crypto.randomUUID());
  const [pub] = await ctx.db
    .select()
    .from(mediaPublications)
    .where(eq(mediaPublications.outputSha256, a.derived.outputSha256));
  expect(pub.state).toBe("revoking");
  const [out] = await ctx.db
    .select()
    .from(mediaPurgeRequests)
    .where(eq(mediaPurgeRequests.outputSha256, a.derived.outputSha256));
  expect(out.generation).toBe(pub.generation);
  const allFacts = await ctx.db
    .select()
    .from(storageTombstones)
    .where(eq(storageTombstones.sha256, a.derived.outputSha256));
  expect(
    allFacts.filter((r) => r.userId === two && r.fileId === b.file.id && r.generation === 2),
  ).toHaveLength(1);
  expect(
    allFacts.filter(
      (r) => r.userId === null && r.fileId === null && r.generation === pub.generation,
    ),
  ).toHaveLength(1);
  const jobs = await ctx.db.execute(
    sql`select id from pgboss.job where name='media.purge' and data->>'hash'=${a.derived.outputSha256} and (data->>'generation')::bigint=${pub.generation}`,
  );
  expect(jobs.rows).toHaveLength(1);
  await expect(
    setAvatar(ctx, one, { fileId: a.file.id, expectedRevision: 2 }, crypto.randomUUID()),
  ).rejects.toMatchObject({ code: "MEDIA_REVOCATION_PENDING" });
});
test("active status, ready ownership, blocks and maintenance are checked inside mutation transaction", async () => {
  const { ctx, policy } = fixture;
  const id = await own();
  const a = await readyFile(ctx, policy.id, id);
  await expect(
    setAvatar(ctx, await own(), { fileId: a.file.id, expectedRevision: 0 }, crypto.randomUUID()),
  ).rejects.toMatchObject({ status: 404 });
  await ctx.db.update(user).set({ status: "pending_deletion" }).where(eq(user.id, id));
  await expect(
    setAvatar(ctx, id, { fileId: a.file.id, expectedRevision: 0 }, crypto.randomUUID()),
  ).rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });
  expect(await ctx.db.select().from(userAvatars).where(eq(userAvatars.userId, id))).toHaveLength(0);
});

test("postcommit notification failure retries persisted result; old success replay never resumes a revoked generation", async () => {
  const { ctx, policy } = fixture,
    id = await own(),
    f = await readyFile(ctx, policy.id, id);
  const key = crypto.randomUUID(),
    input = { fileId: f.file.id, expectedRevision: 0 };
  let calls = 0;
  const notifying = {
    ...ctx,
    onMediaPublished: async (hash: string, generation: number) => {
      calls++;
      expect(hash).toBe(f.derived.outputSha256);
      const [committed] = await ctx.db.select().from(userAvatars).where(eq(userAvatars.userId, id));
      expect(committed.revision).toBe(1);
      const [pub] = await ctx.db
        .select()
        .from(mediaPublications)
        .where(eq(mediaPublications.outputSha256, hash));
      expect(pub.generation).toBe(generation);
      if (calls === 1) throw new Error("test notification failure");
    },
  };
  await expect(setAvatar(notifying, id, input, key)).rejects.toMatchObject({ status: 503 });
  expect(await setAvatar(notifying, id, input, key)).toMatchObject({ avatarRevision: 1 });
  expect(calls).toBe(2);
  await setAvatar(ctx, id, { fileId: null, expectedRevision: 1 }, crypto.randomUUID());
  expect(await setAvatar(notifying, id, input, key)).toMatchObject({ avatarRevision: 1 });
  expect(calls).toBe(2);
});
test("new save rechecks blocked/ready state and races serialize revision; maintenance refuses mutation", async () => {
  const { ctx, policy } = fixture,
    id = await own(),
    f = await readyFile(ctx, policy.id, id);
  await ctx.db.insert(blobBlocks).values({ sha256: f.derived.outputSha256, reasonCode: "test" });
  await expect(
    setAvatar(ctx, id, { fileId: f.file.id, expectedRevision: 0 }, crypto.randomUUID()),
  ).rejects.toMatchObject({ status: 404 });
  await ctx.db.delete(blobBlocks).where(eq(blobBlocks.sha256, f.derived.outputSha256));
  await ctx.db.update(files).set({ state: "rejected" }).where(eq(files.id, f.file.id));
  await expect(
    setAvatar(ctx, id, { fileId: f.file.id, expectedRevision: 0 }, crypto.randomUUID()),
  ).rejects.toMatchObject({ status: 404 });
  await ctx.db.update(files).set({ state: "ready" }).where(eq(files.id, f.file.id));
  const results = await Promise.allSettled(
    [0, 1].map(() =>
      setAvatar(ctx, id, { fileId: f.file.id, expectedRevision: 0 }, crypto.randomUUID()),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason.code).toBe(
    "AVATAR_CHANGED",
  );
  await ctx.db
    .update(storageMaintenance)
    .set({ ownerId: crypto.randomUUID(), leaseUntil: new Date(Date.now() + 10000) })
    .where(eq(storageMaintenance.id, "global"));
  try {
    await expect(
      setAvatar(ctx, id, { fileId: null, expectedRevision: 1 }, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "STORAGE_MAINTENANCE" });
  } finally {
    await ctx.db
      .update(storageMaintenance)
      .set({ ownerId: null, leaseUntil: null })
      .where(eq(storageMaintenance.id, "global"));
  }
});

test("explicit removal retains an avatar row and advances revision even when image is already absent", async () => {
  const { ctx } = fixture,
    id = await own();
  expect(
    await setAvatar(ctx, id, { fileId: null, expectedRevision: 0 }, crypto.randomUUID()),
  ).toEqual({ image: null, avatarRevision: 1 });
  expect(
    (await ctx.db.select().from(userAvatars).where(eq(userAvatars.userId, id)))[0].revision,
  ).toBe(1);
});
