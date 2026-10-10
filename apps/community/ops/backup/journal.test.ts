import { beforeAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetTestDatabase, testDbHandle } from "../../src/server/testing/test-db";
import { STORAGE_LOCK_KEY } from "../../src/server/storage/transactions";
import { initializeJournal, exportJournal, verifyLatestJournal, retainJournal } from "./journal";
beforeAll(resetTestDatabase, 30000);
test("real PG allocation order is drained before export, rollback gaps legal, ciphertext/tail tampering fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "journal-test-"));
  const keyFile = join(dir, "key");
  await writeFile(keyFile, crypto.getRandomValues(new Uint8Array(32)), { mode: 0o600 });
  const config = {
    directory: join(dir, "journal"),
    keyFile,
    databaseUrl: process.env.TEST_DATABASE_URL!,
  };
  const { pool } = testDbHandle();
  const a = await pool.connect(),
    b = await pool.connect();
  try {
    await pool.query(
      "update storage_journal_progress set exported_sequence=0,chain_hash=null,exported_at=null where id='global'",
    );
    await initializeJournal(config);
    const genesisBytes = await readFile(join(config.directory, "head.json"));
    await a.query("begin");
    await a.query("select pg_advisory_xact_lock_shared($1)", [STORAGE_LOCK_KEY]);
    await a.query("insert into storage_tombstones(kind,user_id) values('user_deleted','lower')");
    await b.query("begin");
    await b.query("select pg_advisory_xact_lock_shared($1)", [STORAGE_LOCK_KEY]);
    await b.query("insert into storage_tombstones(kind,user_id) values('user_deleted','higher')");
    await b.query("commit");
    let done = false;
    const exporting = exportJournal(config).then((h) => {
      done = true;
      return h;
    });
    for (let i = 0; i < 100; i++) {
      const r = await pool.query(
        "select 1 from pg_locks where locktype='advisory' and objid=$1 and not granted",
        [STORAGE_LOCK_KEY],
      );
      if (r.rowCount) break;
      await Bun.sleep(5);
    }
    expect(done).toBe(false);
    await a.query("commit");
    const head = await exporting;
    const verified = await verifyLatestJournal(config);
    expect(verified.head).toEqual(head);
    expect(
      verified.records.map((r) => r.userId).filter((id) => ["lower", "higher"].includes(id ?? "")),
    ).toEqual(["lower", "higher"]);
    await a.query("begin");
    await a.query("insert into storage_tombstones(kind,user_id) values('user_deleted','rollback')");
    await a.query("rollback");
    await a.query(
      "insert into storage_tombstones(kind,user_id) values('user_deleted','after-gap')",
    );
    await exportJournal(config);
    expect(
      (await verifyLatestJournal(config)).records.filter((r) =>
        ["lower", "higher", "after-gap"].includes(r.userId ?? ""),
      ),
    ).toHaveLength(3);
    // Actual committed orphan segment survives simulated crash before its head/checkpoint, then new facts arrive.
    await writeFile(join(config.directory, "head.json"), genesisBytes);
    await pool.query(
      "update storage_journal_progress set exported_sequence=0,chain_hash=null,exported_at=null where id='global'",
    );
    await pool.query(
      "insert into storage_tombstones(kind,user_id) values('user_deleted','after-crash')",
    );
    await exportJournal(config);
    const recovered = await verifyLatestJournal(config);
    expect(
      recovered.records.filter((r) =>
        ["lower", "higher", "after-gap", "after-crash"].includes(r.userId ?? ""),
      ),
    ).toHaveLength(4);
    expect(recovered.head.sequence).toBeGreaterThan(head.sequence);
    const fromOldSignedSnapshot = await verifyLatestJournal(config, head);
    expect(fromOldSignedSnapshot.head).toEqual(recovered.head);
    expect(fromOldSignedSnapshot.records.some((r) => r.userId === "after-crash")).toBe(true);
    const sixMonthly = new Date(recovered.head.capturedAt);
    sixMonthly.setUTCMonth(sixMonthly.getUTCMonth() + 6);
    await retainJournal(config, sixMonthly);
    expect((await verifyLatestJournal(config, head)).head).toEqual(recovered.head);
    const expired = new Date(recovered.head.capturedAt);
    expired.setUTCMonth(expired.getUTCMonth() + 8);
    await retainJournal(config, expired);
    expect((await verifyLatestJournal(config, recovered.head)).anchor).toEqual(recovered.head);
    await expect(verifyLatestJournal(config, head)).rejects.toThrow();
    const p = join(config.directory, "head.json");
    const raw = await readFile(p);
    raw[raw.length - 5] ^= 1;
    await writeFile(p, raw);
    await expect(verifyLatestJournal(config)).rejects.toThrow();
  } finally {
    await a.query("rollback");
    await pool.query(
      "update storage_journal_progress set exported_sequence=0,chain_hash=null,exported_at=null where id='global'",
    );
    a.release();
    b.release();
    await rm(dir, { recursive: true, force: true });
  }
});

test("media withdrawal variants keep text account IDs and distinguish revision from global generation", async () => {
  const { validJournalRecord, globalMediaRevocation } = await import("./journal");
  const global = {
    sequence: 1,
    kind: "media_revoked" as const,
    userId: null,
    fileId: null,
    sha256: "a".repeat(64),
    generation: 2,
    createdAt: new Date().toISOString(),
  };
  const individual = {
    ...global,
    userId: "account-text",
    fileId: crypto.randomUUID(),
    generation: 100,
  };
  expect(validJournalRecord(global)).toBe(true);
  expect(globalMediaRevocation(global)).toBe(true);
  expect(validJournalRecord(individual)).toBe(true);
  expect(globalMediaRevocation(individual)).toBe(false);
  for (const invalid of [
    { ...individual, fileId: null },
    { ...individual, userId: null },
    { ...individual, userId: "" },
    { ...individual, fileId: "invalid" },
    { ...individual, generation: 0 },
    { ...global, generation: -1 },
    { ...global, generation: Number.MAX_SAFE_INTEGER + 1 },
  ])
    expect(validJournalRecord(invalid)).toBe(false);
});
