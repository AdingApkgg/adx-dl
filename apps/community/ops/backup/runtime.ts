import { sql } from "drizzle-orm";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
/** Every invocation owns a unique private directory until its restic and marker callbacks finish. */
export async function withBackupBundle<T>(
  root: string,
  run: (directory: string) => Promise<T>,
): Promise<T> {
  const path = resolve(root);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0)
    throw new Error("STORAGE_BUNDLE_ROOT_INVALID");
  const directory = await mkdtemp(join(path, "run-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function journalConfig(source: Record<string, string | undefined> = process.env) {
  const directory = source.STORAGE_JOURNAL_DIR,
    keyFile = source.STORAGE_JOURNAL_KEY_FILE,
    databaseUrl = source.DATABASE_URL;
  if (!directory || !keyFile || !databaseUrl) throw new Error("STORAGE_JOURNAL_CONFIG_INVALID");
  return { directory, keyFile, databaseUrl };
}

export async function runBackup() {
  const { assertNormalStorageStartup } = await import("./restore");
  await assertNormalStorageStartup();
  const { createDb } = await import("../../src/server/db/client");
  const { createStorageContext } = await import("../../src/server/storage/runtime");
  const { createLogger } = await import("../../src/shared/log");
  const { createBackupCoordinator } = await import("../../src/server/storage/runtime-role");
  const { backupOriginals, fileDigest } = await import("./export");
  const journal = journalConfig();
  const required = (key: string) => {
    const value = process.env[key];
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };
  const { db, pool } = createDb(journal.databaseUrl);
  const runId = crypto.randomUUID();
  let claimed = false;
  try {
    const result = await db.execute(sql`insert into storage_backup_status(id,run_id,status,started_at)
      values('global',${runId}::uuid,'running',clock_timestamp())
      on conflict(id) do update set run_id=excluded.run_id,status='running',started_at=excluded.started_at,finished_at=null
      where storage_backup_status.status<>'running' or storage_backup_status.started_at<clock_timestamp()-interval '30 minutes'
      returning id`);
    if (result.rows.length !== 1) throw new Error("STORAGE_BACKUP_ALREADY_RUNNING");
    claimed = true;
    const options = {
      databaseUrl: journal.databaseUrl,
      umamiDatabaseUrl: required("UMAMI_DATABASE_URL"),
      stagingDirectory: required("STORAGE_STAGING_DIR"),
      repositoryDirectory: required("RESTIC_REPOSITORY"),
      journal,
      dumpBounds: {
        community: Number(required("STORAGE_COMMUNITY_DUMP_BOUND")),
        umami: Number(required("STORAGE_UMAMI_DUMP_BOUND")),
      },
      coordinator: createBackupCoordinator(journal.databaseUrl),
    };
    const ctx = createStorageContext({
      db,
      boss: async () => {
        throw new Error("STORAGE_BACKUP_NO_QUEUE");
      },
      log: createLogger(),
      role: "backup",
    });
    const completed = await withBackupBundle(required("STORAGE_BUNDLE_ROOT"), async bundleDirectory => {
      // backupOriginals returns only after restic, retention and its durable success marker.
      const manifest = await backupOriginals(ctx, { ...options, bundleDirectory });
      return { manifest, digest: (await fileDigest(join(bundleDirectory, "manifest.json"))).sha256 };
    });
    const bytes = completed.manifest.originals.reduce((total, original) => total + original.size, 0)
      + completed.manifest.dumps.community.size + completed.manifest.dumps.umami.size;
    if (!Number.isSafeInteger(bytes)) throw new Error("STORAGE_BACKUP_BYTES_INVALID");
    const saved = await db.execute(sql`update storage_backup_status set status='succeeded',finished_at=clock_timestamp(),
      last_success_at=clock_timestamp(),manifest_sha256=${completed.digest},original_count=${completed.manifest.originals.length},bytes=${bytes}
      where id='global' and run_id=${runId}::uuid and status='running' returning id`);
    if (saved.rows.length !== 1) throw new Error("STORAGE_BACKUP_RUN_LOST");
  } catch (error) {
    if (claimed) await db.execute(sql`update storage_backup_status set status='failed',finished_at=clock_timestamp()
      where id='global' and run_id=${runId}::uuid and status='running'`).catch(() => {});
    throw error;
  } finally {
    await pool.end();
  }
}
