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
  const { backupOriginals } = await import("./export");
  const journal = journalConfig();
  const required = (key: string) => {
    const value = process.env[key];
    if (!value) throw new Error(`Missing ${key}`);
    return value;
  };
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
  const { db, pool } = createDb(journal.databaseUrl);
  try {
    const ctx = createStorageContext({
      db,
      boss: async () => {
        throw new Error("STORAGE_BACKUP_NO_QUEUE");
      },
      log: createLogger(),
      role: "backup",
    });
    await withBackupBundle(required("STORAGE_BUNDLE_ROOT"), (bundleDirectory) =>
      backupOriginals(ctx, { ...options, bundleDirectory }),
    );
  } finally {
    await pool.end();
  }
}
