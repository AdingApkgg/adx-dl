import { mkdir, readdir, open, lstat, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { journalConfig } from "./runtime";
import { initializeJournal } from "./journal";
import { initializeRestoreState } from "./restore";
import { eq, sql } from "drizzle-orm";
import { createDb } from "../../src/server/db/client";
import { storagePolicies } from "../../src/server/db/schema";
import { parseStorageEnv } from "../../src/server/storage/env";
import { withStorageTransaction } from "../../src/server/storage/transactions";

/** First-install metadata only: the initializer never receives web/media credentials. */
async function initializePolicies(databaseUrl: string) {
  const config = parseStorageEnv(process.env, "backup");
  const { db, pool } = createDb(databaseUrl);
  try {
    await withStorageTransaction(db, async (tx) => {
      const used = await tx.execute(sql`select 1 where
        exists(select 1 from upload_sessions) or exists(select 1 from upload_attempts) or
        exists(select 1 from upload_parts) or exists(select 1 from files) or
        exists(select 1 from blobs) or exists(select 1 from blob_derivatives) or
        exists(select 1 from derived_objects) or exists(select 1 from user_avatars) or
        exists(select 1 from storage_usage) or exists(select 1 from storage_quarantine) or
        exists(select 1 from storage_tombstones) or exists(select 1 from blob_blocks) or
        exists(select 1 from media_publications) or exists(select 1 from media_purge_requests)`);
      if (used.rows.length) throw new Error("STORAGE_INITIALIZATION_REQUIRES_UNUSED_DATABASE");
      for (const role of ["media", "web"] as const) {
        const expected = {
          name: `primary-${role}`,
          driver: "s3" as const,
          enabled: true,
          endpoint: config.endpoint,
          region: config.region,
          originalBucket: config.originalBucket,
          derivedBucket: config.derivedBucket,
          credentialsRef: `STORAGE_${role.toUpperCase()}`,
        };
        await tx
          .insert(storagePolicies)
          .values(expected)
          .onConflictDoNothing({ target: storagePolicies.name });
        const [row] = await tx
          .select()
          .from(storagePolicies)
          .where(eq(storagePolicies.name, expected.name))
          .for("update");
        if (
          !row ||
          Object.entries(expected).some(([key, value]) => row[key as keyof typeof row] !== value)
        )
          throw new Error("STORAGE_INITIAL_POLICY_CONFLICT");
      }
    });
  } finally {
    await pool.end();
  }
}
/** Explicit first install only. Partial failure stays closed for operator inspection; never adopt old state. */
export async function initializeStorageState() {
  const config = journalConfig(),
    state = process.env.STORAGE_RESTORE_STATE_DIR;
  if (!state) throw new Error("STORAGE_RESTORE_STATE_REQUIRED");
  for (const path of [state, config.directory, dirname(config.keyFile)]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (!(await lstat(path)).isDirectory() || (await readdir(path)).length)
      throw new Error("STORAGE_INITIALIZATION_REQUIRES_EMPTY_STATE");
  }
  for (const path of [
    state,
    config.directory,
    dirname(config.keyFile),
    process.env.STORAGE_STAGING_DIR,
    process.env.STORAGE_BUNDLE_ROOT,
  ]) {
    if (!path) throw new Error("STORAGE_BACKUP_PATH_INVALID");
    await mkdir(path, { recursive: true, mode: 0o700 });
    await chmod(path, 0o700);
  }
  await initializePolicies(config.databaseUrl);
  const key = await open(config.keyFile, "wx", 0o600);
  try {
    await key.writeFile(randomBytes(32));
    await key.sync();
  } finally {
    await key.close();
  }
  await initializeJournal(config);
  await initializeRestoreState(state);
}
if (import.meta.main)
  try {
    await initializeStorageState();
  } catch {
    console.error("STORAGE_INITIALIZATION_FAILED");
    process.exitCode = 1;
  }
