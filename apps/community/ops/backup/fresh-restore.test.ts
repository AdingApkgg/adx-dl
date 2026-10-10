import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile, rename, stat, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { eq } from "drizzle-orm";
import { ingestFixture } from "../../test/storage/ingest-fixture";
import { storageFixtureConfig } from "../../test/storage/fixture";
import { createDb } from "../../src/server/db/client";
import { testSender } from "../../src/server/testing/test-boss";
import { resetTestDatabase, testDbHandle } from "../../src/server/testing/test-db";
import { createS3Driver } from "../../src/server/storage/s3";
import { completeUpload, initUpload } from "../../src/server/storage/uploads";
import { ingestUpload } from "../../src/media-worker/ingest";
import { deriveAvatar } from "../../src/media-worker/avatar";
import { finalizeUpload } from "../../src/media-worker/finalize";
import { RECIPE_BUILD } from "../../src/media-worker/image-child";
import { setAvatar } from "../../src/server/storage/avatars";
import { createMediaDrain } from "../../src/server/storage/drain";
import { createPublicMediaHandler } from "../../src/server/storage/public-media";
import { resolvePrivateFile } from "../../src/server/storage/files";
import { createDeletionHandlers } from "../../src/server/storage/deletion";
import { requestDeletion, purgeUser } from "../../src/server/services/user-deletion";
import {
  derivedObjects,
  user,
  uploadSessions,
  storageUsage,
  storageBudget,
  mediaPublications,
  mediaPurgeRequests,
  profiles,
  blobBlocks,
  storageTombstones,
  userAvatars,
} from "../../src/server/db/schema";
import type { StorageContext } from "../../src/server/storage/contracts";
import {
  requestMissingDerivedRebuild,
  readDerivedRebuildIntents,
} from "../../src/worker/storage-reconcile";
import { rebuildDerivedIntent } from "../../src/server/storage/backup";
import { revokeMedia } from "../../src/worker/media-purge";
import { backupOriginals, runBoundedCommand, databaseCommandEnv } from "./export";
import { initializeJournal, exportJournal } from "./journal";
import {
  initializeRestoreState,
  readRestoreState,
  assertNormalStorageStartup,
  restoreOriginals,
  restoreVerifiedOriginals,
} from "./restore";
import { createRecoveryWeb } from "../../src/server/storage/recovery-web";
import { withStorageTransaction } from "../../src/server/storage/transactions";
import { createStorageIOTracker } from "../../src/server/storage/maintenance";

