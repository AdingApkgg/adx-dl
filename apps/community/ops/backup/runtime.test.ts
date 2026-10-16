import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withBackupBundle } from "./runtime";

test("concurrent manual backup invocations keep exclusive private frozen bundles until completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "backup-bundles-"));
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  let firstPath = "";
  try {
    const first = withBackupBundle(root, async (path) => {
      firstPath = path;
      expect((await stat(path)).mode & 0o777).toBe(0o700);
      await writeFile(join(path, "manifest.json"), "first");
      await pending;
      expect(await readFile(join(path, "manifest.json"), "utf8")).toBe("first");
    });
    while (!firstPath) await Bun.sleep(1);
    await withBackupBundle(root, async (path) => {
      expect(path).not.toBe(firstPath);
      await writeFile(join(path, "manifest.json"), "second");
    });
    expect(await Bun.file(join(firstPath, "manifest.json")).exists()).toBe(true);
    release();
    await first;
    expect(await Bun.file(join(firstPath, "manifest.json")).exists()).toBe(false);
  } finally {
    release?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("full backup retention groups unique bundle paths by host and tag only", async () => {
  const { communityFullRetentionCommand } = await import("./export");
  expect(communityFullRetentionCommand()).toEqual(["restic", "forget", "--host", "astrodx-community", "--tag", "community-full", "--group-by", "host,tags", "--prune", "--keep-daily", "7", "--keep-weekly", "4", "--keep-monthly", "6"]);
});

test("backup coordinator rejects an overlapping run without overwriting its owner or prior success evidence", async () => {
  const { resetTestDatabase, testDbHandle } = await import("../../src/server/testing/test-db");
  const { testDatabaseUrl } = await import("../../src/server/testing/services");
  const { runBackup } = await import("./runtime");
  await resetTestDatabase();
  const root = await mkdtemp(join(tmpdir(), "backup-status-owner-"));
  const keys = ["STORAGE_RESTORE_STATE_DIR", "STORAGE_JOURNAL_DIR", "STORAGE_JOURNAL_KEY_FILE", "DATABASE_URL", "UMAMI_DATABASE_URL"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const pool = testDbHandle().pool;
  const owner = crypto.randomUUID();
  try {
    await writeFile(join(root, "state.json"), JSON.stringify({ version: 1, state: "open", restoreId: crypto.randomUUID(), journal: null, updatedAt: new Date().toISOString() }), { mode: 0o600 });
    process.env.STORAGE_RESTORE_STATE_DIR = root;
    process.env.STORAGE_JOURNAL_DIR = root;
    process.env.STORAGE_JOURNAL_KEY_FILE = join(root, "unused-key");
    process.env.DATABASE_URL = testDatabaseUrl();
    delete process.env.UMAMI_DATABASE_URL;
    await pool.query("delete from storage_backup_status");
    await pool.query(`insert into storage_backup_status(id,run_id,status,started_at,last_success_at,manifest_sha256,original_count,bytes)
      values('global',$1,'running',clock_timestamp(),'2026-10-01T00:00:00Z',$2,7,4096)`, [owner, "b".repeat(64)]);
    const [before] = (await pool.query("select * from storage_backup_status")).rows;
    const attempts = await Promise.allSettled([runBackup(), runBackup()]);
    for (const result of attempts) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason.message).toBe("STORAGE_BACKUP_ALREADY_RUNNING");
    }
    expect((await pool.query("select * from storage_backup_status")).rows).toEqual([before]);
    // Only a stale owner may be replaced. Configuration failure after that claim
    // must fail this new run while retaining the last verified completed result.
    await pool.query("update storage_backup_status set started_at=clock_timestamp()-interval '31 minutes'");
    await expect(runBackup()).rejects.toThrow("Missing UMAMI_DATABASE_URL");
    const [failed] = (await pool.query("select * from storage_backup_status")).rows;
    expect(failed.run_id).not.toBe(owner);
    expect(failed.status).toBe("failed");
    expect(failed.finished_at).toBeInstanceOf(Date);
    expect(failed.last_success_at).toEqual(before.last_success_at);
    expect(failed.manifest_sha256).toBe("b".repeat(64));
    expect(failed.original_count).toBe(7);
    expect(Number(failed.bytes)).toBe(4096);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await pool.query("delete from storage_backup_status");
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
