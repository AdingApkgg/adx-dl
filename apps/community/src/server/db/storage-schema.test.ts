import { beforeAll, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { shortId } from "../auth/short-id";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import {
  avatarMutations,
  blobDerivatives,
  blobs,
  derivedObjects,
  files,
  mediaPurgeRequests,
  storageBudget,
  storageMaintenance,
  storageTombstones,
  storageUsage,
  uploadAttempts,
  uploadParts,
  uploadSessions,
  user,
  userAvatars,
} from "./schema";

beforeAll(resetTestDatabase, 30_000);
const hash = () => crypto.randomUUID().replaceAll("-", "").repeat(2);
async function fixture() {
  const { db } = testDbHandle();
  const userId = shortId();
  await db.insert(user).values({ id: userId, name: "storage", email: `${userId}@placeholder.invalid` });
  const p = await db.execute<{ id: string }>(
    sql`insert into storage_policies(name, driver, endpoint, region, original_bucket, derived_bucket, credentials_ref) values (${crypto.randomUUID()}, 's3', 'http://seaweedfs:8333', 'us-east-1', 'blobs', 'derived', 'SEAWEED') returning id`,
  );
  const policyId = p.rows[0]!.id;
  const [blob] = await db
    .insert(blobs)
    .values({ sha256: hash(), policyId, key: crypto.randomUUID(), size: 1, detectedMime: "image/png" })
    .returning();
  return { db, userId, policyId, blob: blob! };
}
async function rejects(query: PromiseLike<unknown>, code = "23514") {
  await expect(Promise.resolve(query)).rejects.toMatchObject({ cause: { code } });
}

test("fresh migration creates a single zero budget, maintenance lease and no secret policy", async () => {
  const { db } = testDbHandle();
  expect(await db.select().from(storageBudget)).toEqual([
    expect.objectContaining({
      id: "global",
      temporaryReserved: 0,
      temporaryWritten: 0,
      originalReserved: 0,
      originalWritten: 0,
      derivedReserved: 0,
      derivedWritten: 0,
    }),
  ]);
  expect(await db.select().from(storageMaintenance)).toEqual([
    expect.objectContaining({ id: "global", ownerId: null, leaseUntil: null }),
  ]);
  const policies = await db.execute(sql`select * from storage_policies`);
  expect(policies.rows).toHaveLength(0);
});
test("physical ledger rejects bad hashes, states, negative bytes and duplicate output hash", async () => {
  const { db, policyId } = await fixture();
  for (const patch of [{ sha256: "X".repeat(64) }, { state: "unknown" }, { size: -1 }, { generation: -1 }]) {
    await rejects(
      db.execute(
        sql`insert into blobs(sha256, policy_id, key, size, state, generation) values (${patch.sha256 ?? hash()}, ${policyId}, ${crypto.randomUUID()}, ${patch.size ?? 1}, ${patch.state ?? "pending"}, ${patch.generation ?? 0})`,
      ),
    );
  }
  const outputSha256 = hash();
  await db
    .insert(derivedObjects)
    .values({ outputSha256, policyId, key: crypto.randomUUID(), size: 2, mime: "image/jpeg" });
  await rejects(
    db
      .insert(derivedObjects)
      .values({ outputSha256, policyId, key: crypto.randomUUID(), size: 2, mime: "image/jpeg" }),
    "23505",
  );
});
test("avatar FK pair, usage, part count and singleton constraints survive migrations", async () => {
  const { db, userId, blob } = await fixture();
  const [file] = await db
    .insert(files)
    .values({ ownerId: userId, blobId: blob.id, originalName: "a.png", purpose: "avatar", size: 1 })
    .returning();
  await rejects(db.insert(userAvatars).values({ userId, fileId: file!.id }));
  await rejects(db.insert(storageUsage).values({ userId, usedBytes: -1 }));
  await rejects(db.insert(storageUsage).values({ userId, activeUploads: -1 }));
  await rejects(db.execute(sql`insert into storage_budget(id) values ('other')`));
  await rejects(
    db
      .insert(uploadSessions)
      .values({
        ownerId: userId,
        purpose: "avatar",
        originalName: "a.png",
        expectedSha256: hash(),
        expectedSize: 1,
        partSize: 4_194_304,
        partCount: 2,
        expiresAt: new Date(Date.now() + 60_000),
        idempotencyKey: crypto.randomUUID(),
        requestDigest: hash(),
      }),
  );
});
test("user deletion nulls file owner, cascades personal ledgers, preserves purge and temp attempts", async () => {
  const { db, userId, policyId, blob } = await fixture();
  const [file] = await db
    .insert(files)
    .values({ ownerId: userId, blobId: blob.id, originalName: "a.png", purpose: "avatar", size: 1 })
    .returning();
  await db.insert(userAvatars).values({ userId });
  await db.insert(storageUsage).values({ userId });
  await db
    .insert(avatarMutations)
    .values({ userId, idempotencyKey: crypto.randomUUID(), requestDigest: hash() });
  const [upload] = await db
    .insert(uploadSessions)
    .values({
      ownerId: userId,
      purpose: "avatar",
      originalName: "a.png",
      expectedSha256: hash(),
      expectedSize: 1,
      partSize: 4_194_304,
      partCount: 1,
      expiresAt: new Date(Date.now() + 60_000),
      idempotencyKey: crypto.randomUUID(),
      requestDigest: hash(),
    })
    .returning();
  const [attempt] = await db
    .insert(uploadAttempts)
    .values({
      uploadId: upload!.id,
      index: 0,
      policyId,
      tempKey: `tmp/${upload!.id}/0/${crypto.randomUUID()}`,
      size: 1,
      generation: 0,
      leaseUntil: new Date(Date.now() + 60_000),
    })
    .returning();
  await db
    .insert(uploadParts)
    .values({
      uploadId: upload!.id,
      index: 0,
      size: 1,
      sha256: hash(),
      tempKey: attempt!.tempKey,
      attemptId: attempt!.id,
      leaseUntil: attempt!.leaseUntil,
    });
  const [outbox] = await db
    .insert(mediaPurgeRequests)
    .values({ outputSha256: hash(), generation: 0 })
    .returning();
  const [tombstone] = await db.insert(storageTombstones).values({ kind: "user_deleted", userId }).returning();
  await db.delete(user).where(eq(user.id, userId));
  expect((await db.select().from(files).where(eq(files.id, file!.id)))[0]?.ownerId).toBeNull();
  expect(await db.select().from(userAvatars).where(eq(userAvatars.userId, userId))).toHaveLength(0);
  expect(await db.select().from(storageUsage).where(eq(storageUsage.userId, userId))).toHaveLength(0);
  expect(await db.select().from(uploadSessions).where(eq(uploadSessions.ownerId, userId))).toHaveLength(0);
  expect(await db.select().from(avatarMutations).where(eq(avatarMutations.userId, userId))).toHaveLength(0);
  expect(await db.select().from(uploadParts).where(eq(uploadParts.uploadId, upload!.id))).toHaveLength(0);
  expect(await db.select().from(uploadAttempts).where(eq(uploadAttempts.id, attempt!.id))).toHaveLength(1);
  expect(
    await db.select().from(mediaPurgeRequests).where(eq(mediaPurgeRequests.id, outbox!.id)),
  ).toHaveLength(1);
  expect(
    await db.select().from(storageTombstones).where(eq(storageTombstones.sequence, tombstone!.sequence)),
  ).toHaveLength(1);
  await rejects(db.delete(storageTombstones).where(eq(storageTombstones.sequence, tombstone!.sequence)));
  await rejects(
    db
      .update(storageTombstones)
      .set({ kind: "file_deleted" })
      .where(eq(storageTombstones.sequence, tombstone!.sequence)),
  );
});

test("ready relationships require ready shared output and physical downgrade requires retirement", async () => {
  const { db, policyId, blob } = await fixture();
  const [object] = await db
    .insert(derivedObjects)
    .values({ outputSha256: hash(), policyId, key: crypto.randomUUID(), size: 10, mime: "image/jpeg" })
    .returning();
  await rejects(
    db
      .insert(blobDerivatives)
      .values({
        sourceBlobId: blob.id,
        recipe: "avatar-v1",
        recipeBuild: "test",
        derivedObjectId: object!.id,
        state: "ready",
      }),
  );
  const [relationship] = await db.transaction(async (tx) => {
    await tx.update(derivedObjects).set({ state: "ready" }).where(eq(derivedObjects.id, object!.id));
    return tx
      .insert(blobDerivatives)
      .values({
        sourceBlobId: blob.id,
        recipe: "avatar-v1",
        recipeBuild: "test",
        derivedObjectId: object!.id,
        state: "ready",
      })
      .returning();
  });
  await rejects(
    db.update(derivedObjects).set({ state: "deleting" }).where(eq(derivedObjects.id, object!.id)),
  );
  await rejects(
    db.insert(blobDerivatives).values({ sourceBlobId: blob.id, recipe: "avatar-v1", recipeBuild: "test" }),
    "23505",
  );
  await db.transaction(async (tx) => {
    await tx
      .update(blobDerivatives)
      .set({ state: "retired" })
      .where(eq(blobDerivatives.id, relationship!.id));
    await tx.update(derivedObjects).set({ state: "deleting" }).where(eq(derivedObjects.id, object!.id));
  });
  expect((await db.select().from(derivedObjects).where(eq(derivedObjects.id, object!.id)))[0]?.state).toBe(
    "deleting",
  );
});
test("normalized names, safe integer counters, purge generations and references are database constraints", async () => {
  const { db, userId, policyId, blob } = await fixture();
  for (const originalName of ["../a.png", "a\\b.png", "a\nb.png", "..", "x".repeat(256)]) {
    await rejects(
      db.insert(files).values({ ownerId: userId, blobId: blob.id, purpose: "avatar", size: 1, originalName }),
    );
  }
  await rejects(
    db.insert(blobs).values({ sha256: hash(), policyId, key: crypto.randomUUID(), size: 1, state: "ready" }),
  );
  await rejects(
    db
      .insert(files)
      .values({
        ownerId: userId,
        blobId: crypto.randomUUID(),
        purpose: "avatar",
        size: 1,
        originalName: "a.png",
      }),
    "23503",
  );
  await rejects(db.execute(sql`update storage_budget set temporary_written = 9007199254740992`));
  await rejects(db.execute(sql`update storage_budget set original_reserved = -1`));
  const outputSha256 = hash();
  await db.insert(mediaPurgeRequests).values({ outputSha256, generation: 3 });
  await rejects(db.insert(mediaPurgeRequests).values({ outputSha256, generation: 3 }), "23505");
  await db.insert(mediaPurgeRequests).values({ outputSha256, generation: 4 });
  await rejects(db.update(storageMaintenance).set({ ownerId: crypto.randomUUID(), leaseUntil: null }));
});
