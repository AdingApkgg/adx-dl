import { permissionFact, retentionFact } from "../../src/shared/chart-journal";
import { type ChartRestorePending, replayChartPermission, replayDeletedUserCharts } from "./chart-replay";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { lstat, mkdir, readFile, readdir, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/server/db/schema";
import { completeMediaPurgeEvidence } from "../../src/server/storage/publication";
import { hasPublicRepresentation } from "../../src/server/storage/references";
import type { StorageContext } from "../../src/server/storage/contracts";
import {
  durableFile,
  verifyLatestJournal,
  validJournalRecord,
  globalMediaRevocation,
  type JournalConfig,
  type JournalHead,
  type JournalRecord,
} from "./journal";
import { fileDigest, type FullManifest, type OriginalEntry } from "./export";
export type RestoreState = {
  version: 1;
  state: "open" | "closed";
  restoreId: string;
  journal: JournalHead | null;
  updatedAt: string;
};
const fail = () => new Error("STORAGE_RESTORE_CLOSED");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function readRestoreState(directory: string | undefined): Promise<RestoreState> {
  try {
    if (!directory) throw fail();
    const path = join(directory, "state.json"),
      s = await lstat(path);
    if (!s.isFile() || (s.mode & 0o777) !== 0o600 || s.size > 4096) throw fail();
    const v = JSON.parse(await readFile(path, "utf8")) as RestoreState;
    if (
      v.version !== 1 ||
      !["open", "closed"].includes(v.state) ||
      !uuid.test(v.restoreId) ||
      !Number.isFinite(Date.parse(v.updatedAt)) ||
      Object.keys(v).sort().join(",") !== "journal,restoreId,state,updatedAt,version" ||
      (v.journal !== null &&
        (!Number.isSafeInteger(v.journal.sequence) ||
          v.journal.sequence < 0 ||
          !/^[a-f0-9]{64}$/.test(v.journal.hash) ||
          !Number.isFinite(Date.parse(v.journal.capturedAt))))
    )
      throw fail();
    return v;
  } catch {
    throw fail();
  }
}
export async function assertNormalStorageStartup(
  directory = process.env.STORAGE_RESTORE_STATE_DIR,
) {
  if ((await readRestoreState(directory)).state !== "open" || !directory) throw fail();
  try {
    await lstat(join(directory, ".restore.lock"));
    throw fail();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw fail();
  }
}
type RestoreOwner = {
  handle: Awaited<ReturnType<typeof open>>;
  inode: number;
  device: number;
  nonce: string;
  restoreId: string;
};
async function acquireRestoreOwner(directory: string): Promise<RestoreOwner> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dir = await lstat(directory);
  if (!dir.isDirectory() || (dir.mode & 0o777) !== 0o700) throw fail();
  const handle = await open(join(directory, ".restore.lock"), "wx", 0o600);
  const owner = {
    handle,
    inode: 0,
    device: 0,
    nonce: crypto.randomUUID(),
    restoreId: crypto.randomUUID(),
  };
  try {
    await handle.writeFile(
      JSON.stringify({ version: 1, nonce: owner.nonce, restoreId: owner.restoreId }),
    );
    await handle.sync();
    const stat = await handle.stat();
    owner.inode = stat.ino;
    owner.device = stat.dev;
    const parent = await open(directory, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
    return owner;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function assertRestoreOwner(directory: string, owner: RestoreOwner) {
  const path = join(directory, ".restore.lock"),
    stat = await lstat(path),
    held = await owner.handle.stat();
  if (
    !stat.isFile() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.ino !== owner.inode ||
    stat.dev !== owner.device ||
    held.ino !== owner.inode
  )
    throw fail();
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value.version !== 1 || value.nonce !== owner.nonce || value.restoreId !== owner.restoreId)
    throw fail();
}
async function releaseRestoreOwner(directory: string, owner: RestoreOwner) {
  try {
    await assertRestoreOwner(directory, owner);
    await unlink(join(directory, ".restore.lock"));
    const parent = await open(directory, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } finally {
    await owner.handle.close();
  }
}
/** Only explicit fresh-install initialization. A preexisting restore lock or state never implies a fresh install. */
export async function initializeRestoreState(directory: string) {
  const owner = await acquireRestoreOwner(directory);
  try {
    if ((await readdir(directory)).some((name) => name !== ".restore.lock")) throw fail();
    await assertRestoreOwner(directory, owner);
    await durableFile(
      join(directory, "state.json"),
      Buffer.from(
        JSON.stringify({
          version: 1,
          state: "open",
          restoreId: owner.restoreId,
          journal: null,
          updatedAt: new Date().toISOString(),
        } satisfies RestoreState),
      ),
    );
  } finally {
    await releaseRestoreOwner(directory, owner);
  }
}
async function closeOwnedRestoreState(
  directory: string,
  owner: RestoreOwner,
): Promise<RestoreState> {
  await assertRestoreOwner(directory, owner);
  const value: RestoreState = {
    version: 1,
    state: "closed",
    restoreId: owner.restoreId,
    journal: null,
    updatedAt: new Date().toISOString(),
  };
  await durableFile(join(directory, "state.json"), Buffer.from(JSON.stringify(value)));
  return value;
}
export async function closeRestoreState(directory: string): Promise<RestoreState> {
  const owner = await acquireRestoreOwner(directory);
  try {
    return await closeOwnedRestoreState(directory, owner);
  } finally {
    await releaseRestoreOwner(directory, owner);
  }
}
/** Only the coordinator holding the unchanged durable lock can open its current restore generation. */
async function openRestoreState(directory: string, owner: RestoreOwner, head: JournalHead) {
  await assertRestoreOwner(directory, owner);
  const v = await readRestoreState(directory);
  if (v.state !== "closed" || v.restoreId !== owner.restoreId) throw fail();
  await durableFile(
    join(directory, "state.json"),
    Buffer.from(
      JSON.stringify({ ...v, state: "open", journal: head, updatedAt: new Date().toISOString() }),
    ),
  );
}
export async function verifyRestoreBundle(directory: string): Promise<FullManifest> {
  const metadata = await lstat(join(directory, "manifest.json"));
  if (!metadata.isFile() || metadata.mode & 0o222 || metadata.size > 16 * 1024 * 1024)
    throw new Error("STORAGE_BUNDLE_INVALID");
  const m = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as FullManifest;
  if (m.version !== 1 || !Array.isArray(m.originals) || !m.dumps || !m.journal)
    throw new Error("STORAGE_BUNDLE_INVALID");
  for (const [name, expected] of Object.entries(m.dumps)) {
    if (!["community", "umami"].includes(name)) throw new Error("STORAGE_BUNDLE_INVALID");
    const path = join(directory, `${name}.dump`),
      metadata = await lstat(path);
    if (!metadata.isFile() || metadata.mode & 0o222) throw new Error("STORAGE_DUMP_INVALID");
    const actual = await fileDigest(path);
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256)
      throw new Error("STORAGE_DUMP_INVALID");
  }
  if (Object.keys(m.dumps).sort().join(",") !== "community,umami")
    throw new Error("STORAGE_BUNDLE_INVALID");
  const hashes = new Set<string>();
  for (const e of m.originals) {
    if (
      !/^[a-f0-9]{64}$/.test(e.sha256) ||
      hashes.has(e.sha256) ||
      !Number.isSafeInteger(e.size) ||
      e.size < 1 ||
      e.key !== `sha256/${e.sha256.slice(0, 2)}/${e.sha256.slice(2, 4)}/${e.sha256}` ||
      !e.policy ||
      !Array.isArray(e.recipes)
    )
      throw new Error("STORAGE_BUNDLE_INVALID");
    hashes.add(e.sha256);
    const path = join(directory, "originals", e.sha256),
      metadata = await lstat(path);
    if (!metadata.isFile() || metadata.mode & 0o222) throw new Error("STORAGE_ORIGINAL_INVALID");
    const actual = await fileDigest(path);
    if (actual.size !== e.size || actual.sha256 !== e.sha256)
      throw new Error("STORAGE_ORIGINAL_INVALID");
  }
  return m;
}
/** Replay minimum facts offline. Never run normal queue claims; current legitimate shared references survive. */
export async function replayJournal(
  c: Client,
  records: JournalRecord[],
  head: JournalHead,
  options: { onChartPending?: (diagnostic: ChartRestorePending) => void } = {},
) {
  if (!records.every(validJournalRecord)) throw new Error("STORAGE_JOURNAL_INVALID");
  const latestPermission = new Map<string, number>();
  for (const r of records) {
    const facts = r.kind === "chart_permission" ? [permissionFact.parse(r.payload)]
      : r.kind === "user_deleted" && r.payload ? retentionFact.parse(r.payload).retained : [];
    for (const fact of facts) {
      latestPermission.set(fact.chartId, Math.max(latestPermission.get(fact.chartId) ?? 0, r.sequence));
    }
  }
  const pending: ChartRestorePending[] = [];
  await c.query("begin");
  try {
    await c.query("select pg_advisory_xact_lock($1::bigint)", [714102026]);
    for (const r of records) {
      const reportPending = (diagnostic: ChartRestorePending) => {
        if (latestPermission.get(diagnostic.chartId) === r.sequence) pending.push(diagnostic);
      };
      if (r.kind === "user_deleted") {
        await replayDeletedUserCharts(c, r, reportPending);
        await c.query("delete from user_avatars where user_id=$1", [r.userId]);
        await c.query('delete from "user" where id=$1', [r.userId]);
      } else if (r.kind === "chart_permission") {
        await replayChartPermission(c, r, r.payload, reportPending);
      } else if (r.kind === "file_deleted") {
        await c.query(
          'update "user" set image=null where id in(select user_id from user_avatars where file_id=$1)',
          [r.fileId],
        );
        await c.query("delete from user_avatars where file_id=$1", [r.fileId]);
        await c.query(
          "update files set state='deleted',deleted_at=coalesce(deleted_at,$2),retained_until=$2::timestamptz+interval '30 days',original_name='removed' where id=$1",
          [r.fileId, r.createdAt],
        );
        // The logical File is exclusive to one version. A lost current version selects the newest
        // surviving ready history; the final whole-chart tombstone therefore cannot resurrect it.
        await c.query(`with lost as (
          update chart_versions set deleted_at=$2 where source_file_id=$1 and deleted_at is null returning chart_id,id
        ), affected as (
          select ch.id, ch.current_version_id=lost.id as lost_current,
            (select v.id from chart_versions v join files f on f.id=v.source_file_id
             where v.chart_id=ch.id and v.deleted_at is null and f.state='ready'
             order by v.ordinal desc limit 1) as replacement
          from charts ch join lost on lost.chart_id=ch.id
        ) update charts ch set
          current_version_id=case when a.lost_current then a.replacement else ch.current_version_id end,
          deleted_at=case when a.lost_current and a.replacement is null then coalesce(ch.deleted_at,$2) else ch.deleted_at end,
          revision=least(ch.revision::bigint+1,2147483647)::integer,updated_at=$2
          from affected a where ch.id=a.id`, [r.fileId, r.createdAt]);
      } else if (r.kind === "hash_blocked") {
        await c.query(
          "insert into blob_blocks(sha256,reason_code) values($1,'RESTORED_BLOCK') on conflict do nothing",
          [r.sha256],
        );
        await c.query(
          'update "user" set image=null where id in(select a.user_id from user_avatars a join files f on f.id=a.file_id join blobs b on b.id=f.blob_id join blob_derivatives br on br.id=a.derivative_id join derived_objects d on d.id=br.derived_object_id where b.sha256=$1 or d.output_sha256=$1)',
          [r.sha256],
        );
        await c.query(
          "update user_avatars a set suspended_at=coalesce(suspended_at,clock_timestamp()) from files f,blobs b,blob_derivatives br,derived_objects d where f.id=a.file_id and b.id=f.blob_id and br.id=a.derivative_id and d.id=br.derived_object_id and (b.sha256=$1 or d.output_sha256=$1)",
          [r.sha256],
        );
      }
      if (r.kind === "media_revoked" && !globalMediaRevocation(r)) {
        // Exact old association + revision fence: shared owners and later saves survive an older fact.
        await c.query(
          'with withdrawn as (update user_avatars a set file_id=null,derivative_id=null,revision=$4,suspended_at=null,updated_at=clock_timestamp() from blob_derivatives br,derived_objects d where a.user_id=$1 and a.file_id=$2 and a.revision<$4 and a.derivative_id=br.id and br.derived_object_id=d.id and d.output_sha256=$3 returning a.user_id) update "user" u set image=null,updated_at=clock_timestamp() where u.id in(select user_id from withdrawn) and u.image=$5',
          [r.userId, r.fileId, r.sha256, r.generation, `/media/${r.sha256}.jpg`],
        );
      }
      if (globalMediaRevocation(r)) {
        const publication = await c.query(
          "select generation from media_publications where output_sha256=$1 for update",
          [r.sha256],
        );
        // This fact says the last public reference was withdrawn at this generation. Only older snapshot associations are stale.
        if (publication.rowCount && Number(publication.rows[0].generation) < Number(r.generation)) {
          await c.query('update "user" set image=null where image=$1', [`/media/${r.sha256}.jpg`]);
          await c.query(
            "update user_avatars a set file_id=null,derivative_id=null,revision=revision+1,suspended_at=null,updated_at=clock_timestamp() from blob_derivatives br,derived_objects d where a.derivative_id=br.id and br.derived_object_id=d.id and d.output_sha256=$1",
            [r.sha256],
          );
        }
      }
      await c.query(
        "insert into storage_tombstones(sequence,kind,user_id,file_id,sha256,generation,created_at,payload) overriding system value values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(sequence) do nothing",
        [r.sequence, r.kind, r.userId, r.fileId, r.sha256, r.generation, r.createdAt, r.payload ? JSON.stringify(r.payload) : null],
      );
    }
    // Unbacked tmp cannot be resurrected. All roles are stopped, so these old leases own no future IO.
    await c.query(
      "update upload_sessions set state='cancelled',generation=generation+1,reserved_bytes=0,error_code='UPLOAD_CANCELLED',updated_at=clock_timestamp() where state in('receiving','processing')",
    );
    await c.query("delete from upload_parts");
    await c.query(
      "update upload_attempts set state='deleted',generation=generation+1,reserved_bytes=0,written_bytes=0,updated_at=clock_timestamp()",
    );
    await c.query("update files set state='rejected' where state='processing'");
    await c.query(
      "update storage_usage u set used_bytes=coalesce((select sum(size) from files f where f.owner_id=u.user_id and f.state='ready'),0),reserved_bytes=0,active_uploads=0,updated_at=clock_timestamp()",
    );
    await c.query(
      "update blobs set state='deleted',generation=generation+1,lease_until=null where state in('pending','deleting')",
    );
    await c.query(
      "update derived_objects set state='deleted',generation=generation+1,lease_until=null where state in('pending','deleting')",
    );
    await c.query(
      "update storage_quarantine set state='deleted',generation=generation+1,delete_started_at=coalesce(delete_started_at,clock_timestamp()),delete_uncertain=false where state<>'deleted'",
    );
    await c.query(
      "update storage_budget set temporary_reserved=0,temporary_written=0,original_reserved=0,original_written=coalesce((select sum(size) from blobs where state='ready'),0)+coalesce((select sum(size) from storage_quarantine where state<>'deleted'),0),derived_reserved=0,derived_written=coalesce((select sum(size) from derived_objects where state='ready'),0),updated_at=clock_timestamp() where id='global'",
    );
    await c.query(
      "update storage_maintenance set owner_id=null,lease_until=null where id='global'",
    );
    await c.query(
      "delete from pgboss.job where name in ('storage.ingest','media.avatar','media.chart-import','storage.finalize')",
    );
    // SQL mirrors actual avatar public-representation predicate; revocations never erase surviving shared references.
    const hashes = new Set(
      records
        .filter((r) => globalMediaRevocation(r) || r.kind === "hash_blocked")
        .map((r) => r.sha256)
        .filter((s): s is string => !!s),
    );
    const pubs = (
      await c.query(
        "select output_sha256,generation,state from media_publications where state in('public','revoking','blocked') order by output_sha256 for update",
      )
    ).rows;
    const affected: { hash: string; generation: number }[] = [];
    for (const p of pubs) {
      const valid = await c.query(
        `select 1 from user_avatars a join "user" u on u.id=a.user_id join files f on f.id=a.file_id join blobs b on b.id=f.blob_id join blob_derivatives r on r.id=a.derivative_id and r.source_blob_id=b.id join derived_objects d on d.id=r.derived_object_id where d.output_sha256=$1 and u.status='active' and a.suspended_at is null and f.owner_id=u.id and f.state='ready' and f.purpose='avatar' and b.state='ready' and r.state='ready' and r.recipe='avatar-v1' and d.state='ready' and not exists(select 1 from blob_blocks where sha256 in(b.sha256,d.output_sha256)) limit 1`,
        [p.output_sha256],
      );
      if (valid.rowCount && p.state !== "blocked") continue;
      if (
        p.state === "public" ||
        hashes.has(p.output_sha256) ||
        p.state === "revoking" ||
        p.state === "blocked"
      ) {
        const gen = Math.max(
          Number(p.generation) + 1,
          ...records
            .filter((r) => globalMediaRevocation(r) && r.sha256 === p.output_sha256)
            .map((r) => r.generation ?? 0),
        );
        const blocked = await c.query(
          "select 1 from blob_blocks where sha256=$1 or sha256 in(select b.sha256 from blob_derivatives br join blobs b on b.id=br.source_blob_id join derived_objects d on d.id=br.derived_object_id where d.output_sha256=$1) limit 1",
          [p.output_sha256],
        );
        await c.query(
          "update media_publications set state=$3,generation=$2,updated_at=clock_timestamp() where output_sha256=$1",
          [
            p.output_sha256,
            gen,
            p.state === "blocked" || blocked.rowCount ? "blocked" : "revoking",
          ],
        );
        await c.query(
          "insert into media_purge_requests(output_sha256,generation) values($1,$2) on conflict do nothing",
          [p.output_sha256, gen],
        );
        affected.push({ hash: p.output_sha256, generation: gen });
      }
    }
    await c.query(
      "update storage_journal_progress set exported_sequence=$1,chain_hash=$2,exported_at=$3,updated_at=clock_timestamp() where id='global'",
      [head.sequence, head.sequence ? head.hash : null, head.sequence ? head.capturedAt : null],
    );
    await c.query(
      "select setval(pg_get_serial_sequence('storage_tombstones','sequence'),greatest($1,coalesce((select max(sequence) from storage_tombstones),0),1),true)",
      [head.sequence],
    );
    await c.query("commit");
    for (const diagnostic of pending) {
      if (options.onChartPending) options.onChartPending(diagnostic);
      else console.warn(JSON.stringify(diagnostic));
    }
    return affected;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  }
}
/** Include revocations created by native drift and restored current outboxes; ordinary queue consumers remain stopped. */
async function currentRestoreRevocations(c: Client) {
  const rows = await c.query(`select p.output_sha256 as hash,p.generation from media_publications p
    left join media_purge_requests r on r.output_sha256=p.output_sha256 and r.generation=p.generation
    where p.state in ('revoking','blocked') or r.state<>'done' order by p.output_sha256`);
  return rows.rows.map((row) => ({ hash: String(row.hash), generation: Number(row.generation) }));
}
/** The coordinator itself gates OPEN on current terminal state and the existing strict protocol evidence. */
async function assertRestoreRevocations(c: Client, targets: { hash: string; generation: number }[]) {
  await c.query("begin");
  try {
    await c.query("select pg_advisory_xact_lock($1::bigint)", [714102026]);
    const db = drizzle({ client: c, schema, casing: "snake_case" });
    const hashes = targets.map((data) => data.hash);
    // Lock each whole class in its stable order, before moving to the next class.
    await c.query("select id from derived_objects where output_sha256=any($1::text[]) order by id for update", [hashes]);
    const publications = (await c.query("select * from media_publications where output_sha256=any($1::text[]) order by output_sha256 for update", [hashes])).rows;
    const outboxes = (await c.query("select * from media_purge_requests where output_sha256=any($1::text[]) order by output_sha256,generation for update", [hashes])).rows;
    for (const data of targets) {
      const pub = publications.find((row) => row.output_sha256 === data.hash);
      const out = outboxes.find((row) => row.output_sha256 === data.hash && Number(row.generation) === data.generation);
      if (Number(pub?.generation) !== data.generation || !["private", "blocked"].includes(pub.state) ||
        out?.state !== "done" || !completeMediaPurgeEvidence(out.evidence, data.generation) ||
        await hasPublicRepresentation(db, data.hash)) throw fail();
    }
    const pending = await c.query(`select 1 from media_publications p left join media_purge_requests r
      on r.output_sha256=p.output_sha256 and r.generation=p.generation
      where p.state='revoking' or r.state<>'done' limit 1`);
    if (pending.rowCount || (await currentRestoreRevocations(c)).some((row) =>
      !targets.some((target) => target.hash === row.hash && target.generation === row.generation))) throw fail();
    await c.query("commit");
  } catch (error) {
    await c.query("rollback").catch(() => {});
    throw error;
  }
}
export type RestoreOptions = {
  stateDirectory: string;
  bundleDirectory: string;
  journal: JournalConfig;
  databaseUrl: string;
  stopAndConfirmNormal: () => Promise<void>;
  replaceDatabases: (manifest: FullManifest) => Promise<void>;
  restoreOriginals: (entries: OriginalEntry[], directory: string) => Promise<void>;
  rebuild: () => Promise<void>;
  startRecovery: () => Promise<{ stopAndConfirm(): Promise<void> }>;
  revoke: (data: { hash: string; generation: number }) => Promise<void>;
  verifyInvariants: () => Promise<void>;
};
/** Failure never opens in finally. Coordinator callbacks are actual owned process/IO operations, never implicit ACKs. */
export async function restoreOriginals(options: RestoreOptions) {
  const started = performance.now();
  const owner = await acquireRestoreOwner(options.stateDirectory);
  let safeRelease = true;
  try {
    await closeOwnedRestoreState(options.stateDirectory, owner);
    const outside = [resolve(options.stateDirectory), resolve(options.journal.directory)];
    if (
      outside.some(
        (p) =>
          p === resolve(options.bundleDirectory) ||
          p.startsWith(`${resolve(options.bundleDirectory)}/`),
      )
    )
      throw fail();
    safeRelease = false;
    await options.stopAndConfirmNormal();
    safeRelease = true;
    const manifest = await verifyRestoreBundle(options.bundleDirectory);
    const latest = await verifyLatestJournal(options.journal, manifest.journal);
    await assertRestoreOwner(options.stateDirectory, owner);
    safeRelease = false;
    await options.replaceDatabases(manifest);
    await options.restoreOriginals(manifest.originals, options.bundleDirectory);
    const c = new Client({ connectionString: options.databaseUrl, connectionTimeoutMillis: 5000 });
    await c.connect();
    try {
      // A dump before numeric IDs must not assign an old snapshot a number already issued later.
      // Migration seeds all durable reservations, even charts absent from this snapshot, before backfill.
      const identities = new Map<string, string>();
      for (const record of latest.records) {
        const facts = record.kind === "chart_permission" ? [permissionFact.parse(record.payload)]
          : record.kind === "user_deleted" && record.payload ? retentionFact.parse(record.payload).retained : [];
        for (const fact of facts) if (fact.publicId) {
          const prior = identities.get(fact.chartId);
          if (prior && prior !== fact.publicId) throw new Error("CHART_PUBLIC_ID_CONFLICT");
          identities.set(fact.chartId, fact.publicId);
        }
      }
      await c.query("select set_config('astrodx.restore_chart_public_ids',$1,false)", [
        JSON.stringify([...identities].map(([chartId, publicId]) => ({ chartId, publicId }))),
      ]);
      // Restored dumps can predate additive publication and journal columns. Upgrade while closed.
      await migrate(drizzle(c), { migrationsFolder: fileURLToPath(new URL("../../src/server/db/migrations", import.meta.url)) });
      await replayJournal(c, latest.records, latest.head);
      await options.rebuild();
      const targets = await currentRestoreRevocations(c);
      const recovery = await options.startRecovery();
      try {
        for (const data of targets) await options.revoke(data);
        await options.verifyInvariants();
      } finally {
        await recovery.stopAndConfirm();
      }
      await assertRestoreRevocations(c, targets);
    } finally {
      await c.end();
    }
    // Re-read live external latest head: a concurrent source deletion invalidates this restoration, even if earlier head was signed.
    const current = await verifyLatestJournal(options.journal, manifest.journal);
    if (current.head.hash !== latest.head.hash || current.head.sequence !== latest.head.sequence)
      throw fail();
    await openRestoreState(options.stateDirectory, owner, latest.head);
    safeRelease = true;
    return { rtoMs: performance.now() - started, rpoMs: 86400000, head: latest.head };
  } finally {
    // Any later-phase failure can hide unresolved remote IO behind a generic error. No automatic takeover.
    if (safeRelease) await releaseRestoreOwner(options.stateDirectory, owner);
    else await owner.handle.close();
  }
}

/** Explicit CLOSED offline relocation; never weaken the ordinary recorded-namespace guard. */
export async function restoreVerifiedOriginals(
  ctx: StorageContext,
  entries: OriginalEntry[],
  bundle: string,
  stateDirectory: string,
  restoreId: string,
) {
  const state = await readRestoreState(stateDirectory);
  if (state.state !== "closed" || state.restoreId !== restoreId || ctx.config.role !== "media")
    throw fail();
  const policies = new Map<string, OriginalEntry["policy"]>();
  for (const e of entries) {
    const old = policies.get(e.policy.id);
    if (old && JSON.stringify(old) !== JSON.stringify(e.policy))
      throw new Error("STORAGE_NAMESPACE_MISMATCH");
    policies.set(e.policy.id, e.policy);
  }
  const c = new Client({
    connectionString: (
      ctx.db as import("../../src/server/db/client").Db & { $client: import("pg").Pool }
    ).$client.options.connectionString,
    connectionTimeoutMillis: 5000,
  });
  await c.connect();
  try {
    for (const p of policies.values()) {
      const r = await c.query("select * from storage_policies where id=$1", [p.id]);
      const old = r.rows[0];
      if (
        !old ||
        old.endpoint !== p.endpoint ||
        old.region !== p.region ||
        old.original_bucket !== p.originalBucket ||
        old.derived_bucket !== p.derivedBucket
      )
        throw new Error("STORAGE_NAMESPACE_MISMATCH");
    }
    for (const e of entries) {
      const path = join(bundle, "originals", e.sha256),
        actual = await fileDigest(path);
      if (actual.size !== e.size || actual.sha256 !== e.sha256)
        throw new Error("STORAGE_ORIGINAL_INVALID");
      const current = await readRestoreState(stateDirectory);
      if (current.restoreId !== restoreId || current.state !== "closed") throw fail();
      const signal = AbortSignal.timeout(120000);
      const present = await ctx.driver.head({ bucket: "original", key: e.key, signal });
      if (!present)
        await ctx.driver.put({
          bucket: "original",
          key: e.key,
          body: Bun.file(path).stream(),
          size: e.size,
          mime: e.mime,
          sha256: e.sha256,
          signal,
        });
      const data = await ctx.driver.get({ bucket: "original", key: e.key, signal });
      const digest = new Bun.CryptoHasher("sha256");
      let total = 0;
      for await (const bytes of data.body) {
        total += bytes.length;
        if (total > e.size) throw new Error("STORAGE_ORIGINAL_INVALID");
        digest.update(bytes);
      }
      if (total !== e.size || digest.digest("hex") !== e.sha256)
        throw new Error("STORAGE_ORIGINAL_INVALID");
    }
    await c.query("begin");
    try {
      await c.query("select pg_advisory_xact_lock($1::bigint)", [714102026]);
      for (const p of policies.values()) {
        const r = await c.query(
          "update storage_policies set endpoint=$2,region=$3,original_bucket=$4,derived_bucket=$5 where id=$1 and endpoint=$6 and region=$7 and original_bucket=$8 and derived_bucket=$9 returning id",
          [
            p.id,
            ctx.config.endpoint,
            ctx.config.region,
            ctx.config.originalBucket,
            ctx.config.derivedBucket,
            p.endpoint,
            p.region,
            p.originalBucket,
            p.derivedBucket,
          ],
        );
        if (r.rowCount !== 1) throw new Error("STORAGE_NAMESPACE_MISMATCH");
      }
      const current = await readRestoreState(stateDirectory);
      if (current.restoreId !== restoreId || current.state !== "closed") throw fail();
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  } finally {
    await c.end();
  }
}
