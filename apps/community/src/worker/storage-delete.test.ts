import { resetTestDatabase } from "../server/testing/test-db";
import { beforeAll, afterAll, expect, test } from "bun:test";
import { createServer } from "node:http";
import { eq, sql } from "drizzle-orm";
import { blobs, files, storageBudget, uploadSessions } from "../server/db/schema";
import { readyContext, readyFile, readyOwner } from "../../test/storage/ready-file";
import { cleanupStorageFixture, storageFixtureConfig } from "../../test/storage/fixture";
import { createS3Driver } from "../server/storage/s3";
import { parseStorageEnv } from "../server/storage/env";
import { initUpload } from "../server/storage/uploads";
import { claimOriginal } from "../server/storage/objects";
let fixture: Awaited<ReturnType<typeof readyContext>>;
const owners: string[] = [];
beforeAll(async () => {
  await resetTestDatabase();
  fixture = await readyContext();
  fixture.ctx.driver = createS3Driver(await storageFixtureConfig("control"));
  await fixture.ctx.boss();
}, 30000);
afterAll(async () => {
  if (fixture)
    await cleanupStorageFixture(
      fixture.ctx.db,
      owners,
      [fixture.policy.id],
      process.env.STORAGE_TEST_FIXTURE_PATH ? fixture.ctx.driver : undefined,
      true,
    );
}, 30000);
async function own() {
  const id = await readyOwner(fixture.ctx);
  owners.push(id);
  return id;
}
async function implementation() {
  const mod = (await import("./storage-delete").catch(
    () => ({}),
  )) as typeof import("./storage-delete");
  expect(typeof mod.deleteStorageObject).toBe("function");
  return mod;
}
async function candidate() {
  const { ctx, policy } = fixture,
    id = await own(),
    a = await readyFile(ctx, policy.id, id);
  await ctx.db
    .update(files)
    .set({
      state: "deleted",
      deletedAt: new Date(),
      retainedUntil: new Date(Date.now() + 30 * 86400000),
    })
    .where(eq(files.id, a.file.id));
  await ctx.db
    .update(blobs)
    .set({ orphanedAt: new Date(Date.now() - 8 * 86400000) })
    .where(eq(blobs.id, a.blob.id));
  return { id, a };
}

test("successful physical DELETE keeps ledger tombstone and refunds once; stale delivery cannot touch reincarnation", async () => {
  const { claimStorageObjectDeletion, deleteStorageObject } = await implementation(),
    { ctx } = fixture,
    { a } = await candidate();
  const before = (await ctx.db.select().from(storageBudget))[0].originalWritten;
  const data = await claimStorageObjectDeletion(ctx, { kind: "blob", id: a.blob.id });
  expect(data).not.toBeNull();
  let calls = 0;
  const deleting = {
    ...ctx,
    driver: {
      ...ctx.driver,
      delete: async (input: Parameters<typeof ctx.driver.delete>[0]) => {
        calls++;
        if (process.env.STORAGE_TEST_FIXTURE_PATH) await ctx.driver.delete(input);
      },
    },
  };
  await deleteStorageObject(deleting, data!);
  await deleteStorageObject(deleting, data!);
  const [row] = await ctx.db.select().from(blobs).where(eq(blobs.id, a.blob.id));
  expect(row.state).toBe("deleted");
  expect(row.generation).toBe(data!.generation);
  expect((await ctx.db.select().from(storageBudget))[0].originalWritten).toBe(before - a.blob.size);
  expect(calls).toBe(1);
  await ctx.db
    .update(blobs)
    .set({
      state: "pending",
      generation: row.generation + 1,
      leaseUntil: new Date(Date.now() + 120000),
    })
    .where(eq(blobs.id, row.id));
  await ctx.db
    .update(storageBudget)
    .set({ originalReserved: sql`${storageBudget.originalReserved}+${row.size}` });
  await deleteStorageObject(deleting, data!);
  expect(calls).toBe(1);
});

