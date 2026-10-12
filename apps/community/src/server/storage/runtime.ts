import { trackStorageWrites, type createStorageIOTracker } from "./maintenance";
import type { StorageConfig, StorageContext, StorageRole } from "./contracts";
import { parseStorageEnv } from "./env";
import { createS3Driver } from "./s3";

/** Construction validates role config but does no IO; readiness is storage-route specific. */
export function createStorageContext(
  input: Pick<StorageContext, "db" | "boss" | "log" | "now"> & {
    tracker?: ReturnType<typeof createStorageIOTracker>;
    signal?: AbortSignal;
    config?: StorageConfig;
    driver?: StorageContext["driver"];
    source?: Record<string, string | undefined>;
    role?: StorageRole;
  },
): StorageContext {
  const config = input.config ?? parseStorageEnv(input.source ?? process.env, input.role ?? "web");
  const driver = input.driver ?? createS3Driver(config, { log: input.log });
  return {
    db: input.db,
    boss: input.boss,
    log: input.log,
    now: input.now,
    config,
    driver: input.tracker ? trackStorageWrites(driver, input.tracker) : driver,
    // Media never receives the internal bearer credential. The committed public row
    // remains the control worker's fair backfill intent; do not count immediate delivery.
    onMediaPublished: config.role === "media" ? async () => {
      throw new Error("STORAGE_MEDIA_RESUME_DEFERRED");
    } : config.role === "control" ? async (hash, generation) => {
      const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
      const response = await fetch(`${config.internalMediaUrl}/internal/media/resume`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.internalMediaSecret}`, "content-type": "application/json" },
        body: JSON.stringify({ hash, generation }), signal,
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("STORAGE_MEDIA_RESUME_UNAVAILABLE");
    } : undefined,
    lifecycle: input.tracker && input.signal ? {signal: input.signal,run: input.tracker.run} : undefined,
  };
}

/** Whole admitted jobs count through postcommit work, including their nested object IO. */
export function runStorageWork<T>(ctx: StorageContext, run: () => Promise<T>): Promise<T> {
  return ctx.lifecycle ? ctx.lifecycle.run(run) : run();
}
