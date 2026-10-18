import { exportTestUserIds } from "../testing/user-public-ids";
import { resetTestDatabase } from "../testing/test-db";
import { beforeAll, afterAll, expect, test } from "bun:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  user,
  userAvatars,
  files,
  uploadSessions,
  storageUsage,
  mediaPublications,
  mediaPurgeRequests,
  storageTombstones,
  blobs,
} from "../db/schema";
import {
  requestDeletion,
  cancelDeletion,
  purgeUser,
  type DeletionHandler,
} from "../services/user-deletion";
import { readyContext, readyFile, readyOwner } from "../../../test/storage/ready-file";
import { cleanupStorageFixture, storageFixtureConfig } from "../../../test/storage/fixture";
import { createS3Driver } from "./s3";
import { setAvatar } from "./avatars";
import { initUpload } from "./uploads";
import { hasFileReferences, hasPublicRepresentation } from "./references";
let fixture: Awaited<ReturnType<typeof readyContext>>;
const owners: string[] = [];
const future: DeletionHandler = {
  name: "future-fixture",
  hasContent: async () => true,
  purge: async () => {},
};
beforeAll(async () => {
  await resetTestDatabase();
  fixture = await readyContext();
  fixture.ctx.exportChartJournal=exportTestUserIds;
  await fixture.ctx.boss();
}, 30000);
afterAll(async () => {
  if (!fixture) return;
  // Purged owners have SET NULL files; remove fixture files by their actual physical policy.
  const physical = await fixture.ctx.db
    .select()
    .from(blobs)
    .where(eq(blobs.policyId, fixture.policy.id));
  if (physical.length)
    await fixture.ctx.db.delete(files).where(
      and(
        inArray(
          files.blobId,
          physical.map((b) => b.id),
        ),
        sql`${files.ownerId} is null`,
      ),
    );
  await cleanupStorageFixture(
    fixture.ctx.db,
    owners,
    [fixture.policy.id],
    process.env.STORAGE_TEST_FIXTURE_PATH
      ? createS3Driver(await storageFixtureConfig("control"))
      : undefined,
    true,
  );
}, 30000);
async function owner() {
  const id = await readyOwner(fixture.ctx);
  owners.push(id);
  return id;
}
async function handlers() {
  const mod = (await import("./deletion").catch(() => ({}))) as typeof import("./deletion");
  expect(typeof mod.createStorageDeletionHandler).toBe("function");
  return mod;
}
async function row(table: typeof user, id: string) {
  return (await fixture.ctx.db.select().from(table).where(eq(user.id, id)))[0];
}

test("avatar-only prepare is immediately due, suspends the FK and commits durable revoke plus cancelled reservation", async () => {
  const { createStorageDeletionHandler } = await handlers(),
    { ctx, policy } = fixture,
    id = await owner();
  const avatar = await readyFile(ctx, policy.id, id);
  await setAvatar(ctx, id, { fileId: avatar.file.id, expectedRevision: 0 }, crypto.randomUUID());
  const upload = await initUpload(
    ctx,
    id,
    { name: "pending.png", purpose: "avatar", size: 11, sha256: "a".repeat(64) },
    crypto.randomUUID(),
  );
  const storage = createStorageDeletionHandler(ctx);
  expect(await storage.hasContent(id, ctx.db)).toBe(false);
  const result = await requestDeletion({ db: ctx.db, boss: ctx.boss, handlers: [storage] }, id, {
    deleteContent: false,
  });
  expect(result.status).toBe("requested");
  if (result.status === "requested")
    expect(result.purgeAt.getTime()).toBeLessThanOrEqual(Date.now());
  expect((await row(user, id)).image).toBeNull();
  const [association] = await ctx.db.select().from(userAvatars).where(eq(userAvatars.userId, id));
  expect(association.suspendedAt).toBeInstanceOf(Date);
  expect(association.fileId).toBe(avatar.file.id);
  expect(await hasFileReferences(ctx.db, avatar.file.id)).toBe(true);
  expect(await hasPublicRepresentation(ctx.db, avatar.derived.outputSha256)).toBe(false);
  const [session] = await ctx.db
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.id, upload.id));
  expect(session).toMatchObject({ state: "cancelled", reservedBytes: 0, generation: 1 });
  expect(
    (await ctx.db.select().from(storageUsage).where(eq(storageUsage.userId, id)))[0],
  ).toMatchObject({ usedBytes: avatar.file.size, reservedBytes: 0, activeUploads: 0 });
  expect(
    (
      await ctx.db
        .select()
        .from(mediaPublications)
        .where(eq(mediaPublications.outputSha256, avatar.derived.outputSha256))
    )[0].state,
  ).toBe("revoking");
  expect(
    await ctx.db
      .select()
      .from(mediaPurgeRequests)
      .where(eq(mediaPurgeRequests.outputSha256, avatar.derived.outputSha256)),
  ).toHaveLength(1);
});

