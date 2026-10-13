import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createLogger } from "@/shared/log";
import {
  user,
  blobs,
  files,
  blobBlocks,
  storageMaintenance,
  storagePolicies,
  storageUsage,
  storageBudget,
  uploadAttempts,
  uploadSessions,
  uploadParts,
} from "../db/schema";
import { testSender } from "../testing/test-boss";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import { cleanupStorageFixture, storageFixtureConfig } from "../../../test/storage/fixture";
import type { DbTransaction, StorageContext } from "./contracts";
import { StorageUnavailableError } from "./errors";
import { createS3Driver } from "./s3";
import { initUpload, getUpload, cancelUpload } from "./uploads";
import { putUploadPart } from "./parts";
import { AVATAR_RULE } from "./rules";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytes = new Uint8Array([1, 2, 3]);
let ctx: StorageContext;
const fixtureOwners: string[] = [];
const fixturePolicies: string[] = [];
beforeAll(async () => {
  await resetTestDatabase();
  const config = await storageFixtureConfig();
  ctx = {
    db: testDbHandle().db,
    config,
    driver: createS3Driver(config),
    boss: testSender,
    log: createLogger(() => {}),
  };
  const [policy] = await ctx.db
    .insert(storagePolicies)
    .values({
      name: "upload-test",
      endpoint: config.endpoint,
      region: config.region,
      originalBucket: config.originalBucket,
      derivedBucket: config.derivedBucket,
      credentialsRef: config.credentialsRef,
    })
    .returning({ id: storagePolicies.id });
  fixturePolicies.push(policy.id);
}, 30000);
afterAll(async () => {
  if (ctx)
    await cleanupStorageFixture(
      ctx.db,
      fixtureOwners,
      fixturePolicies,
      process.env.STORAGE_TEST_FIXTURE_PATH ? ctx.driver : undefined,
    );
}, 30000);
async function owner() {
  const id = crypto.randomUUID();
  fixtureOwners.push(id);
  await ctx.db.insert(user).values({ id, name: "test", email: `${id}@placeholder.invalid` });
  return id;
}
const input = (size = bytes.length) => ({
  purpose: "avatar" as const,
  name: "../photo.png",
  size,
  sha256: hash(bytes),
});
test("three racing reservations admit two and cancel releases exactly once; idempotency is stable", async () => {
  const id = await owner();
  const keys = Array.from({ length: 3 }, () => crypto.randomUUID());
  const results = await Promise.allSettled(keys.map((k) => initUpload(ctx, id, input(8388608), k)));
  expect(
    results.filter((r) => r.status === "fulfilled"),
    JSON.stringify(results.map((r) => (r.status === "rejected" ? r.reason?.code : "accepted"))),
  ).toHaveLength(2);
  expect(
    (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
  ).toMatchObject({ code: "TOO_MANY_UPLOADS" });
  const [usage] = await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, id));
  expect(usage.reservedBytes).toBe(16777216);
  expect(usage.activeUploads).toBe(2);
  const n = results.findIndex((r) => r.status === "fulfilled");
  const first = (results[n] as PromiseFulfilledResult<Awaited<ReturnType<typeof initUpload>>>)
    .value;
  expect(await initUpload(ctx, id, input(8388608), keys[n])).toEqual(first);
  await expect(initUpload(ctx, id, input(7), keys[n])).rejects.toMatchObject({
    code: "IDEMPOTENCY_CONFLICT",
  });
  await Promise.all([cancelUpload(ctx, id, first.id), cancelUpload(ctx, id, first.id)]);
  const [after] = await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, id));
  expect(after.activeUploads).toBe(1);
  expect(after.reservedBytes).toBe(8388608);
});
test("ownership, inactive users, quota, budget and global cap fail without sessions", async () => {
  const id = await owner();
  const upload = await initUpload(ctx, id, input(), crypto.randomUUID());
  await expect(getUpload(ctx, await owner(), upload.id)).rejects.toMatchObject({
    status: 404,
  });
  await ctx.db.update(user).set({ status: "pending_deletion" }).where(eq(user.id, id));
  await expect(initUpload(ctx, id, input(), crypto.randomUUID())).rejects.toMatchObject({
    code: "ACCOUNT_INACTIVE",
  });
  const next = await owner();
  await ctx.db.insert(storageUsage).values({ userId: next, usedBytes: 33554432 });
  const quotaHash = createHash("sha256").update(next).digest("hex");
  const [quotaBlob] = await ctx.db.insert(blobs).values({sha256:quotaHash,size:33554432,
    policyId:fixturePolicies[0],key:`sha256/${quotaHash}`,state:"ready",detectedMime:"image/png",verifiedAt:new Date()}).returning();
  await ctx.db.insert(files).values({ownerId:next,blobId:quotaBlob.id,purpose:"avatar",
    originalName:"quota.png",size:33554432,state:"ready"});
  await expect(initUpload(ctx, next, input(), crypto.randomUUID())).rejects.toMatchObject({
    code: "QUOTA_EXCEEDED",
  });
  const tiny = {
    ...ctx,
    config: {
      ...ctx.config,
      limits: { ...ctx.config.limits, originalBudget: 1 },
    },
  };
  await expect(initUpload(tiny, await owner(), input(), crypto.randomUUID())).rejects.toMatchObject(
    { code: "STORAGE_BUDGET_EXCEEDED" },
  );
});
test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "real S3 parts replay, conflict, hash validation and cancellation during PUT cleans own key",
  async () => {
    const id = await owner();
    const upload = await initUpload(ctx, id, input(), crypto.randomUUID());
    await expect(putUploadPart(ctx, id, upload.id, 0, bytes, "0".repeat(64))).rejects.toMatchObject(
      { code: "PART_HASH_MISMATCH" },
    );
    await putUploadPart(ctx, id, upload.id, 0, bytes, hash(bytes));
    await putUploadPart(ctx, id, upload.id, 0, bytes, hash(bytes));
    await expect(
      putUploadPart(
        ctx,
        id,
        upload.id,
        0,
        new Uint8Array([3, 2, 1]),
        hash(new Uint8Array([3, 2, 1])),
      ),
    ).rejects.toMatchObject({ code: "PART_CONFLICT" });
    expect((await getUpload(ctx, id, upload.id)).receivedParts).toEqual([
      { index: 0, size: 3, sha256: hash(bytes) },
    ]);
    const other = await initUpload(ctx, id, input(), crypto.randomUUID());
    let started!: () => void;
    let release!: () => void;
    const start = new Promise<void>((r) => (started = r));
    const held = new Promise<void>((r) => (release = r));
    let key = "";
    const delayed = {
      ...ctx,
      driver: {
        ...ctx.driver,
        put: async (args: Parameters<StorageContext["driver"]["put"]>[0]) => {
          key = args.key;
          await ctx.driver.put(args);
          started();
          await held;
        },
      },
    };
    const pending = putUploadPart(delayed, id, other.id, 0, bytes, hash(bytes));
    const settled = pending.catch((e) => e);
    await start;
    await cancelUpload(ctx, id, other.id);
    release();
    expect(await settled).toMatchObject({ code: "UPLOAD_CANCELLED" });
    expect(await ctx.driver.head({ bucket: "original", key })).toBeNull();
    const [attempt] = await ctx.db
      .select()
      .from(uploadAttempts)
      .where(eq(uploadAttempts.tempKey, key));
    expect(attempt.state).toBe("deleted");
    expect(attempt.reservedBytes + attempt.writtenBytes).toBe(0);
  },
);

