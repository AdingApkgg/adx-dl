import { beforeAll, afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mediaPublications, mediaPurgeRequests } from "@/server/db/schema";
import { readyContext, readyOwner, readyFile } from "../../test/storage/ready-file";
import { cleanupStorageFixture, storageFixtureConfig } from "../../test/storage/fixture";
import { setAvatar } from "@/server/storage/avatars";
import { resetTestDatabase } from "@/server/testing/test-db";
let fixture: Awaited<ReturnType<typeof readyContext>>;
const owners: string[] = [];
const blockedHashes: string[] = [];
beforeAll(async () => {
  await resetTestDatabase();
  fixture = await readyContext();
}, 30000);
afterAll(async () => {
  if (fixture) {
    const { blobBlocks } = await import("@/server/db/schema");
    const { inArray } = await import("drizzle-orm");
    if (blockedHashes.length)
      await fixture.ctx.db.delete(blobBlocks).where(inArray(blobBlocks.sha256, blockedHashes));
    const { createS3Driver } = await import("@/server/storage/s3");
    await cleanupStorageFixture(
      fixture.ctx.db,
      owners,
      [fixture.policy.id],
      process.env.STORAGE_TEST_FIXTURE_PATH
        ? createS3Driver(await storageFixtureConfig("control"))
        : undefined,
      true,
    );
  }
}, 30000);
async function revoked() {
  const ctx = { ...fixture.ctx, config: await storageFixtureConfig("control") };
  const id = await readyOwner(ctx);
  owners.push(id);
  const f = await readyFile(ctx, fixture.policy.id, id);
  await setAvatar(ctx, id, { fileId: f.file.id, expectedRevision: 0 }, crypto.randomUUID());
  await setAvatar(ctx, id, { fileId: null, expectedRevision: 1 }, crypto.randomUUID());
  const [pub] = await ctx.db
    .select()
    .from(mediaPublications)
    .where(eq(mediaPublications.outputSha256, f.derived.outputSha256));
  expect(pub.state).toBe("revoking");
  return { ctx, data: { hash: pub.outputSha256, generation: pub.generation }, f, id };
}
function timeline(generation: number) {
  let time = 0;
  const calls: { url: string; init: RequestInit; at: number }[] = [];
  const deps = {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
    drainUrl: "http://web:3001/internal/media/drain",
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init!, at: time });
      if (String(url).includes("/internal/")) return Response.json({ generation, drained: true });
      if (String(url).includes("api.cloudflare.com"))
        return Response.json({ success: true, errors: [] });
      return new Response("missing", { status: 404, headers: { "cf-cache-status": "DYNAMIC" } });
    },
  };
  return {
    deps,
    calls,
    advance: (ms: number) => {
      time += ms;
    },
  };
}
test("real PG: ordered durable drain/two purges/two anonymous probes converge private/done", async () => {
  const { ctx, data } = await revoked(),
    clock = timeline(data.generation);
  const { revokeMedia } = await import("./media-purge");
  await revokeMedia(ctx, data, clock.deps);
  expect(clock.calls).toHaveLength(5);
  expect(clock.calls[2].at - clock.calls[1].at).toBeGreaterThanOrEqual(5000);
  expect(clock.calls[4].at - clock.calls[3].at).toBeGreaterThanOrEqual(5000);
  for (const call of clock.calls.slice(3)) {
    expect(call.url).toBe(`${ctx.config.publicOrigin}/media/${data.hash}.jpg`);
    expect([...new Headers(call.init.headers)].length).toBe(0);
    expect(call.init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error" });
    expect(call.init.cache).toBeUndefined();
  }
  const [pub] = await ctx.db
    .select()
    .from(mediaPublications)
    .where(eq(mediaPublications.outputSha256, data.hash));
  const [out] = await ctx.db
    .select()
    .from(mediaPurgeRequests)
    .where(eq(mediaPurgeRequests.outputSha256, data.hash));
  expect(pub.state).toBe("private");
  expect(out.state).toBe("done");
  expect(out.evidence?.purges).toHaveLength(2);
  expect(out.evidence?.probes).toHaveLength(2);
});
test("real PG: non-404 cancels old body and durably fails without downloading pixels", async () => {
  const { ctx, data } = await revoked(),
    clock = timeline(data.generation);
  let cancelled = false,
    read = false;
  const normal = clock.deps.fetch;
  clock.deps.fetch = async (url, init) => {
    if (!String(url).startsWith(ctx.config.publicOrigin)) return normal(url, init);
    return new Response(
      new ReadableStream(
        {
          pull() {
            read = true;
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
      { status: 200 },
    );
  };
  const { revokeMedia } = await import("./media-purge");
  await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({
    code: "MEDIA_PROBE_STATUS",
  });
  expect(cancelled).toBe(true);
  expect(read).toBe(false);
  const [out] = await ctx.db
    .select()
    .from(mediaPurgeRequests)
    .where(eq(mediaPurgeRequests.outputSha256, data.hash));
  expect(out.state).toBe("failed");
  expect(out.lastErrorCode).toBe("MEDIA_PROBE_STATUS");
});
async function outbox(hash: string) {
  return (
    await fixture.ctx.db
      .select()
      .from(mediaPurgeRequests)
      .where(eq(mediaPurgeRequests.outputSha256, hash))
  )[0];
}
async function publication(hash: string) {
  return (
    await fixture.ctx.db
      .select()
      .from(mediaPublications)
      .where(eq(mediaPublications.outputSha256, hash))
  )[0];
}
for (const [name, response, code] of [
  ["stale ACK", () => Response.json({ generation: 9999, drained: true }), "MEDIA_DRAIN_ACK"],
  ["coerced ACK", () => Response.json({ generation: 2, drained: "true" }), "MEDIA_DRAIN_ACK"],
  [
    "extra ACK fields",
    () => Response.json({ generation: 2, drained: true, extra: true }),
    "MEDIA_DRAIN_ACK",
  ],
  [
    "malformed drain JSON",
    () => new Response("private upstream message"),
    "MEDIA_RESPONSE_INVALID",
  ],
  ["oversize drain JSON", () => new Response("x".repeat(65537)), "MEDIA_BODY_LIMIT"],
  ["drain denial", () => new Response("private pixels", { status: 404 }), "MEDIA_DRAIN_STATUS"],
] as const)
  test(`real PG: ${name} leaves revoking with durable safe error`, async () => {
    const { ctx, data } = await revoked(),
      clock = timeline(data.generation);
    clock.deps.fetch = async () => response();
    const { revokeMedia } = await import("./media-purge");
    await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({ code });
    expect((await publication(data.hash)).state).toBe("revoking");
    expect((await outbox(data.hash)).lastErrorCode).toBe(code);
    expect(JSON.stringify(await outbox(data.hash))).not.toContain("private upstream");
  });
for (const [name, response, code] of [
  [
    "API false",
    () => Response.json({ success: false, errors: [{ code: 1134, message: "private upstream" }] }),
    "MEDIA_PURGE_API",
  ],
  [
    "API error envelope",
    () => Response.json({ success: true, errors: [{ code: 1134 }] }),
    "MEDIA_PURGE_API",
  ],
  ["API invalid JSON", () => new Response("private upstream"), "MEDIA_RESPONSE_INVALID"],
  ["API oversize", () => new Response("x".repeat(65537)), "MEDIA_BODY_LIMIT"],
  ["API 429", () => new Response("private upstream", { status: 429 }), "MEDIA_PURGE_STATUS"],
] as const)
  test(`real PG: ${name} does not retry or probe`, async () => {
    const { ctx, data } = await revoked(),
      clock = timeline(data.generation),
      normal = clock.deps.fetch;
    let purges = 0;
    clock.deps.fetch = async (url, init) => {
      if (!String(url).includes("api.cloudflare.com")) return normal(url, init);
      purges++;
      return response();
    };
    const { revokeMedia } = await import("./media-purge");
    await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({ code });
    expect(purges).toBe(1);
    expect(clock.calls).toHaveLength(1);
    expect((await outbox(data.hash)).lastErrorCode).toBe(code);
  });
for (const status of [206, 304, 301, 503])
  test(`real PG: probe ${status} immediately cancels body`, async () => {
    const { ctx, data } = await revoked(),
      clock = timeline(data.generation),
      normal = clock.deps.fetch;
    let cancelled = false,
      read = false,
      probes = 0;
    clock.deps.fetch = async (url, init) => {
      if (!String(url).startsWith(ctx.config.publicOrigin)) return normal(url, init);
      probes++;
      const body =
        status === 304
          ? null
          : new ReadableStream(
              {
                pull() {
                  read = true;
                },
                cancel() {
                  cancelled = true;
                },
              },
              { highWaterMark: 0 },
            );
      return new Response(body, { status });
    };
    const { revokeMedia } = await import("./media-purge");
    await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({
      code: "MEDIA_PROBE_STATUS",
    });
    expect(read).toBe(false);
    expect(probes).toBe(1);
    if (status !== 304) expect(cancelled).toBe(true);
  });
test("real PG: 404 HIT cancels without body; CF status missing is recorded null", async () => {
  const { ctx, data } = await revoked(),
    clock = timeline(data.generation),
    normal = clock.deps.fetch;
  let cancelled = false;
  clock.deps.fetch = async (url, init) => {
    if (!String(url).startsWith(ctx.config.publicOrigin)) return normal(url, init);
    return new Response(
      new ReadableStream(
        {
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
      { status: 404, headers: { "CF-Cache-Status": " hit " } },
    );
  };
  const { revokeMedia } = await import("./media-purge");
  await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({
    code: "MEDIA_PROBE_HIT",
  });
  expect(cancelled).toBe(true);
  clock.deps.fetch = async (url, init) =>
    String(url).startsWith(ctx.config.publicOrigin)
      ? new Response(null, { status: 404 })
      : normal(url, init);
  await revokeMedia(ctx, data, clock.deps);
  expect((await outbox(data.hash)).evidence?.probes.map((p) => p.cacheStatus)).toEqual([
    null,
    null,
  ]);
});
for (const size of [65536, 65537])
  test(`real PG: undeclared/chunked 404 body ${size} bytes`, async () => {
    const { ctx, data } = await revoked(),
      clock = timeline(data.generation),
      normal = clock.deps.fetch;
    let cancelled = false;
    clock.deps.fetch = async (url, init) => {
      if (!String(url).startsWith(ctx.config.publicOrigin)) return normal(url, init);
      let chunk = 0;
      return new Response(
        new ReadableStream(
          {
            pull(c) {
              if (chunk++ === 0) c.enqueue(new Uint8Array(65536));
              else if (size > 65536 && chunk === 2) c.enqueue(new Uint8Array(1));
              else c.close();
            },
            cancel() {
              cancelled = true;
            },
          },
          { highWaterMark: 0 },
        ),
        { status: 404, headers: { "cf-cache-status": "BYPASS" } },
      );
    };
    const { revokeMedia } = await import("./media-purge");
    if (size === 65536) {
      await revokeMedia(ctx, data, clock.deps);
      expect((await outbox(data.hash)).evidence?.probes[0].bodyLength).toBe(65536);
    } else {
      await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({
        code: "MEDIA_BODY_LIMIT",
      });
      expect(cancelled).toBe(true);
    }
  });
test("real PG: transport errors never log/persist upstream body/message or credentials", async () => {
  const { ctx, data } = await revoked(),
    clock = timeline(data.generation);
  const lines: string[] = [];
  const { createLogger } = await import("@/shared/log");
  ctx.log = createLogger((line) => lines.push(line));
  clock.deps.fetch = async () => {
    throw new Error("PRIVATE-TOKEN upstream-url private-body");
  };
  const { revokeMedia } = await import("./media-purge");
  await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({
    code: "MEDIA_REQUEST_FAILED",
  });
  expect(lines.join("\n")).not.toContain("PRIVATE-TOKEN");
  expect(JSON.stringify(await outbox(data.hash))).not.toContain("private-body");
});
test("real PG: old generation no-op and a generation change after drain cannot publish private", async () => {
  const { ctx, data } = await revoked(),
    clock = timeline(data.generation),
    normal = clock.deps.fetch;
  const { revokeMedia } = await import("./media-purge");
  await revokeMedia(ctx, { ...data, generation: data.generation - 1 }, clock.deps);
  expect(clock.calls).toHaveLength(0);
  clock.deps.fetch = async (url, init) => {
    const response = await normal(url, init);
    if (String(url).includes("/internal/"))
      await ctx.db
        .update(mediaPublications)
        .set({ generation: data.generation + 1, state: "public" })
        .where(eq(mediaPublications.outputSha256, data.hash));
    return response;
  };
  await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({
    code: "MEDIA_ATTEMPT_STALE",
  });
  expect((await publication(data.hash)).state).toBe("public");
  expect((await outbox(data.hash)).lastErrorCode).toBe("MEDIA_ATTEMPT_INCOMPLETE");
});
for (const boundary of ["drain", "final"])
  test(`real PG: a new shared reference at ${boundary} cannot be erased`, async () => {
    const { ctx, data, f } = await revoked(),
      clock = timeline(data.generation),
      normal = clock.deps.fetch;
    const other = await readyOwner(ctx);
    owners.push(other);
    const shared = await readyFile(ctx, fixture.policy.id, other, f.derived);
    const { userAvatars } = await import("@/server/db/schema");
    let probes = 0;
    clock.deps.fetch = async (url, init) => {
      const response = await normal(url, init);
      if (String(url).startsWith(ctx.config.publicOrigin)) probes++;
      if (
        (boundary === "drain" && String(url).includes("/internal/")) ||
        (boundary === "final" && probes === 2)
      ) {
        await ctx.db
          .insert(userAvatars)
          .values({
            userId: other,
            fileId: shared.file.id,
            derivativeId: shared.recipe.id,
            revision: 1,
          });
      }
      return response;
    };
    const { revokeMedia } = await import("./media-purge");
    await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({
      code: "MEDIA_PUBLIC_REFERENCE",
    });
    expect((await publication(data.hash)).state).toBe("revoking");
    expect((await outbox(data.hash)).state).toBe("failed");
    expect(clock.calls).toHaveLength(boundary === "drain" ? 1 : 5);
  });
test("real PG: overlapping same-generation attempts clear evidence and fence old evidence/error/final writes", async () => {
  const { ctx, data } = await revoked(),
    first = timeline(data.generation),
    second = timeline(data.generation);
  const normal = first.deps.fetch;
  let release!: () => void, reached!: () => void;
  const barrier = new Promise<void>((r) => (release = r)),
    hit = new Promise<void>((r) => (reached = r));
  first.deps.fetch = async (url, init) => {
    if (String(url).includes("api.cloudflare.com")) {
      reached();
      await barrier;
    }
    return normal(url, init);
  };
  const { revokeMedia } = await import("./media-purge");
  const old = revokeMedia(ctx, data, first.deps).then(
    () => null,
    (e) => e,
  );
  await hit;
  second.deps.fetch = async () => Response.json({ generation: 999, drained: true });
  await expect(revokeMedia(ctx, data, second.deps)).rejects.toMatchObject({
    code: "MEDIA_DRAIN_ACK",
  });
  const fresh = await outbox(data.hash);
  expect(fresh.attempts).toBe(2);
  expect(fresh.evidence?.drain).toBeUndefined();
  expect(fresh.evidence?.purges).toEqual([]);
  expect(fresh.lastErrorCode).toBe("MEDIA_DRAIN_ACK");
  release();
  expect((await old).code).toBe("MEDIA_ATTEMPT_STALE");
  expect(await outbox(data.hash)).toEqual(fresh);
  expect((await publication(data.hash)).state).toBe("revoking");
});
test("real PG: injected elapsed request time and DB time consume the whole budget", async () => {
  const { ctx, data } = await revoked(),
    clock = timeline(data.generation),
    normal = clock.deps.fetch;
  clock.deps.fetch = async (url, init) => {
    clock.advance(9999);
    return normal(url, init);
  };
  const { revokeMedia } = await import("./media-purge");
  await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({
    code: "MEDIA_ATTEMPT_DEADLINE",
  });
  expect(clock.calls.length).toBeLessThanOrEqual(5);
  expect((await publication(data.hash)).state).toBe("revoking");
  expect((await outbox(data.hash)).lastErrorCode).toBe("MEDIA_ATTEMPT_DEADLINE");
});
test("real PG: stalled bounded drain body is cancelled at the individual 10s deadline", async () => {
  const { ctx, data } = await revoked(),
    clock = timeline(data.generation);
  let cancelled = false,
    signal: AbortSignal | undefined;
  clock.deps.fetch = async (_url, init) => {
    signal = init?.signal ?? undefined;
    return new Response(
      new ReadableStream(
        {
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
    );
  };
  const { revokeMedia } = await import("./media-purge");
  const start = performance.now();
  await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({
    code: "MEDIA_REQUEST_TIMEOUT",
  });
  expect(performance.now() - start).toBeLessThan(11000);
  expect(signal?.aborted).toBe(true);
  expect(cancelled).toBe(true);
  expect((await outbox(data.hash)).state).toBe("failed");
}, 15000);
test("real PG: final transaction rejects incomplete durable evidence atomically", async () => {
  const { ctx, data } = await revoked();
  const { claimMediaPurge, finishMediaPurge } = await import("@/server/storage/publication");
  const b = { remaining: () => 5000, check() {} };
  const attempt = await claimMediaPurge(ctx, data, b);
  await expect(finishMediaPurge(ctx, attempt!, b)).rejects.toMatchObject({
    code: "MEDIA_EVIDENCE_INCOMPLETE",
  });
  expect((await publication(data.hash)).state).toBe("revoking");
  expect((await outbox(data.hash)).state).toBe("running");
});
function realBudget(ms: number) {
  const deadline = performance.now() + ms;
  return {
    remaining: () => Math.max(0, deadline - performance.now()),
    check() {
      if (performance.now() >= deadline) throw new Error("deadline");
    },
  };
}
test("real PG: row lock deadline destroys active connection and rolls back writes", async () => {
  const { ctx, data } = await revoked();
  const { testDbHandle } = await import("@/server/testing/test-db");
  const { withPurgeTransaction } = await import("@/server/storage/publication");
  const blocker = await testDbHandle().pool.connect();
  await blocker.query("begin");
  await blocker.query("select 1 from media_purge_requests where output_sha256=$1 for update", [
    data.hash,
  ]);
  const start = performance.now();
  try {
    await expect(
      withPurgeTransaction(ctx.db, realBudget(100), async (tx) => {
        await tx
          .update(mediaPurgeRequests)
          .set({ lastErrorCode: "SHOULD_ROLLBACK" })
          .where(eq(mediaPurgeRequests.outputSha256, data.hash));
      }),
    ).rejects.toMatchObject({ code: "MEDIA_ATTEMPT_DEADLINE" });
    expect(performance.now() - start).toBeLessThan(500);
  } finally {
    await blocker.query("rollback");
    blocker.release();
  }
  expect((await outbox(data.hash)).lastErrorCode).toBeNull();
});
test("real PG: stalled COMMIT transport phase cannot continue after timeout", async () => {
  const { ctx, data } = await revoked();
  const { testDbHandle } = await import("@/server/testing/test-db");
  const { withPurgeTransaction } = await import("@/server/storage/publication");
  const pool = testDbHandle().pool,
    connect = pool.connect;
  const listeners = pool.listeners("error"),
    errors: string[] = [];
  let release!: () => void, clientQuery: import("pg").PoolClient["query"] | undefined;
  const barrier = new Promise<void>((r) => (release = r));
  let failed = false,
    failure: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    pool.removeAllListeners("error");
    pool.on("error", (error) => {
      errors.push((error as Error & { code: string }).code);
    });
    pool.connect = (async () => {
      const client = await Reflect.apply(connect, pool, []),
        query = client.query;
      clientQuery = query;
      client.query = (async (...args: unknown[]) => {
        const text = typeof args[0] === "string" ? args[0] : (args[0] as { text: string }).text;
        if (text === "commit") await barrier;
        return Reflect.apply(query, client, args);
      }) as typeof client.query;
      return client;
    }) as typeof pool.connect;
    await expect(
      withPurgeTransaction(ctx.db, realBudget(100), async (tx) => {
        await tx
          .update(mediaPurgeRequests)
          .set({ lastErrorCode: "SHOULD_ROLLBACK" })
          .where(eq(mediaPurgeRequests.outputSha256, data.hash));
      }),
    ).rejects.toMatchObject({ code: "MEDIA_ATTEMPT_DEADLINE" });
    expect(clientQuery).toBeDefined();
    pool.connect = connect;
    release();
    expect((await outbox(data.hash)).lastErrorCode).toBeNull();
    expect(errors.length).toBeLessThanOrEqual(1);
    expect(errors.every((code) => code === "25P04")).toBe(true);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    // Attempt every restoration even if one cleanup step fails; preserve assertion errors.
    for (const restore of [
      () => {
        pool.connect = connect;
      },
      release,
      () => {
        pool.removeAllListeners("error");
      },
      ...listeners.map((listener) => () => {
        pool.on("error", listener as (error: Error, client: import("pg").PoolClient) => void);
      }),
    ]) {
      try {
        restore();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (cleanupErrors.length)
    throw new AggregateError(
      failed ? [failure, ...cleanupErrors] : cleanupErrors,
      "stalled COMMIT fixture cleanup failed",
      failed ? { cause: failure } : undefined,
    );
  if (failed) throw failure;
});
test("real PG: pool acquisition is bounded and a late acquired client is discarded", async () => {
  const { createDb } = await import("@/server/db/client");
  const { testDatabaseUrl } = await import("@/server/testing/services");
  const { withPurgeTransaction } = await import("@/server/storage/publication");
  const { db, pool } = createDb(testDatabaseUrl(), { max: 1 });
  const blocker = await pool.connect();
  let callback = false;
  try {
    await expect(
      withPurgeTransaction(db, realBudget(60), async () => {
        callback = true;
      }),
    ).rejects.toMatchObject({ code: "MEDIA_ATTEMPT_DEADLINE" });
    blocker.release();
    // Subsequent query can only run after the timed-out waiter discards its client.
    await db.execute((await import("drizzle-orm")).sql`select 1`);
    expect(callback).toBe(false);
    expect(pool.waitingCount).toBe(0);
  } finally {
    await pool.end();
  }
});
test("real PG: maintenance denial refuses claim and does not contact edge", async () => {
  const { ctx, data } = await revoked(),
    clock = timeline(data.generation);
  const { storageMaintenance } = await import("@/server/db/schema");
  await ctx.db
    .update(storageMaintenance)
    .set({ ownerId: crypto.randomUUID(), leaseUntil: new Date(Date.now() + 10000) });
  try {
    const { revokeMedia } = await import("./media-purge");
    await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({
      code: "STORAGE_MAINTENANCE",
    });
    expect(clock.calls).toHaveLength(0);
    expect((await outbox(data.hash)).attempts).toBe(0);
  } finally {
    await ctx.db.update(storageMaintenance).set({ ownerId: null, leaseUntil: null });
  }
});
test("real PG: old dead observation preserves fresh attempt; repair enqueues due pending/failed/stale-running only", async () => {
  const { repairMediaPurges, recordMediaPurgeDead } = await import("./media-purge");
  const { sql } = await import("drizzle-orm");
  const items = await Promise.all([revoked(), revoked(), revoked(), revoked(), revoked()]);
  const states = ["pending", "failed", "running", "running", "done"] as const;
  for (let i = 0; i < items.length; i++) {
    const { ctx, data } = items[i];
    await ctx.db
      .update(mediaPurgeRequests)
      .set({
        state: states[i],
        attempts: i + 1,
        lastErrorCode: "FRESH_ATTEMPT",
        nextAttemptAt: new Date(Date.now() + (i === 3 ? 3600000 : -1000)),
      })
      .where(eq(mediaPurgeRequests.outputSha256, data.hash));
    await ctx.db.execute(
      sql`delete from pgboss.job where name='media.purge' and data->>'hash'=${data.hash}`,
    );
  }
  const fresh = await outbox(items[3].data.hash);
  await recordMediaPurgeDead(items[3].ctx, [
    { id: crypto.randomUUID(), data: items[3].data } as import("pg-boss").Job<
      import("@/server/storage/avatars").MediaPurgeJobData
    >,
  ]);
  expect(await outbox(items[3].data.hash)).toEqual(fresh);
  await repairMediaPurges(items[0].ctx);
  for (let i = 0; i < items.length; i++) {
    const jobs = await items[i].ctx.db.execute(
      sql`select id from pgboss.job where name='media.purge' and data->>'hash'=${items[i].data.hash}`,
    );
    expect(jobs.rows).toHaveLength(i < 3 ? 1 : 0);
  }
  await repairMediaPurges(items[0].ctx);
  const jobs = await items[0].ctx.db.execute(
    sql`select id from pgboss.job where name='media.purge' and data->>'hash'=${items[0].data.hash}`,
  );
  expect(jobs.rows).toHaveLength(1);
});
test("real PG: lost ACK after accepted COMMIT reconciles done and sends no extra Cloudflare requests", async () => {
  const { ctx, data } = await revoked(),
    clock = timeline(data.generation);
  const { revokeMedia } = await import("./media-purge");
  await revokeMedia(ctx, data, clock.deps);
  const row = await outbox(data.hash);
  await ctx.db
    .update(mediaPublications)
    .set({ state: "revoking" })
    .where(eq(mediaPublications.outputSha256, data.hash));
  await ctx.db
    .update(mediaPurgeRequests)
    .set({ state: "running" })
    .where(eq(mediaPurgeRequests.outputSha256, data.hash));
  const { testDbHandle } = await import("@/server/testing/test-db");
  const { finishMediaPurge } = await import("@/server/storage/publication");
  const pool = testDbHandle().pool,
    connect = pool.connect;
  let release!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  pool.connect = (async () => {
    const client = await Reflect.apply(connect, pool, []),
      query = client.query;
    client.query = (async (...args: unknown[]) => {
      const text = typeof args[0] === "string" ? args[0] : (args[0] as { text: string }).text;
      const response = await Reflect.apply(query, client, args);
      if (text === "commit") await barrier;
      return response;
    }) as typeof client.query;
    return client;
  }) as typeof pool.connect;
  try {
    await expect(
      finishMediaPurge(ctx, { ...data, attempt: row.attempts }, realBudget(100)),
    ).rejects.toMatchObject({ code: "MEDIA_ATTEMPT_DEADLINE" });
  } finally {
    pool.connect = connect;
    release();
  }
  expect((await publication(data.hash)).state).toBe("private");
  expect((await outbox(data.hash)).state).toBe("done");
  const retry = timeline(data.generation);
  await revokeMedia(ctx, data, retry.deps);
  expect(retry.calls).toHaveLength(0);
});
test("real PG: due outbox repair caps each batch at100 and excludes obsolete generations", async () => {
  const { ctx } = fixture;
  const { derivedObjects, storageBudget } = await import("@/server/db/schema");
  const { sql } = await import("drizzle-orm");
  const hashes = Array.from({ length: 105 }, () =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
  );
  await ctx.db
    .insert(derivedObjects)
    .values(
      hashes.map((hash) => ({
        outputSha256: hash,
        policyId: fixture.policy.id,
        key: `sha256/${hash}`,
        size: 1,
        mime: "image/jpeg",
        state: "ready" as const,
      })),
    );
  await ctx.db
    .update(storageBudget)
    .set({ derivedWritten: sql`${storageBudget.derivedWritten}+105` })
    .where(eq(storageBudget.id, "global"));
  await ctx.db
    .insert(mediaPublications)
    .values(
      hashes.map((hash) => ({ outputSha256: hash, generation: 2, state: "revoking" as const })),
    );
  await ctx.db
    .insert(mediaPurgeRequests)
    .values(
      hashes.map((hash) => ({ outputSha256: hash, generation: 2, nextAttemptAt: new Date(0) })),
    );
  await ctx.db
    .insert(mediaPurgeRequests)
    .values({ outputSha256: hashes[0], generation: 1, nextAttemptAt: new Date(0) });
  const { repairMediaPurges } = await import("./media-purge");
  expect(await repairMediaPurges(ctx)).toBe(100);
  const all = await ctx.db.execute(sql`select data from pgboss.job where name='media.purge'`);
  const jobs = { rows: all.rows.filter((r) => hashes.includes((r.data as { hash: string }).hash)) };
  expect(jobs.rows).toHaveLength(100);
  expect(jobs.rows.every((r) => (r.data as { generation: number }).generation === 2)).toBe(true);
});
for (const failure of [false, true])
  test(`real PG: blacklisted shared public output remains blocked after ${failure ? "failed" : "successful"} revocation`, async () => {
    const { ctx, data, f, id } = await revoked(),
      clock = timeline(data.generation);
    const { blobBlocks, userAvatars } = await import("@/server/db/schema");
    await ctx.db
      .update(userAvatars)
      .set({ fileId: f.file.id, derivativeId: f.recipe.id, revision: 3 })
      .where(eq(userAvatars.userId, id));
    await ctx.db.insert(blobBlocks).values({ sha256: data.hash, reasonCode: "test-block" });
    blockedHashes.push(data.hash);
    await ctx.db
      .update(mediaPublications)
      .set({ state: "blocked" })
      .where(eq(mediaPublications.outputSha256, data.hash));
    const { revokeMedia } = await import("./media-purge");
    if (failure) {
      clock.deps.fetch = async () => new Response(null, { status: 503 });
      await expect(revokeMedia(ctx, data, clock.deps)).rejects.toMatchObject({
        code: "MEDIA_DRAIN_STATUS",
      });
      expect((await outbox(data.hash)).state).toBe("failed");
    } else {
      await revokeMedia(ctx, data, clock.deps);
      const out = await outbox(data.hash);
      expect(out.state).toBe("done");
      expect(out.evidence?.purges).toHaveLength(2);
      expect(out.evidence?.probes).toHaveLength(2);
      expect(clock.calls).toHaveLength(5);
    }
    expect((await publication(data.hash)).state).toBe("blocked");
  });
test("malformed jobs fail before any network request", async () => {
  const { ctx, data } = await revoked(),
    clock = timeline(data.generation);
  const { revokeMedia } = await import("./media-purge");
  for (const bad of [
    { hash: data.hash.toUpperCase(), generation: 2 },
    { hash: "invalid?token", generation: 2 },
    { hash: data.hash, generation: -1 },
    { hash: data.hash, generation: 1.5 },
    { hash: data.hash, generation: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    await expect(revokeMedia(ctx, bad, clock.deps)).rejects.toMatchObject({
      code: "MEDIA_JOB_INVALID",
    });
  }
  expect(clock.calls).toHaveLength(0);
});
