import {preservePayloadShape,journalBatchPrefix} from "./journal-codec";
import { communityContentFact, type CommunityContentFact } from "../../src/shared/community-content-journal";
import { userPublicIdFact, type UserPublicIdFact } from "../../src/shared/user-journal";
import { permissionFact, retentionFact, type ChartJournalPayload } from "../../src/shared/chart-journal";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, readdir, unlink, link } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { STORAGE_LOCK_KEY } from "../../src/server/storage/transactions";
export type JournalConfig = { directory: string; keyFile: string; databaseUrl: string };
export type JournalHead = { sequence: number; hash: string; capturedAt: string };
export type JournalRecord = {
  sequence: number;
  kind: "user_deleted" | "file_deleted" | "hash_blocked" | "media_revoked" | "chart_permission" | "user_public_id" | "community_content";
  payload?: ChartJournalPayload | UserPublicIdFact | CommunityContentFact;
  userId: string | null;
  fileId: string | null;
  sha256: string | null;
  generation: number | null;
  createdAt: string;
};
/** media_revoked: null identities use publication generation; paired identities use the new avatar revision. */
export function validJournalRecord(r: JournalRecord): boolean {
  if (
    !Number.isSafeInteger(r.sequence) ||
    r.sequence <= 0 ||
    !Number.isFinite(Date.parse(r.createdAt))
  )
    return false;
  const userId = typeof r.userId === "string" && r.userId.length > 0;
  const fileId =
    typeof r.fileId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.fileId);
  const hash = typeof r.sha256 === "string" && /^[a-f0-9]{64}$/.test(r.sha256);
  if (r.kind === "community_content")
    return (r.userId === null || userId) && r.fileId === null && r.sha256 === null && r.generation === null && communityContentFact.safeParse(r.payload).success;
  if (r.kind === "user_public_id")
    return userId && r.fileId === null && r.sha256 === null && r.generation === null &&
      userPublicIdFact.safeParse(r.payload).success;
  if (r.kind === "chart_permission")
    return (r.userId === null || userId) && r.fileId === null && r.sha256 === null &&
      r.generation === null && permissionFact.safeParse(r.payload).success;
  if (r.kind === "user_deleted")
    return userId && (r.payload === undefined || retentionFact.safeParse(r.payload).success);
  if (r.payload !== undefined) return false;
  if (r.kind === "file_deleted") return fileId;
  if (r.kind === "hash_blocked") return hash;
  if (
    r.kind !== "media_revoked" ||
    !hash ||
    !Number.isSafeInteger(r.generation) ||
    r.generation === null ||
    r.generation < 0
  )
    return false;
  return (r.userId === null && r.fileId === null) || (userId && fileId && r.generation > 0);
}
export const globalMediaRevocation = (r: JournalRecord) =>
  r.kind === "media_revoked" && r.userId === null && r.fileId === null;
type Segment = { version: 1; previous: JournalHead; head: JournalHead; records: JournalRecord[] };
const genesis: JournalHead = {
  sequence: 0,
  hash: "0".repeat(64),
  capturedAt: "1970-01-01T00:00:00.000Z",
};
const PUBLISH_LOCK = 714102027;
const fail = () => new Error("STORAGE_JOURNAL_UNVERIFIED");
const validHead = (h: JournalHead) =>
  h &&
  Number.isSafeInteger(h.sequence) &&
  h.sequence >= 0 &&
  /^[a-f0-9]{64}$/.test(h.hash) &&
  Number.isFinite(Date.parse(h.capturedAt));
const equal = (a: JournalHead, b: JournalHead) => a.sequence === b.sequence && a.hash === b.hash;
const digest = (previous: string, records: JournalRecord[]) =>
  createHash("sha256").update(previous).update(JSON.stringify(records)).digest("hex");