test("global cap, budget rejection and low disk leave no session or reservation", async () => {
  const id = await owner();
  const inserted = await ctx.db
    .insert(uploadSessions)
    .values(
      Array.from({ length: 100 }, () => ({
        ownerId: id,
        purpose: "avatar" as const,
        originalName: "a.png",
        expectedSize: 3,
        expectedSha256: hash(bytes),
        partSize: 4194304,
        partCount: 1,
        expiresAt: new Date(Date.now() + 60000),
        idempotencyKey: crypto.randomUUID(),
        requestDigest: "1".repeat(64),
      })),
    )
    .returning({ id: uploadSessions.id });
  const candidate = await owner();
  try {
    await expect(initUpload(ctx, candidate, input(), crypto.randomUUID())).rejects.toMatchObject({
      code: "TOO_MANY_UPLOADS",
    });
  } finally {
    for (const item of inserted)
      await ctx.db.delete(uploadSessions).where(eq(uploadSessions.id, item.id));
  }
  for (const limits of [
    { ...ctx.config.limits, temporaryBudget: 1 },
    { ...ctx.config.limits, derivedBudget: 0 },
  ])
    await expect(
      initUpload(
        { ...ctx, config: { ...ctx.config, limits } },
        candidate,
        input(),
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "STORAGE_BUDGET_EXCEEDED" });
  await expect(
    initUpload(
      {
        ...ctx,
        config: {
          ...ctx.config,
          limits: {
            ...ctx.config.limits,
            minFreeDiskBytes: Number.MAX_SAFE_INTEGER,
          },
        },
      },
      candidate,
      input(),
      crypto.randomUUID(),
    ),
  ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  expect(
    await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.ownerId, candidate)),
  ).toHaveLength(0);
  expect(
    await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, candidate)),
  ).toHaveLength(0);
});
test("expiry is absolute and idempotency replays expired terminal DTO", async () => {
  const id = await owner();
  const key = crypto.randomUUID();
  const upload = await initUpload(ctx, id, input(), key);
  expect(Date.parse(upload.expiresAt) - Date.now()).toBeGreaterThan(86390000);
  await ctx.db
    .update(uploadSessions)
    .set({ expiresAt: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(uploadSessions.id, upload.id));
  expect(await initUpload(ctx, id, input(), key)).toMatchObject({
    id: upload.id,
    state: "expired",
    errorCode: "UPLOAD_EXPIRED",
  });
  await expect(putUploadPart(ctx, id, upload.id, 0, bytes, hash(bytes))).rejects.toMatchObject({
    code: "UPLOAD_EXPIRED",
  });
});
test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "expired lease takeover keeps both charges until stale actual PUT settles and deletes only its key",
  async () => {
    const id = await owner();
    const upload = await initUpload(ctx, id, input(), crypto.randomUUID());
    let started!: () => void;
    let release!: () => void;
    const start = new Promise<void>((r) => (started = r));
    const held = new Promise<void>((r) => (release = r));
    let oldKey = "";
    const delayed = {
      ...ctx,
      driver: {
        ...ctx.driver,
        put: async (args: Parameters<StorageContext["driver"]["put"]>[0]) => {
          oldKey = args.key;
          await ctx.driver.put(args);
          started();
          await held;
        },
      },
    };
    const stale = putUploadPart(delayed, id, upload.id, 0, bytes, hash(bytes)).catch((e) => e);
    await start;
    await expect(putUploadPart(ctx, id, upload.id, 0, bytes, hash(bytes))).rejects.toMatchObject({
      code: "PART_BUSY",
    });
    await ctx.db
      .update(uploadParts)
      .set({ leaseUntil: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(uploadParts.uploadId, upload.id));
    await ctx.db
      .update(uploadAttempts)
      .set({ leaseUntil: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(uploadAttempts.uploadId, upload.id));
    try {
      await putUploadPart(ctx, id, upload.id, 0, bytes, hash(bytes));
      const attempts = await ctx.db
        .select()
        .from(uploadAttempts)
        .where(eq(uploadAttempts.uploadId, upload.id));
      expect(attempts).toHaveLength(2);
      expect(attempts.reduce((n, a) => n + a.reservedBytes + a.writtenBytes, 0)).toBe(6);
      const current = attempts.find((a) => a.tempKey !== oldKey)!;
      expect(await ctx.driver.head({ bucket: "original", key: oldKey })).not.toBeNull();
      release();
      expect(await stale).toMatchObject({ code: "PART_BUSY" });
      expect(await ctx.driver.head({ bucket: "original", key: oldKey })).toBeNull();
      expect(await ctx.driver.head({ bucket: "original", key: current.tempKey })).not.toBeNull();
      expect((await getUpload(ctx, id, upload.id)).receivedParts).toHaveLength(1);
    } finally {
      release();
      await stale;
    }
  },
);
test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "parts arrive out of order; S3 IO holds no business transaction locks",
  async () => {
    const id = await owner();
    const full = new Uint8Array(AVATAR_RULE.partSize + 1);
    const upload = await initUpload(
      ctx,
      id,
      { ...input(full.length), sha256: hash(full) },
      crypto.randomUUID(),
    );
    const checking = {
      ...ctx,
      driver: {
        ...ctx.driver,
        put: async (args: Parameters<StorageContext["driver"]["put"]>[0]) => {
          // A conflicting user/budget/maintenance NOWAIT lock must succeed while storage IO is active.
          const client = await testDbHandle().pool.connect();
          try {
            await client.query("begin");
            await client.query("select * from storage_maintenance for update nowait");
            await client.query('select * from "user" where id=$1 for update nowait', [id]);
            await client.query("select * from storage_budget for update nowait");
          } finally {
            await client.query("rollback");
            client.release();
          }
          await ctx.driver.put(args);
        },
      },
    };
    await putUploadPart(
      checking,
      id,
      upload.id,
      1,
      full.subarray(upload.partSize),
      hash(full.subarray(upload.partSize)),
    );
    await putUploadPart(
      checking,
      id,
      upload.id,
      0,
      full.subarray(0, upload.partSize),
      hash(full.subarray(0, upload.partSize)),
    );
    expect((await getUpload(ctx, id, upload.id)).receivedParts.map((p) => p.index)).toEqual([0, 1]);
  },
);

test("private original knowledge grants no shortcut; only owner ready original bypasses original preflight", async () => {
  const originalOwner = await owner();
  const stranger = await owner();
  const [policy] = await ctx.db.select().from(storagePolicies).limit(1);
  const content = new Uint8Array([42, 11]);
  const sha256 = hash(content);
  const [blob] = await ctx.db
    .insert(blobs)
    .values({
      sha256,
      policyId: policy.id,
      key: `sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`,
      size: 2,
      state: "ready",
      detectedMime: "image/png",
      verifiedAt: new Date(),
    })
    .returning();
  await ctx.db.insert(files).values({
    ownerId: originalOwner,
    blobId: blob.id,
    originalName: "private.png",
    purpose: "avatar",
    size: 2,
    state: "ready",
  });
  const request = {
    purpose: "avatar" as const,
    name: "../private.png",
    size: 2,
    sha256,
  };
  const ordinary = await initUpload(ctx, stranger, request, crypto.randomUUID());
  expect(ordinary.state).toBe("receiving");
  expect(ordinary.fileId).toBeUndefined();
  expect(ordinary.receivedParts).toEqual([]);
  const [stored] = await ctx.db
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.id, ordinary.id));
  expect(stored.originalName).toBe("private.png");
  const full = {
    ...ctx,
    config: {
      ...ctx.config,
      limits: { ...ctx.config.limits, originalBudget: 1 },
    },
  };
  await expect(initUpload(full, stranger, request, crypto.randomUUID())).rejects.toMatchObject({
    code: "STORAGE_BUDGET_EXCEEDED",
  });
  expect((await initUpload(full, originalOwner, request, crypto.randomUUID())).state).toBe(
    "processing",
  );
  await ctx.db.insert(blobBlocks).values({ sha256, reasonCode: "test" });
  await expect(initUpload(ctx, originalOwner, request, crypto.randomUUID())).rejects.toMatchObject({
    code: "HASH_BLOCKED",
  });
  await expect(initUpload(ctx, stranger, request, crypto.randomUUID())).rejects.toMatchObject({
    code: "HASH_BLOCKED",
  });
});
test("maintenance rejects init/part/cancel but permits owner reads", async () => {
  const id = await owner();
  const upload = await initUpload(ctx, id, input(), crypto.randomUUID());
  await ctx.db.update(storageMaintenance).set({
    ownerId: crypto.randomUUID(),
    leaseUntil: new Date(Date.now() + 60000),
  });
  try {
    await expect(initUpload(ctx, id, input(), crypto.randomUUID())).rejects.toMatchObject({
      status: 503,
      code: "STORAGE_MAINTENANCE",
    });
    await expect(putUploadPart(ctx, id, upload.id, 0, bytes, hash(bytes))).rejects.toMatchObject({
      status: 503,
      code: "STORAGE_MAINTENANCE",
    });
    await expect(cancelUpload(ctx, id, upload.id)).rejects.toMatchObject({
      status: 503,
      code: "STORAGE_MAINTENANCE",
    });
    expect((await getUpload(ctx, id, upload.id)).id).toBe(upload.id);
  } finally {
    await ctx.db.update(storageMaintenance).set({ ownerId: null, leaseUntil: null });
  }
});

