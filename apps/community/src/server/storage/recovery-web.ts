import { createDb } from "../db/client";
import { createMediaDrain } from "./drain";
import { canonicalMediaHash } from "./public-media";
import { mediaDenial } from "./files";
import { readRestoreState } from "../../../ops/backup/restore";
import type { Db } from "../db/client";
/** Independent bootstrap: no normal auth/SSR/API bootstrap or queue consumers. */
export async function createRecoveryWeb({
  db,
  secret,
  stateDirectory,
}: {
  db: Db;
  secret: string;
  stateDirectory: string;
}) {
  if ((await readRestoreState(stateDirectory)).state !== "closed" || secret.length < 32)
    throw new Error("STORAGE_RECOVERY_CONFIG_INVALID");
  const drain = createMediaDrain({ db, secret });
  return {
    async public(request: Request) {
      if (new URL(request.url).pathname === "/healthz" && request.method === "GET")
        return Response.json(
          { status: "recovery-closed" },
          { headers: { "cache-control": "private, no-store" } },
        );
      canonicalMediaHash(request);
      return mediaDenial();
    },
    async internal(request: Request) {
      if (new URL(request.url).pathname !== "/internal/media/drain") return mediaDenial();
      return drain.handle(request);
    },
  };
}
if (import.meta.main) {
  const url = process.env.DATABASE_URL,
    stateDirectory = process.env.STORAGE_RESTORE_STATE_DIR,
    secret = process.env.STORAGE_INTERNAL_MEDIA_SECRET;
  if (!url || !stateDirectory || !secret) throw new Error("STORAGE_RECOVERY_CONFIG_INVALID");
  const { db, pool } = createDb(url);
  const handlers = await createRecoveryWeb({ db, secret, stateDirectory });
  const publicServer = Bun.serve({
    hostname: process.env.HOST ?? "0.0.0.0",
    port: Number(process.env.PORT ?? 3000),
    fetch: handlers.public,
  });
  const internalServer = Bun.serve({ hostname: "0.0.0.0", port: 3001, fetch: handlers.internal });
  const stop = async () => {
    await publicServer.stop(true);
    await internalServer.stop(true);
    await pool.end();
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}
