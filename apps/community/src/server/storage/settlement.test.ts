import { beforeAll, expect, test } from "bun:test";
import { resetTestDatabase } from "../testing/test-db";
import { ingestFixture, hash, png } from "../../../test/storage/ingest-fixture";
import { initUpload } from "./uploads";
import { putUploadPart } from "./parts";
import { acquireStorageMaintenance, releaseStorageMaintenance } from "./maintenance";
import { uploadParts } from "../db/schema";
import { eq } from "drizzle-orm";
beforeAll(resetTestDatabase, 30000);
test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "already claimed real PUT settles under gate; new claim remains503",
  async () => {
    const f = await ingestFixture();
    const bytes = png();
    const owner = await f.owner();
    const upload = await initUpload(
      f.ctx,
      owner,
      { purpose: "avatar", name: "settled.png", size: bytes.length, sha256: hash(bytes) },
      crypto.randomUUID(),
    );
    let release!: () => void, enter!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      held = new Promise<void>((r) => (release = r));
    const ctx = {
      ...f.ctx,
      driver: {
        ...f.ctx.driver,
        put: async (input: Parameters<typeof f.ctx.driver.put>[0]) => {
          enter();
          await held;
          await f.ctx.driver.put(input);
        },
      },
    };
    const putting = putUploadPart(ctx, owner, upload.id, 0, bytes, hash(bytes));
    const result = putting.catch((e) => e);
    await entered;
    const lease = await acquireStorageMaintenance(f.ctx.db);
    try {
      await expect(
        initUpload(
          f.ctx,
          owner,
          { purpose: "avatar", name: "new.png", size: bytes.length, sha256: hash(bytes) },
          crypto.randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 503 });
      release();
      expect(await result).toBeUndefined();
      expect(
        (await f.ctx.db.select().from(uploadParts).where(eq(uploadParts.uploadId, upload.id)))[0]
          .state,
      ).toBe("ready");
    } finally {
      release();
      await result;
      await releaseStorageMaintenance(f.ctx.db, lease);
      await f.cleanup();
    }
  },
);

test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "typed original completion rejects forged, stale and expired durable proofs under closed gate",
  async () => {
    const f = await ingestFixture();
    const { completeUpload } = await import("./uploads");
    const { claimOriginal, publishOriginal, claimAvatarRecipe } = await import("./objects");
    const { blobs } = await import("../db/schema");
    const u = await f.upload(png());
    await completeUpload(f.ctx, u.userId, u.dto.id);
    const claim = (await claimOriginal(f.mediaCtx, u.data))!;
    const lease = await acquireStorageMaintenance(f.ctx.db);
    try {
      await expect(claimOriginal(f.mediaCtx, u.data)).rejects.toMatchObject({ status: 503 });
      await expect(claimAvatarRecipe(f.mediaCtx, u.data)).rejects.toMatchObject({ status: 503 });
      expect(
        await publishOriginal(
          f.mediaCtx,
          u.data,
          { ...claim, blob: { ...claim.blob, id: crypto.randomUUID() } },
          "image/png",
        ),
      ).toBe(false);
      expect(
        await publishOriginal(
          f.mediaCtx,
          u.data,
          { ...claim, blob: { ...claim.blob, generation: claim.blob.generation + 1 } },
          "image/png",
        ),
      ).toBe(false);
      await f.ctx.db
        .update(blobs)
        .set({ leaseUntil: new Date(Date.now() - 1000) })
        .where(eq(blobs.id, claim.blob.id));
      expect(await publishOriginal(f.mediaCtx, u.data, claim, "image/png")).toBe(false);
      expect(
        (await f.ctx.db.select().from(blobs).where(eq(blobs.id, claim.blob.id)))[0].state,
      ).toBe("pending");
    } finally {
      await releaseStorageMaintenance(f.ctx.db, lease);
      await f.cleanup();
    }
  },
);

