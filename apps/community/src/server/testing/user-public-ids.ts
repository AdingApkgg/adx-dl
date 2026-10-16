import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeJournal, exportJournal } from "../../../ops/backup/journal";
import { assertTestDatabaseUrl, testDbHandle } from "./test-db";
import { testDatabaseUrl } from "./services";

/** Serialized API/HTTP fixtures use an actual encrypted export, never a fabricated checkpoint. */
export async function exportTestUserIds() {
  const databaseUrl = testDatabaseUrl();
  assertTestDatabaseUrl(databaseUrl);
  const directory = await mkdtemp(join(tmpdir(), "user-api-journal-"));
  const keyFile = join(directory, "key");
  try {
    await writeFile(keyFile, crypto.getRandomValues(new Uint8Array(32)), { mode: 0o600 });
    await testDbHandle().pool.query("update storage_journal_progress set exported_sequence=0,chain_hash=null,exported_at=null where id='global'");
    const config = { databaseUrl, directory: join(directory, "log"), keyFile };
    await initializeJournal(config);
    await exportJournal(config);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
