import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { resetTestDatabase } from "../testing/test-db";
import { readyContext, readyFile, readyOwner } from "../../../test/storage/ready-file";
import { cleanupStorageFixture, storageFixtureConfig } from "../../../test/storage/fixture";
import { mediaPublications, user } from "../db/schema";
import { createStorageContext } from "./runtime";
import { createS3Driver } from "./s3";
import { createMediaDrain } from "./drain";
import { setAvatar } from "./avatars";
import { sweepStorage } from "../../worker/storage-sweep";

test("media postcommit delivery defers explicitly and actual control backfill resumes current public bytes", async () => {
  await resetTestDatabase();
  const { ctx, policy } = await readyContext();
  ctx.driver = createS3Driver(await storageFixtureConfig("control"));
  await ctx.boss();
  const owner = await readyOwner(ctx);
  const secret = "runtime-publication-fixture-secret";
  const drain = createMediaDrain({ db: ctx.db, secret });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: drain.handle });
  try {
    const item = await readyFile(ctx, policy.id, owner);
    const hash = item.derived.outputSha256;
    await ctx.db.insert(mediaPublications).values({ outputSha256: hash, state: "revoking", generation: 1 });
    await drain.drain(hash, 1);
    await ctx.db.update(mediaPublications).set({ state: "private" }).where(eq(mediaPublications.outputSha256, hash));
    const media = createStorageContext({ ...ctx, config: await storageFixtureConfig("media"), driver: ctx.driver });
    await expect(setAvatar(media, owner, { fileId: item.file.id, expectedRevision: 0 }, crypto.randomUUID())).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect((await ctx.db.select().from(user).where(eq(user.id, owner)))[0].image).toBe(`/media/${hash}.jpg`);
    expect(drain.register(hash)).toBeNull();
    const config = await storageFixtureConfig("control");
    if (config.role !== "control") throw new Error("fixture role mismatch");
    const control = createStorageContext({ ...ctx, config: { ...config, internalMediaSecret: secret, internalMediaUrl: `http://127.0.0.1:${server.port}` }, driver: ctx.driver });
    const result = await sweepStorage(control);
    expect(result.storageFailures).toBe(0);
    const registration = drain.register(hash);
    expect(registration).not.toBeNull();
    registration?.release();
  } finally {
    server.stop(true);
    await cleanupStorageFixture(ctx.db, [owner], [policy.id], process.env.STORAGE_TEST_FIXTURE_PATH ? ctx.driver : undefined, true);
  }
}, 30000);
