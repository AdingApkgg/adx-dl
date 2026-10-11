import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { ingestFixture, png, hash } from "../../test/storage/ingest-fixture";
import {
  blobs,
  files,
  storageBudget,
  storageUsage,
  uploadSessions,
  uploadParts,
  user,
} from "../server/db/schema";
import { completeUpload, getUpload, initUpload, cancelUpload } from "../server/storage/uploads";
import { claimOriginal, publishOriginal } from "../server/storage/objects";
import { StorageUnavailableError } from "../server/storage/errors";
import type { DbTransaction, StorageContext } from "../server/storage/contracts";
import { ingestUpload, originalMime } from "./ingest";
test("original magic accepts normal and extended AVIF ftyp while rejecting HEIC and oversized boxes", () => {
  const normal = Buffer.alloc(20);
  normal.writeUInt32BE(20);
  normal.write("ftyp", 4);
  normal.write("avif", 8);
  normal.write("mif1", 16);
  const extended = Buffer.alloc(28);
  extended.writeUInt32BE(1);
  extended.write("ftyp", 4);
  extended.writeBigUInt64BE(28n, 8);
  extended.write("mif1", 16);
  extended.write("avif", 24);
  expect(originalMime(normal)).toBe("image/avif");
  expect(originalMime(extended)).toBe("image/avif");
  extended.write("heic", 24);
  expect(() => originalMime(extended)).toThrow("TYPE_NOT_ALLOWED");
  normal.writeUInt32BE(8192);
  expect(() => originalMime(normal)).toThrow("TYPE_NOT_ALLOWED");
});
describe.skipIf(
  !process.env.STORAGE_TEST_FIXTURE_PATH && !process.env.STORAGE_TEST_MEDIA_ACCESS_KEY_ID,
)("verified original ingestion", () => {
  let f: Awaited<ReturnType<typeof ingestFixture>>;
  beforeAll(async () => {
    f = await ingestFixture();
  }, 30000);
  afterAll(async () => {
    await f?.cleanup();
  }, 30000);
  async function session(id: string) {
    return (await f.ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, id)))[0];
  }
  async function original(id: string) {
    const row = await session(id);
    const [file] = await f.ctx.db.select().from(files).where(eq(files.id, row.fileId!));
    return (await f.ctx.db.select().from(blobs).where(eq(blobs.id, file.blobId)))[0];
  }
  test("completion races create one file and one flow; missing/writing parts cannot complete", async () => {
    const bytes = png();
    const id = await f.owner();
    const pending = await import("../server/storage/uploads").then((m) =>
      m.initUpload(
        f.ctx,
        id,
        { purpose: "avatar", name: "a.png", size: bytes.length, sha256: hash(bytes) },
        crypto.randomUUID(),
      ),
    );
    await expect(completeUpload(f.ctx, id, pending.id)).rejects.toMatchObject({
      code: "UPLOAD_INCOMPLETE",
      status: 409,
    });
    const u = await f.upload(bytes);
    await f.ctx.db
      .update(uploadParts)
      .set({ state: "writing" })
      .where(eq(uploadParts.uploadId, u.dto.id));
    await expect(completeUpload(f.ctx, u.userId, u.dto.id)).rejects.toMatchObject({
      code: "UPLOAD_INCOMPLETE",
    });
    await f.ctx.db
      .update(uploadParts)
      .set({ state: "ready" })
      .where(eq(uploadParts.uploadId, u.dto.id));
    const results = await Promise.all([
      completeUpload(f.ctx, u.userId, u.dto.id),
      completeUpload(f.ctx, u.userId, u.dto.id),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].state).toBe("processing");
    const row = await session(u.dto.id);
    expect(row.flowJobIds).toHaveLength(3);
    expect(await f.ctx.db.select().from(files).where(eq(files.ownerId, u.userId))).toHaveLength(1);
    expect(
      (await f.ctx.db.execute(sql`select id from pgboss.job where data->>'uploadId'=${u.dto.id}`))
        .rows,
    ).toHaveLength(3);
  });
  test("real S3 ordered multipart ingest verifies hash and original once across two sessions", async () => {
    const bytes = png(4194311);
    const a = await f.upload(bytes);
    const b = await f.upload(bytes);
    await completeUpload(f.ctx, a.userId, a.dto.id);
    await completeUpload(f.ctx, b.userId, b.dto.id);
    const [before] = await f.ctx.db.select().from(storageBudget);
    await ingestUpload(f.mediaCtx, a.data);
    await ingestUpload(f.mediaCtx, b.data);
    await ingestUpload(f.mediaCtx, a.data);
    const aa = await original(a.dto.id),
      bb = await original(b.dto.id);
    expect(aa.id).toBe(bb.id);
    expect(aa).toMatchObject({
      state: "ready",
      sha256: hash(bytes),
      size: bytes.length,
      detectedMime: "image/png",
    });
    const [after] = await f.ctx.db.select().from(storageBudget);
    expect(after.originalWritten - before.originalWritten).toBe(bytes.length);
    expect(after.originalReserved).toBe(before.originalReserved);
    expect((await getUpload(f.ctx, a.userId, a.dto.id)).state).toBe("processing");
  });
  test("full hash mismatch terminalizes once and releases logical quota", async () => {
    const u = await f.upload(png(), undefined, "f".repeat(64));
    await completeUpload(f.ctx, u.userId, u.dto.id);
    await ingestUpload(f.mediaCtx, u.data);
    await ingestUpload(f.mediaCtx, u.data);
    expect(await getUpload(f.ctx, u.userId, u.dto.id)).toMatchObject({
      state: "rejected",
      errorCode: "HASH_MISMATCH",
    });
    const [usage] = await f.ctx.db
      .select()
      .from(storageUsage)
      .where(eq(storageUsage.userId, u.userId));
    expect(usage).toMatchObject({ activeUploads: 0, reservedBytes: 0, usedBytes: 0 });
    expect((await original(u.dto.id)).state).toBe("pending");
    const descendants = await f.ctx.db.execute(
      sql`select state from pgboss.job where data->>'uploadId'=${u.dto.id} and name in ('media.avatar','storage.finalize')`,
    );
    expect(descendants.rows.map((r) => r.state)).toEqual(["cancelled", "cancelled"]);
  });

  test("business completion rolls back when flow insertion throws after inserting real jobs", async () => {
    const u = await f.upload(png());
    const boss = await f.ctx.boss();
    const broken = {
      ...f.ctx,
      boss: async () =>
        new Proxy(boss, {
          get(target, key) {
            if (key === "flow")
              return async (...args: Parameters<typeof boss.flow>) => {
                await boss.flow(...args);
                throw Error("after flow insert");
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
    };
    await expect(completeUpload(broken, u.userId, u.dto.id)).rejects.toThrow("after flow insert");
    expect(await session(u.dto.id)).toMatchObject({
      state: "receiving",
      fileId: null,
      flowJobIds: [],
    });
    expect(await f.ctx.db.select().from(files).where(eq(files.ownerId, u.userId))).toHaveLength(0);
    expect(
      (await f.ctx.db.execute(sql`select id from pgboss.job where data->>'uploadId'=${u.dto.id}`))
        .rows,
    ).toHaveLength(0);
  });
  test("part bytes, actual length and purpose magic are untrusted; transient GET errors retry", async () => {
    for (const mode of ["hash", "short", "long", "magic", "temporary"] as const) {
      const bytes = mode === "magic" ? new TextEncoder().encode("<svg>not an image</svg>") : png();
      const u = await f.upload(bytes);
      await completeUpload(f.ctx, u.userId, u.dto.id);
      const fault: StorageContext = {
        ...f.mediaCtx,
        driver: {
          ...f.mediaCtx.driver,
          get: async (input) => {
            if (mode === "temporary") throw new StorageUnavailableError();
            const read = await f.mediaCtx.driver.get(input);
            if (mode === "magic") return read;
            const original = new Uint8Array(await new Response(read.body).arrayBuffer());
            const modified =
              mode === "short"
                ? original.subarray(0, original.length - 1)
                : mode === "long"
                  ? new Uint8Array(original.length + 1)
                  : original;
            if (mode === "hash") modified[modified.length - 1] ^= 1;
            return { ...read, body: new Blob([modified]).stream() };
          },
        },
      };
      if (mode === "temporary") {
        await expect(ingestUpload(fault, u.data)).rejects.toMatchObject({ status: 503 });
        expect((await session(u.dto.id)).state).toBe("processing");
        await ingestUpload(f.mediaCtx, u.data);
        expect((await original(u.dto.id)).state).toBe("ready");
      } else {
        await ingestUpload(fault, u.data);
        expect((await session(u.dto.id)).errorCode).toBe(
          mode === "magic"
            ? "TYPE_NOT_ALLOWED"
            : mode === "long"
              ? "HASH_MISMATCH"
              : "PART_HASH_MISMATCH",
        );
      }
    }
  });
  test("eligible init creates the same flow once with no parts, and ready sources still pass purpose validation", async () => {
    const bytes = png();
    const source = await f.upload(bytes);
    await completeUpload(f.ctx, source.userId, source.dto.id);
    await ingestUpload(f.mediaCtx, source.data);
    await f.ctx.db
      .update(files)
      .set({ state: "ready" })
      .where(eq(files.id, (await session(source.dto.id)).fileId!));
    const input = {
      purpose: "avatar" as const,
      name: "again.png",
      size: bytes.length,
      sha256: hash(bytes),
    };
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      initUpload(f.ctx, source.userId, input, key),
      initUpload(f.ctx, source.userId, input, key),
    ]);
    expect(a).toEqual(b);
    expect(a.state).toBe("processing");
    expect(a.receivedParts).toEqual([]);
    expect((await session(a.id)).flowJobIds).toHaveLength(3);
    expect(
      await f.ctx.db.select().from(uploadParts).where(eq(uploadParts.uploadId, a.id)),
    ).toHaveLength(0);
    await ingestUpload(f.mediaCtx, { uploadId: a.id, generation: 0 });
    const blob = await original(a.id);
    expect(blob.state).toBe("ready");
    // Same-length source corruption and false metadata cannot grant a successful fast path.
    const spoof: StorageContext = {
      ...f.mediaCtx,
      driver: {
        ...f.mediaCtx.driver,
        get: async (input) => {
          const read = await f.mediaCtx.driver.get(input);
          await read.body.cancel();
          return { ...read, body: new Blob([new Uint8Array(bytes.length)]).stream() };
        },
      },
    };
    await ingestUpload(spoof, { uploadId: a.id, generation: 0 });
    expect((await session(a.id)).state).toBe("rejected");
  });
  test("PUT success followed by lost PG commit recovers from the stored original with one physical charge", async () => {
    const u = await f.upload(png());
    await completeUpload(f.ctx, u.userId, u.dto.id);
    let commits = 0;
    let puts = 0;
    const faultyDb = new Proxy(f.ctx.db, {
      get(target, key) {
        if (key === "transaction")
          return async (fn: (tx: DbTransaction) => Promise<unknown>) => {
            commits++;
            if (commits === 3) throw new StorageUnavailableError();
            return target.transaction(fn);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const fault: StorageContext = {
      ...f.mediaCtx,
      db: faultyDb,
      driver: {
        ...f.mediaCtx.driver,
        put: async (input) => {
          puts++;
          await f.mediaCtx.driver.put(input);
        },
      },
    };
    const [before] = await f.ctx.db.select().from(storageBudget);
    await expect(ingestUpload(fault, u.data)).rejects.toMatchObject({ status: 503 });
    const pending = await original(u.dto.id);
    expect(pending.state).toBe("pending");
    expect(puts).toBe(1);
    expect(await f.mediaCtx.driver.head({ bucket: "original", key: pending.key })).not.toBeNull();
    await f.ctx.db
      .update(blobs)
      .set({ leaseUntil: sql`clock_timestamp()-interval '1 second'` })
      .where(eq(blobs.id, pending.id));
    await ingestUpload({ ...f.mediaCtx, driver: fault.driver }, u.data);
    expect(puts).toBe(1);
    expect((await original(u.dto.id)).state).toBe("ready");
    const [after] = await f.ctx.db.select().from(storageBudget);
    expect(after.originalWritten - before.originalWritten).toBe(pending.size);
    expect(after.originalReserved).toBe(before.originalReserved);
  });
  test("rejected original PUT keeps uncertain bytes charged without delete; stale lease cannot publish", async () => {
    const u = await f.upload(png());
    await completeUpload(f.ctx, u.userId, u.dto.id);
    let deletes = 0;
    const fault: StorageContext = {
      ...f.mediaCtx,
      driver: {
        ...f.mediaCtx.driver,
        put: async (input) => {
          await f.mediaCtx.driver.put(input);
          throw new StorageUnavailableError();
        },
        delete: async () => {
          deletes++;
        },
      },
    };
    const [before] = await f.ctx.db.select().from(storageBudget);
    await expect(ingestUpload(fault, u.data)).rejects.toMatchObject({ status: 503 });
    let blob = await original(u.dto.id);
    expect(blob.state).toBe("pending");
    expect(deletes).toBe(0);
    const [charged] = await f.ctx.db.select().from(storageBudget);
    expect(charged.originalReserved - before.originalReserved).toBe(blob.size);
    const oldClaim = { kind: "writer" as const, blob };
    await f.ctx.db
      .update(blobs)
      .set({ leaseUntil: sql`clock_timestamp()-interval '1 second'` })
      .where(eq(blobs.id, blob.id));
    const next = await claimOriginal(f.mediaCtx, u.data);
    expect(next?.blob.generation).toBe(blob.generation + 1);
    expect(await publishOriginal(f.mediaCtx, u.data, oldClaim, "image/png")).toBe(false);
    expect(await publishOriginal(f.mediaCtx, u.data, next!, "image/png")).toBe(true);
    blob = await original(u.dto.id);
    expect(blob.state).toBe("ready");
  });
  test("deleting generation waits for confirmed deletion and independent new physical generation", async () => {
    const u = await f.upload(png());
    await completeUpload(f.ctx, u.userId, u.dto.id);
    await ingestUpload(f.mediaCtx, u.data);
    const blob = await original(u.dto.id);
    await f.ctx.db
      .update(blobs)
      .set({ state: "deleting", generation: blob.generation + 1 })
      .where(eq(blobs.id, blob.id));
    await expect(claimOriginal(f.mediaCtx, u.data)).rejects.toMatchObject({ code: "STORAGE_BUSY" });
    await f.cleanupDriver.delete({ bucket: "original", key: blob.key });
    await f.ctx.db.transaction(async (tx) => {
      await tx
        .update(blobs)
        .set({ state: "deleted", leaseUntil: null })
        .where(eq(blobs.id, blob.id));
      await tx
        .update(storageBudget)
        .set({ originalWritten: sql`${storageBudget.originalWritten}-${blob.size}` });
    });
    await ingestUpload(f.mediaCtx, u.data);
    const restored = await original(u.dto.id);
    expect(restored.state).toBe("ready");
    expect(restored.generation).toBe(blob.generation + 2);
    expect((await session(u.dto.id)).generation).toBe(0);
  });
  test("cancellation and account deletion during original PUT prevent ready publication and leave physical accounting", async () => {
    for (const action of ["cancel", "account"] as const) {
      const u = await f.upload(png());
      await completeUpload(f.ctx, u.userId, u.dto.id);
      const fault: StorageContext = {
        ...f.mediaCtx,
        driver: {
          ...f.mediaCtx.driver,
          put: async (input) => {
            await f.mediaCtx.driver.put(input);
            if (action === "cancel") await cancelUpload(f.ctx, u.userId, u.dto.id);
            else
              await f.ctx.db
                .update(user)
                .set({ status: "pending_deletion" })
                .where(eq(user.id, u.userId));
          },
        },
      };
      await ingestUpload(fault, u.data);
      const blob = await original(u.dto.id);
      expect(blob.state).toBe("pending");
      expect(blob.leaseUntil).not.toBeNull();
      expect(await f.mediaCtx.driver.head({ bucket: "original", key: blob.key })).not.toBeNull();
    }
  });

  test("original IO holds no user, usage, budget, session, file or original locks", async () => {
    const u = await f.upload(png());
    await completeUpload(f.ctx, u.userId, u.dto.id);
    const blob = await original(u.dto.id);
    let checked = 0;
    const check = async () => {
      await f.ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select id from "user" where id=${u.userId} for update nowait`);
        await tx.execute(
          sql`select user_id from storage_usage where user_id=${u.userId} for update nowait`,
        );
        await tx.execute(sql`select id from storage_budget for update nowait`);
        await tx.execute(
          sql`select id from upload_sessions where id=${u.dto.id} for update nowait`,
        );
        await tx.execute(sql`select id from files where blob_id=${blob.id} for update nowait`);
        await tx.execute(sql`select id from blobs where id=${blob.id} for update nowait`);
      });
      checked++;
    };
    await ingestUpload(
      {
        ...f.mediaCtx,
        driver: {
          ...f.mediaCtx.driver,
          get: async (input) => {
            await check();
            return f.mediaCtx.driver.get(input);
          },
          put: async (input) => {
            await check();
            return f.mediaCtx.driver.put(input);
          },
        },
      },
      u.data,
    );
    expect(checked).toBe(2);
    expect((await original(u.dto.id)).state).toBe("ready");
  });
  test("ready-original fast path applies allowed-purpose magic to the actual source bytes", async () => {
    const bytes = new TextEncoder().encode("<svg>legacy verified hash, unsupported avatar</svg>");
    const u = await f.upload(bytes);
    await completeUpload(f.ctx, u.userId, u.dto.id);
    const claim = await claimOriginal(f.mediaCtx, u.data);
    await f.mediaCtx.driver.put({
      bucket: "original",
      key: claim!.blob.key,
      body: new Blob([bytes]).stream(),
      size: bytes.length,
      sha256: hash(bytes),
      mime: "image/png",
    });
    await publishOriginal(f.mediaCtx, u.data, claim!, "image/png");
    await f.ctx.db
      .update(files)
      .set({ state: "ready" })
      .where(eq(files.id, (await session(u.dto.id)).fileId!));
    const instant = await initUpload(
      f.ctx,
      u.userId,
      { purpose: "avatar", name: "legacy.png", sha256: hash(bytes), size: bytes.length },
      crypto.randomUUID(),
    );
    expect(instant.state).toBe("processing");
    expect(instant.receivedParts).toEqual([]);
    await ingestUpload(f.mediaCtx, { uploadId: instant.id, generation: 0 });
    expect(await getUpload(f.ctx, u.userId, instant.id)).toMatchObject({
      state: "rejected",
      errorCode: "TYPE_NOT_ALLOWED",
    });
  });
  test("ambiguous successful ready COMMIT retries without a second write or charge", async () => {
    const u = await f.upload(png());
    await completeUpload(f.ctx, u.userId, u.dto.id);
    let commits = 0;
    let puts = 0;
    const db = new Proxy(f.ctx.db, {
      get(target, key) {
        if (key === "transaction")
          return async (fn: (tx: DbTransaction) => Promise<unknown>) => {
            const result = await target.transaction(fn);
            commits++;
            if (commits === 3) throw new StorageUnavailableError();
            return result;
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const driver = {
      ...f.mediaCtx.driver,
      put: async (input: Parameters<StorageContext["driver"]["put"]>[0]) => {
        puts++;
        await f.mediaCtx.driver.put(input);
      },
    };
    const [before] = await f.ctx.db.select().from(storageBudget);
    await expect(ingestUpload({ ...f.mediaCtx, db, driver }, u.data)).rejects.toMatchObject({
      status: 503,
    });
    const ready = await original(u.dto.id);
    expect(ready.state).toBe("ready");
    await ingestUpload({ ...f.mediaCtx, driver }, u.data);
    expect(puts).toBe(1);
    const [after] = await f.ctx.db.select().from(storageBudget);
    expect(after.originalWritten - before.originalWritten).toBe(ready.size);
    expect(after.originalReserved).toBe(before.originalReserved);
  });
  test("rejected false-size claimant cannot pin a known image hash against another user's verified bytes", async () => {
    const bytes = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const [before] = await f.ctx.db.select().from(storageBudget);
    const falseUpload = await f.upload(new Uint8Array([7]), undefined, hash(bytes));
    await completeUpload(f.ctx, falseUpload.userId, falseUpload.dto.id);
    await ingestUpload(f.mediaCtx, falseUpload.data);
    expect(await session(falseUpload.dto.id)).toMatchObject({
      state: "rejected",
      errorCode: "HASH_MISMATCH",
    });
    const pending = await original(falseUpload.dto.id);
    expect(pending).toMatchObject({
      size: 1,
      state: "pending",
      leaseUntil: null,
      generation: 0,
      verifiedAt: null,
    });
    const good = await f.upload(bytes);
    expect(good.userId).not.toBe(falseUpload.userId);
    await completeUpload(f.ctx, good.userId, good.dto.id);
    await ingestUpload(f.mediaCtx, good.data);
    const ready = await original(good.dto.id);
    expect(ready).toMatchObject({
      id: pending.id,
      state: "ready",
      size: bytes.length,
      sha256: hash(bytes),
    });
    expect(
      await f.ctx.db
        .select()
        .from(blobs)
        .where(eq(blobs.sha256, hash(bytes))),
    ).toHaveLength(1);
    const [after] = await f.ctx.db.select().from(storageBudget);
    expect(after.originalWritten - before.originalWritten).toBe(bytes.length);
    expect(after.originalReserved).toBe(before.originalReserved);
    const stored = await f.mediaCtx.driver.get({ bucket: "original", key: ready.key });
    expect(hash(new Uint8Array(await new Response(stored.body).arrayBuffer()))).toBe(hash(bytes));
  });
  test("competing different pending declarations cannot replace a verified size or reserve their unverified size", async () => {
    for (const falseFirst of [true, false]) {
      const bytes = png();
      const good = await f.upload(bytes);
      const bad = await f.upload(new Uint8Array([9]), undefined, hash(bytes));
      const [before] = await f.ctx.db.select().from(storageBudget);
      const ordered = falseFirst ? [bad, good] : [good, bad];
      for (const upload of ordered) await completeUpload(f.ctx, upload.userId, upload.dto.id);
      const pending = await original(good.dto.id);
      expect(pending).toMatchObject({ state: "pending", generation: 0, leaseUntil: null });
      await ingestUpload(f.mediaCtx, good.data);
      await ingestUpload(f.mediaCtx, bad.data);
      expect((await session(bad.dto.id)).errorCode).toBe("HASH_MISMATCH");
      expect(await original(good.dto.id)).toMatchObject({
        id: pending.id,
        state: "ready",
        size: bytes.length,
        generation: 1,
      });
      const [after] = await f.ctx.db.select().from(storageBudget);
      expect(after.originalWritten - before.originalWritten).toBe(bytes.length);
      expect(after.originalReserved).toBe(before.originalReserved);
      const lateBad = await f.upload(new Uint8Array([1]), undefined, hash(bytes));
      await expect(completeUpload(f.ctx, lateBad.userId, lateBad.dto.id)).rejects.toMatchObject({
        code: "STORAGE_INCONSISTENT",
      });
      expect((await original(good.dto.id)).size).toBe(bytes.length);
    }
  });
  test("size correction never changes leased or uncertain pending accounting", async () => {
    const bytes = png();
    const good = await f.upload(bytes);
    const bad = await f.upload(new Uint8Array([6]), undefined, hash(bytes));
    await completeUpload(f.ctx, good.userId, good.dto.id);
    await completeUpload(f.ctx, bad.userId, bad.dto.id);
    // Fault after a real PUT leaves the original leased and its reservation durable.
    await expect(
      ingestUpload(
        {
          ...f.mediaCtx,
          driver: {
            ...f.mediaCtx.driver,
            put: async (input) => {
              await f.mediaCtx.driver.put(input);
              throw new StorageUnavailableError();
            },
          },
        },
        good.data,
      ),
    ).rejects.toMatchObject({ status: 503 });
    const blob = await original(good.dto.id);
    const [before] = await f.ctx.db.select().from(storageBudget);
    await f.ctx.db
      .update(blobs)
      .set({ leaseUntil: sql`clock_timestamp()-interval '1 second'` })
      .where(eq(blobs.id, blob.id));
    await expect(claimOriginal(f.mediaCtx, bad.data)).rejects.toMatchObject({
      code: "STORAGE_INCONSISTENT",
    });
    const lateBad = await f.upload(new Uint8Array([2]), undefined, hash(bytes));
    await expect(completeUpload(f.ctx, lateBad.userId, lateBad.dto.id)).rejects.toMatchObject({
      code: "STORAGE_INCONSISTENT",
    });
    const [after] = await f.ctx.db.select().from(storageBudget);
    expect(after.originalReserved).toBe(before.originalReserved);
    expect(after.originalWritten).toBe(before.originalWritten);
    expect(await original(good.dto.id)).toMatchObject({
      size: bytes.length,
      generation: blob.generation,
      state: "pending",
    });
    await ingestUpload(f.mediaCtx, good.data);
    expect((await original(good.dto.id)).state).toBe("ready");
  });
});