test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "an ambiguous ready commit preserves the selected object and replay converges",
  async () => {
    const id = await owner();
    const upload = await initUpload(ctx, id, input(), crypto.randomUUID());
    let deletes = 0;
    const uncertain = {
      ...ctx,
      db: transactionFault(ctx.db, (call, phase) => {
        if (call === 2 && phase === "after") throw new StorageUnavailableError();
      }),
      driver: {
        ...ctx.driver,
        delete: async (args: Parameters<StorageContext["driver"]["delete"]>[0]) => {
          deletes++;
          await ctx.driver.delete(args);
        },
      },
    };
    await expect(
      putUploadPart(uncertain, id, upload.id, 0, bytes, hash(bytes)),
    ).rejects.toMatchObject({ status: 503 });
    expect(deletes).toBe(0);
    expect((await getUpload(ctx, id, upload.id)).receivedParts).toEqual([
      { index: 0, size: 3, sha256: hash(bytes) },
    ]);
    const [attempt] = await ctx.db
      .select()
      .from(uploadAttempts)
      .where(eq(uploadAttempts.uploadId, upload.id));
    expect(attempt).toMatchObject({ state: "ready", reservedBytes: 0, writtenBytes: 3 });
    expect(await ctx.driver.head({ bucket: "original", key: attempt.tempKey })).toMatchObject({
      size: 3,
    });
    await putUploadPart(ctx, id, upload.id, 0, bytes, hash(bytes));
  },
);

