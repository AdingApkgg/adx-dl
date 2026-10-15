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
  const removed = `restore-removal-text-${crypto.randomUUID()}`;
  await ctx.db
    .insert(user)
    .values({ id: removed, name: "test", email: `${removed}@placeholder.invalid` });
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
  const records = rows.map((r) => ({ ...r, payload: r.payload ?? undefined, createdAt: r.createdAt.toISOString() }));
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


test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)("restore intrinsically settles native drift and current restored outboxes through real canonical HTTP/drain; no-op or incomplete evidence cannot open", async () => {
  const { mkdir, chmod } = await import("node:fs/promises");
  const { readyContext, readyOwner, readyFile, digest } = await import("../../test/storage/ready-file");
  const { storageFixtureConfig, cleanupStorageFixture } = await import("../../test/storage/fixture");
  const { createS3Driver } = await import("../../src/server/storage/s3");
  const { objectKey } = await import("../../src/server/storage/keys");
  const { RECIPE_BUILD } = await import("../../src/media-worker/image-child");
  const { rebuildDerivedIntent } = await import("../../src/server/storage/backup");
  const { requestMissingDerivedRebuild, readDerivedRebuildIntents } = await import("../../src/worker/storage-reconcile");
  const { revokeMedia } = await import("../../src/worker/media-purge");
  const { restoreOriginals } = await import("./restore");
  const { initializeJournal, exportJournal } = await import("./journal");
  const { readOriginalManifest, fileDigest } = await import("./export");
  const { blobs, blobDerivatives, mediaPurgeRequests, storageBudget, user, storageTombstones } = await import("../../src/server/db/schema");
  const { sql } = await import("drizzle-orm");
  const dir = await mkdtemp(join(tmpdir(), "restore-drift-"));
  const { ctx, policy } = await readyContext();
  await ctx.boss();
  const owner = await readyOwner(ctx), f = await readyFile(ctx, policy.id, owner);
  const config = { ...(await storageFixtureConfig("media")), recipeBuild: RECIPE_BUILD };
  const media = { ...ctx, config, driver: createS3Driver(config) };
  const controlDriver = createS3Driver(await storageFixtureConfig("control"));
  const source = await readFile(new URL("../../test/storage/images/safe.png", import.meta.url));
  const sourceHash = digest(source), sourceKey = objectKey(sourceHash);
  const restoredHash = "b".repeat(64);
  let publicServer: ReturnType<typeof Bun.serve> | undefined, internalServer: ReturnType<typeof Bun.serve> | undefined;
  const cf = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (r) => {
    expect(r.method).toBe("POST");
    const body = await r.json() as { files: string[] };
    expect(body.files).toHaveLength(1);
    return Response.json({ success: true, errors: [] });
  } });
  try {
    await controlDriver.delete({ bucket: "original", key: f.blob.key });
    await controlDriver.delete({ bucket: "derived", key: f.derived.key });
    await media.driver.put({ bucket: "original", key: sourceKey, body: new Blob([source]).stream(), size: source.length, mime: "image/png", sha256: sourceHash });
    await ctx.db.update(blobs).set({ sha256: sourceHash, key: sourceKey, size: source.length }).where(eq(blobs.id, f.blob.id));
    await ctx.db.update(storageBudget).set({ originalWritten: sql`${storageBudget.originalWritten}+${source.length-f.original.length}` });
    await ctx.db.update(blobDerivatives).set({ recipeBuild: RECIPE_BUILD }).where(eq(blobDerivatives.id, f.recipe.id));
    await ctx.db.update(user).set({ image: `/media/${f.derived.outputSha256}.jpg` }).where(eq(user.id, owner));
    const { userAvatars } = await import("../../src/server/db/schema");
    await ctx.db.insert(userAvatars).values({ userId: owner, fileId: f.file.id, derivativeId: f.recipe.id });
    await ctx.db.insert(derivedObjects).values({ outputSha256: restoredHash, key: objectKey(restoredHash), policyId: policy.id, size: 1, mime: "image/jpeg", state: "ready" });
    await ctx.db.insert(mediaPublications).values([
      { outputSha256: f.derived.outputSha256, state: "public", generation: 3 },
      { outputSha256: restoredHash, state: "blocked", generation: 8 },
    ]);
    await ctx.db.insert(mediaPurgeRequests).values({ outputSha256: restoredHash, generation: 8 });
    const pool = testDbHandle().pool;
    await pool.query("update storage_journal_progress set exported_sequence=0,chain_hash=null,exported_at=null where id='global'");
    const journal = { directory: join(dir, "journal"), keyFile: join(dir, "key"), databaseUrl: process.env.TEST_DATABASE_URL! };
    await writeFile(journal.keyFile, crypto.getRandomValues(new Uint8Array(32)), { mode: 0o600 });
    await initializeJournal(journal);
    const head = await exportJournal(journal);
    const bundle = join(dir, "bundle");
    await mkdir(join(bundle, "originals"), { recursive: true });
    await writeFile(join(bundle, "originals", sourceHash), source, { mode: 0o400 });
    // Focused orchestration fixture: real restored PG rows/S3 bytes already prepared above. These are hash-checked dump placeholders, not pg_restore proof.
    for (const name of ["community", "umami"]) await writeFile(join(bundle, `${name}.dump`), name, { mode: 0o400 });
    const originals = (await readOriginalManifest(pool as never)).filter((e) => e.id === f.blob.id);
    expect(originals).toHaveLength(1);
    await writeFile(join(bundle, "manifest.json"), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), journal: head, originals, dumps: {
      community: await fileDigest(join(bundle, "community.dump")), umami: await fileDigest(join(bundle, "umami.dump")),
    } }), { mode: 0o400 });
    const secret = "test-restore-drift-internal-secret-0123456789";
    let control = { ...ctx, config: { ...(await storageFixtureConfig("control")), internalMediaSecret: secret }, driver: controlDriver };
    const revoked: { hash: string; generation: number }[] = [];
    const options = {
      bundleDirectory: bundle, journal, databaseUrl: process.env.TEST_DATABASE_URL!,
      stopAndConfirmNormal: async () => {}, // No normal processes were started in this isolated fixture.
      replaceDatabases: async () => {}, // Prepared real PG restored-state fixture; no fake pg_restore acceptance.
      restoreOriginals: async () => { expect(digest(await new Response((await media.driver.get({ bucket: "original", key: sourceKey })).body).bytes())).toBe(sourceHash); },
      rebuild: async () => {
        const [current] = await ctx.db.select().from(derivedObjects).where(eq(derivedObjects.id, f.derived.id));
        if (await requestMissingDerivedRebuild(media, { id: current.id, generation: current.generation })) {
          const intent = (await readDerivedRebuildIntents(media)).find((i) => i.id === current.id);
          if (intent) expect(await rebuildDerivedIntent(media, intent)).toBe(true);
        }
      },
      startRecovery: async () => {
        const h = await createRecoveryWeb({ db: ctx.db, secret, stateDirectory: activeState });
        publicServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: h.public });
        internalServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: h.internal });
        control = { ...control, config: { ...control.config, publicOrigin: publicServer.url.origin } };
        return { stopAndConfirm: async () => { await publicServer!.stop(true); await internalServer!.stop(true); } };
      },
      verifyInvariants: async () => {}, // Intrinsic durable purge gate must not depend on this callback.
    };
    let activeState = join(dir, "noop-state");
    await initializeRestoreState(activeState);
    await expect(restoreOriginals({ ...options, stateDirectory: activeState, revoke: async () => {} })).rejects.toThrow("STORAGE_RESTORE_CLOSED");
    expect((await readRestoreState(activeState)).state).toBe("closed");
    expect(await readFile(join(activeState, ".restore.lock"), "utf8")).toContain("restoreId");
    const driftPub = (await ctx.db.select().from(mediaPublications).where(eq(mediaPublications.outputSha256, f.derived.outputSha256)))[0];
    expect(driftPub).toMatchObject({ state: "revoking", generation: 4 });
    expect((await ctx.db.select().from(user).where(eq(user.id, owner)))[0].image).not.toBe(`/media/${f.derived.outputSha256}.jpg`);
    expect(await ctx.db.select().from(storageTombstones).where(eq(storageTombstones.sha256, f.derived.outputSha256))).toHaveLength(2);
    // Even forged terminal flags without the existing strict evidence are insufficient.
    activeState = join(dir, "incomplete-state");
    await initializeRestoreState(activeState);
    await expect(restoreOriginals({ ...options, stateDirectory: activeState, revoke: async (data) => {
      await pool.query("update media_purge_requests set state='done' where output_sha256=$1 and generation=$2", [data.hash, data.generation]);
      await pool.query("update media_publications set state=case when state='blocked' then 'blocked' else 'private' end where output_sha256=$1", [data.hash]);
    } })).rejects.toThrow("STORAGE_RESTORE_CLOSED");
    expect((await readRestoreState(activeState)).state).toBe("closed");
    // Reset only this injected evidence-corruption fixture before invoking the real strict protocol.
    await pool.query("update media_purge_requests set state='pending' where output_sha256=any($1::text[])", [[f.derived.outputSha256, restoredHash]]);
    await pool.query("update media_publications set state='revoking' where output_sha256=$1", [f.derived.outputSha256]);
    activeState = join(dir, "strict-state");
    await initializeRestoreState(activeState);
    await restoreOriginals({ ...options, stateDirectory: activeState, revoke: async (data) => {
      revoked.push(data);
      await revokeMedia(control, data, { fetch: (url, init) => fetch(url.startsWith("https://api.cloudflare.com/") ? cf.url.href : url, init), sleep: (ms) => Bun.sleep(Math.ceil(ms) + 1), now: () => performance.now(), drainUrl: `${internalServer!.url.origin}/internal/media/drain` });
    } });
    expect((await readRestoreState(activeState)).state).toBe("open");
    await assertNormalStorageStartup(activeState);
    for (const hash of [f.derived.outputSha256, restoredHash]) {
      const current = (await ctx.db.select().from(mediaPublications).where(eq(mediaPublications.outputSha256, hash)))[0];
      expect(revoked).toContainEqual({ hash, generation: current.generation });
    }
    for (const data of revoked) {
      const request = (await ctx.db.select().from(mediaPurgeRequests).where(eq(mediaPurgeRequests.outputSha256, data.hash))).find((r) => r.generation === data.generation)!;
      expect(request.state).toBe("done"); expect(request.evidence!.drain!.generation).toBe(data.generation);
      expect(request.evidence!.purges).toHaveLength(2); expect(request.evidence!.probes).toHaveLength(2);
      expect(request.evidence!.purges[1].elapsedMs-request.evidence!.purges[0].elapsedMs).toBeGreaterThanOrEqual(5000);
      expect(request.evidence!.probes[1].elapsedMs-request.evidence!.probes[0].elapsedMs).toBeGreaterThanOrEqual(5000);
      expect(request.evidence!.probes.every((p) => p.status===404 && p.cacheStatus!=="HIT")).toBe(true);
    }
    expect((await ctx.db.select().from(mediaPublications).where(eq(mediaPublications.outputSha256, restoredHash)))[0].state).toBe("blocked");
  } finally {
    await publicServer?.stop(true); await internalServer?.stop(true); await cf.stop(true);
    await ctx.db.delete(mediaPurgeRequests).where(eq(mediaPurgeRequests.outputSha256, restoredHash));
    await ctx.db.delete(mediaPublications).where(eq(mediaPublications.outputSha256, restoredHash));
    await cleanupStorageFixture(ctx.db, [owner], [policy.id], controlDriver, true);
    await chmod(dir, 0o700); await rm(dir, { recursive: true, force: true });
  }
}, 60000);
