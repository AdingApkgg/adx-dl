import { parseDumpBounds } from "./dump-bounds";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createDb } from "../../src/server/db/client";
import { createStorageContext } from "../../src/server/storage/runtime";
import { createLogger } from "../../src/shared/log";
import { assertMediaScratch } from "../../src/server/storage/health";
import { assertNormalStorageStartup } from "./restore";
import { preflightSpace, readOriginalManifest, verifiedStaging } from "./export";
import { Client } from "pg";
/** Live additional demand, measured after scratch is allocated; existing object/staging bytes are not charged twice. */
export async function preflightStorage() {
  const { total: dump } = parseDumpBounds(
    process.env.STORAGE_COMMUNITY_DUMP_BOUND, process.env.STORAGE_UMAMI_DUMP_BOUND,
  );
  await assertNormalStorageStartup();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("STORAGE_DATABASE_REQUIRED");
  const { db, pool } = createDb(url),
    c = new Client({
      connectionString: url,
      connectionTimeoutMillis: 2000,
      statement_timeout: 5000,
    });
  c.on("error", () => {});
  try {
    const ctx = createStorageContext({
      db,
      boss: async () => {
        throw new Error("unused");
      },
      log: createLogger(),
      role: "backup",
    });
    const stage = process.env.STORAGE_STAGING_DIR,
      bundle = process.env.STORAGE_BUNDLE_ROOT,
      repo = process.env.RESTIC_REPOSITORY;
    if (!stage || !bundle || !repo) throw new Error("STORAGE_BACKUP_PATH_INVALID");
    for (const path of [stage, bundle]) await mkdir(path, { recursive: true, mode: 0o700 });
    await assertMediaScratch("/media-tmp");
    await ctx.driver.ready(AbortSignal.timeout(5000));
    await c.connect();
    const budget = (await c.query("select * from storage_budget where id='global'")).rows[0];
    if (!budget) throw new Error("STORAGE_BUDGET_MISSING");
    let staged = 0;
    for (const original of await readOriginalManifest(c))
      if (await verifiedStaging(join(stage, original.sha256), original)) staged += original.size;
    const limits = ctx.config.limits;
    const remaining =
      Math.max(0, limits.originalBudget - Number(budget.original_written)) +
      Math.max(0, limits.derivedBudget - Number(budget.derived_written)) +
      Math.max(0, limits.temporaryBudget - Number(budget.temporary_written));
    await preflightSpace([
      { path: ctx.config.capacityDir!, additional: remaining },
      { path: stage, additional: Math.max(0, limits.originalBudget - staged) },
      { path: bundle, additional: dump + 268435456 },
      { path: repo, additional: limits.originalBudget + dump + 268435456 },
    ]);
    console.log("STORAGE_PREFLIGHT_OK");
  } finally {
    await c.end();
    await pool.end();
  }
}
if (import.meta.main)
  try {
    await preflightStorage();
  } catch {
    console.error("STORAGE_PREFLIGHT_FAILED");
    process.exitCode = 1;
  }
