import type { Pool } from "pg";
import type { Db } from "../server/db/client";
import type { StorageContext, StorageJobData } from "../server/storage/contracts";
import { StorageError } from "../server/storage/errors";

/** Poll only this active generation; one bounded read, no business locks or writes. */
export async function watchProcessingUpload(ctx: StorageContext, data: StorageJobData, upstream: AbortSignal) {
  const controller = new AbortController();
  const signal = AbortSignal.any([upstream, controller.signal]);
  const pool = (ctx.db as Db & { $client: Pool }).$client;
  let stopped = false, reading: Promise<void> | undefined;
  const check = (): Promise<void> => {
    if (stopped || signal.aborted) return Promise.resolve();
    return reading ??= (async () => {
      try {
        const query = {
          text: "select 1 from upload_sessions where id=$1 and generation=$2 and state='processing' and expires_at>clock_timestamp()",
          values: [data.uploadId, data.generation], query_timeout: 1500,
        };
        const current = await pool.query(query);
        if (!stopped && !current.rowCount) controller.abort(new StorageError(409, "UPLOAD_CANCELLED"));
      } catch {
        if (!stopped) controller.abort(new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 1));
      } finally { reading = undefined; }
    })();
  };
  await check();
  const timer = setInterval(() => { void check(); }, 250);
  return { signal, check, stop() { stopped = true; clearInterval(timer); } };
}
