import { beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readRestoreState,
  initializeRestoreState,
  assertNormalStorageStartup,
  closeRestoreState,
} from "./restore";
import { createRecoveryWeb } from "../../src/server/storage/recovery-web";
import { resetTestDatabase, testDbHandle } from "../../src/server/testing/test-db";
import { mediaPublications, derivedObjects, storagePolicies } from "../../src/server/db/schema";
import { eq } from "drizzle-orm";
beforeAll(resetTestDatabase, 30000);
test("missing, malformed, uninitialized state fails closed across process restart; closed recovery serves no data and only real authenticated current-generation drain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "restore-state-"));
  const { db } = testDbHandle();
  let p: string | undefined;
  try {
    await expect(assertNormalStorageStartup(dir)).rejects.toThrow("STORAGE_RESTORE_CLOSED");
    await initializeRestoreState(dir);
    await assertNormalStorageStartup(dir);
    await closeRestoreState(dir);
    await expect(assertNormalStorageStartup(dir)).rejects.toThrow("STORAGE_RESTORE_CLOSED");
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import {assertNormalStorageStartup} from './ops/backup/restore';await assertNormalStorageStartup(process.env.STORAGE_RESTORE_STATE_DIR)`,
      ],
      {
        env: { ...process.env, STORAGE_RESTORE_STATE_DIR: dir },
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    expect(await child.exited).not.toBe(0);
    const secret = "test-recovery-internal-secret-0123456789";
    const h = await createRecoveryWeb({ db, secret, stateDirectory: dir });
    for (const path of [
      "/api/auth/get-session",
      "/api/v1/profile",
      "/",
      `/media/${"a".repeat(64)}.jpg`,
    ]) {
      const r = await h.public(new Request(`http://localhost${path}`));
      expect(r.status).toBe(404);
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect(r.headers.get("set-cookie")).toBeNull();
    }
    const [policy] = await db
      .insert(storagePolicies)
      .values({
        name: crypto.randomUUID(),
        endpoint: "http://isolated.test",
        region: "us-east-1",
        originalBucket: "blobs",
        derivedBucket: "derived",
        credentialsRef: "STORAGE_MEDIA",
      })
      .returning();
    p = policy.id;
    const hash = "c".repeat(64);
    await db.insert(derivedObjects).values({
      outputSha256: hash,
      key: `sha256/cc/cc/${hash}`,
      policyId: p,
      size: 1,
      mime: "image/jpeg",
      state: "ready",
    });
    await db
      .insert(mediaPublications)
      .values({ outputSha256: hash, state: "revoking", generation: 3 });
    const request = (generation: number, path = "/internal/media/drain", auth = true) =>
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: auth ? { authorization: `Bearer ${secret}` } : {},
        body: JSON.stringify({ hash, generation }),
      });
    expect((await h.internal(request(3, "/internal/media/drain", false))).status).toBe(404);
    expect((await h.internal(request(2))).status).toBe(404);
    const ack = await h.internal(request(3));
    expect(ack.status).toBe(200);
    expect(await ack.json()).toEqual({ generation: 3, drained: true });
    expect((await h.internal(request(3, "/internal/media/resume"))).status).toBe(404);
    await writeFile(join(dir, "state.json"), "{}", { mode: 0o600 });
    await expect(readRestoreState(dir)).rejects.toThrow("STORAGE_RESTORE_CLOSED");
  } finally {
    if (p) {
      await db.delete(mediaPublications).where(eq(mediaPublications.outputSha256, "c".repeat(64)));
      await db.delete(derivedObjects).where(eq(derivedObjects.policyId, p));
      await db.delete(storagePolicies).where(eq(storagePolicies.id, p));
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("owner lock blocks concurrent restore/init/normal boot and never unlinks a replacement inode", async () => {
  const { restoreOriginals } = await import("./restore");
  const { rename, lstat } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "restore-owner-"));
  await initializeRestoreState(dir);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const options = {
    stateDirectory: dir,
    bundleDirectory: join(dir, "absent-bundle"),
    journal: { directory: join(dir, "journal"), keyFile: join(dir, "key"), databaseUrl: "unused" },
    databaseUrl: "unused",
    stopAndConfirmNormal: async () => {
      entered();
      await held;
    },
    replaceDatabases: async () => {},
    restoreOriginals: async () => {},
    rebuild: async () => {},
    startRecovery: async () => {
      throw new Error("must not start");
    },
    revoke: async () => {},
    verifyInvariants: async () => {},
  };
  const first = restoreOriginals(options).catch((e) => e);
  try {
    await started;
    expect((await lstat(join(dir, ".restore.lock"))).mode & 0o777).toBe(0o600);
    await expect(restoreOriginals(options)).rejects.toThrow();
    await expect(initializeRestoreState(dir)).rejects.toThrow();
    await expect(assertNormalStorageStartup(dir)).rejects.toThrow();
    await rename(join(dir, ".restore.lock"), join(dir, "old.lock"));
    const replacement = JSON.stringify({
      version: 1,
      nonce: crypto.randomUUID(),
      restoreId: crypto.randomUUID(),
    });
    await writeFile(join(dir, ".restore.lock"), replacement, { mode: 0o600 });
    release();
    expect(await first).toBeInstanceOf(Error);
    expect(await readFile(join(dir, ".restore.lock"), "utf8")).toBe(replacement);
    expect((await readRestoreState(dir)).state).toBe("closed");
  } finally {
    release();
    await first;
    await rm(dir, { recursive: true, force: true });
  }
});

