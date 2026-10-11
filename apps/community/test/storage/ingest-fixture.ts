import { createHash } from "node:crypto";
import { createLogger } from "../../src/shared/log";
import { user, storagePolicies } from "../../src/server/db/schema";
import { testSender } from "../../src/server/testing/test-boss";
import { testDbHandle } from "../../src/server/testing/test-db";
import { createS3Driver } from "../../src/server/storage/s3";
import type { StorageContext } from "../../src/server/storage/contracts";
import { initUpload } from "../../src/server/storage/uploads";
import { putUploadPart } from "../../src/server/storage/parts";
import { storageFixtureConfig, cleanupStorageFixture } from "./fixture";
export const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function png(size = 100) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes.subarray(0, Math.min(size, 65536)));
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  return bytes;
}
export async function ingestFixture() {
  await testSender();
  const config = await storageFixtureConfig("web");
  const ctx: StorageContext = {
    config,
    db: testDbHandle().db,
    boss: testSender,
    driver: createS3Driver(config),
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
  const mediaConfig = await storageFixtureConfig("media");
  const mediaCtx: StorageContext = {
    ...ctx,
    config: mediaConfig,
    driver: createS3Driver(mediaConfig),
  };
  const cleanupDriver = createS3Driver(await storageFixtureConfig("control"));
  const owners: string[] = [];
  async function owner() {
    const id = crypto.randomUUID();
    owners.push(id);
    await ctx.db
      .insert(user)
      .values({ id, name: "ingest-test", email: `${id}@placeholder.invalid` });
    return id;
  }
  async function upload(bytes: Uint8Array, id?: string, expectedHash = hash(bytes)) {
    const userId = id ?? (await owner());
    const dto = await initUpload(
      ctx,
      userId,
      { purpose: "avatar", name: "test.png", size: bytes.length, sha256: expectedHash },
      crypto.randomUUID(),
    );
    for (let index = 0; index < dto.partCount; index++) {
      const part = bytes.subarray(index * dto.partSize, (index + 1) * dto.partSize);
      await putUploadPart(ctx, userId, dto.id, index, part, hash(part));
    }
    return { userId, dto, data: { uploadId: dto.id, generation: 0 } };
  }
  return {
    ctx,
    mediaCtx,
    cleanupDriver,
    owner,
    upload,
    cleanup: () => cleanupStorageFixture(ctx.db, owners, [policy.id], cleanupDriver, true),
  };
}
