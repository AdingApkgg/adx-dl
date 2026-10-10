import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import {
  derivedObjects,
  mediaPublications,
  mediaPurgeRequests,
  type MediaPurgeEvidence,
} from "../db/schema";
import type { DbTransaction, StorageContext } from "./contracts";
import type { MediaPurgeJobData } from "./avatars";
import { hasPublicRepresentation } from "./references";
import { lockStorageMutation } from "./transactions";

export class MediaPurgeError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: { status?: number; apiCodes?: number[] } = {},
  ) {
    super(code);
    this.name = "MediaPurgeError";
  }
}
export type PurgeBudget = { remaining(): number; check(): void };
export type PurgeAttempt = MediaPurgeJobData & { attempt: number };
/** The timer encloses pool admission, BEGIN, maintenance, statements and COMMIT.
 * Destroy timed-out connections to stop local continuation. Lost COMMIT ACK is
 * ambiguous: durable row state is authoritative on retry, never the timeout. */
export async function withPurgeTransaction<T>(
  db: Db,
  budget: PurgeBudget,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  budget.check();
  let client: PoolClient | undefined,
    released = false,
    expired = false;
  let originalQuery: PoolClient["query"] | undefined;
  const destroy = () => {
    if (client && !released) {
      released = true;
      client.release(true);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      destroy();
      reject(new MediaPurgeError("MEDIA_ATTEMPT_DEADLINE"));
    }, budget.remaining());
  });
  const run = async () => {
    client = await (db as Db & { $client: Pool }).$client.connect();
    if (expired) {
      destroy();
      throw new MediaPurgeError("MEDIA_ATTEMPT_DEADLINE");
    }
    originalQuery = client.query;
    const query = originalQuery.bind(client);
    client.query = ((input: string | { text: string }, values?: unknown[]) => {
      budget.check();
      if (expired || released) return Promise.reject(new MediaPurgeError("MEDIA_ATTEMPT_DEADLINE"));
      const config = typeof input === "string" ? { text: input } : input;
      const guarded = { ...config, query_timeout: Math.max(1, Math.floor(budget.remaining())) };
      return query(guarded, values);
    }) as PoolClient["query"];
    const local = drizzle({ client, schema, casing: "snake_case" });
    return local.transaction(async (tx) => {
      budget.check();
      await tx.execute(
        sql`select set_config('transaction_timeout', ${String(Math.max(1, Math.floor(budget.remaining())))}, true)`,
      );
      await lockStorageMutation(tx);
      const ms = Math.max(1, Math.floor(Math.min(5000, budget.remaining())));
      await tx.execute(sql`select set_config('statement_timeout', ${String(ms)}, true)`);
      const result = await fn(tx);
      budget.check();
      // PostgreSQL also bounds COMMIT; the enclosing connection timer covers transport stalls.
      await tx.execute(
        sql`select set_config('statement_timeout', ${String(Math.max(1, Math.floor(budget.remaining())))}, true)`,
      );
      budget.check();
      return result;
    });
  };
  try {
    const result = await Promise.race([run(), timeout]);
    budget.check();
    return result;
  } catch (error) {
    destroy();
    throw error;
  } finally {
    clearTimeout(timer);
    if (client && !released) {
      if (originalQuery) client.query = originalQuery;
      released = true;
      client.release();
    }
  }
}
async function locked(tx: DbTransaction, data: MediaPurgeJobData) {
  await tx
    .select()
    .from(derivedObjects)
    .where(eq(derivedObjects.outputSha256, data.hash))
    .for("update");
  const [pub] = await tx
    .select()
    .from(mediaPublications)
    .where(eq(mediaPublications.outputSha256, data.hash))
    .for("update");
  const [out] = await tx
    .select()
    .from(mediaPurgeRequests)
    .where(
      and(
        eq(mediaPurgeRequests.outputSha256, data.hash),
        eq(mediaPurgeRequests.generation, data.generation),
      ),
    )
    .for("update");
  return { pub, out };
}
function current(rows: Awaited<ReturnType<typeof locked>>, data: MediaPurgeJobData) {
  return (
    rows.pub?.generation === data.generation &&
    (rows.pub.state === "revoking" || rows.pub.state === "blocked") &&
    rows.out &&
    rows.out.state !== "done"
  );
}
function fenced(rows: Awaited<ReturnType<typeof locked>>, data: PurgeAttempt) {
  return current(rows, data) && rows.out?.state === "running" && rows.out.attempts === data.attempt;
}
export async function claimMediaPurge(
  ctx: StorageContext,
  data: MediaPurgeJobData,
  budget: PurgeBudget,
) {
  return withPurgeTransaction(ctx.db, budget, async (tx) => {
    const rows = await locked(tx, data);
    if (!current(rows, data)) return null;
    const now = ctx.now?.() ?? new Date();
    const attempt = rows.out.attempts + 1;
    await tx
      .update(mediaPurgeRequests)
      .set({
        state: "running",
        attempts: attempt,
        attemptStartedAt: now,
        evidence: { purges: [], probes: [] },
        lastErrorCode: "MEDIA_ATTEMPT_INCOMPLETE",
        nextAttemptAt: new Date(now.getTime() + 90000),
      })
      .where(eq(mediaPurgeRequests.id, rows.out.id));
    return { ...data, attempt };
  });
}
export async function recordMediaPurge(
  ctx: StorageContext,
  data: PurgeAttempt,
  evidence: MediaPurgeEvidence,
  budget: PurgeBudget,
  checkReferences = false,
) {
  await withPurgeTransaction(ctx.db, budget, async (tx) => {
    const rows = await locked(tx, data);
    if (!fenced(rows, data)) throw new MediaPurgeError("MEDIA_ATTEMPT_STALE");
    if (checkReferences && (await hasPublicRepresentation(tx, data.hash)))
      throw new MediaPurgeError("MEDIA_PUBLIC_REFERENCE");
    await tx
      .update(mediaPurgeRequests)
      .set({ evidence })
      .where(eq(mediaPurgeRequests.id, rows.out.id));
  });
}
function complete(e: MediaPurgeEvidence | null, generation: number) {
  if (
    !e?.drain ||
    e.drain.generation !== generation ||
    e.drain.status !== 200 ||
    e.purges.length !== 2 ||
    e.probes.length !== 2
  )
    return false;
  const [p1, p2] = e.purges,
    [g1, g2] = e.probes;
  return (
    e.drain.elapsedMs <= p1.elapsedMs &&
    p1.status === 200 &&
    p2.status === 200 &&
    p2.elapsedMs - p1.elapsedMs >= 5000 &&
    g1.elapsedMs >= p2.elapsedMs &&
    g2.elapsedMs - g1.elapsedMs >= 5000 &&
    e.probes.every(
      (p) =>
        p.status === 404 &&
        p.cacheStatus !== "HIT" &&
        p.bodyLength <= 65536 &&
        p.bodyLength >= 0 &&
        /^[a-f0-9]{64}$/.test(p.bodySha256),
    )
  );
}
export async function finishMediaPurge(
  ctx: StorageContext,
  data: PurgeAttempt,
  budget: PurgeBudget,
) {
  await withPurgeTransaction(ctx.db, budget, async (tx) => {
    const rows = await locked(tx, data);
    if (!fenced(rows, data)) throw new MediaPurgeError("MEDIA_ATTEMPT_STALE");
    if (await hasPublicRepresentation(tx, data.hash))
      throw new MediaPurgeError("MEDIA_PUBLIC_REFERENCE");
    if (!complete(rows.out.evidence, data.generation))
      throw new MediaPurgeError("MEDIA_EVIDENCE_INCOMPLETE");
    budget.check();
    const now = ctx.now?.() ?? new Date();
    await tx
      .update(mediaPublications)
      .set({
        state: rows.pub.state === "blocked" ? "blocked" : "private",
        updatedAt: now,
        lastPurgeAt: now,
      })
      .where(eq(mediaPublications.outputSha256, data.hash));
    await tx
      .update(mediaPurgeRequests)
      .set({ state: "done", lastErrorCode: null })
      .where(eq(mediaPurgeRequests.id, rows.out.id));
  });
}
export async function failMediaPurge(
  ctx: StorageContext,
  data: PurgeAttempt,
  code: string,
  budget: PurgeBudget,
  detail: { status?: number; apiCodes?: number[] } = {},
) {
  await withPurgeTransaction(ctx.db, budget, async (tx) => {
    const rows = await locked(tx, data);
    if (!fenced(rows, data)) return;
    await tx
      .update(mediaPurgeRequests)
      .set({
        state: "failed",
        lastErrorCode: code,
        evidence: {
          ...(rows.out.evidence ?? { purges: [], probes: [] }),
          failure: { code, ...detail },
        },
        nextAttemptAt: new Date((ctx.now?.() ?? new Date()).getTime() + 30000),
      })
      .where(eq(mediaPurgeRequests.id, rows.out.id));
  });
}