test("real setAvatar same-hash replacement and removal facts clear only older exact associations, retaining shared and newer revisions", async () => {
  const { Client } = await import("pg");
  const { readyContext, readyOwner, readyFile } = await import("../../test/storage/ready-file");
  const { setAvatar } = await import("../../src/server/storage/avatars");
  const { replayJournal } = await import("./restore");
  const { user, userAvatars, storageTombstones } = await import("../../src/server/db/schema");
  const { ctx, policy } = await readyContext();
  // user IDs are text, not an assumed UUID namespace.
  const removed = "restore-removal-text-" + crypto.randomUUID();
  await ctx.db
    .insert(user)
    .values({ id: removed, name: "test", email: removed + "@placeholder.invalid" });
  const shared = await readyOwner(ctx),
    newer = await readyOwner(ctx);
  const a = await readyFile(ctx, policy.id, removed),
    b = await readyFile(ctx, policy.id, shared, a.derived),
    replacement = await readyFile(ctx, policy.id, removed, a.derived),
    n = await readyFile(ctx, policy.id, newer, a.derived);
  for (const [id, f] of [
    [removed, a],
    [shared, b],
    [newer, n],
  ] as const)
    await setAvatar(ctx, id, { fileId: f.file.id, expectedRevision: 0 }, crypto.randomUUID());
  await setAvatar(
    ctx,
    removed,
    { fileId: replacement.file.id, expectedRevision: 1 },
    crypto.randomUUID(),
  );
  await setAvatar(ctx, removed, { fileId: null, expectedRevision: 2 }, crypto.randomUUID());
  await setAvatar(ctx, newer, { fileId: null, expectedRevision: 1 }, crypto.randomUUID());
  await setAvatar(ctx, newer, { fileId: n.file.id, expectedRevision: 2 }, crypto.randomUUID());
  const rows = await ctx.db
    .select()
    .from(storageTombstones)
    .where(eq(storageTombstones.sha256, a.derived.outputSha256))
    .orderBy(storageTombstones.sequence);
  expect(rows.filter((r) => r.userId === removed).map((r) => [r.fileId, r.generation])).toEqual([
    [a.file.id, 2],
    [replacement.file.id, 3],
  ]);
  expect(rows.filter((r) => r.userId === null)).toHaveLength(0);
  const records = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  try {
    // Restore this account's snapshot association; the other account is a genuinely newer revision 3.
    await ctx.db
      .update(userAvatars)
      .set({ fileId: a.file.id, derivativeId: a.recipe.id, revision: 1 })
      .where(eq(userAvatars.userId, removed));
    await ctx.db
      .update(user)
      .set({ image: `/media/${a.derived.outputSha256}.jpg` })
      .where(eq(user.id, removed));
    expect(
      await replayJournal(c, records, {
        sequence: rows.at(-1)!.sequence,
        hash: "a".repeat(64),
        capturedAt: new Date().toISOString(),
      }),
    ).toEqual([]);
    const associations = await ctx.db.select().from(userAvatars);
    const old = associations.find((r) => r.userId === removed)!;
    expect([old.fileId, old.derivativeId, old.revision]).toEqual([null, null, 2]);
    expect((await ctx.db.select().from(user).where(eq(user.id, removed)))[0].image).toBeNull();
    expect(associations.find((r) => r.userId === shared)!.fileId).toBe(b.file.id);
    expect(associations.find((r) => r.userId === newer)!.revision).toBe(3);
    expect((await ctx.db.select().from(user).where(eq(user.id, newer)))[0].image).toBe(
      `/media/${a.derived.outputSha256}.jpg`,
    );
    expect(
      (
        await ctx.db
          .select()
          .from(mediaPublications)
          .where(eq(mediaPublications.outputSha256, a.derived.outputSha256))
      )[0].state,
    ).toBe("public");
    // Malformed mixed variant must reject without committing replay.
    await expect(
      replayJournal(c, [{ ...records[0], fileId: null }], {
        sequence: rows.at(-1)!.sequence,
        hash: "b".repeat(64),
        capturedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow("STORAGE_JOURNAL_INVALID");
  } finally {
    await c.end();
    const { cleanupStorageFixture, storageFixtureConfig } = await import(
      "../../test/storage/fixture"
    );
    const { createS3Driver } = await import("../../src/server/storage/s3");
    await cleanupStorageFixture(
      ctx.db,
      [removed, shared, newer],
      [policy.id],
      process.env.STORAGE_TEST_FIXTURE_PATH
        ? createS3Driver(await storageFixtureConfig("control"))
        : undefined,
      true,
    );
  }
});
