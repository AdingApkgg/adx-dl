import { createStorageIOTracker } from "../server/storage/maintenance";
import { startStorageRole } from "../server/storage/runtime-role";
import { superviseStorageRole } from "../server/storage/process-supervision";
import { rebuildMissingDerived } from "../server/storage/backup";
import { assertMediaScratch } from "../server/storage/health";
import { assertNormalStorageStartup } from "../../ops/backup/restore";
import type {
  StorageContext,
  StorageJobData,
} from "../server/storage/contracts";
import { createDb } from "../server/db/client";
import { createBoss } from "../server/jobs/boss";
import {
  ensureQueues,
  STORAGE_QUEUES,
  STORAGE_INGEST_QUEUE,
  MEDIA_AVATAR_QUEUE,
  MEDIA_CHART_QUEUE,
  STORAGE_FINALIZE_QUEUE,
} from "../server/jobs/queues";
import { createStorageContext } from "../server/storage/runtime";
import { createLogger } from "../shared/log";
import { describeError } from "../shared/describe-error";
import { deriveAvatar } from "./avatar";
import { finalizeUpload } from "./finalize";
import { ingestUpload } from "./ingest";
import { RECIPE_BUILD } from "./image-child";
import { handleChartImport } from "./chart-import";
import { currentChartRecipeBuild, recipeBuildFor } from "../server/charts/recipe";
/** The supplied boss must be started with the worker role so Navigator advances flow edges. */
export async function registerMediaWorkers(ctx: StorageContext): Promise<void> {
  if (ctx.config.role !== "media" || ctx.config.recipeBuild !== RECIPE_BUILD)
    throw new Error("Media recipe configuration mismatch");
  if(recipeBuildFor(ctx,"chart-source") !== currentChartRecipeBuild()) throw new Error("Chart recipe configuration mismatch");
  const boss = await ctx.boss();
  await ensureQueues(boss, STORAGE_QUEUES);
  for (const [queue, handle] of [
    [STORAGE_INGEST_QUEUE, ingestUpload],
    [MEDIA_AVATAR_QUEUE, deriveAvatar],
    [MEDIA_CHART_QUEUE, handleChartImport],
    [STORAGE_FINALIZE_QUEUE, finalizeUpload],
  ] as const) {
    await boss.work<StorageJobData>(
      queue,
      { localConcurrency: 1, batchSize: 1 },
      async (jobs) => {
        for (const job of jobs) {
          const run = () => handle(ctx, job.data);
          await (ctx.lifecycle ? ctx.lifecycle.run(run) : run());
        }
      },
    );
  }
}
if (import.meta.main) {
  await assertNormalStorageStartup();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const log = createLogger();
  const boss = createBoss(url, "worker");
  boss.on("error", (error) =>
    log.error("media_jobs_error", describeError(error)),
  );
  const { db, pool } = createDb(url);
  const tracker = createStorageIOTracker();
  const controller = new AbortController();
  const ctx = createStorageContext({
    tracker, signal: controller.signal,
    db,
    boss: async () => boss,
    log,
    role: "media",
  });
  await assertMediaScratch(ctx.config.tempDir);
  const role = await startStorageRole({databaseUrl:url,role:"media",tracker});
  let stopping: Promise<void> | undefined;
  let rebuilding: Promise<unknown> | undefined;
  let repairTimer: ReturnType<typeof setInterval> | undefined;
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
    clearInterval(repairTimer);
    tracker.pause();
    controller.abort();
    await boss.stop({ graceful: true, timeout: 125000 });
    await rebuilding;
    await tracker.pauseAndDrain(AbortSignal.timeout(5000));
    await role.stop();
    await pool.end();
  })();
    return stopping;
  };
  superviseStorageRole(role.failure, stop, 130000);
  await boss.start();
  await registerMediaWorkers(ctx);
  repairTimer = setInterval(() => {
    if(stopping || rebuilding || tracker.status().paused || tracker.status().active) return;
    rebuilding=tracker.run(() => rebuildMissingDerived(ctx,1)).catch(error=>log.error("storage_rebuild_failed",describeError(error))).finally(()=>{rebuilding=undefined;});
  },1000);
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  log.info("media_worker_started", { recipeBuild: RECIPE_BUILD });
}
