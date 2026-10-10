import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql, inArray } from "drizzle-orm";
import sharp from "sharp";
import { ingestFixture } from "../../test/storage/ingest-fixture";
import {
  blobDerivatives,
  derivedObjects,
  files,
  storageBudget,
  storageUsage,
  uploadSessions,
  user,
} from "../server/db/schema";
import { completeUpload, cancelUpload } from "../server/storage/uploads";
import {
  claimAvatarRecipe,
  claimAvatarOutput,
  publishAvatarOutput,
} from "../server/storage/objects";
import { StorageUnavailableError } from "../server/storage/errors";
import type {
  StorageContext,
  DbTransaction,
} from "../server/storage/contracts";
import { testDbHandle } from "../server/testing/test-db";
import { ingestUpload } from "./ingest";
import { deriveAvatar, processAvatar } from "./avatar";
import { finalizeUpload } from "./finalize";
import { RECIPE_BUILD } from "./image-child";

describe.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "avatar lease and finalize races on real PG/S3",
  () => {
    let f: Awaited<ReturnType<typeof ingestFixture>>,
      dir: string,
      color = 20;
    beforeAll(async () => {
      f = await ingestFixture();
      f.mediaCtx.config.recipeBuild = RECIPE_BUILD;
      dir = await mkdtemp(join(tmpdir(), "avatar-races-"));
    }, 30000);
    afterAll(async () => {
      await f?.cleanup();
      await rm(dir, { recursive: true, force: true });
    }, 30000);
    async function pair() {
      const bytes = await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 3,
          background: {
            r: (color * 29) % 251,
            g: (color * 71) % 251,
            b: (color++ * 113) % 251,
          },
        },
      })
        .jpeg()
        .toBuffer();
      const modified = Buffer.concat([
        bytes.subarray(0, 2),
        Buffer.from([255, 254, 0, 5, 65, 66, 67]),
        bytes.subarray(2),
      ]);
      const a = await f.upload(bytes),
        b = await f.upload(modified);
      for (const u of [a, b]) {
        await completeUpload(f.ctx, u.userId, u.dto.id);
        await ingestUpload(f.mediaCtx, u.data);
      }
      const path = join(dir, crypto.randomUUID());
      await Bun.write(path, bytes);
      const out = `${path}.jpg`,
        output = await processAvatar(path, out);
      return { a, b, out, output };
    }
    async function session(id: string) {
      return (
        await f.ctx.db
          .select()
          .from(uploadSessions)
          .where(eq(uploadSessions.id, id))
      )[0];
    }
    async function expire(ids: string[], objectId?: string) {
      await f.ctx.db
        .update(blobDerivatives)
        .set({ leaseUntil: sql`clock_timestamp()-interval '1 second'` })
        .where(inArray(blobDerivatives.id, ids));
      if (objectId)
        await f.ctx.db
          .update(derivedObjects)
          .set({ leaseUntil: sql`clock_timestamp()-interval '1 second'` })
          .where(eq(derivedObjects.id, objectId));
    }
    test("competing independent recipe claims elect one physical writer; expiry fences old writer and converges", async () => {
      const { a, b, out, output } = await pair();
      const [ra, rb] = await Promise.all([
        claimAvatarRecipe(f.mediaCtx, a.data),
        claimAvatarRecipe(f.mediaCtx, b.data),
      ]);
      const sources = [ra!, rb!],
        uploads = [a, b];
      const [before] = await f.ctx.db.select().from(storageBudget);
      const raced = await Promise.allSettled(
        sources.map((r, i) =>
          claimAvatarOutput(f.mediaCtx, uploads[i].data, r, output),
        ),
      );
      expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const winner = raced.findIndex((r) => r.status === "fulfilled"),
        loser = 1 - winner;
      const success = raced[winner];
      if (success.status !== "fulfilled" || !success.value)
        throw Error("missing writer");
      const claim = success.value;
      expect(claim.kind).toBe("writer");
      const denied = raced[loser];
      if (denied.status === "rejected")
        expect(denied.reason).toMatchObject({ code: "STORAGE_BUSY" });
      // Real successful PUT followed by process loss: bytes exist, reservation remains uncertain.
      await f.mediaCtx.driver.put({
        bucket: "derived",
        key: claim.object.key,
        body: Bun.file(out).stream(),
        size: output.size,
        mime: output.mime,
        sha256: output.hash,
      });
      await expire(
        sources.map((s) => s.recipe.id),
        claim.object.id,
      );
      const next = await claimAvatarRecipe(f.mediaCtx, uploads[loser].data);
      const replacement = await claimAvatarOutput(
        f.mediaCtx,
        uploads[loser].data,
        next!,
        output,
      );
      expect(replacement?.object.generation).toBe(claim.object.generation + 1);
      expect(
        await publishAvatarOutput(
          f.mediaCtx,
          uploads[winner].data,
          sources[winner],
          claim,
        ),
      ).toBe(false);
      expect(
        await publishAvatarOutput(
          f.mediaCtx,
          uploads[loser].data,
          next!,
          replacement!,
        ),
      ).toBe(true);
      await deriveAvatar(f.mediaCtx, uploads[winner].data);
      const relations = await f.ctx.db
        .select()
        .from(blobDerivatives)
        .where(
          inArray(
            blobDerivatives.id,
            sources.map((s) => s.recipe.id),
          ),
        );
      expect(
        relations.every(
          (r) => r.state === "ready" && r.derivedObjectId === claim.object.id,
        ),
      ).toBe(true);
      const [after] = await f.ctx.db.select().from(storageBudget);
      expect(after.derivedWritten - before.derivedWritten).toBe(output.size);
      expect(after.derivedReserved).toBe(before.derivedReserved);
    });
    test("real PUT failure after remote settlement retries by hashing existing bytes without recharging", async () => {
      const { a, output } = await pair();
      let puts = 0;
      const fault: StorageContext = {
        ...f.mediaCtx,
        driver: {
          ...f.mediaCtx.driver,
          put: async (input) => {
            puts++;
            await f.mediaCtx.driver.put(input);
            throw new StorageUnavailableError();
          },
        },
      };
      const [before] = await f.ctx.db.select().from(storageBudget);
      await expect(deriveAvatar(fault, a.data)).rejects.toMatchObject({
        code: "STORAGE_UNAVAILABLE",
      });
      const [object] = await f.ctx.db
        .select()
        .from(derivedObjects)
        .where(eq(derivedObjects.outputSha256, output.hash));
      const [recipe] = await f.ctx.db
        .select()
        .from(blobDerivatives)
        .where(eq(blobDerivatives.derivedObjectId, object.id));
      expect(object).toMatchObject({ state: "pending", generation: 1 });
      const [pending] = await f.ctx.db.select().from(storageBudget);
      expect(pending.derivedReserved - before.derivedReserved).toBe(
        output.size,
      );
      await expire([recipe.id], object.id);
      await deriveAvatar(fault, a.data);
      expect(puts).toBe(1);
      const [after] = await f.ctx.db.select().from(storageBudget);
      expect(after.derivedWritten - before.derivedWritten).toBe(output.size);
      expect(after.derivedReserved).toBe(before.derivedReserved);
    });
    test("cancel or delete owner during processing never produces ready file or logical used charge", async () => {
      for (const action of ["cancel", "delete"] as const) {
        const { a, output } = await pair();
        const ctx: StorageContext = {
          ...f.mediaCtx,
          driver: {
            ...f.mediaCtx.driver,
            get: async (input) => {
              const read = await f.mediaCtx.driver.get(input);
              if (input.bucket === "original") {
                if (action === "cancel")
                  await cancelUpload(f.ctx, a.userId, a.dto.id);
                else
                  await f.ctx.db
                    .update(user)
                    .set({ status: "pending_deletion" })
                    .where(eq(user.id, a.userId));
              }
              return read;
            },
          },
        };
        await deriveAvatar(ctx, a.data);
        await finalizeUpload(f.mediaCtx, a.data);
        const s = await session(a.dto.id);
        expect(s.state).not.toBe("ready");
        const [file] = await f.ctx.db
          .select()
          .from(files)
          .where(eq(files.id, s.fileId!));
        expect(file.state).not.toBe("ready");
        const [usage] = await f.ctx.db
          .select()
          .from(storageUsage)
          .where(eq(storageUsage.userId, a.userId));
        expect(usage.usedBytes).toBe(0);
        expect(
          await f.ctx.db
            .select()
            .from(derivedObjects)
            .where(eq(derivedObjects.outputSha256, output.hash)),
        ).toHaveLength(0);
      }
    });
    test("cancel during derived PUT fences physical promotion and keeps uncertain budget", async () => {
      const { a, output } = await pair();
      const [before] = await f.ctx.db.select().from(storageBudget);
      await deriveAvatar(
        {
          ...f.mediaCtx,
          driver: {
            ...f.mediaCtx.driver,
            put: async (input) => {
              await f.mediaCtx.driver.put(input);
              await cancelUpload(f.ctx, a.userId, a.dto.id);
            },
          },
        },
        a.data,
      );
      await finalizeUpload(f.mediaCtx, a.data);
      const [object] = await f.ctx.db
        .select()
        .from(derivedObjects)
        .where(eq(derivedObjects.outputSha256, output.hash));
      expect(object.state).toBe("pending");
      expect(object.leaseUntil).not.toBeNull();
      const [after] = await f.ctx.db.select().from(storageBudget);
      expect(after.derivedReserved - before.derivedReserved).toBe(output.size);
      expect(after.derivedWritten).toBe(before.derivedWritten);
    });
    test("all derived IO occurs outside business row locks", async () => {
      const { a } = await pair();
      let checks = 0;
      const check = async () => {
        await f.ctx.db.transaction(async (tx) => {
          await tx.execute(
            sql`select id from "user" where id=${a.userId} for update nowait`,
          );
          await tx.execute(
            sql`select user_id from storage_usage where user_id=${a.userId} for update nowait`,
          );
          await tx.execute(
            sql`select id from storage_budget for update nowait`,
          );
          await tx.execute(
            sql`select id from upload_sessions where id=${a.dto.id} for update nowait`,
          );
          await tx.execute(
            sql`select id from files where owner_id=${a.userId} for update nowait`,
          );
          await tx.execute(sql`select id from blobs for update nowait`);
          await tx.execute(
            sql`select id from blob_derivatives for update nowait`,
          );
          await tx.execute(
            sql`select id from derived_objects for update nowait`,
          );
        });
        checks++;
      };
      await deriveAvatar(
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
            head: async (input) => {
              await check();
              return f.mediaCtx.driver.head(input);
            },
          },
        },
        a.data,
      );
      expect(checks).toBe(4);
    });
    test("ready settlement rollback and ambiguous commit remain atomic and replay safe", async () => {
      for (const afterCommit of [false, true]) {
        const { a } = await pair();
        await deriveAvatar(f.mediaCtx, a.data);
        const faulty = new Proxy(f.ctx.db, {
          get(target, key) {
            if (key === "transaction")
              return async (fn: (tx: DbTransaction) => Promise<unknown>) => {
                if (afterCommit) {
                  await target.transaction(fn);
                  throw new StorageUnavailableError();
                }
                return target.transaction(async (tx) => {
                  await fn(tx);
                  throw new StorageUnavailableError();
                });
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        await expect(
          finalizeUpload({ ...f.mediaCtx, db: faulty }, a.data),
        ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
        const s = await session(a.dto.id);
        expect(s.state).toBe(afterCommit ? "ready" : "processing");
        await finalizeUpload(f.mediaCtx, a.data);
        await finalizeUpload(f.mediaCtx, a.data);
        const [usage] = await f.ctx.db
          .select()
          .from(storageUsage)
          .where(eq(storageUsage.userId, a.userId));
        expect(usage).toMatchObject({
          usedBytes: s.expectedSize,
          reservedBytes: 0,
          activeUploads: 0,
        });
      }
    });
    test("two physical connections serialize recipe promotion against physical downgrade", async () => {
      const { a, output } = await pair();
      const recipe = await claimAvatarRecipe(f.mediaCtx, a.data);
      const claim = await claimAvatarOutput(
        f.mediaCtx,
        a.data,
        recipe!,
        output,
      );
      await f.ctx.db
        .update(derivedObjects)
        .set({ state: "ready", leaseUntil: null })
        .where(eq(derivedObjects.id, claim!.object.id));
      await f.ctx.db.update(storageBudget).set({
        derivedReserved: sql`${storageBudget.derivedReserved}-${output.size}`,
        derivedWritten: sql`${storageBudget.derivedWritten}+${output.size}`,
      });
      const pool = testDbHandle().pool,
        c1 = await pool.connect(),
        c2 = await pool.connect();
      try {
        await c1.query("BEGIN");
        await c2.query("BEGIN");
        await c1.query(
          "UPDATE blob_derivatives SET state='ready' WHERE id=$1",
          [recipe!.recipe.id],
        );
        await c1.query("SET CONSTRAINTS ALL IMMEDIATE");
        let settled = false;
        const downgrade = c2
          .query("UPDATE derived_objects SET state='deleting' WHERE id=$1", [
            claim!.object.id,
          ])
          .finally(() => {
            settled = true;
          });
        await Bun.sleep(100);
        expect(settled).toBe(false);
        await c1.query("COMMIT");
        await downgrade;
        await expect(c2.query("COMMIT")).rejects.toMatchObject({
          code: "23514",
        });
        const [object] = await f.ctx.db
          .select()
          .from(derivedObjects)
          .where(eq(derivedObjects.id, claim!.object.id));
        expect(object.state).toBe("ready");
      } finally {
        await c1.query("ROLLBACK");
        await c2.query("ROLLBACK");
        c1.release();
        c2.release();
      }
    });
  },
);
