import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../db/client";
import { userShortId } from "../auth/short-id";
import { assertTestDatabaseUrl } from "../testing/test-db";
import { testDatabaseUrl } from "../testing/services";
import { getPublicProfile } from "./profile";
import { exportJournal, initializeJournal, verifyLatestJournal } from "../../../ops/backup/journal";
import { checkRestoredUserIds, numberRestoredUsers, replayUserPublicId } from "../../../ops/backup/user-replay";

// A separate disposable database isolates exact sequence/migration assertions from other test files.
test("user numbers: sorted migration, concurrent registrations, durable aliases, deletion nonreuse and old-snapshot seeding", async () => {
  const original = new URL(testDatabaseUrl()); assertTestDatabaseUrl(original.href);
  const name = `user_ids_${crypto.randomUUID().replaceAll("-", "")}_test`;
  const admin = new Client({ connectionString: original.href }); await admin.connect();
  await admin.query(`create database "${name}"`);
  original.pathname = `/${name}`;
  const handle = createDb(original.href, { max: 6 });
  const c = new Client({ connectionString: original.href }); await c.connect();
  const directory = await mkdtemp(join(tmpdir(), "numeric-users-"));
  const migrationsFolder = fileURLToPath(new URL("../db/migrations", import.meta.url));
  const oldMigrations = join(directory, "old"); await mkdir(join(oldMigrations, "meta"), { recursive: true });
  const metadata = JSON.parse(await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"));
  metadata.entries = metadata.entries.filter((entry: { idx: number }) => entry.idx < 13);
  await writeFile(join(oldMigrations, "meta/_journal.json"), JSON.stringify(metadata));
  for (const entry of metadata.entries) await copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(oldMigrations, `${entry.tag}.sql`));
  const insert = (id: string, at = "2026-10-16T00:00:00Z") => c.query('insert into "user"(id,name,email,created_at) values($1,$1,$2,$3)', [id, `${id}@placeholder.invalid`, at]);
  const keyFile = join(directory, "key"); await writeFile(keyFile, crypto.getRandomValues(new Uint8Array(32)), { mode: 0o600 });
  const config = { databaseUrl: original.href, directory: join(directory, "journal"), keyFile };
  try {
    await migrate(drizzle(c), { migrationsFolder: oldMigrations });
    // Deliberately insert newest first, proving backfill follows registration dates.
    await insert("bcdefghjkm", "2026-10-15T00:00:00Z"); await insert("abcdefghjk", "2026-10-14T00:00:00Z");
    await migrate(drizzle(c), { migrationsFolder });
    expect((await c.query("select user_id,public_id::text as id from user_public_ids order by public_id")).rows)
      .toEqual([{ user_id: "abcdefghjk", id: "1" }, { user_id: "bcdefghjkm", id: "2" }]);
    await expect(getPublicProfile(handle.db, "1")).rejects.toMatchObject({ status: 503 });
    await initializeJournal(config); await exportJournal(config);
    expect(await getPublicProfile(handle.db, "1")).toEqual(await getPublicProfile(handle.db, "abcdefghjk"));
    expect(await getPublicProfile(handle.db, "1")).toHaveProperty("publicId", "1");
    for (const id of ["0", "01", "-1", "1e3", "1\n", "9223372036854775808", "9999999"])
      expect(await getPublicProfile(handle.db, id)).toBeNull();
    const ids = Array.from({ length: 12 }, () => userShortId());
    await Promise.all(ids.map(id => handle.pool.query('insert into "user"(id,name,email) values($1,$1,$2)', [id, `${id}@placeholder.invalid`])));
    const numbers = (await c.query("select public_id::text as id from user_public_ids order by public_id")).rows.map(row => row.id);
    expect(numbers).toEqual(Array.from({ length: 14 }, (_, i) => String(i + 1)));
    await c.query(`update "user" set status='pending_deletion' where id='abcdefghjk'`);
    expect(await getPublicProfile(handle.db, "1")).toEqual({ id: "abcdefghjk", publicId: "1", status: "pending_deletion" });
    await c.query(`delete from "user" where id='abcdefghjk'`);
    expect(await getPublicProfile(handle.db, "1")).toBeNull(); expect(await getPublicProfile(handle.db, "abcdefghjk")).toBeNull();
    await expect(insert("abcdefghjk")).rejects.toMatchObject({ code: "23505" });
    const latestUser = userShortId(); await insert(latestUser);
    expect((await c.query("select max(public_id)::text as id from user_public_ids")).rows[0].id).toBe("15");
    const head = await exportJournal(config);
    const verified = await verifyLatestJournal(config);
    const facts = verified.records.filter(record => record.kind === "user_public_id");
    expect(facts).toHaveLength(15);
    const deleted = facts.find(record => record.userId === "abcdefghjk")!;
    await c.query("begin");
    await c.query("delete from user_public_ids where user_id=$1", [deleted.userId]);
    await replayUserPublicId(c, deleted); await replayUserPublicId(c, deleted);
    expect((await c.query("select public_id::text as id from user_public_ids where user_id=$1", [deleted.userId])).rows[0].id).toBe("1");
    expect((await c.query('select 1 from "user" where id=$1', [deleted.userId])).rowCount).toBe(0);
    await expect(replayUserPublicId(c, { ...deleted, payload: { version: 1, publicId: "999" } })).rejects.toThrow("USER_PUBLIC_ID_CONFLICT");
    await c.query("rollback");
    // A pre-0013 snapshot gets verified reservations before legacy users are numbered.
    await c.query("begin");
    await c.query("drop trigger user_assign_public_id on \"user\"");
    await c.query("drop function assign_user_public_id(); drop function allocate_user_public_id(text); drop table user_public_ids");
    await c.query('delete from "user" where id=$1', [latestUser]);
    await insert("cdefghjkmn");
    await c.query("select set_config('astrodx.restore_user_public_ids',$1,true)", [JSON.stringify(facts.map(record => ({ userId: record.userId, publicId: (record.payload as { publicId: string }).publicId })))]);
    await c.query(await readFile(join(migrationsFolder, "0013_user_public_ids.sql"), "utf8"));
    expect((await c.query("select max(public_id)::text as id from user_public_ids")).rows[0].id).toBe("15");
    for (const record of facts) await replayUserPublicId(c, record);
    await checkRestoredUserIds(c, head.sequence);
    await c.query("savepoint unknown_fact");
    await c.query("insert into storage_tombstones(kind,user_id,payload) values('user_public_id','unknown', '{\"version\":1,\"publicId\":\"16\"}')");
    await expect(checkRestoredUserIds(c, head.sequence)).rejects.toThrow("STORAGE_RESTORE_CLOSED");
    await c.query("rollback to savepoint unknown_fact");
    await numberRestoredUsers(c);
    expect((await c.query("select public_id::text as id from user_public_ids where user_id='cdefghjkmn'")).rows[0].id).toBe("16");
    expect((await c.query('select 1 from "user" where id=$1', [latestUser])).rowCount).toBe(0);
    const nextUser = userShortId(); await insert(nextUser);
    expect((await c.query("select public_id::text as id from user_public_ids where user_id=$1", [nextUser])).rows[0].id).toBe("17");
    await c.query("rollback");
  } finally {
    await c.query("rollback").catch(() => {}); await c.end(); await handle.pool.end();
    await admin.query(`drop database "${name}" with (force)`); await admin.end(); await rm(directory, { recursive: true, force: true });
  }
}, 30000);
