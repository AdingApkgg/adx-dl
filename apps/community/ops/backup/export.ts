import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, rename, rm, stat, statfs, link } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "pg";
import type { StorageContext } from "../../src/server/storage/contracts";
import {
  acquireStorageMaintenance,
  releaseStorageMaintenance,
  withStorageSnapshot,
  type MaintenanceLease,
} from "../../src/server/storage/maintenance";
import { exportJournal, durableFile, type JournalConfig, type JournalHead } from "./journal";
export type OriginalEntry = {
  id: string;
  sha256: string;
  key: string;
  size: number;
  mime: string;
  policy: {
    id: string;
    endpoint: string;
    region: string;
    originalBucket: string;
    derivedBucket: string;
  };
  recipes: { id: string; recipe: string; recipeBuild: string; outputSha256: string | null }[];
};
export type FullManifest = {
  version: 1;
  createdAt: string;
  journal: JournalHead;
  originals: OriginalEntry[];
  dumps: { community: { size: number; sha256: string }; umami: { size: number; sha256: string } };
};
const FLOOR = 5 * 1024 ** 3;
export async function fileDigest(path: string) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const bytes of Bun.file(path).stream()) {
    size += bytes.length;
    hash.update(bytes);
  }
  return { size, sha256: hash.digest("hex") };
}
export async function verifiedStaging(path: string, entry: Pick<OriginalEntry, "size" | "sha256">) {
  try {
    const s = await lstat(path);
    if (!s.isFile() || s.mode & 0o222) return false;
    const actual = await fileDigest(path);
    return actual.size === entry.size && actual.sha256 === entry.sha256;
  } catch {
    return false;
  }
}
/** Streams actual bytes; unverified/partial data is never eligible for reuse. */
export async function stageOriginal(
  ctx: StorageContext,
  entry: OriginalEntry,
  directory: string,
  signal: AbortSignal,
) {
  if (
    entry.policy.endpoint !== ctx.config.endpoint ||
    entry.policy.region !== ctx.config.region ||
    entry.policy.originalBucket !== ctx.config.originalBucket
  )
    throw new Error("STORAGE_NAMESPACE_MISMATCH");
  const path = join(directory, entry.sha256);
  signal.throwIfAborted();
  const reused = await verifiedStaging(path, entry);
  signal.throwIfAborted();
  if (reused) return { path, reused: true };
  const tmp = join(directory, `${entry.sha256}.${crypto.randomUUID()}.tmp`);
  const f = await open(tmp, "wx", 0o600);
  const hash = createHash("sha256");
  let size = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const source = await ctx.driver.get({ bucket: "original", key: entry.key, signal });
    reader = source.body.getReader();
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.length;
      if (size > entry.size) throw new Error("STORAGE_ORIGINAL_INVALID");
      hash.update(next.value);
      let offset = 0;
      while (offset < next.value.length) {
        const r = await f.write(next.value, offset, next.value.length - offset);
        if (!r.bytesWritten) throw new Error("STORAGE_STAGE_FAILED");
        offset += r.bytesWritten;
      }
    }
    if (size !== entry.size || hash.digest("hex") !== entry.sha256)
      throw new Error("STORAGE_ORIGINAL_INVALID");
    signal.throwIfAborted();
    await f.sync();
    signal.throwIfAborted();
    await f.chmod(0o400);
    await f.close();
    signal.throwIfAborted();
    await rename(tmp, path);
    const d = await open(directory, "r");
    try {
      await d.sync();
    } finally {
      await d.close();
    }
    return { path, reused: false };
  } catch (e) {
    await f.close().catch(() => {});
    await rm(tmp, { force: true });
    throw e;
  } finally {
    await reader?.cancel().catch(() => {});
  }
}
export async function readOriginalManifest(c: Client): Promise<OriginalEntry[]> {
  const r =
    await c.query(`select b.id,b.sha256,b.key,b.size,b.detected_mime,p.id as policy_id,p.endpoint,p.region,p.original_bucket,p.derived_bucket,
 coalesce((select json_agg(json_build_object('id',r.id,'recipe',r.recipe,'recipeBuild',r.recipe_build,'outputSha256',d.output_sha256) order by r.id) from blob_derivatives r left join derived_objects d on d.id=r.derived_object_id where r.source_blob_id=b.id),'[]') as recipes
 from blobs b join storage_policies p on p.id=b.policy_id where b.state='ready' and b.verified_at is not null order by b.sha256`);
  return r.rows.map((r) => ({
    id: r.id,
    sha256: r.sha256,
    key: r.key,
    size: Number(r.size),
    mime: r.detected_mime,
    policy: {
      id: r.policy_id,
      endpoint: r.endpoint,
      region: r.region,
      originalBucket: r.original_bucket,
      derivedBucket: r.derived_bucket,
    },
    recipes: r.recipes,
  }));
}
/** Group reservations by real filesystem; never add available bytes for two paths on the same disk. */
export async function preflightSpace(
  requirements: { path: string; additional: number }[],
  floor = FLOOR,
) {
  const devices = new Map<number, { path: string; bytes: number }>();
  for (const r of requirements) {
    if (!Number.isSafeInteger(r.additional) || r.additional < 0)
      throw new Error("STORAGE_CAPACITY_BOUND_MISSING");
    const s = await stat(r.path);
    const previous = devices.get(s.dev);
    devices.set(s.dev, { path: r.path, bytes: (previous?.bytes ?? 0) + r.additional });
  }
  for (const item of devices.values()) {
    const fs = await statfs(item.path);
    const available = Number(fs.bavail) * Number(fs.bsize);
    if (available - item.bytes < floor) throw new Error("STORAGE_BACKUP_DISK_LOW");
  }
  return devices;
}
/** libpq does not expand URI defaults in PGDATABASE; credentials remain only in child environment. */
export function databaseCommandEnv(value: string): NodeJS.ProcessEnv {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname.slice(1)
  )
    throw new Error("STORAGE_DATABASE_URL_INVALID");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "5",
  };
  const supported: Record<string, string> = {
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    application_name: "PGAPPNAME",
    connect_timeout: "PGCONNECT_TIMEOUT",
  };
  for (const [key, val] of url.searchParams) {
    if (!supported[key]) throw new Error("STORAGE_DATABASE_URL_PARAMETER_UNSUPPORTED");
    env[supported[key]] = val;
  }
  return env;
}
export async function runBoundedCommand(
  args: string[],
  signal: AbortSignal,
  env?: Record<string, string | undefined>,
) {
  signal.throwIfAborted();
  const child = Bun.spawn({
    cmd: args,
    env: env ?? process.env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const stop = () => child.kill("SIGKILL");
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  try {
    const exit = await child.exited;
    signal.throwIfAborted();
    if (exit !== 0) throw new Error("STORAGE_BACKUP_COMMAND_FAILED");
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
/** Owned read connection: server statement limit and transport destruction bound preflight/drain queries. */
async function withBackupReadClient<T>(
  url: string,
  signal: AbortSignal,
  deadline: number,
  read: (client: Client) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const remaining = Math.max(1, Math.min(5000, deadline - Date.now()));
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: remaining,
    statement_timeout: remaining,
    lock_timeout: remaining,
  });
  client.on("error", () => {});
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= client.end().catch(() => {});
    // This private, never-pooled connection carries reads only; destroy even if connect/terminate stalls.
    (
      client as Client & { connection: { stream: { destroy(): void } } }
    ).connection.stream.destroy();
    return closing;
  };
  const abort = () => void close();
  signal.addEventListener("abort", abort, { once: true });
  try {
    await withinDeadline(() => client.connect(), signal);
    return await withinDeadline(() => read(client), signal);
  } finally {
    signal.removeEventListener("abort", abort);
    await close();
    signal.throwIfAborted();
  }
}
export type BackupOptions = {
  databaseUrl: string;
  umamiDatabaseUrl: string;
  stagingDirectory: string;
  bundleDirectory: string;
  repositoryDirectory: string;
  journal: JournalConfig;
  dumpBounds: { community: number; umami: number };
  /** Real role coordinator: pauses new claims and acknowledges zero actual IO; absence is an error. */
  coordinator: (ownerId: string) => {
    drain(lease: MaintenanceLease, signal: AbortSignal): Promise<void>;
    resume(lease: MaintenanceLease, signal: AbortSignal): Promise<void>;
  };
  maintenanceMs?: number;
  jobMs?: number;
  command?: typeof runBoundedCommand;
};
export async function backupOriginals(
  ctx: StorageContext,
  options: BackupOptions,
): Promise<FullManifest> {
  if (ctx.config.role !== "backup") throw new Error("STORAGE_BACKUP_ROLE_REQUIRED");
  const ownerId = crypto.randomUUID();
  if (typeof options.coordinator !== "function") throw new Error("STORAGE_DRAIN_UNAVAILABLE");
  const coordinator = options.coordinator(ownerId);
  if (
    !coordinator ||
    typeof coordinator.drain !== "function" ||
    typeof coordinator.resume !== "function"
  )
    throw new Error("STORAGE_DRAIN_UNAVAILABLE");
  const jobMs = Math.min(options.jobMs ?? 1800000, 1800000);
  if (jobMs < 1) throw new Error("STORAGE_BACKUP_DEADLINE");
  const started = Date.now();
  const job = AbortSignal.timeout(jobMs);
  const command = options.command ?? runBoundedCommand;
  const stage = resolve(options.stagingDirectory),
    bundle = resolve(options.bundleDirectory);
  if (stage === bundle || stage.startsWith(`${bundle}/`) || bundle.startsWith(`${stage}/`))
    throw new Error("STORAGE_BACKUP_PATH_INVALID");
  await mkdir(stage, { recursive: true, mode: 0o700 });
  await mkdir(bundle, { recursive: true, mode: 0o700 });
  // A bound is mandatory even for an empty DB; never assume unknown dump size is zero.
  for (const v of Object.values(options.dumpBounds))
    if (!Number.isSafeInteger(v) || v < 1) throw new Error("STORAGE_CAPACITY_BOUND_MISSING");
  const projected = await withBackupReadClient(
    options.databaseUrl,
    job,
    started + jobMs,
    readOriginalManifest,
  );
  async function capacity(entries: OriginalEntry[]) {
    let missing = 0;
    for (const e of entries)
      if (!(await verifiedStaging(join(stage, e.sha256), e))) missing += e.size;
    const overhead = 1024 * 1024 * (entries.length + 10);
    const payload =
      entries.reduce((n, e) => n + e.size, 0) +
      options.dumpBounds.community +
      options.dumpBounds.umami +
      overhead;
    // Assume zero dedup/compression: all payload may be new, plus per-file and repository overhead.
    await preflightSpace([
      { path: stage, additional: missing },
      {
        path: bundle,
        additional: options.dumpBounds.community + options.dumpBounds.umami + overhead,
      },
      { path: options.repositoryDirectory, additional: payload + overhead + 256 * 1024 * 1024 },
    ]);
    if ((await stat(stage)).dev !== (await stat(bundle)).dev)
      throw new Error("STORAGE_STAGE_FILESYSTEM_MISMATCH");
  }
  await withinDeadline(() => capacity(projected), job);
  job.throwIfAborted();
  let lease: MaintenanceLease | undefined;
  let manifest: FullManifest;
  let resumed = false;
  const maintenanceMs = Math.min(options.maintenanceMs ?? 300000, 300000, jobMs);
  const cleanupReserve = Math.max(1, Math.min(5000, Math.floor(maintenanceMs / 10)));
  let cleanupDeadline = started + jobMs;
  async function cleanup() {
    if (!lease) return;
    const signal = AbortSignal.timeout(
      Math.max(1, Math.min(cleanupReserve, cleanupDeadline - Date.now())),
    );
    try {
      const releaseSignal = AbortSignal.timeout(
        Math.max(1, Math.min(Math.floor(cleanupReserve / 2), cleanupDeadline - Date.now())),
      );
      await withinDeadline(() => releaseStorageMaintenance(ctx.db, lease!), releaseSignal);
    } finally {
      if (!resumed) {
        await withinDeadline(() => coordinator.resume(lease!, signal), signal);
        resumed = true;
      }
    }
  }
  try {
    lease = await acquireStorageMaintenance(ctx.db, {
      ownerId,
      durationMs: Math.max(1, maintenanceMs - cleanupReserve),
    });
    cleanupDeadline = Math.min(started + jobMs, lease.deadline + cleanupReserve);
    const signal = AbortSignal.any([
      job,
      AbortSignal.timeout(Math.max(1, lease.deadline - Date.now())),
    ]);
    await withinDeadline(() => coordinator.drain(lease!, signal), signal);
    signal.throwIfAborted();
    await withBackupReadClient(
      options.databaseUrl,
      signal,
      Math.min(started + jobMs, lease.deadline),
      assertStorageDrained,
    );
    const journal = await withinDeadline(() => exportJournal(options.journal, signal), signal);
    signal.throwIfAborted();
    manifest = await withStorageSnapshot(
      options.databaseUrl,
      lease,
      async (c, snapshot, snapshotSignal) => {
        const bounded = AbortSignal.any([signal, snapshotSignal]);
        await assertStorageDrained(c);
        const originals = await readOriginalManifest(c);
        await capacity(originals);
        bounded.throwIfAborted();
        await rm(join(bundle, "manifest.json"), { force: true });
        await rm(join(bundle, "originals"), { recursive: true, force: true });
        await mkdir(join(bundle, "originals"), { mode: 0o700 });
        for (const [name, url] of [
          ["community", options.databaseUrl],
          ["umami", options.umamiDatabaseUrl],
        ] as const) {
          bounded.throwIfAborted();
          // DB credentials go through libpq environment, never argv/output.
          await command(
            [
              "pg_dump",
              "--format=custom",
              `--file=${join(bundle, `${name}.dump`)}`,
              ...(name === "community" ? [`--snapshot=${snapshot}`] : []),
            ],
            bounded,
            databaseCommandEnv(url),
          );
          bounded.throwIfAborted();
          if ((await stat(join(bundle, `${name}.dump`))).size > options.dumpBounds[name])
            throw new Error("STORAGE_DUMP_BOUND_EXCEEDED");
          await chmod(join(bundle, `${name}.dump`), 0o400);
        }
        for (const e of originals) {
          const staged = await stageOriginal(ctx, e, stage, bounded);
          bounded.throwIfAborted();
          await link(staged.path, join(bundle, "originals", e.sha256));
          await preflightSpace([{ path: stage, additional: 0 }]);
        }
        const dumps = {
          community: await fileDigest(join(bundle, "community.dump")),
          umami: await fileDigest(join(bundle, "umami.dump")),
        };
        const m: FullManifest = {
          version: 1,
          createdAt: new Date().toISOString(),
          journal,
          originals,
          dumps,
        };
        bounded.throwIfAborted();
        await durableFile(
          join(bundle, "manifest.json"),
          Buffer.from(JSON.stringify(m)),
          0o400,
          bounded,
        );
        return m;
      },
    );
  } finally {
    await cleanup();
  }
  job.throwIfAborted();
  await preflightSpace([
    {
      path: options.repositoryDirectory,
      additional:
        manifest.originals.reduce((n, e) => n + e.size, 0) +
        manifest.dumps.community.size +
        manifest.dumps.umami.size +
        1024 * 1024 * (manifest.originals.length + 20) +
        256 * 1024 * 1024,
    },
  ]);
  await command(
    ["restic", "backup", "--host", "astrodx-community", "--tag", "community-full", bundle],
    job,
  );
  await command(
    [
      "restic",
      "forget",
      "--host",
      "astrodx-community",
      "--tag",
      "community-full",
      "--prune",
      "--keep-daily",
      "7",
      "--keep-weekly",
      "4",
      "--keep-monthly",
      "6",
    ],
    job,
  );
  await durableFile(
    join(stage, "last-success.json"),
    Buffer.from(
      JSON.stringify({
        version: 1,
        at: new Date().toISOString(),
        manifestSha256: (await fileDigest(join(bundle, "manifest.json"))).sha256,
      }),
    ),
  );
  return manifest;
}

export async function withinDeadline<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("STORAGE_BACKUP_DEADLINE"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    const result = await Promise.race([fn(), aborted]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

if (import.meta.main) {
  // Task11 must supply the real owner-scoped web/media/control process coordinator.
  // Refuse rather than infer quiescence from a lease or invent a zero-IO acknowledgement.
  console.error("STORAGE_DRAIN_UNAVAILABLE");
  process.exitCode = 1;
}

/** Current role ACKs do not erase ambiguous remote IO; retained durable claims veto a snapshot. */
export async function assertStorageDrained(c: Pick<Client, "query">) {
  const uncertain = await c.query(`select 1 where
 exists(select 1 from upload_attempts where state in('writing','deleting')) or
 exists(select 1 from blobs where lease_until is not null or state='deleting' or (properties->'deletion'->>'confirmed' is distinct from 'true' and (properties->'deletion'->>'startedAt' is not null or properties->'deletion'->>'uncertain'='true'))) or
 exists(select 1 from derived_objects where lease_until is not null or state='deleting' or (properties->'deletion'->>'confirmed' is distinct from 'true' and (properties->'deletion'->>'startedAt' is not null or properties->'deletion'->>'uncertain'='true'))) or
 exists(select 1 from blob_derivatives where lease_until is not null) or
 exists(select 1 from storage_quarantine where state='deleting' or delete_uncertain) or
 exists(select 1 from media_purge_requests where state='running')`);
  if (uncertain.rowCount) throw new Error("STORAGE_IO_UNCERTAIN");
}