test("shared output remains public and cancellation restores only avatar, never cancelled upload", async () => {
  const { createStorageDeletionHandler } = await handlers(),
    { ctx, policy } = fixture,
    one = await owner(),
    two = await owner();
  const a = await readyFile(ctx, policy.id, one),
    b = await readyFile(ctx, policy.id, two, a.derived);
  await setAvatar(ctx, one, { fileId: a.file.id, expectedRevision: 0 }, crypto.randomUUID());
  await setAvatar(ctx, two, { fileId: b.file.id, expectedRevision: 0 }, crypto.randomUUID());
  const upload = await initUpload(
    ctx,
    one,
    { purpose: "avatar", name: "cancel.png", size: 7, sha256: "b".repeat(64) },
    crypto.randomUUID(),
  );
  const deps = {
    db: ctx.db,
    boss: ctx.boss,
    handlers: [future, createStorageDeletionHandler(ctx)],
  };
  await requestDeletion(deps, one, { deleteContent: false });
  expect(
    (
      await ctx.db
        .select()
        .from(mediaPublications)
        .where(eq(mediaPublications.outputSha256, a.derived.outputSha256))
    )[0].state,
  ).toBe("public");
  expect(await cancelDeletion(deps, one)).toBe("cancelled");
  expect((await row(user, one)).image).toBe(`/media/${a.derived.outputSha256}.jpg`);
  expect(
    (await ctx.db.select().from(userAvatars).where(eq(userAvatars.userId, one)))[0],
  ).toMatchObject({ suspendedAt: null, revision: 3, fileId: a.file.id });
  expect(
    (await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, upload.id)))[0].state,
  ).toBe("cancelled");
});

test("final purge always deletes personal photos and recovery/outbox facts outlive user", async () => {
  const { createStorageDeletionHandler } = await handlers(),
    { ctx, policy } = fixture;
  for (const deleteContent of [false, true]) {
    const id = await owner(),
      a = await readyFile(ctx, policy.id, id);
    await setAvatar(ctx, id, { fileId: a.file.id, expectedRevision: 0 }, crypto.randomUUID());
    const deps = { db: ctx.db, boss: ctx.boss, handlers: [createStorageDeletionHandler(ctx)] };
    await requestDeletion(deps, id, { deleteContent });
    await ctx.db.execute(
      sql`update "user" set deletion_purge_at=clock_timestamp()-interval '1 second' where id=${id}`,
    );
    expect(await purgeUser(deps, id)).toBe("purged");
    expect(await row(user, id)).toBeUndefined();
    const [file] = await ctx.db.select().from(files).where(eq(files.id, a.file.id));
    expect(file).toMatchObject({ state: "deleted", ownerId: null, originalName: "removed" });
    expect(file.deletedAt).toBeInstanceOf(Date);
    expect(
      (await ctx.db.select().from(storageTombstones).where(eq(storageTombstones.userId, id))).some(
        (t) => t.kind === "user_deleted",
      ),
    ).toBe(true);
    expect(
      await ctx.db
        .select()
        .from(mediaPurgeRequests)
        .where(eq(mediaPurgeRequests.outputSha256, a.derived.outputSha256)),
    ).toHaveLength(1);
  }
});

test("registry binds every real business FK deletion partner and keeps storage last", async () => {
  const { createDeletionHandlers } = await handlers();
  const registry = createDeletionHandlers(fixture.ctx, [future]);
  expect(registry.map((h) => h.name)).toEqual(["future-fixture", "charts", "discussions", "following", "storage"]);
  expect(() => createDeletionHandlers(fixture.ctx, [{ ...future, name: "storage" }])).toThrow();
});

