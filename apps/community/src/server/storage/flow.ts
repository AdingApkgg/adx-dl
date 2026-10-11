import { sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss } from "pg-boss";
import { STORAGE_INGEST_QUEUE, MEDIA_AVATAR_QUEUE, MEDIA_CHART_QUEUE, STORAGE_FINALIZE_QUEUE } from "../jobs/queues";
import type { StoragePurpose } from "@/shared/storage";
import type { DbTransaction, StorageJobData } from "./contracts";
/** pg-boss 12.35 flow inserts jobs and dependency edges on the caller's transaction. */
export async function enqueueStorageFlow(
  boss: PgBoss,
  tx: DbTransaction,
  data: StorageJobData,
  purpose: StoragePurpose = "avatar",
): Promise<string[]> {
  const options = { singletonKey: `${data.uploadId}:${data.generation}` };
  const ids = await boss.flow(
    [
      { ref: "ingest", name: STORAGE_INGEST_QUEUE, data, options },
      { ref: "avatar", name: storageFlowQueues(purpose)[1], data, options, dependsOn: ["ingest"] },
      { ref: "finalize", name: STORAGE_FINALIZE_QUEUE, data, options, dependsOn: ["avatar"] },
    ],
    { db: fromDrizzle(tx, sql) },
  );
  return [ids.ingest, ids.avatar, ids.finalize];
}
export function storageFlowQueues(purpose: StoragePurpose): readonly [string,string,string] {
  return [STORAGE_INGEST_QUEUE,purpose === "avatar" ? MEDIA_AVATAR_QUEUE : MEDIA_CHART_QUEUE,STORAGE_FINALIZE_QUEUE];
}