test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "an unconfirmed cleanup claim preserves physical bytes and its durable charge",
  async () => {
    const id = await owner();
    const upload = await initUpload(ctx, id, input(), crypto.randomUUID());
    let deletes = 0;
    const uncertain = {
      ...ctx,
      db: transactionFault(ctx.db, (call, phase) => {
        if ((call === 2 && phase === "before") || (call === 3 && phase === "after"))
          throw new StorageUnavailableError();
      }),
      driver: {
        ...ctx.driver,
        delete: async (args: Parameters<StorageContext["driver"]["delete"]>[0]) => {
          deletes++;
          await ctx.driver.delete(args);
        },
      },
    };
    await expect(
      putUploadPart(uncertain, id, upload.id, 0, bytes, hash(bytes)),
    ).rejects.toMatchObject({ status: 503 });
    expect(deletes).toBe(0);
    const [attempt] = await ctx.db
      .select()
      .from(uploadAttempts)
      .where(eq(uploadAttempts.uploadId, upload.id));
    expect(attempt).toMatchObject({
      state: "deleting",
      reservedBytes: 3,
      writtenBytes: 0,
      generation: 1,
    });
    expect(await ctx.driver.head({ bucket: "original", key: attempt.tempKey })).toMatchObject({
      size: 3,
    });
  },
);