test("anonymous future business FK retains its file, delete-content detaches, personal avatars always disappear", async () => {
  const { createDeletionHandlers } = await handlers(),
    { ctx, policy } = fixture;
  const { pgTable, text, uuid } = await import("drizzle-orm/pg-core");
  const { FILE_REFERENCES, registerFileReferences } = await import("./references");
  const retained = pgTable("test_retained_file", {
    id: uuid().primaryKey(),
    authorId: text().references(() => user.id, { onDelete: "set null" }),
    fileId: uuid()
      .notNull()
      .references(() => files.id, { onDelete: "restrict" }),
  });
  await ctx.db.execute(
    sql`create table test_retained_file(id uuid primary key,author_id text references "user"(id) on delete set null,file_id uuid not null references files(id) on delete restrict)`,
  );
  try {
    const business: DeletionHandler = {
      name: "future-fixture",
      hasContent: async () => true,
      purge: async (id, options, tx) => {
        if (options.deleteContent) await tx.delete(retained).where(eq(retained.authorId, id));
      },
    };
    const registry = registerFileReferences([
      ...FILE_REFERENCES,
      {
        name: "future-fixture",
        referenceTable: retained,
        deletionPartner: "future-fixture",
        references: async (db, id) =>
          (await db.select().from(retained).where(eq(retained.fileId, id)).limit(1)).length > 0,
        retention: async (db, id) =>
          (await db.select().from(retained).where(eq(retained.fileId, id)).limit(1)).length > 0,
        publicRepresentations: async () => false,
      },
    ]);
    for (const deleteContent of [false, true]) {
      const id = await owner(),
        futureFile = await readyFile(ctx, policy.id, id),
        personal = await readyFile(ctx, policy.id, id);
      // Schema-only future-purpose fixture, not an enabled upload purpose/module.
      await ctx.db
        .update(files)
        .set({ purpose: "chart-source" })
        .where(eq(files.id, futureFile.file.id));
      await ctx.db
        .insert(retained)
        .values({ id: crypto.randomUUID(), authorId: id, fileId: futureFile.file.id });
      await setAvatar(
        ctx,
        id,
        { fileId: personal.file.id, expectedRevision: 0 },
        crypto.randomUUID(),
      );
      const producerCtx = {
        ...ctx,
        driver: new Proxy(ctx.driver, {
          get() {
            return () => {
              throw new Error("External IO in account hook");
            };
          },
        }),
      };
      const deps = {
        db: ctx.db,
        boss: ctx.boss,
        handlers: createDeletionHandlers(producerCtx, [business], registry),
      };
      await requestDeletion(deps, id, { deleteContent });
      await ctx.db.execute(
        sql`update "user" set deletion_purge_at=clock_timestamp()-interval '1 second' where id=${id}`,
      );
      expect(await purgeUser(deps, id)).toBe("purged");
      const [file] = await ctx.db.select().from(files).where(eq(files.id, futureFile.file.id));
      expect(file).toMatchObject({
        ownerId: null,
        originalName: "removed",
        state: deleteContent ? "deleted" : "ready",
      });
      expect(
        (await ctx.db.select().from(files).where(eq(files.id, personal.file.id)))[0].state,
      ).toBe("deleted");
      const retainedRows = await ctx.db
        .select()
        .from(retained)
        .where(eq(retained.fileId, futureFile.file.id));
      expect(retainedRows).toHaveLength(deleteContent ? 0 : 1);
      if (!deleteContent) {
        expect(retainedRows[0].authorId).toBeNull();
        expect(await hasFileReferences(ctx.db, file.id, registry)).toBe(true);
      }
    }
  } finally {
    await ctx.db.execute(sql`drop table test_retained_file`);
  }
});

test("request deletion fences a worker that already claimed the original before final publication", async () => {
  const { createStorageDeletionHandler } = await handlers(),
    { ctx, policy } = fixture,
    id = await owner(),
    a = await readyFile(ctx, policy.id, id);
  const upload = await initUpload(
    ctx,
    id,
    { purpose: "avatar", name: "race.png", size: a.file.size, sha256: a.blob.sha256 },
    crypto.randomUUID(),
  );
  const { claimAvatarRecipe } = await import("./objects");
  const claim = await claimAvatarRecipe(ctx, { uploadId: upload.id, generation: 0 });
  expect(claim).not.toBeNull();
  await requestDeletion(
    { db: ctx.db, boss: ctx.boss, handlers: [future, createStorageDeletionHandler(ctx)] },
    id,
    { deleteContent: false },
  );
  const { finalizeUpload } = await import("../../media-worker/finalize");
  await finalizeUpload(ctx, { uploadId: upload.id, generation: 0 });
  expect(
    (await ctx.db.select().from(uploadSessions).where(eq(uploadSessions.id, upload.id)))[0].state,
  ).toBe("cancelled");
  expect((await row(user, id)).image).toBeNull();
});
