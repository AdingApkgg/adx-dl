import { storageFilesystemBytes } from "./disk";
import { statfs } from "node:fs/promises";
import { createDb } from "../db/client";
import { createStorageContext } from "./runtime";
import { assertMediaProcess } from "./runtime-role";
import { assertQueueExists, createBoss } from "../jobs/boss";
import { STORAGE_QUEUES } from "../jobs/queues";
import { createLogger } from "../../shared/log";
import { assertNormalStorageStartup } from "../../../ops/backup/restore";
export async function assertMediaScratch(directory: string) {
  const stats = await statfs(directory, { bigint: true });
  const { total } = storageFilesystemBytes(stats);
  if (
    stats.type === 0x01021994n ||
    stats.type === 0x858458f6n ||
    total > 2147483648 ||
    total < 33554432
  )
    throw new Error("STORAGE_SCRATCH_NOT_BOUNDED_DISK");
}
if (import.meta.main) {
  let pool: Awaited<ReturnType<typeof createDb>>["pool"] | undefined;
  let boss: ReturnType<typeof createBoss> | undefined;
  try {
    await assertNormalStorageStartup();
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("STORAGE_DATABASE_REQUIRED");
    if (process.argv[2] === "media") await assertMediaProcess(url);
    else {
      const handle = createDb(url);
      pool = handle.pool;
      boss = createBoss(url, "sender");
      boss.on("error", () => {});
      await boss.start();
      const ctx = createStorageContext({
        db: handle.db,
        boss: async () => boss!,
        log: createLogger(),
        role: "control",
      });
      await ctx.driver.ready(AbortSignal.timeout(2000));
      for (const { name } of STORAGE_QUEUES) await assertQueueExists(boss, name);
      await assertMediaProcess(url);
      const counts = await pool.query(`select
    (select count(*) from media_purge_requests where state in ('pending','failed','running')) as purge_incomplete,
    (select count(*) from media_publications where state='revoking') as revoking,
    (select count(*) from pgboss.job where name='media.purge.dead') as purge_dead,
    (select count(*) from pgboss.job where name='storage.dead') as storage_dead`);
      console.log(JSON.stringify({ status: "ready", ...counts.rows[0] }));
    }
  } catch {
    console.error("STORAGE_HEALTH_FAILED");
    process.exitCode = 1;
  } finally {
    await boss?.stop({ graceful: false, timeout: 1000 });
    await pool?.end();
  }
}