test("actual driver timeout retains deleting and charge despite retry204+HEADmissing; new PUT claim stays refused", async () => {
  const { claimStorageObjectDeletion, deleteStorageObject } = await implementation(),
    { ctx } = fixture,
    { id, a } = await candidate();
  const before = (await ctx.db.select().from(storageBudget))[0].originalWritten;
  let exists = true,
    deletes = 0,
    finishOld: (() => void) | undefined;
  const server = createServer((req, res) => {
    if (req.method === "DELETE") {
      deletes++;
      if (deletes === 1) {
        finishOld = () => {
          exists = false;
          res.writeHead(204);
          res.end();
        };
        return;
      }
      exists = false;
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "HEAD") {
      const bucket = /^\/blobs\/?(?:\?.*)?$/.test(req.url ?? "");
      res.writeHead(
        bucket || exists ? 200 : 404,
        bucket
          ? {}
          : exists
            ? {
                "content-length": String(a.blob.size),
                "content-type": "image/png",
                "x-amz-meta-sha256": a.blob.sha256,
              }
            : {},
      );
      res.end();
      return;
    }
    if (req.method === "PUT") {
      req.resume();
      req.on("end", () => {
        exists = true;
        res.writeHead(200);
        res.end();
      });
      return;
    }
    res.writeHead(400);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("listener");
  try {
    const config = parseStorageEnv(
      {
        PUBLIC_ORIGIN: "https://community.example.test",
        STORAGE_S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
        STORAGE_TEMP_DIR: "/tmp/community-storage-test",
        STORAGE_RECIPE_BUILD: "test-v1",
        STORAGE_WEB_ACCESS_KEY_ID: "isolated-fault",
        STORAGE_WEB_SECRET_ACCESS_KEY: "isolated-fault-secret",
        STORAGE_INTERNAL_MEDIA_SECRET: "isolated-media-secret-0123456789abcdef",
      },
      "web",
    );
    const driver = createS3Driver(config, { requestTimeoutMs: 100 });
    const fault = { ...ctx, driver };
    const data = await claimStorageObjectDeletion(ctx, { kind: "blob", id: a.blob.id });
    expect(data).not.toBeNull();
    await expect(deleteStorageObject(fault, data!)).rejects.toThrow();
    expect(finishOld).toBeDefined();
    await driver.delete({ bucket: "original", key: a.blob.key });
    expect(await driver.head({ bucket: "original", key: a.blob.key })).toBeNull();
    await expect(deleteStorageObject(fault, data!)).rejects.toMatchObject({ code: "STORAGE_BUSY" });
    expect(deletes).toBe(2);
    const [row] = await ctx.db.select().from(blobs).where(eq(blobs.id, a.blob.id));
    expect(row.state).toBe("deleting");
    expect((row.properties.deletion as { uncertain: boolean }).uncertain).toBe(true);
    expect((await ctx.db.select().from(storageBudget))[0].originalWritten).toBe(before);
    // Same physical hash remains unavailable to a fresh business upload.
    const upload = await initUpload(
      ctx,
      id,
      { purpose: "avatar", name: "new.png", size: a.blob.size, sha256: a.blob.sha256 },
      crypto.randomUUID(),
    );
    // Complete admits the hash only through ensureOriginal, which rejects deleting.
    await ctx.db
      .update(uploadSessions)
      .set({ state: "processing", fileId: a.file.id })
      .where(eq(uploadSessions.id, upload.id));
    await ctx.db
      .update(files)
      .set({ state: "processing", deletedAt: null })
      .where(eq(files.id, a.file.id));
    await expect(claimOriginal(ctx, { uploadId: upload.id, generation: 0 })).rejects.toMatchObject({
      code: "STORAGE_BUSY",
    });
    expect((await ctx.db.select().from(blobs).where(eq(blobs.id, a.blob.id)))[0].generation).toBe(
      data!.generation,
    );
    // The risk still exists in the driver: deliberately bypass business fences only to show old DELETE is not quiescent.
    await driver.put({
      bucket: "original",
      key: a.blob.key,
      body: new Blob([a.original]).stream(),
      size: a.original.length,
      mime: "image/png",
      sha256: a.blob.sha256,
    });
    expect(await driver.head({ bucket: "original", key: a.blob.key })).not.toBeNull();
    finishOld!();
    expect(await driver.head({ bucket: "original", key: a.blob.key })).toBeNull();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("shared-output reuse and derived GC have one generation winner under the physical budget lock", async () => {
  const { claimStorageObjectDeletion } = await implementation(),
    { ctx, policy } = fixture,
    first = await own(),
    second = await own();
  const { blobDerivatives, derivedObjects } = await import("../server/db/schema"),
    { claimAvatarRecipe, claimAvatarOutput } = await import("../server/storage/objects");
  const a = await readyFile(ctx, policy.id, first),
    b = await readyFile(ctx, policy.id, second);
  await ctx.db
    .update(files)
    .set({ state: "deleted", deletedAt: new Date() })
    .where(eq(files.id, a.file.id));
  await ctx.db
    .update(blobDerivatives)
    .set({ state: "retired" })
    .where(eq(blobDerivatives.id, a.recipe.id));
  await ctx.db
    .update(derivedObjects)
    .set({ orphanedAt: new Date(Date.now() - 8 * 86400000) })
    .where(eq(derivedObjects.id, a.derived.id));
  const upload = await initUpload(
    ctx,
    second,
    { purpose: "avatar", name: "reuse.png", size: b.file.size, sha256: b.blob.sha256 },
    crypto.randomUUID(),
  );
  await ctx.db
    .update(blobDerivatives)
    .set({ state: "pending", derivedObjectId: null })
    .where(eq(blobDerivatives.id, b.recipe.id));
  const source = await claimAvatarRecipe(ctx, { uploadId: upload.id, generation: 0 });
  expect(source).not.toBeNull();
  const [reuse, gc] = await Promise.allSettled([
    claimAvatarOutput(ctx, { uploadId: upload.id, generation: 0 }, source!, {
      hash: a.derived.outputSha256,
      size: a.derived.size,
    }),
    claimStorageObjectDeletion(ctx, { kind: "derived", id: a.derived.id }),
  ]);
  const [physical] = await ctx.db
    .select()
    .from(derivedObjects)
    .where(eq(derivedObjects.id, a.derived.id));
  if (gc.status === "fulfilled" && gc.value) {
    expect(physical.state).toBe("deleting");
    expect(reuse.status).toBe("rejected");
    if (reuse.status === "rejected") expect(reuse.reason.code).toBe("STORAGE_BUSY");
  } else {
    expect(reuse.status).toBe("fulfilled");
    if (reuse.status === "fulfilled") expect(reuse.value?.kind).toBe("ready");
    expect(physical.state).toBe("ready");
  }
});

test("first acknowledged object404 plus bucket proof confirms business deletion and refunds once", async () => {
  const { claimStorageObjectDeletion, deleteStorageObject } = await implementation(),
    { ctx } = fixture,
    { a } = await candidate(),
    before = (await ctx.db.select().from(storageBudget))[0].originalWritten;
  let deletes = 0,
    heads = 0;
  const server = createServer((request, response) => {
    if (request.method === "DELETE") {
      deletes++;
      response.writeHead(404, { "content-type": "application/xml" });
      response.end("<Error><Code>NoSuchKey</Code></Error>");
    } else {
      heads++;
      response.writeHead(200);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("listener");
  try {
    const cfg = parseStorageEnv(
      {
        PUBLIC_ORIGIN: "https://community.example.test",
        STORAGE_S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
        STORAGE_TEMP_DIR: "/tmp/community-storage-test",
        STORAGE_RECIPE_BUILD: "test-v1",
        STORAGE_WEB_ACCESS_KEY_ID: "local-test-access",
        STORAGE_WEB_SECRET_ACCESS_KEY: "local-test-secret",
        STORAGE_INTERNAL_MEDIA_SECRET: "local-internal-secret-0123456789abcdef",
      },
      "web",
    );
    const fault = { ...ctx, driver: createS3Driver(cfg) },
      data = await claimStorageObjectDeletion(ctx, { kind: "blob", id: a.blob.id });
    expect(data).not.toBeNull();
    await deleteStorageObject(fault, data!);
    await deleteStorageObject(fault, data!);
    const [row] = await ctx.db.select().from(blobs).where(eq(blobs.id, a.blob.id));
    expect(row.state).toBe("deleted");
    expect((row.properties.deletion as { confirmed?: boolean }).confirmed).toBe(true);
    expect((await ctx.db.select().from(storageBudget))[0].originalWritten).toBe(
      before - a.blob.size,
    );
    expect([deletes, heads]).toEqual([1, 1]);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("review: foreign physical policy never uses this driver's key or refunds its charge", async () => {
  const { ctx, policy } = fixture,
    { storagePolicies, derivedObjects } = await import("../server/db/schema"),
    { sweepStorage } = await import("./storage-sweep"),
    { cleanupStorageQuarantine } = await import("./storage-reconcile"),
    { storageQuarantine } = await import("../server/db/schema"),
    id = await own();
  const [foreign] = await ctx.db
    .insert(storagePolicies)
    .values({
      name: crypto.randomUUID(),
      endpoint: "http://foreign-storage.invalid",
      region: ctx.config.region,
      originalBucket: "foreign-original",
      derivedBucket: "foreign-derived",
      credentialsRef: policy.credentialsRef,
    })
    .returning();
  const hash = crypto.randomUUID().replaceAll("-", "").repeat(2),
    key = `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`,
    calls: string[] = [];
  try {
    const [original] = await ctx.db
      .insert(blobs)
      .values({
        policyId: foreign.id,
        sha256: hash,
        key,
        size: 1,
        state: "ready",
        detectedMime: "image/png",
        verifiedAt: new Date(),
        orphanedAt: new Date(0),
      })
      .returning();
    const [derived] = await ctx.db
      .insert(derivedObjects)
      .values({
        policyId: foreign.id,
        outputSha256: crypto.randomUUID().replaceAll("-", "").repeat(2),
        key: `foreign-derived/${hash}`,
        size: 1,
        mime: "image/jpeg",
        state: "ready",
        orphanedAt: new Date(0),
      })
      .returning();
    const qHash = crypto.randomUUID().replaceAll("-", "").repeat(2),
      qKey = `sha256/${qHash.slice(0, 2)}/${qHash.slice(2, 4)}/${qHash}`;
    await ctx.db
      .insert(storageQuarantine)
      .values({
        policyId: foreign.id,
        sha256: qHash,
        key: qKey,
        size: 1,
        observedEtag: "foreign",
        firstSeenAt: new Date(0),
        lastObservedAt: new Date(0),
      });
    await ctx.db
      .update(storageBudget)
      .set({
        originalWritten: sql`${storageBudget.originalWritten}+2`,
        derivedWritten: sql`${storageBudget.derivedWritten}+1`,
      });
    const foreignKeys = new Set([key, derived.key, qKey]),
      scoped = {
        ...ctx,
        driver: {
          ...ctx.driver,
          head: async (input: Parameters<typeof ctx.driver.head>[0]) => {
            if (foreignKeys.has(input.key)) calls.push(input.key);
            return null;
          },
          list: async () => ({ objects: [] }),
          delete: async (input: Parameters<typeof ctx.driver.delete>[0]) => {
            if (foreignKeys.has(input.key)) calls.push(input.key);
          },
        },
      };
    const before = (await ctx.db.select().from(storageBudget))[0];
    await sweepStorage(scoped);
    await cleanupStorageQuarantine(scoped);
    expect(calls).toEqual([]);
    expect((await ctx.db.select().from(blobs).where(eq(blobs.id, original.id)))[0].state).toBe(
      "ready",
    );
    expect(
      (await ctx.db.select().from(derivedObjects).where(eq(derivedObjects.id, derived.id)))[0]
        .state,
    ).toBe("ready");
    const { deleteStorageObject } = await implementation();
    for (const [kind, row, table] of [
      ["blob", original, blobs],
      ["derived", derived, derivedObjects],
    ] as const) {
      await ctx.db
        .update(table)
        .set({
          state: "deleting",
          generation: 1,
          properties: {
            deletion: { generation: 1, chargedFrom: "written", startedAt: null, uncertain: false },
          },
        })
        .where(eq(table.id, row.id));
      await expect(
        deleteStorageObject(scoped, { kind, id: row.id, generation: 1 }),
      ).rejects.toMatchObject({ code: "STORAGE_INCONSISTENT" });
      expect(
        (await ctx.db.select().from(table).where(eq(table.id, row.id)))[0].properties.deletion,
      ).toMatchObject({ startedAt: null, uncertain: false });
    }
    expect(calls).toEqual([]);
    const after = (await ctx.db.select().from(storageBudget))[0];
    expect([after.originalWritten, after.derivedWritten]).toEqual([
      before.originalWritten,
      before.derivedWritten,
    ]);
  } finally {
    await cleanupStorageFixture(ctx.db, [id], [foreign.id], undefined, true);
  }
}, 30000);