async function key(config: JournalConfig) {
  const s = await lstat(config.keyFile);
  if (!s.isFile() || (s.mode & 0o777) !== 0o600 || s.size !== 32) throw fail();
  return readFile(config.keyFile);
}
export async function durableFile(
  path: string,
  bytes: Uint8Array,
  mode = 0o600,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  const f = await open(tmp, "wx", mode);
  try {
    await f.writeFile(bytes);
    await f.sync();
  } finally {
    await f.close();
  }
  try {
    signal?.throwIfAborted();
    await rename(tmp, path);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
  const d = await open(join(path, ".."), "r");
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}
function seal(value: unknown, k: Buffer, aad: unknown) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", k, nonce);
  const a = JSON.stringify(aad);
  cipher.setAAD(Buffer.from(a));
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.from(
    JSON.stringify({
      version: 1,
      aad,
      nonce: nonce.toString("hex"),
      body: body.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
    }),
  );
}
function unseal<T>(bytes: Buffer, k: Buffer): T {
  try {
    const e = JSON.parse(bytes.toString());
    if (
      e.version !== 1 ||
      !/^[a-f0-9]{24}$/.test(e.nonce) ||
      !/^[a-f0-9]{32}$/.test(e.tag) ||
      typeof e.body !== "string" ||
      e.body.length > 32 * 1024 * 1024
    )
      throw fail();
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(e.nonce, "hex"));
    d.setAAD(Buffer.from(JSON.stringify(e.aad)));
    d.setAuthTag(Buffer.from(e.tag, "hex"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(e.body, "hex")), d.final()]).toString());
  } catch {
    throw fail();
  }
}
async function readHead(path: string, k: Buffer) {
  const h = unseal<JournalHead>(await readFile(path), k);
  if (!validHead(h)) throw fail();
  return h;
}
async function publishHead(config: JournalConfig, k: Buffer, h: JournalHead, signal: AbortSignal, name = "head.json") {
  await durableFile(
    join(config.directory, name),
    seal(h, k, { version: 1, sequence: h.sequence, hash: h.hash }),
    0o600, signal,
  );
}
const publisherPath = (config: JournalConfig) => join(config.directory, ".publisher.lock");
async function assertNoPublisher(config: JournalConfig) {
  try { await lstat(publisherPath(config)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
  throw new Error("STORAGE_JOURNAL_PUBLISHER_ACTIVE");
}
async function syncDirectory(directory: string) {
  const d = await open(directory, "r");
  try { await d.sync(); } finally { await d.close(); }
}
async function dedicated<T>(
  config: JournalConfig,
  fn: (c: Client, signal: AbortSignal) => Promise<T>,
  external?: AbortSignal,
) {
  const signal = AbortSignal.any([AbortSignal.timeout(45000), ...(external ? [external] : [])]);
  signal.throwIfAborted();
  const c = new Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });
  c.on("error", () => {});
  const owner = crypto.randomUUID();
  let abort: () => void = () => {};
  const expired = new Promise<never>((_, reject) => {
    abort = () => { void c.end().catch(() => {}); reject(new Error("STORAGE_JOURNAL_DEADLINE")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  // The caller may time out; this promise still owns every started FS operation.
  // Failed/aborted publishers retain their durable marker, even after their callbacks settle.
  const work = (async () => {
    try {
      await c.connect();
      await c.query("set statement_timeout='40s';set lock_timeout='40s';set idle_session_timeout='45s'");
      await c.query("select pg_advisory_lock($1::bigint)", [PUBLISH_LOCK]);
      signal.throwIfAborted();
      const path = publisherPath(config);
      let f: Awaited<ReturnType<typeof open>>;
      try { f = await open(path, "wx", 0o600); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error("STORAGE_JOURNAL_PUBLISHER_ACTIVE"); throw e; }
      let identity: Awaited<ReturnType<typeof lstat>>;
      try {
        identity = await f.stat();
        await f.writeFile(JSON.stringify({ owner, pid: process.pid, startedAt: new Date().toISOString() }));
        await f.sync();
      } finally { await f.close(); }
      await syncDirectory(config.directory);
      signal.throwIfAborted();
      const result = await fn(c, signal);
      signal.throwIfAborted();
      // Only the exact owner, after successful checkpoint/publication and actual FS quiescence, can unlock.
      const current = await lstat(path);
      if (current.ino !== identity.ino || current.dev !== identity.dev || JSON.parse(await readFile(path, "utf8")).owner !== owner)
        throw new Error("STORAGE_JOURNAL_PUBLISHER_CHANGED");
      signal.throwIfAborted();
      await unlink(path);
      await syncDirectory(config.directory);
      return result;
    } finally { await c.end().catch(() => {}); }
  })();
  try { return await Promise.race([work, expired]); }
  finally { signal.removeEventListener("abort", abort); }
}
/** Task11 invokes this explicitly once. Missing state never implicitly becomes genesis. */
export async function initializeJournal(config: JournalConfig) {
  const k = await key(config);
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  return dedicated(config, async (c, signal) => {
    const files = (await readdir(config.directory)).filter((name) => name !== ".publisher.lock");
    if (files.length) throw fail();
    const r = await c.query(
      "select exported_sequence,chain_hash from storage_journal_progress where id='global'",
    );
    if (
      r.rowCount !== 1 ||
      Number(r.rows[0].exported_sequence) !== 0 ||
      r.rows[0].chain_hash !== null
    )
      throw fail();
    await publishHead(config, k, genesis, signal, "anchor.json");
    await publishHead(config, k, genesis, signal);
  });
}
async function segmentsIn(config: JournalConfig, k: Buffer) {
  const names = (await readdir(config.directory)).filter((n) =>
    /^segment-\d+-[a-f0-9]{64}\.json$/.test(n),
  );
  return Promise.all(
    names.map(async (name) => ({
      name,
      segment: unseal<Segment>(await readFile(join(config.directory, name)), k),
    })),
  );
}
function publishedChain(all: Segment[], anchor: JournalHead, latest: JournalHead) {
  const chain: Segment[] = [];
  let cursor = latest;
  while (!equal(cursor, anchor)) {
    const matches = all.filter(
      (s) => s.version === 1 && validHead(s.head) && equal(s.head, cursor),
    );
    if (matches.length !== 1) throw fail();
    const segment = matches[0];
    if (
      !validHead(segment.previous) ||
      segment.previous.sequence >= cursor.sequence ||
      chain.length >= all.length
    )
      throw fail();
    chain.unshift(segment);
    cursor = segment.previous;
  }
  return chain;
}
/** Read only the authoritative outside-snapshot directory. A bundle's old signed head is never a latest witness. */
async function verifyJournal(
  config: JournalConfig,
  from?: JournalHead,
): Promise<{ head: JournalHead; anchor: JournalHead; records: JournalRecord[] }> {
  const k = await key(config),
    anchor = await readHead(join(config.directory, "anchor.json"), k),
    latest = await readHead(join(config.directory, "head.json"), k);
  let current = anchor;
  let found = !from || equal(from, anchor);
  const records: JournalRecord[] = [];
  const segments = (await segmentsIn(config, k)).map((item) => item.segment);
  const chain = publishedChain(segments, anchor, latest);
  for (const s of chain) {
    if (!equal(s.previous, current)) throw fail();
    if (!validHead(s.head) || !s.records.length || s.records.length > 1000) throw fail();
    let previous = current.sequence;
    for (const r of s.records) {
      if (r.sequence <= previous || !validJournalRecord(r)) throw fail();
      previous = r.sequence;
    }
    if (s.head.sequence !== previous || s.head.hash !== digest(current.hash, s.records))
      throw fail();
    if (found) records.push(...s.records);
    current = s.head;
    if (from && equal(from, current)) found = true;
  }
  if (!found) throw fail();
  return { head: latest, anchor, records };
}
/** A publisher marker fences restore too; verify a stable head/anchor, never a timed-out writer's partial state. */
export async function verifyLatestJournal(config: JournalConfig, from?: JournalHead) {
  await assertNoPublisher(config);
  const verified = await verifyJournal(config, from);
  const k = await key(config);
  if (!equal(await readHead(join(config.directory, "head.json"), k), verified.head) ||
      !equal(await readHead(join(config.directory, "anchor.json"), k), verified.anchor)) throw fail();
  await assertNoPublisher(config);
  return verified;
}
function record(r: Record<string, unknown>): JournalRecord {
  const result: JournalRecord = {
    sequence: Number(r.sequence),
    kind: r.kind as JournalRecord["kind"],
    userId: r.user_id as string | null,
    fileId: r.file_id as string | null,
    sha256: r.sha256 as string | null,
    generation: r.generation === null ? null : Number(r.generation),
    createdAt: new Date(r.created_at as string).toISOString(),
  };
  // Never add payload:null to legacy records: their exact JSON bytes are already hash chained.
  if (r.payload != null) {
    const parsed = result.kind === "chart_permission"
      ? permissionFact.parse(r.payload) : result.kind === "community_content" ? communityContentFact.parse(r.payload) : result.kind === "user_public_id" ? userPublicIdFact.parse(r.payload) : retentionFact.parse(r.payload);
    result.payload=preservePayloadShape(parsed,r.payload);
  }
  if (!validJournalRecord(result)) throw fail();
  return result;
}
/** A short exclusive READ COMMITTED visibility barrier drains identity allocators before its NEXT statement reads. */
export async function exportJournal(
  config: JournalConfig,
  external?: AbortSignal,
): Promise<JournalHead> {
  const signal = external ?? AbortSignal.timeout(45000);
  signal.throwIfAborted();
  return dedicated(
    config,
    async (c, signal) => {
      const k = await key(config);
      const verified = await verifyJournal(config);
      let current = verified.head;
      const progress = await c.query(
        "select exported_sequence,chain_hash from storage_journal_progress where id='global'",
      );
      if (progress.rowCount !== 1) throw fail();
      const p = progress.rows[0];
      if (
        Number(p.exported_sequence) > current.sequence ||
        (Number(p.exported_sequence) === current.sequence &&
          (p.chain_hash ?? genesis.hash) !== current.hash)
      )
        throw fail();
      if (Number(p.exported_sequence) < current.sequence) {
        // Durable publication may precede its DB CAS. Authenticate the exact committed suffix before reconciling.
        const old = {
          sequence: Number(p.exported_sequence),
          hash: p.chain_hash ?? genesis.hash,
          capturedAt: genesis.capturedAt,
        };
        const suffix = await verifyJournal(config, old);
        const dbRecords = (
          await c.query(
            "select * from storage_tombstones where sequence>$1 and sequence<=$2 order by sequence",
            [old.sequence, current.sequence],
          )
        ).rows.map(record);
        if (JSON.stringify(dbRecords) !== JSON.stringify(suffix.records)) throw fail();
        await checkpoint(c, old, current);
      }
      for (let batch = 0; batch < 100; batch++) {
        await c.query("begin");
        let rows: JournalRecord[];
        try {
          await c.query("select pg_advisory_xact_lock($1::bigint)", [STORAGE_LOCK_KEY]);
          rows = (
            await c.query(
              "select * from storage_tombstones where sequence>$1 order by sequence limit 1000",
              [current.sequence],
            )
          ).rows.map(record);
          await c.query("commit");
        } catch (e) {
          await c.query("rollback").catch(() => {});
          throw e;
        }
        if (!rows.length) return current;
        rows=journalBatchPrefix(rows);
        // A segment may be durable while its head was never published. Promote ONLY an exact committed prefix.
        const orphans = (await segmentsIn(config, k))
          .map((item) => item.segment)
          .filter((s) => s.version === 1 && equal(s.previous, current))
          .sort((a, b) => a.head.sequence - b.head.sequence);
        if (orphans.length) {
          const orphan = orphans[0];
          const prefix = rows.filter((r) => r.sequence <= orphan.head.sequence);
          if (
            !validHead(orphan.head) ||
            !prefix.length ||
            prefix[prefix.length - 1].sequence !== orphan.head.sequence ||
            JSON.stringify(prefix) !== JSON.stringify(orphan.records) ||
            digest(current.hash, prefix) !== orphan.head.hash
          )
            throw fail();
          signal.throwIfAborted();
          await publishHead(config, k, orphan.head, signal);
          signal.throwIfAborted();
          await checkpoint(c, current, orphan.head);
          current = orphan.head;
          continue;
        }

        if (Buffer.byteLength(JSON.stringify(rows)) > 8 * 1024 * 1024) throw fail();
        let h: JournalHead = {
          sequence: rows[rows.length - 1].sequence,
          hash: digest(current.hash, rows),
          capturedAt: new Date().toISOString(),
        };
        const segment: Segment = { version: 1, previous: current, head: h, records: rows };
        const name = `segment-${h.sequence}-${h.hash}.json`;
        const encrypted = seal(segment, k, { version: 1, previous: current, cursor: h.sequence });
        // Immutable publication; crash orphan segments are ignored until authenticated head includes them.
        const path = join(config.directory, name);
        try {
          const temp = `${path}.${crypto.randomUUID()}.tmp`;
          const f = await open(temp, "wx", 0o600);
          try {
            await f.writeFile(encrypted);
            await f.sync();
          } finally {
            await f.close();
          }
          try {
            signal.throwIfAborted();
            await link(temp, path);
          } finally {
            await unlink(temp);
          }
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          const existing = unseal<Segment>(await readFile(path), k);
          if (
            !equal(existing.previous, current) ||
            existing.head.sequence !== h.sequence ||
            existing.head.hash !== h.hash ||
            JSON.stringify(existing.records) !== JSON.stringify(rows)
          )
            throw fail();
          h = existing.head;
        }
        const d = await open(config.directory, "r");
        try {
          await d.sync();
        } finally {
          await d.close();
        }
        signal.throwIfAborted();
        await publishHead(config, k, h, signal);
        signal.throwIfAborted();
        await checkpoint(c, current, h);
        current = h;
      }
      throw new Error("STORAGE_JOURNAL_LAG");
    },
    signal,
  );
}
async function checkpoint(c: Client, previous: JournalHead, next: JournalHead) {
  await c.query("begin");
  try {
    await c.query("select pg_advisory_xact_lock_shared($1::bigint)", [STORAGE_LOCK_KEY]);
    const r = await c.query(
      "update storage_journal_progress set exported_sequence=$1,chain_hash=$2,exported_at=$3,updated_at=clock_timestamp() where id='global' and exported_sequence=$4 and (chain_hash=$5 or ($4=0 and chain_hash is null)) returning id",
      [next.sequence, next.hash, next.capturedAt, previous.sequence, previous.hash],
    );
    if (r.rowCount !== 1) throw fail();
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  }
}
/** Seven calendar months; preserve an authenticated anchor and refuse snapshots preceding it. */
export async function retainJournal(config: JournalConfig, now = new Date(), external?: AbortSignal) {
  return dedicated(config, async (_c, signal) => {
    const k = await key(config);
    await verifyJournal(config);
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - 7);
    let anchor = await readHead(join(config.directory, "anchor.json"), k);
    const all = await segmentsIn(config, k),
      latest = await readHead(join(config.directory, "head.json"), k);
    const chain = publishedChain(
      all.map((item) => item.segment),
      anchor,
      latest,
    );
    const old = all
      .filter(
        (item) =>
          chain.includes(item.segment) &&
          Date.parse(item.segment.head.capturedAt) < cutoff.getTime(),
      )
      .map((item) => ({ name: item.name, s: item.segment }));
    old.sort((a, b) => a.s.head.sequence - b.s.head.sequence);
    for (const item of old) {
      if (!equal(item.s.previous, anchor)) continue;
      anchor = item.s.head;
      await publishHead(config, k, anchor, signal, "anchor.json");
      signal.throwIfAborted();
      await unlink(join(config.directory, item.name));
    }
  }, external);
}
