import { beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetTestDatabase, testDbHandle } from "../../src/server/testing/test-db";
import { storageFixtureConfig } from "../../test/storage/fixture";
import { createS3Driver } from "../../src/server/storage/s3";
import { createLogger } from "../../src/shared/log";
import { blobs, storagePolicies } from "../../src/server/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  backupOriginals,
  stageOriginal,
  preflightSpace,
  fileDigest,
  type OriginalEntry,
} from "./export";
import { initializeJournal } from "./journal";
import { createStorageIOTracker, trackStorageWrites } from "../../src/server/storage/maintenance";
import { withStorageTransaction } from "../../src/server/storage/transactions";
beforeAll(resetTestDatabase, 30000);
test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "true S3 originals are verified/reused; wronghash/missing fails; actual blocked writer drains before manifest and dump; failed restic no prune",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "backup-test-"));
    const { db } = testDbHandle();
    const media = await storageFixtureConfig("media"),
      backup = await storageFixtureConfig("backup"),
      control = await storageFixtureConfig("control");
    const source = createS3Driver(media),
      driver = createS3Driver(backup);
    const cleanup = createS3Driver(control);
    const bytes = crypto.getRandomValues(new Uint8Array(120));
    await writeFile(join(dir, "input"), bytes);
    const { sha256 } = await fileDigest(join(dir, "input"));
    const key = `sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
    const [policy] = await db
      .insert(storagePolicies)
      .values({
        name: crypto.randomUUID(),
        endpoint: backup.endpoint,
        region: backup.region,
        originalBucket: backup.originalBucket,
        derivedBucket: backup.derivedBucket,
        credentialsRef: backup.credentialsRef,
      })
      .returning();
    const entry: OriginalEntry = {
      id: crypto.randomUUID(),
      key,
      sha256,
      size: bytes.length,
      mime: "image/png",
      policy: {
        id: policy.id,
        endpoint: backup.endpoint,
        region: backup.region,
        originalBucket: backup.originalBucket,
        derivedBucket: backup.derivedBucket,
      },
      recipes: [],
    };
    const ctx = {
      db,
      driver,
      config: backup,
      boss: async () => {
        throw new Error("No queue required");
      },
      log: createLogger(() => {}),
    };
    const tracker = createStorageIOTracker();
    let unblock!: () => void, entered!: () => void;
    const blocked = new Promise<void>((r) => (unblock = r));
    const started = new Promise<void>((r) => (entered = r));
    const writing = tracker.run(async () => {
      entered();
      await blocked;
      await source.put({
        bucket: "original",
        key,
        body: new Blob([bytes]).stream(),
        size: bytes.length,
        mime: entry.mime,
        sha256,
      });
      await db.insert(blobs).values({
        id: entry.id,
        sha256,
        key,
        size: bytes.length,
        policyId: policy.id,
        state: "ready",
        detectedMime: entry.mime,
        verifiedAt: new Date(),
      });
    });
    await started;
    await mkdir(join(dir, "stage"));
    await mkdir(join(dir, "bundle"));
    await mkdir(join(dir, "repo"));
    await writeFile(join(dir, "journal-key"), crypto.getRandomValues(new Uint8Array(32)), {
      mode: 0o600,
    });
    const journal = {
      directory: join(dir, "journal"),
      keyFile: join(dir, "journal-key"),
      databaseUrl: process.env.TEST_DATABASE_URL!,
    };
    await db.execute(
      sql`update storage_journal_progress set exported_sequence=0,chain_hash=null,exported_at=null where id='global'`,
    );
    await initializeJournal(journal);
    const commands: string[][] = [];
    let drainStarted!: () => void;
    const drainEntry = new Promise<void>((r) => (drainStarted = r));
    const backing = backupOriginals(ctx, {
      databaseUrl: journal.databaseUrl,
      umamiDatabaseUrl: journal.databaseUrl,
      stagingDirectory: join(dir, "stage"),
      bundleDirectory: join(dir, "bundle"),
      repositoryDirectory: join(dir, "repo"),
      journal,
      dumpBounds: { community: 65536, umami: 65536 },
      coordinator: () => ({
        drain: async (_lease, signal) => {
          drainStarted();
          await tracker.pauseAndDrain(signal);
        },
        resume: async () => {
          tracker.resume();
        },
      }),
      command: async (args) => {
        commands.push(args);
        if (args[0] === "pg_dump")
          await writeFile(
            args.find((a) => a.startsWith("--file="))!.slice(7),
            "actual fixture dump placeholder",
          );
        else if (args[1] === "backup") throw new Error("injected restic failure");
      },
    }).catch((e) => e);
    try {
      await drainEntry;
      await expect(withStorageTransaction(db, async () => 1)).rejects.toMatchObject({
        status: 503,
      });
      expect(await db.execute(sql`select 1`)).toBeDefined();
      expect(commands).toHaveLength(0);
      unblock();
      await writing;
      expect(await backing).toBeInstanceOf(Error);
      expect(commands.filter((a) => a[1] === "forget")).toHaveLength(0);
      expect(commands.find((a) => a[1] === "backup")).toContain("community-full");
      const manifest = JSON.parse(await readFile(join(dir, "bundle", "manifest.json"), "utf8"));
      expect(manifest.originals.map((e: OriginalEntry) => e.sha256)).toContain(sha256);
      expect(await withStorageTransaction(db, async () => 1)).toBe(1);
      expect(
        (await stageOriginal(ctx, entry, join(dir, "stage"), AbortSignal.timeout(10000))).reused,
      ).toBe(true);
      const wrong = { ...entry, sha256: "f".repeat(64) };
      await expect(
        stageOriginal(ctx, wrong, join(dir, "stage"), AbortSignal.timeout(10000)),
      ).rejects.toThrow("STORAGE_ORIGINAL_INVALID");
      await expect(
        stageOriginal(
          ctx,
          { ...entry, key: "missing", sha256: "e".repeat(64) },
          join(dir, "stage"),
          AbortSignal.timeout(10000),
        ),
      ).rejects.toThrow();
      await expect(
        preflightSpace([{ path: dir, additional: Number.MAX_SAFE_INTEGER }]),
      ).rejects.toThrow("STORAGE_BACKUP_DISK_LOW");
    } finally {
      unblock();
      await writing;
      await cleanup.delete({ bucket: "original", key });
      await db.delete(blobs).where(eq(blobs.id, entry.id));
      await db.delete(storagePolicies).where(eq(storagePolicies.id, policy.id));
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("zero local activity and expired lease never authenticate uncertain physical IO", async () => {
  const { db, pool } = testDbHandle();
  const { storagePolicies, uploadAttempts } = await import("../../src/server/db/schema");
  const { assertStorageDrained } = await import("./export");
  const [p] = await db
    .insert(storagePolicies)
    .values({
      name: crypto.randomUUID(),
      endpoint: "http://uncertain.test",
      region: "us-east-1",
      originalBucket: "blobs",
      derivedBucket: "derived",
      credentialsRef: "STORAGE_WEB",
    })
    .returning();
  const [a] = await db
    .insert(uploadAttempts)
    .values({
      uploadId: crypto.randomUUID(),
      index: 0,
      policyId: p.id,
      tempKey: `tmp/uncertain/${crypto.randomUUID()}`,
      size: 1,
      leaseUntil: new Date(Date.now() - 60000),
      state: "writing",
    })
    .returning();
  try {
    const tracker = createStorageIOTracker();
    await tracker.pauseAndDrain(AbortSignal.timeout(100));
    expect(tracker.status().active).toBe(0);
    await expect(assertStorageDrained(pool)).rejects.toThrow("STORAGE_IO_UNCERTAIN");
  } finally {
    await db.delete(uploadAttempts).where(eq(uploadAttempts.id, a.id));
    await db.delete(storagePolicies).where(eq(storagePolicies.id, p.id));
  }
});

test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "delayed actual S3 write after driver error and expired durable lease cannot yield full snapshot",
  async () => {
    const { db } = testDbHandle(),
      dir = await mkdtemp(join(tmpdir(), "late-physical-"));
    const media = await storageFixtureConfig("media"),
      control = await storageFixtureConfig("control"),
      backup = await storageFixtureConfig("backup");
    const physical = createS3Driver(media),
      cleanup = createS3Driver(control),
      tracker = createStorageIOTracker();
    const bytes = crypto.getRandomValues(new Uint8Array(128)),
      lateBytes = crypto.getRandomValues(new Uint8Array(128));
    await writeFile(join(dir, "input"), bytes);
    const { sha256 } = await fileDigest(join(dir, "input"));
    const key = `sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
    const [policy] = await db
      .insert(storagePolicies)
      .values({
        name: crypto.randomUUID(),
        endpoint: backup.endpoint,
        region: backup.region,
        originalBucket: backup.originalBucket,
        derivedBucket: backup.derivedBucket,
        credentialsRef: backup.credentialsRef,
      })
      .returning();
    const [blob] = await db
      .insert(blobs)
      .values({
        policyId: policy.id,
        sha256,
        key,
        size: bytes.length,
        state: "ready",
        verifiedAt: new Date(),
        detectedMime: "image/png",
        leaseUntil: new Date(Date.now() - 60000),
      })
      .returning();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let remote: Promise<void> | undefined;
    const failed = trackStorageWrites(
      {
        ...physical,
        put: async (input) => {
          remote = held.then(() => physical.put(input));
          throw new Error("transport reported failure while remote operation remained alive");
        },
      },
      tracker,
    );
    try {
      await physical.put({
        bucket: "original",
        key,
        body: new Blob([bytes]).stream(),
        size: bytes.length,
        mime: "image/png",
        sha256,
      });
      await expect(
        failed.put({
          bucket: "original",
          key,
          body: new Blob([lateBytes]).stream(),
          size: lateBytes.length,
          mime: "image/png",
          sha256,
        }),
      ).rejects.toThrow();
      await tracker.pauseAndDrain(AbortSignal.timeout(100));
      expect(tracker.status().active).toBe(0);
      for (const name of ["stage", "bundle", "repo"]) await mkdir(join(dir, name));
      await writeFile(join(dir, "key"), crypto.getRandomValues(new Uint8Array(32)), {
        mode: 0o600,
      });
      const journal = {
        directory: join(dir, "journal"),
        keyFile: join(dir, "key"),
        databaseUrl: process.env.TEST_DATABASE_URL!,
      };
      await db.execute(
        sql`update storage_journal_progress set exported_sequence=0,chain_hash=null,exported_at=null where id='global'`,
      );
      await initializeJournal(journal);
      const commands: string[][] = [];
      await expect(
        backupOriginals(
          {
            db,
            driver: createS3Driver(backup),
            config: backup,
            boss: async () => {
              throw new Error("No queue");
            },
            log: createLogger(() => {}),
          },
          {
            databaseUrl: journal.databaseUrl,
            umamiDatabaseUrl: journal.databaseUrl,
            stagingDirectory: join(dir, "stage"),
            bundleDirectory: join(dir, "bundle"),
            repositoryDirectory: join(dir, "repo"),
            journal,
            dumpBounds: { community: 65536, umami: 65536 },
            coordinator: () => ({
              drain: (_lease, signal) => tracker.pauseAndDrain(signal),
              resume: async () => tracker.resume(),
            }),
            command: async (args) => {
              commands.push(args);
            },
          },
        ),
      ).rejects.toThrow("STORAGE_IO_UNCERTAIN");
      expect(commands).toHaveLength(0);
      await expect(readFile(join(dir, "bundle", "manifest.json"))).rejects.toThrow();
      expect(await withStorageTransaction(db, async () => true)).toBe(true);
      release();
      await remote;
      const changed = await physical.get({ bucket: "original", key });
      expect(await new Response(changed.body).bytes()).toEqual(lateBytes);
    } finally {
      release();
      await remote;
      await cleanup.delete({ bucket: "original", key });
      await db.delete(blobs).where(eq(blobs.id, blob.id));
      await db.delete(storagePolicies).where(eq(storagePolicies.id, policy.id));
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("partial role pause failure and ignored late ACK/resume stay bounded, release matching gate and cannot clear a new owner", async () => {
  const { db } = testDbHandle();
  const config = await storageFixtureConfig("backup"),
    ctx = {
      db,
      config,
      driver: createS3Driver(config),
      boss: async () => {
        throw new Error("No queue");
      },
      log: createLogger(() => {}),
    };
  const { acquireStorageMaintenance, releaseStorageMaintenance } = await import(
    "../../src/server/storage/maintenance"
  );
  for (const mode of ["partial", "late", "resume-timeout", "new-owner"]) {
    const dir = await mkdtemp(join(tmpdir(), "drain-failure-"));
    for (const name of ["stage", "bundle", "repo"]) await mkdir(join(dir, name));
    let resumes = 0,
      newOwner: Awaited<ReturnType<typeof acquireStorageMaintenance>> | undefined,
      finish!: () => void;
    const pending = new Promise<void>((r) => (finish = r));
    const commands: string[][] = [];
    const began = Date.now();
    try {
      await expect(
        backupOriginals(ctx, {
          databaseUrl: process.env.TEST_DATABASE_URL!,
          umamiDatabaseUrl: process.env.TEST_DATABASE_URL!,
          stagingDirectory: join(dir, "stage"),
          bundleDirectory: join(dir, "bundle"),
          repositoryDirectory: join(dir, "repo"),
          journal: {
            directory: join(dir, "journal"),
            keyFile: join(dir, "key"),
            databaseUrl: process.env.TEST_DATABASE_URL!,
          },
          dumpBounds: { community: 65536, umami: 65536 },
          maintenanceMs: 200,
          jobMs: 1000,
          coordinator: (owner) => ({
            drain: async () => {
              if (mode === "late") await pending;
              else throw new Error("partial pause failed");
            },
            resume: async (lease) => {
              expect(lease.ownerId).toBe(owner);
              resumes++;
              expect(await withStorageTransaction(db, async () => true)).toBe(true);
              if (mode === "resume-timeout") await pending;
              if (mode === "new-owner")
                newOwner = await acquireStorageMaintenance(db, { durationMs: 1000 });
            },
          }),
          command: async (args) => {
            commands.push(args);
          },
        }),
      ).rejects.toThrow();
      expect(commands).toHaveLength(0);
      expect(resumes).toBe(1);
      expect(Date.now() - began).toBeLessThan(1000);
      finish();
      await pending;
      if (newOwner) {
        await expect(withStorageTransaction(db, async () => true)).rejects.toMatchObject({
          status: 503,
        });
      } else expect(await withStorageTransaction(db, async () => true)).toBe(true);
    } finally {
      finish();
      if (newOwner) await releaseStorageMaintenance(db, newOwner);
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "whole-job deadline destroys blocked preflight backend before gate/pause",
  async () => {
    const { db, pool } = testDbHandle();
    const blocking = await pool.connect();
    const dir = await mkdtemp(join(tmpdir(), "preflight-deadline-"));
    const config = await storageFixtureConfig("backup");
    const app = `task10-preflight-${crypto.randomUUID()}`;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.searchParams.set("application_name", app);
    let resumed = false,
      drained = false,
      commands = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await blocking.query("begin");
      await blocking.query("lock table blobs in access exclusive mode");
      timer = setTimeout(() => void blocking.query("rollback"), 1000);
      const start = performance.now();
      await expect(
        backupOriginals(
          {
            db,
            config,
            driver: createS3Driver(config),
            boss: async () => {
              throw new Error("unused");
            },
            log: createLogger(() => {}),
          },
          {
            databaseUrl: url.toString(),
            umamiDatabaseUrl: process.env.TEST_DATABASE_URL!,
            stagingDirectory: join(dir, "stage"),
            bundleDirectory: join(dir, "bundle"),
            repositoryDirectory: dir,
            journal: {
              directory: join(dir, "journal"),
              keyFile: join(dir, "key"),
              databaseUrl: url.toString(),
            },
            dumpBounds: { community: 1000000, umami: 1000000 },
            jobMs: 150,
            coordinator: () => ({
              drain: async () => {
                drained = true;
              },
              resume: async () => {
                resumed = true;
              },
            }),
            command: async () => {
              commands++;
            },
          },
        ),
      ).rejects.toThrow();
      expect(performance.now() - start).toBeLessThan(600);
      expect(drained).toBe(false);
      expect(resumed).toBe(false);
      expect(commands).toBe(0);
      expect(
        (await pool.query("select 1 from pg_stat_activity where application_name=$1", [app]))
          .rowCount,
      ).toBe(0);
      expect(
        (await pool.query("select owner_id from storage_maintenance where id='global'")).rows[0]
          .owner_id,
      ).toBeNull();
    } finally {
      clearTimeout(timer);
      await blocking.query("rollback");
      blocking.release();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("aborted late EOF cannot publish verified staging after the maintenance deadline", async () => {
  const { createHash } = await import("node:crypto");
  const { lstat } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "stage-deadline-"));
  const config = await storageFixtureConfig("backup"),
    bytes = new Uint8Array([1, 2, 3]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    waiting = new Promise<void>((r) => (entered = r));
  const signal = new AbortController();
  const driver = {
    ...createS3Driver(config),
    get: async () => ({
      body: new ReadableStream<Uint8Array>(
        {
          start(c) {
            c.enqueue(bytes);
          },
          async pull(c) {
            entered();
            await held;
            c.close();
          },
        },
        { highWaterMark: 0 },
      ),
      size: bytes.length,
      mime: "image/png",
      etag: "fixture",
      sha256,
    }),
  };
  const ctx = {
    db: testDbHandle().db,
    config,
    driver,
    boss: async () => {
      throw new Error("no queue");
    },
    log: createLogger(() => {}),
  };
  const entry: OriginalEntry = {
    id: crypto.randomUUID(),
    key: `sha256/${sha256}`,
    sha256,
    size: bytes.length,
    mime: "image/png",
    policy: {
      id: crypto.randomUUID(),
      endpoint: config.endpoint,
      region: config.region,
      originalBucket: config.originalBucket,
      derivedBucket: config.derivedBucket,
    },
    recipes: [],
  };
  try {
    const work = stageOriginal(ctx, entry, dir, signal.signal);
    await waiting;
    signal.abort();
    release();
    await expect(work).rejects.toThrow();
    await expect(lstat(join(dir, sha256))).rejects.toThrow();
  } finally {
    release();
    await rm(dir, { recursive: true, force: true });
  }
});
