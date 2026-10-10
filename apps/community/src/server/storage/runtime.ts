import type { StorageConfig, StorageContext, StorageRole } from "./contracts";
import { parseStorageEnv } from "./env";
import { createS3Driver } from "./s3";

/** Construction validates role config but does no IO; readiness is storage-route specific. */
export function createStorageContext(
  input: Pick<StorageContext, "db" | "boss" | "log" | "now"> & {
    config?: StorageConfig;
    driver?: StorageContext["driver"];
    source?: Record<string, string | undefined>;
    role?: StorageRole;
  },
): StorageContext {
  const config = input.config ?? parseStorageEnv(input.source ?? process.env, input.role ?? "web");
  return {
    db: input.db,
    boss: input.boss,
    log: input.log,
    now: input.now,
    config,
    driver: input.driver ?? createS3Driver(config),
  };
}
