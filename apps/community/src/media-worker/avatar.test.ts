import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { ingestFixture } from "../../test/storage/ingest-fixture";
import {
  blobs,
  blobDerivatives,
  derivedObjects,
  files,
  mediaPublications,
  storageBudget,
  storageUsage,
  uploadSessions,
  userAvatars,
} from "../server/db/schema";
import { completeUpload } from "../server/storage/uploads";
import { ingestUpload } from "./ingest";
import { deriveAvatar } from "./avatar";
import { finalizeUpload } from "./finalize";
import { createBoss } from "../server/jobs/boss";
import { registerMediaWorkers } from "./main";
import { RECIPE_BUILD } from "./image-child";
describe.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "shared avatar outputs on real PG and S3",
  () => {
    let f: Awaited<ReturnType<typeof ingestFixture>>;
    beforeAll(async () => {
      f = await ingestFixture();
      f.mediaCtx.config.recipeBuild = RECIPE_BUILD;
    }, 30000);
    afterAll(async () => {
      await f?.cleanup();
    }, 30000);
    test("distinct originals share output, one physical charge and atomic replay-safe private finalize", async () => {
      const raw = new Uint8Array(
        await Bun.file(
          new URL("../../test/storage/images/safe.png", import.meta.url),
        ).arrayBuffer(),
      );
      // Different legal JPEG metadata does not affect decoded pixels or output.
      const jpeg = new Uint8Array(
        await Bun.file(
          new URL("../../test/storage/images/safe.jpeg", import.meta.url),
        ).arrayBuffer(),
      );
      const comment = Buffer.from([255, 254, 0, 8, 65, 66, 67, 68, 69, 70]);
      const alternate = Buffer.concat([
        jpeg.subarray(0, 2),
        comment,
        jpeg.subarray(2),
      ]);
      expect(raw.length).toBeGreaterThan(0);
      const a = await f.upload(jpeg),
        b = await f.upload(alternate);
      const [before] = await f.ctx.db.select().from(storageBudget);
      for (const u of [a, b]) {
        await completeUpload(f.ctx, u.userId, u.dto.id);
        await ingestUpload(f.mediaCtx, u.data);
        await deriveAvatar(f.mediaCtx, u.data);
      }
      const relations = await f.ctx.db.select().from(blobDerivatives);
      expect(relations).toHaveLength(2);
      expect(relations[0].derivedObjectId).toBe(relations[1].derivedObjectId);
      const outputs = await f.ctx.db.select().from(derivedObjects);
      expect(outputs).toHaveLength(1);
      const [after] = await f.ctx.db.select().from(storageBudget);
      expect(after.derivedWritten - before.derivedWritten).toBe(
        outputs[0].size,
      );
      expect(after.derivedReserved).toBe(before.derivedReserved);
      await Promise.all([
        finalizeUpload(f.mediaCtx, a.data),
        finalizeUpload(f.mediaCtx, a.data),
      ]);
      await finalizeUpload(f.mediaCtx, b.data);
      await deriveAvatar(f.mediaCtx, a.data);
      for (const u of [a, b]) {
        const [session] = await f.ctx.db
          .select()
          .from(uploadSessions)
          .where(eq(uploadSessions.id, u.dto.id));
        const [file] = await f.ctx.db
          .select()
          .from(files)
          .where(eq(files.id, session.fileId!));
        expect(session).toMatchObject({ state: "ready", reservedBytes: 0 });
        expect(file.state).toBe("ready");
        const [usage] = await f.ctx.db
          .select()
          .from(storageUsage)
          .where(eq(storageUsage.userId, u.userId));
        expect(usage).toMatchObject({
          reservedBytes: 0,
          activeUploads: 0,
          usedBytes: file.size,
        });
      }
      expect(await f.ctx.db.select().from(mediaPublications)).toHaveLength(0);
      expect(await f.ctx.db.select().from(userAvatars)).toHaveLength(0);
      expect(await f.ctx.db.select().from(blobs)).toHaveLength(2);
    });
    test("real worker Navigator executes ingest avatar finalize without NapCat", async () => {
      const worker = createBoss(process.env.TEST_DATABASE_URL!, "worker");
      await worker.start();
      try {
        await registerMediaWorkers({ ...f.mediaCtx, boss: async () => worker });
        const bytes = await Bun.file(
          new URL("../../test/storage/images/own-cmyk.jpg", import.meta.url),
        ).bytes();
        const upload = await f.upload(bytes);
        await completeUpload(f.ctx, upload.userId, upload.dto.id);
        const deadline = Date.now() + 20000;
        let session: typeof uploadSessions.$inferSelect | undefined;
        do {
          session = (
            await f.ctx.db
              .select()
              .from(uploadSessions)
              .where(eq(uploadSessions.id, upload.dto.id))
          )[0];
          if (session.state === "ready") break;
          await Bun.sleep(100);
        } while (Date.now() < deadline);
        expect(session?.state).toBe("ready");
        const [usage] = await f.ctx.db
          .select()
          .from(storageUsage)
          .where(eq(storageUsage.userId, upload.userId));
        expect(usage).toMatchObject({
          usedBytes: bytes.length,
          reservedBytes: 0,
          activeUploads: 0,
        });
        expect(await f.ctx.db.select().from(mediaPublications)).toHaveLength(0);
      } finally {
        await worker.stop({ graceful: true, timeout: 5000 });
      }
    }, 30000);
  },
);
