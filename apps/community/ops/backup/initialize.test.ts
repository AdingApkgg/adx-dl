import { beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resetTestDatabase, testDbHandle } from "../../src/server/testing/test-db";
import { blobs, storagePolicies } from "../../src/server/db/schema";
import { storageFixtureConfig } from "../../test/storage/fixture";
import { initializeStorageState } from "./initialize";
import { readRestoreState } from "./restore";

beforeAll(resetTestDatabase, 30000);

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "storage-initialize-test-"));
  const config = await storageFixtureConfig("backup");
  const values = {
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    PUBLIC_ORIGIN: config.publicOrigin,
    STORAGE_S3_ENDPOINT: config.endpoint,
    STORAGE_RECIPE_BUILD: config.recipeBuild,
    STORAGE_TEMP_DIR: config.tempDir,
    STORAGE_CAPACITY_DIR: config.tempDir,
    STORAGE_BACKUP_ACCESS_KEY_ID: config.accessKeyId,
    STORAGE_BACKUP_SECRET_ACCESS_KEY: config.secretAccessKey,
    STORAGE_RESTORE_STATE_DIR: join(directory, "state"),
    STORAGE_JOURNAL_DIR: join(directory, "journal"),
    STORAGE_JOURNAL_KEY_FILE: join(directory, "key", "journal.key"),
    STORAGE_STAGING_DIR: join(directory, "stage"),
    STORAGE_BUNDLE_ROOT: join(directory, "bundles"),
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    await run(directory);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

test("fresh explicit initialization registers web/media policies before opening and keeps secrets outside rows", async () => {
  await fixture(async (directory) => {
    await initializeStorageState();
    const rows = await testDbHandle().db.select().from(storagePolicies);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.credentialsRef).sort()).toEqual(["STORAGE_MEDIA", "STORAGE_WEB"]);
    expect(rows.find((row) => row.credentialsRef === "STORAGE_WEB")).toMatchObject({
      endpoint: process.env.STORAGE_S3_ENDPOINT,
      region: "us-east-1",
      originalBucket: "blobs",
      derivedBucket: "derived",
      credentialsRef: "STORAGE_WEB",
      enabled: true,
    });
    expect(JSON.stringify(rows)).not.toContain(process.env.STORAGE_BACKUP_SECRET_ACCESS_KEY!);
    expect((await readRestoreState(join(directory, "state"))).state).toBe("open");
    await expect(initializeStorageState()).rejects.toThrow(
      "STORAGE_INITIALIZATION_REQUIRES_EMPTY_STATE",
    );
  });
});

test("existing mismatched or disabled policy cannot be silently adopted and restore state stays unopened", async () => {
  const { db } = testDbHandle();
  const [policy] = await db.select().from(storagePolicies);
  expect(policy).toBeDefined();
  try {
    for (const patch of [{ endpoint: "http://foreign.invalid:8333" }, { enabled: false }]) {
      await db
        .update(storagePolicies)
        .set({ endpoint: policy.endpoint, enabled: true, ...patch })
        .where(eq(storagePolicies.id, policy.id));
      await fixture(async (directory) => {
        await expect(initializeStorageState()).rejects.toThrow("STORAGE_INITIAL_POLICY_CONFLICT");
        await expect(readRestoreState(join(directory, "state"))).rejects.toThrow();
      });
    }
  } finally {
    await db.delete(storagePolicies);
  }
});

test("first-install initializer refuses an already used storage database even with empty external state", async () => {
  const { db } = testDbHandle();
  await fixture(async () => {
    await initializeStorageState();
  });
  const [policy] = await db.select().from(storagePolicies);
  const sha256 = "c".repeat(64);
  const [blob] = await db
    .insert(blobs)
    .values({
      policyId: policy.id,
      sha256,
      key: `sha256/cc/cc/${sha256}`,
      size: 1,
      state: "pending",
    })
    .returning();
  try {
    await fixture(async (directory) => {
      await expect(initializeStorageState()).rejects.toThrow(
        "STORAGE_INITIALIZATION_REQUIRES_UNUSED_DATABASE",
      );
      await expect(readRestoreState(join(directory, "state"))).rejects.toThrow();
    });
    expect((await db.select().from(blobs))[0]).toEqual(blob);
  } finally {
    await db.delete(blobs).where(eq(blobs.id, blob.id));
    await db.delete(storagePolicies);
  }
});