function transactionFault(
  db: StorageContext["db"],
  fault: (call: number, phase: "before" | "after") => void,
): StorageContext["db"] {
  let calls = 0;
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return async <T>(
        fn: (tx: DbTransaction) => Promise<T>,
        config?: Parameters<typeof db.transaction>[1],
      ) => {
        const call = ++calls;
        fault(call, "before");
        const result = await db.transaction(fn, config);
        fault(call, "after");
        return result;
      };
    },
  });
}

test("a rejected PUT that persists later stays charged and is not immediately deleted", async () => {
  const id = await owner();
  const [before] = await ctx.db.select().from(storageBudget).where(eq(storageBudget.id, "global"));
  const upload = await initUpload(ctx, id, input(), crypto.randomUUID());
  let received!: () => void;
  let persist!: () => void;
  let persisted!: () => void;
  const receivedBody = new Promise<void>((resolve) => {
    received = resolve;
  });
  const allowPersistence = new Promise<void>((resolve) => {
    persist = resolve;
  });
  const latePersistence = new Promise<void>((resolve) => {
    persisted = resolve;
  });
  const stored: { body: Uint8Array | null } = { body: null };
  let deletes = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method === "PUT") {
        const body = new Uint8Array(await request.arrayBuffer());
        received();
        await allowPersistence;
        stored.body = body;
        persisted();
        return new Response(null, { status: 200, headers: { etag: '"late-put"' } });
      }
      if (request.method === "DELETE") {
        deletes++;
        stored.body = null;
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 404 });
    },
  });
  const driver = createS3Driver(
    {
      ...ctx.config,
      endpoint: server.url.origin,
      accessKeyId: "isolated-fault-test",
      secretAccessKey: "isolated-fault-test",
    },
    { requestTimeoutMs: 100 },
  );
  try {
    const outcome = putUploadPart({ ...ctx, driver }, id, upload.id, 0, bytes, hash(bytes)).catch(
      (error) => error,
    );
    await receivedBody;
    expect(await outcome).toMatchObject({ status: 503, code: "STORAGE_UNAVAILABLE" });
    persist();
    await latePersistence;
    expect(stored.body).toEqual(bytes);
    expect(deletes).toBe(0);
    const [attempt] = await ctx.db
      .select()
      .from(uploadAttempts)
      .where(eq(uploadAttempts.uploadId, upload.id));
    expect(attempt).toMatchObject({
      state: "writing",
      reservedBytes: 3,
      writtenBytes: 0,
      generation: 0,
    });
    const [after] = await ctx.db.select().from(storageBudget).where(eq(storageBudget.id, "global"));
    expect(after.temporaryReserved).toBe(before.temporaryReserved + 3);
    expect(after.temporaryWritten).toBe(before.temporaryWritten);
    const [part] = await ctx.db
      .select()
      .from(uploadParts)
      .where(eq(uploadParts.uploadId, upload.id));
    expect(part).toMatchObject({ state: "writing", attemptId: attempt.id });
    expect((await getUpload(ctx, id, upload.id)).receivedParts).toEqual([]);
  } finally {
    persist();
    await server.stop(true);
  }
});