test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "avatar completion binds exact current recipe/object; forged, stale and expired proof cannot settle under gate",
  async () => {
    const f = await ingestFixture();
    const { completeUpload } = await import("./uploads");
    const {
      claimOriginal,
      publishOriginal,
      claimAvatarRecipe,
      claimAvatarOutput,
      publishAvatarOutput,
    } = await import("./objects");
    const { derivedObjects, blobDerivatives, storageBudget } = await import("../db/schema");
    const { objectKey } = await import("./keys");
    const { sql } = await import("drizzle-orm");
    const bytes = png();
    const u = await f.upload(bytes);
    await completeUpload(f.ctx, u.userId, u.dto.id);
    const original = (await claimOriginal(f.mediaCtx, u.data))!;
    await f.mediaCtx.driver.put({
      bucket: "original",
      key: original.blob.key,
      body: new Blob([bytes]).stream(),
      size: bytes.length,
      mime: "image/png",
      sha256: hash(bytes),
    });
    expect(await publishOriginal(f.mediaCtx, u.data, original, "image/png")).toBe(true);
    const source = (await claimAvatarRecipe(f.mediaCtx, u.data))!;
    const outputBytes = crypto.getRandomValues(new Uint8Array(60));
    const output = (await claimAvatarOutput(f.mediaCtx, u.data, source, {
      hash: hash(outputBytes),
      size: outputBytes.length,
    }))!;
    await f.mediaCtx.driver.put({
      bucket: "derived",
      key: output.object.key,
      body: new Blob([outputBytes]).stream(),
      size: outputBytes.length,
      mime: "image/jpeg",
      sha256: hash(outputBytes),
    });
    const foreignHash = hash(crypto.getRandomValues(new Uint8Array(60)));
    const [foreign] = await f.ctx.db
      .insert(derivedObjects)
      .values({
        outputSha256: foreignHash,
        key: objectKey(foreignHash),
        size: 60,
        mime: "image/jpeg",
        state: "pending",
        policyId: output.object.policyId,
        generation: output.object.generation,
        leaseUntil: new Date(Date.now() + 120000),
      })
      .returning();
    await f.ctx.db
      .update(storageBudget)
      .set({ derivedReserved: sql`${storageBudget.derivedReserved}+60` });
    const lease = await acquireStorageMaintenance(f.ctx.db);
    try {
      await expect(
        claimAvatarOutput(f.mediaCtx, u.data, source, { hash: foreignHash, size: 60 }),
      ).rejects.toMatchObject({ status: 503 });
      expect(
        await publishAvatarOutput(f.mediaCtx, u.data, source, { kind: "writer", object: foreign }),
      ).toBe(false);
      expect(
        await publishAvatarOutput(f.mediaCtx, u.data, source, {
          ...output,
          object: { ...output.object, id: crypto.randomUUID() },
        }),
      ).toBe(false);
      expect(
        await publishAvatarOutput(
          f.mediaCtx,
          u.data,
          { ...source, recipe: { ...source.recipe, generation: source.recipe.generation + 1 } },
          output,
        ),
      ).toBe(false);
      expect(
        await publishAvatarOutput(f.mediaCtx, u.data, source, {
          ...output,
          object: { ...output.object, generation: output.object.generation + 1 },
        }),
      ).toBe(false);
      await f.ctx.db
        .update(blobDerivatives)
        .set({ leaseUntil: new Date(Date.now() - 1000) })
        .where(eq(blobDerivatives.id, source.recipe.id));
      expect(await publishAvatarOutput(f.mediaCtx, u.data, source, output)).toBe(false);
      await f.ctx.db
        .update(blobDerivatives)
        .set({ leaseUntil: new Date(Date.now() + 120000) })
        .where(eq(blobDerivatives.id, source.recipe.id));
      await f.ctx.db
        .update(derivedObjects)
        .set({ leaseUntil: new Date(Date.now() - 1000) })
        .where(eq(derivedObjects.id, output.object.id));
      expect(await publishAvatarOutput(f.mediaCtx, u.data, source, output)).toBe(false);
      await f.ctx.db
        .update(derivedObjects)
        .set({ leaseUntil: new Date(Date.now() + 120000) })
        .where(eq(derivedObjects.id, output.object.id));
      expect(await publishAvatarOutput(f.mediaCtx, u.data, source, output)).toBe(true);
    } finally {
      await releaseStorageMaintenance(f.ctx.db, lease);
      await f.cleanup();
    }
  },
);

