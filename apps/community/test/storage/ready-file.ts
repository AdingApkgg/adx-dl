import sharp from "sharp";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { eq, sql } from "drizzle-orm";
import { createLogger } from "@/shared/log";
import {
  blobs,
  files,
  blobDerivatives,
  derivedObjects,
  storagePolicies,
  storageUsage,
  storageBudget,
  user,
} from "../../src/server/db/schema";
import type { StorageContext } from "../../src/server/storage/contracts";
import { createS3Driver } from "../../src/server/storage/s3";
import { testSender } from "../../src/server/testing/test-boss";
import { testDbHandle } from "../../src/server/testing/test-db";
import { storageFixtureConfig } from "./fixture";
export const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export async function readyContext() {
  const config = await storageFixtureConfig();
  const ctx: StorageContext = {
    db: testDbHandle().db,
    config,
    driver: createS3Driver(config),
    boss: testSender,
    log: createLogger(() => {}),
  };
  const [policy] = await ctx.db
    .insert(storagePolicies)
    .values({
      name: crypto.randomUUID(),
      endpoint: config.endpoint,
      region: config.region,
      originalBucket: config.originalBucket,
      derivedBucket: config.derivedBucket,
      credentialsRef: config.credentialsRef,
    })
    .returning();
  return { ctx, policy };
}
export async function readyOwner(ctx: StorageContext) {
  const id = crypto.randomUUID();
  await ctx.db.insert(user).values({ id, name: "test", email: `${id}@placeholder.invalid` });
  return id;
}
export async function readyFile(
  ctx: StorageContext,
  policyId: string,
  ownerId: string,
  shared?: typeof derivedObjects.$inferSelect,
) {
  const original = new Uint8Array(Buffer.from(crypto.randomUUID()));
  const output = new Uint8Array(
    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 3,
        background: {
          r: Math.floor(Math.random() * 255),
          g: Math.floor(Math.random() * 255),
          b: Math.floor(Math.random() * 255),
        },
      },
    })
      .jpeg({ quality: 85, progressive: false })
      .toBuffer(),
  );
  const sha = digest(original),
    outputSha = digest(output);
  const [blob] = await ctx.db
    .insert(blobs)
    .values({
      sha256: sha,
      policyId,
      key: `sha256/${sha}`,
      size: original.length,
      detectedMime: "image/png",
      state: "ready",
      verifiedAt: new Date(),
    })
    .returning();
  const derived =
    shared ??
    (
      await ctx.db
        .insert(derivedObjects)
        .values({
          outputSha256: outputSha,
          policyId,
          key: `sha256/${outputSha}`,
          size: output.length,
          mime: "image/jpeg",
          state: "ready",
        })
        .returning()
    )[0];
  const [recipe] = await ctx.db
    .insert(blobDerivatives)
    .values({
      sourceBlobId: blob.id,
      recipe: "avatar-v1",
      recipeBuild: ctx.config.recipeBuild,
      derivedObjectId: derived.id,
      state: "ready",
    })
    .returning();
  const [file] = await ctx.db
    .insert(files)
    .values({
      ownerId,
      blobId: blob.id,
      originalName: '照片・画像😀".png',
      purpose: "avatar",
      size: original.length,
      state: "ready",
      retainedUntil: new Date(Date.now() + 86400000),
    })
    .returning();
  await ctx.db
    .insert(storageUsage)
    .values({ userId: ownerId, usedBytes: original.length })
    .onConflictDoUpdate({
      target: storageUsage.userId,
      set: { usedBytes: sql`${storageUsage.usedBytes}+${original.length}` },
    });
  await ctx.db
    .update(storageBudget)
    .set({
      originalWritten: sql`${storageBudget.originalWritten}+${original.length}`,
      derivedWritten: sql`${storageBudget.derivedWritten}+${shared ? 0 : output.length}`,
    })
    .where(eq(storageBudget.id, "global"));
  if (process.env.STORAGE_TEST_FIXTURE_PATH) {
    const media = createS3Driver(await storageFixtureConfig("media"));
    await media.put({
      bucket: "original",
      key: blob.key,
      body: Readable.toWeb(Readable.from([original])) as unknown as ReadableStream<Uint8Array>,
      size: original.length,
      mime: "image/png",
      sha256: sha,
    });
    if (!shared)
      await media.put({
        bucket: "derived",
        key: derived.key,
        body: Readable.toWeb(Readable.from([output])) as unknown as ReadableStream<Uint8Array>,
        size: output.length,
        mime: "image/jpeg",
        sha256: outputSha,
      });
  }
  return { file, blob, recipe, derived, original, output };
}
