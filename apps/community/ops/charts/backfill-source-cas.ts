import { eq, sql } from "drizzle-orm";
import { chartBackfillRemaining, chartBackfillSource } from "../../src/server/charts/source-backfill";
import { createDb } from "../../src/server/db/client";
import { blobs, chartSourceEntries, storageBudget } from "../../src/server/db/schema";
import { enqueueInTx, getSender, stopSender } from "../../src/server/jobs/boss";
import { MEDIA_CHART_CAS_QUEUE } from "../../src/server/jobs/queues";
import { createStorageContext } from "../../src/server/storage/runtime";
import { withStorageTransaction } from "../../src/server/storage/transactions";
import { createLogger } from "../../src/shared/log";

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !["status", "enqueue"].includes(mode) || extra.length) {
    throw new Error("CHART_CAS_BACKFILL_ARGUMENTS");
  }
  const { db, pool } = createDb(databaseUrl, { onPoolError: () => {} });
  try {
    const ctx = createStorageContext({
      db,
      boss: () => getSender(databaseUrl, () => {}),
      log: createLogger(() => {}),
      role: "media",
    });
    if (mode === "enqueue") {
      const boss = await ctx.boss();
      const result = await withStorageTransaction(db, async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${MEDIA_CHART_CAS_QUEUE})::bigint)`);
        const active = await tx.execute(sql`
          select 1 from pgboss.job where name = ${MEDIA_CHART_CAS_QUEUE}
          and state in ('created', 'retry', 'active') limit 1
        `);
        if (active.rows.length) return { status: "pending" };
        const [source] = await chartBackfillRemaining({ db: tx }, 1);
        if (!source) return { status: "complete" };
        const jobId = await enqueueInTx(boss, tx, MEDIA_CHART_CAS_QUEUE, { sourceId: source.id },
          { singletonKey: source.id });
        return { status: jobId ? "queued" : "pending", jobId, sourceId: source.id, bytes: source.size };
      });
      console.log(JSON.stringify(result));
      return;
    }

    const progress = await db.execute(sql`
      select count(*)::int as eligible,
        count(*) filter (where not exists (
          select 1 from ${chartSourceEntries} where ${chartSourceEntries.sourceBlobId} = ${blobs.id}
        ))::int as remaining
      from ${blobs} where ${chartBackfillSource}
    `);
    const integrity = await db.execute(sql`
      select count(*)::int as entries,
        count(distinct ${chartSourceEntries.contentBlobId})::int as "distinctObjects",
        count(*) filter (where ${chartSourceEntries.size} > 0 and (
          child.id is null or child.state <> 'ready' or child.sha256 <> ${chartSourceEntries.sha256}
          or child.size <> ${chartSourceEntries.size}
        ))::int as invalid
      from ${chartSourceEntries}
      join ${blobs} on ${blobs.id} = ${chartSourceEntries.sourceBlobId}
      left join ${blobs} child on child.id = ${chartSourceEntries.contentBlobId}
      where ${chartBackfillSource}
    `);
    const jobs = await db.execute(sql`
      select id, data->>'sourceId' as "sourceId", state, output->>'status' as status,
        output->>'entries' as entries
      from pgboss.job where name = ${MEDIA_CHART_CAS_QUEUE}
      order by created_on desc limit 10
    `);
    const [budget] = await db.select({
      written: storageBudget.originalWritten, reserved: storageBudget.originalReserved,
    }).from(storageBudget).where(eq(storageBudget.id, "global"));
    if (!budget) throw new Error("CHART_CAS_BACKFILL_BUDGET_MISSING");
    console.log(JSON.stringify({
      ...progress.rows[0], ...integrity.rows[0],
      budget: { ...budget, limit: ctx.config.limits.originalBudget },
      jobs: jobs.rows,
    }));
  } finally {
    try {
      await stopSender();
    } finally {
      await pool.end();
    }
  }
}

void main().catch(() => {
  console.error(JSON.stringify({ status: "failed", code: "CHART_CAS_BACKFILL_FAILED" }));
  process.exitCode = 1;
});
