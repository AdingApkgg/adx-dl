import { readFile, mkdir } from "node:fs/promises";
import { parseStorageEnv } from "../../src/server/storage/env";
import type { StorageConfig, StorageRole } from "../../src/server/storage/contracts";
/** External, opt-in isolated credentials; never depend on ignored source modules. */
export async function storageFixtureConfig(role: StorageRole = "web"): Promise<StorageConfig> {
  let access = process.env[`STORAGE_TEST_${role.toUpperCase()}_ACCESS_KEY_ID`];
  let secret = process.env[`STORAGE_TEST_${role.toUpperCase()}_SECRET_ACCESS_KEY`];
  if (process.env.STORAGE_TEST_FIXTURE_PATH) {
    const fixture = JSON.parse(await readFile(process.env.STORAGE_TEST_FIXTURE_PATH, "utf8"));
    const identity = fixture.identities.find(
      (item: { name: string }) => item.name === `community-test-${role}`,
    );
    access = identity?.credentials[0]?.accessKey;
    secret = identity?.credentials[0]?.secretKey;
  }
  const tempDir = "/tmp/community-storage-test";
  await mkdir(tempDir, { recursive: true });
  return parseStorageEnv(
    {
      PUBLIC_ORIGIN: "https://community.example.test",
      STORAGE_S3_ENDPOINT: process.env.STORAGE_TEST_ENDPOINT ?? "http://127.0.0.1:58333",
      STORAGE_TEMP_DIR: tempDir,
      STORAGE_RECIPE_BUILD: "test-v1",
      [`STORAGE_${role.toUpperCase()}_ACCESS_KEY_ID`]: access ?? "isolated-test",
      [`STORAGE_${role.toUpperCase()}_SECRET_ACCESS_KEY`]: secret ?? "isolated-test",
      STORAGE_INTERNAL_MEDIA_SECRET: "test-internal-secret-0123456789abcdef",
      STORAGE_INTERNAL_MEDIA_URL: "http://web:3001",
      CLOUDFLARE_ZONE_ID: "0".repeat(32),
      CLOUDFLARE_PURGE_TOKEN: "isolated-test-control-token",
    },
    role,
  );
}

/** Remove only this fixture's rows/keys and charges; shared test DB resets once per process. */
export async function cleanupStorageFixture(
  db: import("../../src/server/db/client").Db,
  owners: string[],
  policies: string[],
  driver?: import("../../src/server/storage/contracts").ObjectDriver,
  originalAccounting = false,
): Promise<void> {
  if (!owners.length) return;
  const { inArray, eq, sql } = await import("drizzle-orm");
  const {
    user,
    files,
    blobs,
    blobDerivatives,
    derivedObjects,
    blobBlocks,
    uploadSessions,
    userAvatars, mediaPublications, mediaPurgeRequests,
    uploadAttempts,
    storagePolicies,
    storageBudget,
  } = await import("../../src/server/db/schema");
  const sessions = await db
    .select({ id: uploadSessions.id })
    .from(uploadSessions)
    .where(inArray(uploadSessions.ownerId, owners));
  const ids = sessions.map((row) => row.id);
  const attempts = ids.length
    ? await db.select().from(uploadAttempts).where(inArray(uploadAttempts.uploadId, ids))
    : [];
  const originals =
    originalAccounting && policies.length
      ? await db.select().from(blobs).where(inArray(blobs.policyId, policies))
      : [];
  const derivatives = originalAccounting && policies.length
    ? await db.select().from(derivedObjects).where(inArray(derivedObjects.policyId, policies)) : [];
  if (driver) for (const output of derivatives) await driver.delete({bucket:"derived",key:output.key});
  if (driver)
    for (const original of originals)
      await driver.delete({ bucket: "original", key: original.key });
  if (driver)
    for (const attempt of attempts)
      await driver.delete({ bucket: "original", key: attempt.tempKey });
  await db.transaction(async (tx) => {
    await tx.select().from(storageBudget).where(eq(storageBudget.id, "global")).for("update");
    const ownFiles = await tx
      .select({ blobId: files.blobId, sha256: blobs.sha256 })
      .from(files)
      .innerJoin(blobs, eq(files.blobId, blobs.id))
      .where(inArray(files.ownerId, owners));
    for (const id of ids)
      await tx.execute(sql`delete from pgboss.job where data->>'uploadId'=${id}`);
    await tx.delete(uploadSessions).where(inArray(uploadSessions.ownerId, owners));
    await tx.delete(userAvatars).where(inArray(userAvatars.userId, owners));
    if(derivatives.length) {
      const hashes=derivatives.map(b=>b.outputSha256);
      for(const hash of hashes) await tx.execute(sql`delete from pgboss.job where name='media.purge' and data->>'hash'=${hash}`);
      await tx.delete(mediaPurgeRequests).where(inArray(mediaPurgeRequests.outputSha256,hashes));
      await tx.delete(mediaPublications).where(inArray(mediaPublications.outputSha256,hashes));
    }
    await tx.delete(files).where(inArray(files.ownerId, owners));
    if (ids.length) await tx.delete(uploadAttempts).where(inArray(uploadAttempts.uploadId, ids));
    if (originals.length) await tx.delete(blobDerivatives).where(inArray(blobDerivatives.sourceBlobId,originals.map(b=>b.id)));
    if (derivatives.length) await tx.delete(derivedObjects).where(inArray(derivedObjects.id,derivatives.map(b=>b.id)));
    if (ownFiles.length) {
      await tx.delete(blobBlocks).where(
        inArray(
          blobBlocks.sha256,
          ownFiles.map((row) => row.sha256),
        ),
      );
      await tx.delete(blobs).where(
        inArray(
          blobs.id,
          ownFiles.map((row) => row.blobId),
        ),
      );
    }
    if (originals.length)
      await tx.delete(blobs).where(
        inArray(
          blobs.id,
          originals.map((b) => b.id),
        ),
      );
    await tx.delete(user).where(inArray(user.id, owners));
    if (policies.length)
      await tx.delete(storagePolicies).where(inArray(storagePolicies.id, policies));
    const reserved = attempts.reduce((n, row) => n + row.reservedBytes, 0);
    const written = attempts.reduce((n, row) => n + row.writtenBytes, 0);
    await tx
      .update(storageBudget)
      .set({
        derivedReserved: sql`${storageBudget.derivedReserved}-${derivatives.filter(b=>b.state === "pending" && b.leaseUntil !== null).reduce((n,b)=>n+b.size,0)}`,
        derivedWritten: sql`${storageBudget.derivedWritten}-${derivatives.filter(b=>b.state === "ready").reduce((n,b)=>n+b.size,0)}`,
        temporaryReserved: sql`${storageBudget.temporaryReserved}-${reserved}`,
        originalReserved: sql`${storageBudget.originalReserved}-${originals.filter((b) => b.state === "pending" && b.leaseUntil !== null).reduce((n, b) => n + b.size, 0)}`,
        originalWritten: sql`${storageBudget.originalWritten}-${originals.filter((b) => b.state === "ready").reduce((n, b) => n + b.size, 0)}`,
        temporaryWritten: sql`${storageBudget.temporaryWritten}-${written}`,
      })
      .where(eq(storageBudget.id, "global"));
  });
}