test.skipIf(!process.env.STORAGE_TEST_FRESH_RESTORE)(
  "actual Linux PG/restic/S3/native full snapshot, post-snapshot deletion, fresh-volume fail-closed restore",
  async () => {
    const root = "/proof",
      stateDirectory = join(root, "state"),
      journal = {
        directory: join(root, "journal"),
        keyFile: join(root, "journal-key"),
        databaseUrl: process.env.TEST_DATABASE_URL!,
      };
    await resetTestDatabase();
    await testSender();
    await mkdir(root, { recursive: true });
    for (const p of ["stage", "bundle", "repository", "state", "journal"])
      await mkdir(join(root, p), { recursive: true, mode: 0o700 });
    await writeFile(journal.keyFile, crypto.getRandomValues(new Uint8Array(32)), { mode: 0o600 });
    await initializeJournal(journal);
    await initializeRestoreState(stateDirectory);
    const f = await ingestFixture();
    const sourceWeb = { ...f.ctx, config: { ...f.ctx.config, recipeBuild: RECIPE_BUILD } };
    const sourceMedia = {
      ...f.mediaCtx,
      config: { ...f.mediaCtx.config, recipeBuild: RECIPE_BUILD },
    };
    const sourceControlConfig = {
      ...(await storageFixtureConfig("control")),
      recipeBuild: RECIPE_BUILD,
    };
    const sourceControl = {
      ...f.ctx,
      config: sourceControlConfig,
      driver: createS3Driver(sourceControlConfig),
    };
    const good = await f.upload(await readFile("/fixtures/safe.png")),
      deleted = await f.upload(await readFile("/fixtures/safe.jpeg")),
      removed = await f.upload(await readFile("/fixtures/oriented.jpg")),
      blocked = await f.upload(await readFile("/fixtures/own-cmyk.jpg")),
      sharedRemoved = await f.upload(await readFile("/fixtures/safe.png"));
    for (const u of [good, deleted, removed, blocked, sharedRemoved]) {
      await completeUpload(sourceWeb, u.userId, u.dto.id);
      await ingestUpload(sourceMedia, u.data);
      await deriveAvatar(sourceMedia, u.data);
      await finalizeUpload(sourceMedia, u.data);
      const [s] = await f.ctx.db
        .select()
        .from(uploadSessions)
        .where(eq(uploadSessions.id, u.dto.id));
      await setAvatar(
        sourceWeb,
        u.userId,
        { fileId: s.fileId!, expectedRevision: 0 },
        crypto.randomUUID(),
      );
      await f.ctx.db.insert(profiles).values({ userId: u.userId, bio: "fresh restore fixture" });
    }
    const deletedFileId = (
      await f.ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, deleted.dto.id))
    )[0].fileId!;
    const tmp = await initUpload(
      sourceWeb,
      good.userId,
      { purpose: "avatar", name: "unbacked.png", size: 9, sha256: "a".repeat(64) },
      crypto.randomUUID(),
    );
    const selected = await f.ctx.db.select().from(user);
    const goodImage = selected.find((u) => u.id === good.userId)!.image!,
      deletedImage = selected.find((u) => u.id === deleted.userId)!.image!,
      removedImage = selected.find((u) => u.id === removed.userId)!.image!,
      blockedImage = selected.find((u) => u.id === blocked.userId)!.image!;
    expect(new Set([goodImage, deletedImage, removedImage, blockedImage]).size).toBe(4);
    expect(goodImage).not.toBe(deletedImage);
    const drain = createMediaDrain({
      db: f.ctx.db,
      secret: "fresh-volume-recovery-secret-0123456789",
    });
    const normalHandler = createPublicMediaHandler(sourceWeb, drain);
    let normal = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => normalHandler(r) });
    const origin = normal.url.origin,
      publicPort = normal.port;
    const before = await fetch(origin + goodImage);
    expect(before.status).toBe(200);
    await before.arrayBuffer();
    const umamiUrl = new URL(journal.databaseUrl);
    umamiUrl.pathname = "/community_storage_umami_test";
    const admin = new Client({ connectionString: journal.databaseUrl });
    await admin.connect();
    await admin.query("drop database if exists community_storage_umami_test");
    await admin.query("create database community_storage_umami_test");
    await admin.end();
    const umami = new Client({ connectionString: umamiUrl.href });
    await umami.connect();
    await umami.query(
      "create table measured_events(id integer primary key);insert into measured_events values(1)",
    );
    await umami.end();
    process.env.RESTIC_REPOSITORY = join(root, "repository");
    process.env.RESTIC_PASSWORD = "isolated-restic-fixture-password";
    await runBoundedCommand(["restic", "init"], AbortSignal.timeout(30000));
    const backupConfig = { ...(await storageFixtureConfig("backup")), recipeBuild: RECIPE_BUILD };
    const backupCtx = { ...sourceWeb, config: backupConfig, driver: createS3Driver(backupConfig) };
    const tracker = createStorageIOTracker();
    console.log("proof: source prepared; actual full backup");
    const manifest = await backupOriginals(backupCtx, {
      databaseUrl: journal.databaseUrl,
      umamiDatabaseUrl: umamiUrl.href,
      stagingDirectory: join(root, "stage"),
      bundleDirectory: join(root, "bundle"),
      repositoryDirectory: join(root, "repository"),
      journal,
      dumpBounds: { community: 16 * 1024 * 1024, umami: 16 * 1024 * 1024 },
      coordinator: () => ({
        drain: (_lease, signal) => tracker.pauseAndDrain(signal),
        resume: async () => tracker.resume(),
      }),
    });
    expect(manifest.originals).toHaveLength(4);
    expect(manifest.dumps.community.size).toBeGreaterThan(1000);
    expect(manifest.dumps.umami.size).toBeGreaterThan(1000);
    const snapshots = Bun.spawn(["restic", "snapshots", "--json"], {
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const snapshotText = await new Response(snapshots.stdout).text();
    const snapshotError = await new Response(snapshots.stderr).text();
    await writeFile(join(root, "snapshots-error.log"), snapshotError, { mode: 0o600 });
    expect(await snapshots.exited).toBe(0);
    const snapshotList = JSON.parse(snapshotText);
    expect(snapshotList).toHaveLength(1);
    expect(snapshotList[0].tags).toContain("community-full");
    await runBoundedCommand(
      ["restic", "restore", "latest", "--target", join(root, "restic-restore")],
      AbortSignal.timeout(30000),
    );
    const restoredBundle = join(root, "restic-restore", "proof", "bundle");
    await setAvatar(
      sourceWeb,
      removed.userId,
      { fileId: null, expectedRevision: 1 },
      crypto.randomUUID(),
    );
    await setAvatar(
      sourceWeb,
      sharedRemoved.userId,
      { fileId: null, expectedRevision: 1 },
      crypto.randomUUID(),
    );
    expect(
      (
        await f.ctx.db
          .select()
          .from(mediaPublications)
          .where(eq(mediaPublications.outputSha256, goodImage.slice(7, -4)))
      )[0].state,
    ).toBe("public");
    const withdrawalFacts = await f.ctx.db.select().from(storageTombstones);
    expect(
      withdrawalFacts.filter((r) => r.kind === "media_revoked" && r.userId === removed.userId),
    ).toHaveLength(1);
    expect(
      withdrawalFacts.filter(
        (r) => r.kind === "media_revoked" && r.userId === sharedRemoved.userId,
      ),
    ).toHaveLength(1);
    console.log("proof: restic restored; committing later source facts");
    const handlers = createDeletionHandlers(sourceControl);
    await requestDeletion({ db: f.ctx.db, boss: testSender, handlers }, deleted.userId, {
      deleteContent: true,
    });
    await purgeUser({ db: f.ctx.db, handlers }, deleted.userId);
    // Fixture represents a real committed output moderation fact under the ordinary shared mutation barrier.
    await withStorageTransaction(f.ctx.db, async (tx) => {
      const hash = blockedImage.slice(7, -4);
      await tx.insert(blobBlocks).values({ sha256: hash, reasonCode: "fixture-moderation" });
      await tx.update(user).set({ image: null }).where(eq(user.id, blocked.userId));
      await tx
        .update(userAvatars)
        .set({ suspendedAt: new Date() })
        .where(eq(userAvatars.userId, blocked.userId));
      await tx
        .update(mediaPublications)
        .set({ state: "blocked", generation: 2 })
        .where(eq(mediaPublications.outputSha256, hash));
      await tx.insert(mediaPurgeRequests).values({ outputSha256: hash, generation: 2 });
      await tx
        .insert(storageTombstones)
        .values({ kind: "hash_blocked", sha256: hash, generation: 2 });
    });
    const latest = await exportJournal(journal);
    expect(latest.sequence).toBeGreaterThan(manifest.journal.sequence);
    const targetUrl = process.env.STORAGE_TEST_TARGET_DATABASE_URL!;
    const target = createDb(targetUrl);
    const targetConfig = {
      ...(await storageFixtureConfig("media")),
      recipeBuild: RECIPE_BUILD,
      endpoint: process.env.STORAGE_TEST_TARGET_ENDPOINT!,
    };
    const targetMedia: StorageContext = {
      ...sourceMedia,
      db: target.db,
      config: targetConfig,
      driver: createS3Driver(targetConfig),
    };
    const targetWebConfig = {
      ...(await storageFixtureConfig("web")),
      recipeBuild: RECIPE_BUILD,
      endpoint: targetConfig.endpoint,
    };
    const targetWeb: StorageContext = {
      ...sourceWeb,
      db: target.db,
      config: targetWebConfig,
      driver: createS3Driver(targetWebConfig),
    };
    console.log("proof: latest head verified; fail-closed exercises");
    // A missing latest tail closes persistent state and stops actual normal serving before any replacement.
    let sourceStopped = false;
    const stop = async () => {
      await normal.stop(true);
      sourceStopped = true;
      expect(normal.pendingRequests).toBe(0);
    };
    let replaced = false;
    await rename(join(journal.directory, "head.json"), join(journal.directory, "head.saved"));
    await expect(
      restoreOriginals({
        stateDirectory,
        bundleDirectory: restoredBundle,
        journal,
        databaseUrl: targetUrl,
        stopAndConfirmNormal: stop,
        replaceDatabases: async () => {
          replaced = true;
        },
        restoreOriginals: async () => {},
        rebuild: async () => {},
        startRecovery: async () => {
          throw new Error("Must not start");
        },
        revoke: async () => {},
        verifyInvariants: async () => {},
      }),
    ).rejects.toThrow();
    expect(sourceStopped).toBe(true);
    expect(replaced).toBe(false);
    expect((await readRestoreState(stateDirectory)).state).toBe("closed");
    await expect(assertNormalStorageStartup(stateDirectory)).rejects.toThrow();
    for (const entry of [
      "./src/server/index.ts",
      "./src/worker/main.ts",
      "./src/media-worker/main.ts",
    ]) {
      const bootStarted = performance.now();
      let watchdogKilled = false;
      console.log("proof: closed normal entry", entry);
      const child = Bun.spawn(["bun", entry], {
        env: { ...process.env, STORAGE_RESTORE_STATE_DIR: stateDirectory },
        stdout: "ignore",
        stderr: "pipe",
      });
      // Same-image isolated cold index import measured 4.739s under amd64 emulation; allow a bounded margin.
      const timer = setTimeout(() => {
        watchdogKilled = true;
        child.kill("SIGKILL");
      }, 20000);
      try {
        const error = await new Response(child.stderr).text();
        const exit = await child.exited;
        console.log(
          "proof: closed normal result",
          JSON.stringify({
            entry,
            elapsedMs: performance.now() - bootStarted,
            exit,
            signal: child.signalCode,
            watchdogKilled,
          }),
        );
        expect(watchdogKilled).toBe(false);
        expect(exit).not.toBe(0);
        expect(error).toContain("STORAGE_RESTORE_CLOSED");
      } finally {
        clearTimeout(timer);
      }
    }
    await rename(join(journal.directory, "head.saved"), join(journal.directory, "head.json"));
    const validHeadBytes = await readFile(join(journal.directory, "head.json"));
    const rejectBeforeReplacement = () =>
      restoreOriginals({
        stateDirectory,
        bundleDirectory: restoredBundle,
        journal,
        databaseUrl: targetUrl,
        stopAndConfirmNormal: stop,
        replaceDatabases: async () => {
          replaced = true;
        },
        restoreOriginals: async () => {},
        rebuild: async () => {},
        startRecovery: async () => {
          throw new Error("must not start");
        },
        revoke: async () => {},
        verifyInvariants: async () => {},
      });
    const invalidHead = Buffer.from(validHeadBytes);
    invalidHead[invalidHead.length - 5] ^= 1;
    await writeFile(join(journal.directory, "head.json"), invalidHead);
    await expect(rejectBeforeReplacement()).rejects.toThrow();
    expect((await readRestoreState(stateDirectory)).state).toBe("closed");
    expect(replaced).toBe(false);
    await writeFile(join(journal.directory, "head.json"), validHeadBytes);
    const segment = (await readdir(journal.directory)).find((n) => /^segment-/.test(n))!;
    await rename(join(journal.directory, segment), join(journal.directory, "gap.saved"));
    await expect(rejectBeforeReplacement()).rejects.toThrow();
    expect((await readRestoreState(stateDirectory)).state).toBe("closed");
    expect(replaced).toBe(false);
    await rename(join(journal.directory, "gap.saved"), join(journal.directory, segment));
    // Generic backend error may conceal a remote PUT. Lock remains until the actual owned remote operation is reaped.
    let finishRemote!: () => void;
    const waitRemote = new Promise<void>((r) => (finishRemote = r));
    const uncertainBytes = new Uint8Array([1, 2, 3]);
    const uncertainHash = createHash("sha256").update(uncertainBytes).digest("hex"),
      uncertainKey = `sha256/${uncertainHash.slice(0, 2)}/${uncertainHash.slice(2, 4)}/${uncertainHash}`;
    const remote = waitRemote.then(() =>
      targetMedia.driver.put({
        bucket: "original",
        key: uncertainKey,
        body: new Blob([uncertainBytes]).stream(),
        size: 3,
        mime: "application/octet-stream",
        sha256: createHash("sha256").update(uncertainBytes).digest("hex"),
      }),
    );
    const uncertainOptions = {
      stateDirectory,
      bundleDirectory: restoredBundle,
      journal,
      databaseUrl: targetUrl,
      stopAndConfirmNormal: stop,
      replaceDatabases: async () => {
        throw new Error("STORAGE_BACKEND_UNAVAILABLE");
      },
      restoreOriginals: async () => {},
      rebuild: async () => {},
      startRecovery: async () => {
        throw new Error("Must not start");
      },
      revoke: async () => {},
      verifyInvariants: async () => {},
    };
    await expect(restoreOriginals(uncertainOptions)).rejects.toThrow("STORAGE_BACKEND_UNAVAILABLE");
    expect((await stat(join(stateDirectory, ".restore.lock"))).isFile()).toBe(true);
    await expect(restoreOriginals(uncertainOptions)).rejects.toThrow();
    await expect(assertNormalStorageStartup(stateDirectory)).rejects.toThrow();
    finishRemote();
    await remote;
    const actualRemote = await targetMedia.driver.get({ bucket: "original", key: uncertainKey });
    expect(await new Response(actualRemote.body).bytes()).toEqual(uncertainBytes);
    const targetCleanupConfig = {
      ...(await storageFixtureConfig("control")),
      endpoint: targetConfig.endpoint,
    };
    await createS3Driver(targetCleanupConfig).delete({ bucket: "original", key: uncertainKey });
    await unlink(join(stateDirectory, ".restore.lock")); // Explicit operator fixture: process callback ended and real remote PUT/DELETE completed.
    let recoveryPublic: ReturnType<typeof Bun.serve> | undefined,
      recoveryInternal: ReturnType<typeof Bun.serve> | undefined;
    const purgeRequests: { at: number; body: unknown }[] = [];
    const cf = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (r) => {
        purgeRequests.push({ at: performance.now(), body: await r.json() });
        return Response.json({ success: true, errors: [] });
      },
    });
    const controlConfig = {
      ...sourceControlConfig,
      endpoint: targetConfig.endpoint,
      publicOrigin: origin,
      internalMediaUrl: "http://127.0.0.1:3001",
      internalMediaSecret: "fresh-volume-recovery-secret-0123456789",
    };
    const targetControl: StorageContext = {
      ...sourceControl,
      db: target.db,
      config: controlConfig,
      driver: createS3Driver(controlConfig),
    };
    console.log("proof: delayed remote IO reaped; fresh-volume restoration");
    const result = await restoreOriginals({
      stateDirectory,
      bundleDirectory: restoredBundle,
      journal,
      databaseUrl: targetUrl,
      stopAndConfirmNormal: stop,
      replaceDatabases: async () => {
        const restoreAdmin = new Client({ connectionString: targetUrl });
        await restoreAdmin.connect();
        await restoreAdmin.query("create database community_storage_restore_umami_test");
        await restoreAdmin.end();
        const restoredUmami = new URL(targetUrl);
        restoredUmami.pathname = "/community_storage_restore_umami_test";
        await runBoundedCommand(
          [
            "pg_restore",
            "--dbname=community_storage_restore_umami_test",
            "--no-owner",
            join(restoredBundle, "umami.dump"),
          ],
          AbortSignal.timeout(30000),
          databaseCommandEnv(restoredUmami.href),
        );
        const measured = new Client({ connectionString: restoredUmami.href });
        await measured.connect();
        expect((await measured.query("select * from measured_events")).rows).toEqual([{ id: 1 }]);
        await measured.end();
        await runBoundedCommand(
          [
            "pg_restore",
            "--dbname=community_storage_restore_test",
            "--clean",
            "--if-exists",
            "--no-owner",
            join(restoredBundle, "community.dump"),
          ],
          AbortSignal.timeout(30000),
          databaseCommandEnv(targetUrl),
        );
      },
      restoreOriginals: async (entries) => {
        const state = await readRestoreState(stateDirectory);
        await restoreVerifiedOriginals(
          targetMedia,
          entries,
          restoredBundle,
          stateDirectory,
          state.restoreId,
        );
      },
      rebuild: async () => {
        for (const out of await target.db.select().from(derivedObjects)) {
          await requestMissingDerivedRebuild(targetMedia, {
            id: out.id,
            generation: out.generation,
          });
        }
        for (const intent of await readDerivedRebuildIntents(targetMedia))
          await rebuildDerivedIntent(targetMedia, intent);
      },
      startRecovery: async () => {
        console.log("proof: both databases/originals/rebuild complete; restricted recovery");
        const h = await createRecoveryWeb({
          db: target.db,
          secret: controlConfig.internalMediaSecret,
          stateDirectory,
        });
        recoveryPublic = Bun.serve({ hostname: "127.0.0.1", port: publicPort, fetch: h.public });
        recoveryInternal = Bun.serve({ hostname: "127.0.0.1", port: 3001, fetch: h.internal });
        expect((await fetch(`${origin}/api/auth/get-session`)).status).toBe(404);
        expect((await fetch(`${origin}/api/v1/profile`)).status).toBe(404);
        return {
          stopAndConfirm: async () => {
            await recoveryPublic!.stop(true);
            await recoveryInternal!.stop(true);
            expect(recoveryPublic!.pendingRequests).toBe(0);
          },
        };
      },
      revoke: (data) =>
        revokeMedia(targetControl, data, {
          fetch: (url, init) =>
            fetch(url.startsWith("https://api.cloudflare.com/") ? cf.url.href : url, init),
          sleep: (ms) => Bun.sleep(ms),
          now: () => performance.now(),
          drainUrl: "http://127.0.0.1:3001/internal/media/drain",
        }),
      verifyInvariants: async () => {
        expect(await target.db.select().from(user).where(eq(user.id, deleted.userId))).toHaveLength(
          0,
        );
        expect(
          await target.db.select().from(profiles).where(eq(profiles.userId, deleted.userId)),
        ).toHaveLength(0);
        expect(
          (await target.db.select().from(uploadSessions).where(eq(uploadSessions.id, tmp.id)))[0]
            .state,
        ).toBe("cancelled");
        expect(
          (
            await target.db.select().from(storageUsage).where(eq(storageUsage.userId, good.userId))
          )[0].reservedBytes,
        ).toBe(0);
        expect((await target.db.select().from(storageBudget))[0].temporaryWritten).toBe(0);
        for (const e of manifest.originals) {
          const data = await targetMedia.driver.get({ bucket: "original", key: e.key });
          expect(
            createHash("sha256")
              .update(await new Response(data.body).bytes())
              .digest("hex"),
          ).toBe(e.sha256);
        }
        expect(
          (await targetControl.driver.list({ bucket: "original", prefix: "tmp/" })).objects,
        ).toHaveLength(0);
        expect(
          (await target.db.select().from(user).where(eq(user.id, removed.userId)))[0].image,
        ).toBeNull();
        expect(
          (await target.db.select().from(user).where(eq(user.id, sharedRemoved.userId)))[0].image,
        ).toBeNull();
        expect(
          (
            await target.db
              .select()
              .from(userAvatars)
              .where(eq(userAvatars.userId, sharedRemoved.userId))
          )[0].fileId,
        ).toBeNull();
        expect((await target.db.select().from(user).where(eq(user.id, good.userId)))[0].image).toBe(
          goodImage,
        );
        expect(
          (
            await target.db
              .select()
              .from(mediaPublications)
              .where(eq(mediaPublications.outputSha256, goodImage.slice(7, -4)))
          )[0].state,
        ).toBe("public");
        expect(
          (
            await target.db
              .select()
              .from(mediaPublications)
              .where(eq(mediaPublications.outputSha256, removedImage.slice(7, -4)))
          )[0].state,
        ).toBe("private");
        expect(
          (
            await target.db
              .select()
              .from(mediaPublications)
              .where(eq(mediaPublications.outputSha256, blockedImage.slice(7, -4)))
          )[0].state,
        ).toBe("blocked");
        expect(
          (
            await target.db
              .select()
              .from(mediaPurgeRequests)
              .where(eq(mediaPurgeRequests.outputSha256, blockedImage.slice(7, -4)))
          ).find((r) => r.state === "done"),
        ).toBeDefined();
        const publication = (
          await target.db
            .select()
            .from(mediaPublications)
            .where(eq(mediaPublications.outputSha256, deletedImage.slice(7, -4)))
        )[0];
        expect(publication.state).toBe("private");
        const requests = await target.db
          .select()
          .from(mediaPurgeRequests)
          .where(eq(mediaPurgeRequests.outputSha256, publication.outputSha256));
        const done = requests.find((r) => r.state === "done")!;
        expect(done.evidence!.drain!.generation).toBe(publication.generation);
        expect(done.evidence!.purges).toHaveLength(2);
        expect(done.evidence!.probes).toHaveLength(2);
        expect(
          done.evidence!.probes[1].elapsedMs - done.evidence!.probes[0].elapsedMs,
        ).toBeGreaterThanOrEqual(5000);
      },
    });
    expect(result.rtoMs).toBeGreaterThan(10000);
    expect(result.rpoMs).toBe(86400000);
    expect(purgeRequests).toHaveLength(6);
    for (const image of [deletedImage, removedImage, blockedImage]) {
      const requests = purgeRequests.filter(
        (p) => JSON.stringify(p.body) === JSON.stringify({ files: [origin + image] }),
      );
      expect(requests).toHaveLength(2);
      expect(requests[1].at - requests[0].at).toBeGreaterThanOrEqual(5000);
    }
    expect((await readRestoreState(stateDirectory)).state).toBe("open");
    const openDrain = createMediaDrain({
      db: target.db,
      secret: controlConfig.internalMediaSecret,
    });
    const openHandler = createPublicMediaHandler(targetWeb, openDrain);
    normal = Bun.serve({ hostname: "127.0.0.1", port: publicPort, fetch: (r) => openHandler(r) });
    const ready = await fetch(origin + goodImage);
    expect(ready.status).toBe(200);
    expect(
      createHash("sha256")
        .update(await ready.bytes())
        .digest("hex"),
    ).toBe(goodImage.slice(7, -4));
    expect((await fetch(origin + deletedImage)).status).toBe(404);
    expect((await fetch(origin + removedImage)).status).toBe(404);
    expect((await fetch(origin + blockedImage)).status).toBe(404);
    await expect(
      resolvePrivateFile(targetWeb, deleted.userId, deletedFileId, "content"),
    ).rejects.toThrow();
    const anon = await fetch(`${targetConfig.endpoint}/blobs/${manifest.originals[0].key}`);
    expect(anon.status).toBe(403);
    await anon.arrayBuffer();
    const evidence = {
      runtime: {
        platform: process.platform,
        arch: process.arch,
        bun: process.versions.bun,
        recipeBuild: RECIPE_BUILD,
      },
      originals: manifest.originals.length,
      dumps: manifest.dumps,
      latestJournal: latest,
      measuredRtoMs: result.rtoMs,
      dailyRpoMs: result.rpoMs,
      snapshotAgeMs: Date.now() - Date.parse(manifest.createdAt),
      purgeObservations: purgeRequests.map((p) => ({ at: p.at })),
      sourceStopped,
      freshVolumes: true,
    };
    await writeFile(join(root, "result.json"), JSON.stringify(evidence, null, 2));
    console.log(
      JSON.stringify({
        originals: evidence.originals,
        rtoMs: evidence.measuredRtoMs,
        rpoMs: evidence.dailyRpoMs,
        platform: process.platform,
        arch: process.arch,
      }),
    );
    await normal.stop(true);
    await cf.stop(true);
    await target.pool.end();
    await f.ctx.db.delete(blobBlocks).where(eq(blobBlocks.sha256, blockedImage.slice(7, -4)));
    await f.cleanup();
    const clean = new Client({ connectionString: journal.databaseUrl });
    await clean.connect();
    await clean.query("drop database community_storage_umami_test");
    await clean.end();
    await testDbHandle().pool.end();
  },
  180000,
);