test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH)(
  "part completion rejects expired physical lease, replaced attempt and stale session while gate stays closed",
  async () => {
    const { uploadAttempts, uploadSessions, storageBudget } = await import("../db/schema");
    const { sql } = await import("drizzle-orm");
    for (const mode of ["expired", "replaced", "session", "forged"] as const) {
      const f = await ingestFixture();
      const owner = await f.owner();
      const bytes = png();
      const upload = await initUpload(
        f.ctx,
        owner,
        { purpose: "avatar", name: "negative.png", size: bytes.length, sha256: hash(bytes) },
        crypto.randomUUID(),
      );
      let enter!: () => void, release!: () => void;
      const started = new Promise<void>((r) => (enter = r)),
        held = new Promise<void>((r) => (release = r));
      const context = {
        ...f.ctx,
        driver: {
          ...f.ctx.driver,
          put: async (input: Parameters<typeof f.ctx.driver.put>[0]) => {
            enter();
            await held;
            await f.ctx.driver.put(input);
          },
        },
      };
      const writing = putUploadPart(context, owner, upload.id, 0, bytes, hash(bytes)).catch(
        (e) => e,
      );
      await started;
      const [part] = await f.ctx.db
        .select()
        .from(uploadParts)
        .where(eq(uploadParts.uploadId, upload.id));
      const [attempt] = await f.ctx.db
        .select()
        .from(uploadAttempts)
        .where(eq(uploadAttempts.id, part.attemptId));
      const lease = await acquireStorageMaintenance(f.ctx.db);
      try {
        if (mode === "forged")
          await f.ctx.db
            .update(uploadAttempts)
            .set({ sha256: hash(crypto.getRandomValues(new Uint8Array(10))) })
            .where(eq(uploadAttempts.id, attempt.id));
        if (mode === "expired")
          await f.ctx.db
            .update(uploadAttempts)
            .set({ leaseUntil: new Date(Date.now() - 1000) })
            .where(eq(uploadAttempts.id, attempt.id));
        if (mode === "replaced") {
          const id = crypto.randomUUID();
          await f.ctx.db
            .insert(uploadAttempts)
            .values({ ...attempt, id, tempKey: attempt.tempKey + "-replacement" });
          await f.ctx.db
            .update(storageBudget)
            .set({
              temporaryReserved: sql`${storageBudget.temporaryReserved}+${attempt.reservedBytes}`,
            });
          await f.ctx.db
            .update(uploadParts)
            .set({ attemptId: id })
            .where(eq(uploadParts.uploadId, upload.id));
        }
        if (mode === "session")
          await f.ctx.db
            .update(uploadSessions)
            .set({ generation: 1 })
            .where(eq(uploadSessions.id, upload.id));
        release();
        expect(await writing).toMatchObject({ status: 409 });
        expect(
          (await f.ctx.db.select().from(uploadParts).where(eq(uploadParts.uploadId, upload.id)))[0]
            .state,
        ).toBe("writing");
        expect(
          (await f.ctx.db.select().from(uploadAttempts).where(eq(uploadAttempts.id, attempt.id)))[0]
            .state,
        ).toBe("writing");
        await expect(
          initUpload(
            f.ctx,
            owner,
            { purpose: "avatar", name: "blocked.png", size: bytes.length, sha256: hash(bytes) },
            crypto.randomUUID(),
          ),
        ).rejects.toMatchObject({ status: 503 });
      } finally {
        release();
        await writing;
        await releaseStorageMaintenance(f.ctx.db, lease);
        await f.cleanup();
      }
    }
  },
);
