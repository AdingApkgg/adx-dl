import { runStorageWork } from "../server/storage/runtime";
import { createHash } from "node:crypto";
import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import type { PgBoss, Job } from "pg-boss";
import { mediaPurgeRequests, mediaPublications, type MediaPurgeEvidence } from "@/server/db/schema";
import type { StorageContext } from "@/server/storage/contracts";
import type { MediaPurgeJobData } from "@/server/storage/avatars";
import {
  claimMediaPurge,
  failMediaPurge,
  finishMediaPurge,
  recordMediaPurge,
  privateNoStoreCacheControl,
  MediaPurgeError,
  withPurgeTransaction,
  type PurgeBudget,
} from "@/server/storage/publication";
import { enqueueInTx } from "@/server/jobs/boss";
import {
  MEDIA_PURGE_QUEUE,
  MEDIA_PURGE_DEAD_QUEUE,
  MEDIA_PURGE_REPAIR_QUEUE,
} from "@/server/jobs/queues";
const BODY_LIMIT = 65536;
export type MediaPurgeDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  /** Monotonic milliseconds, shared with the injected sleep/fetch timeline. */
  now: () => number;
  drainUrl: string;
};
export function validMediaPurgeData(value: unknown): value is MediaPurgeJobData {
  if (!value || typeof value !== "object") return false;
  const v = value as MediaPurgeJobData;
  return (
    typeof v.hash === "string" &&
    /^[a-f0-9]{64}$/.test(v.hash) &&
    Number.isSafeInteger(v.generation) &&
    v.generation >= 0
  );
}
function budget(now: () => number, deadline: number): PurgeBudget {
  return {
    remaining: () => Math.max(0, deadline - now()),
    check() {
      if (now() >= deadline) throw new MediaPurgeError("MEDIA_ATTEMPT_DEADLINE");
    },
  };
}
function cancel(body: ReadableStream<Uint8Array> | null) {
  void body?.cancel().catch(() => {});
}
async function boundedBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > BODY_LIMIT) {
    cancel(response.body);
    throw new MediaPurgeError("MEDIA_BODY_LIMIT");
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const bytes = new Uint8Array(BODY_LIMIT);
  let length = 0,
    finished = false;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        finished = true;
        break;
      }
      if (length + value.length > BODY_LIMIT) throw new MediaPurgeError("MEDIA_BODY_LIMIT");
      bytes.set(value, length);
      length += value.length;
    }
    return bytes.slice(0, length);
  } finally {
    signal.removeEventListener("abort", abort);
    if (!finished) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function request<T>(
  deps: MediaPurgeDeps,
  b: PurgeBudget,
  url: string,
  init: RequestInit,
  inspect: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  b.check();
  const controller = new AbortController(),
    timeoutMs = Math.min(10000, b.remaining());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new MediaPurgeError("MEDIA_REQUEST_TIMEOUT"));
    }, timeoutMs);
  });
  const start = deps.now();
  const run = async () => {
    const response = await deps.fetch(url, { ...init, signal: controller.signal });
    if (controller.signal.aborted) {
      cancel(response.body);
      throw new MediaPurgeError("MEDIA_REQUEST_TIMEOUT");
    }
    return inspect(response, controller.signal);
  };
  try {
    const result = await Promise.race([run(), timeout]);
    b.check();
    if (deps.now() - start >= timeoutMs) throw new MediaPurgeError("MEDIA_REQUEST_TIMEOUT");
    return result;
  } catch (error) {
    controller.abort();
    throw error instanceof MediaPurgeError ? error : new MediaPurgeError("MEDIA_REQUEST_FAILED");
  } finally {
    clearTimeout(timer);
  }
}
async function json(response: Response, signal: AbortSignal) {
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(await boundedBody(response, signal)),
    ) as Record<string, unknown>;
  } catch (error) {
    throw error instanceof MediaPurgeError ? error : new MediaPurgeError("MEDIA_RESPONSE_INVALID");
  }
}
async function pause(deps: MediaPurgeDeps, b: PurgeBudget, previous: number) {
  for (let wakes = 0; deps.now() - previous < 5000; wakes++) {
    if (wakes >= 16) throw new MediaPurgeError("MEDIA_DELAY_INVALID");
    b.check();
    const ms = Math.max(1, Math.ceil(5000 - (deps.now() - previous)));
    if (ms >= b.remaining()) throw new MediaPurgeError("MEDIA_ATTEMPT_DEADLINE");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        deps.sleep(ms),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new MediaPurgeError("MEDIA_ATTEMPT_DEADLINE")), b.remaining());
        }),
      ]);
      b.check();
    } finally {
      clearTimeout(timer);
    }
  }
}
export async function revokeMedia(
  ctx: StorageContext,
  data: MediaPurgeJobData,
  injected?: MediaPurgeDeps,
): Promise<void> {
  if (!validMediaPurgeData(data)) throw new MediaPurgeError("MEDIA_JOB_INVALID");
  if (ctx.config.role !== "control") throw new MediaPurgeError("MEDIA_CONTROL_REQUIRED");
  const config = ctx.config;
  const deps = injected ?? {
    fetch: (url: string, init: RequestInit) => fetch(url, {...init, signal: ctx.lifecycle ? AbortSignal.any([ctx.lifecycle.signal, ...(init.signal ? [init.signal] : [])]) : init.signal}),
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now: () => performance.now(),
    drainUrl: `${config.internalMediaUrl}/internal/media/drain`,
  };
  const start = deps.now(),
    whole = budget(deps.now, start + 60000),
    work = budget(deps.now, start + 59000);
  const attempt = await claimMediaPurge(ctx, data, work);
  if (!attempt) return;
  const evidence: MediaPurgeEvidence = { protocol: "origin-private-v1", purges: [], probes: [] };
  const observed = (status: number) => ({
    at: (ctx.now?.() ?? new Date()).toISOString(),
    elapsedMs: deps.now() - start,
    status,
  });
  const url = `${config.publicOrigin}/media/${data.hash}.jpg`;
  try {
    const drain = await request(
      deps,
      work,
      deps.drainUrl,
      {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${config.internalMediaSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ hash: data.hash, generation: data.generation }),
      },
      async (r, s) => {
        if (r.status !== 200) {
          cancel(r.body);
          throw new MediaPurgeError("MEDIA_DRAIN_STATUS", { status: r.status });
        }
        const ack = await json(r, s);
        if (
          !ack ||
          Object.keys(ack).length !== 2 ||
          ack.generation !== data.generation ||
          ack.drained !== true
        )
          throw new MediaPurgeError("MEDIA_DRAIN_ACK");
        return observed(r.status);
      },
    );
    evidence.drain = { ...drain, generation: data.generation };
    await recordMediaPurge(ctx, attempt, evidence, work, true);
    for (let i = 0; i < 2; i++) {
      if (i) await pause(deps, work, start + evidence.probes[0].elapsedMs);
      const probe = await request(
        deps,
        work,
        url,
        { method: "GET", credentials: "omit", redirect: "error" },
        async (r, s) => {
          const cacheStatus = r.headers.get("cf-cache-status")?.trim().toUpperCase() ?? null;
          if (r.status !== 404 || cacheStatus === "HIT") {
            cancel(r.body);
            throw new MediaPurgeError(r.status !== 404 ? "MEDIA_PROBE_STATUS" : "MEDIA_PROBE_HIT", {
              status: r.status,
            });
          }
          const cacheControl = r.headers.get("cache-control")?.trim() ?? null;
          if (!privateNoStoreCacheControl(cacheControl)) {
            cancel(r.body);
            throw new MediaPurgeError("MEDIA_PROBE_CACHE_CONTROL", { status: r.status });
          }
          const body = await boundedBody(r, s);
          return {
            ...observed(r.status),
            cacheStatus,
            cacheControl,
            bodyLength: body.length,
            bodySha256: createHash("sha256").update(body).digest("hex"),
          };
        },
      );
      evidence.probes.push(probe);
      await recordMediaPurge(ctx, attempt, evidence, work);
    }
    await finishMediaPurge(ctx, attempt, work);
  } catch (error) {
    const code = error instanceof MediaPurgeError ? error.code : "MEDIA_DATABASE_FAILED";
    await failMediaPurge(
      ctx,
      attempt,
      code,
      whole,
      error instanceof MediaPurgeError ? error.detail : {},
    ).catch(() => {});
    ctx.log.warn("media_purge_failed", {
      hash: data.hash,
      generation: data.generation,
      attempt: attempt.attempt,
      code,
    });
    throw new MediaPurgeError(code);
  }
}
export function createMediaPurgeHandler(ctx: StorageContext) {
  return async (jobs: Job<MediaPurgeJobData>[]) => {
    for (const job of jobs) await revokeMedia(ctx, job.data);
  };
}
export const MEDIA_PURGE_REPAIR_CRON = "17 * * * *";
export const MEDIA_PURGE_REPAIR_LIMIT = 100;
/** Atomic re-enqueue; exclusive singleton null means an existing job, never completion. */
export async function repairMediaPurges(ctx: StorageContext): Promise<number> {
  const boss = await ctx.boss(),
    start = performance.now(),
    b = budget(() => performance.now(), start + 60000);
  return withPurgeTransaction(ctx.db, b, async (tx) => {
    const rows = await tx
      .select({ request: mediaPurgeRequests })
      .from(mediaPurgeRequests)
      .innerJoin(
        mediaPublications,
        and(
          eq(mediaPublications.outputSha256, mediaPurgeRequests.outputSha256),
          eq(mediaPublications.generation, mediaPurgeRequests.generation),
        ),
      )
      .where(
        and(
          or(eq(mediaPublications.state, "revoking"), eq(mediaPublications.state, "blocked")),
          lte(mediaPurgeRequests.nextAttemptAt, sql`now()`),
          or(
            eq(mediaPurgeRequests.state, "pending"),
            eq(mediaPurgeRequests.state, "failed"),
            eq(mediaPurgeRequests.state, "running"),
          ),
        ),
      )
      .orderBy(asc(mediaPurgeRequests.nextAttemptAt))
      .limit(MEDIA_PURGE_REPAIR_LIMIT);
    let count = 0;
    for (const { request: row } of rows) {
      b.check();
      const id = await enqueueInTx(
        boss,
        tx,
        MEDIA_PURGE_QUEUE,
        { hash: row.outputSha256, generation: row.generation } satisfies MediaPurgeJobData,
        { singletonKey: `${row.outputSha256}:${row.generation}` },
      );
      if (id) count++;
    }
    return count;
  });
}
/** Payload has no claimed-attempt token: observing an old dead job is read-only. */
export async function recordMediaPurgeDead(ctx: StorageContext, jobs: Job<MediaPurgeJobData>[]) {
  for (const job of jobs) {
    if (validMediaPurgeData(job.data))
      ctx.log.error("media_purge_dead", {
        jobId: job.id,
        hash: job.data.hash,
        generation: job.data.generation,
      });
  }
}
export async function registerMediaPurgeWorker(ctx: StorageContext, boss: PgBoss) {
  const handle = createMediaPurgeHandler(ctx);
  await boss.work<MediaPurgeJobData>(MEDIA_PURGE_QUEUE, (jobs) => runStorageWork(ctx, () => handle(jobs)));
  await boss.work<MediaPurgeJobData>(MEDIA_PURGE_DEAD_QUEUE, (jobs) =>
    runStorageWork(ctx, () => recordMediaPurgeDead(ctx, jobs)),
  );
  await boss.work(MEDIA_PURGE_REPAIR_QUEUE, async () => {
    await runStorageWork(ctx, () => repairMediaPurges(ctx));
  });
  await boss.schedule(
    MEDIA_PURGE_REPAIR_QUEUE,
    MEDIA_PURGE_REPAIR_CRON,
    {},
    { tz: "Asia/Shanghai", missed: "once" },
  );
}
