import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseStorageEnv } from "../../src/server/storage/env";
import { createS3Driver } from "../../src/server/storage/s3";
import { ObjectMissingError, StorageUnavailableError } from "../../src/server/storage/errors";
import type { ObjectDriver, StorageConfig } from "../../src/server/storage/contracts";

// Explicitly opt into isolated fixtures; a clean checkout needs no ignored helper module.
const fixturePath = process.env.STORAGE_TEST_FIXTURE_PATH;
const enabled = !!fixturePath || !!process.env.STORAGE_TEST_ADMIN_ACCESS_KEY_ID;
async function config(role = "admin"): Promise<StorageConfig> {
  let access = process.env[`STORAGE_TEST_${role.toUpperCase()}_ACCESS_KEY_ID`];
  let secret = process.env[`STORAGE_TEST_${role.toUpperCase()}_SECRET_ACCESS_KEY`];
  if (fixturePath) {
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const identity = fixture.identities.find(
      (item: { name: string }) => item.name === `community-test-${role}`,
    );
    access = identity?.credentials[0]?.accessKey;
    secret = identity?.credentials[0]?.secretKey;
  }
  return parseStorageEnv(
    {
      PUBLIC_ORIGIN: "https://community.example.test",
      STORAGE_S3_ENDPOINT: process.env.STORAGE_TEST_ENDPOINT ?? "http://127.0.0.1:58333",
      STORAGE_TEMP_DIR: "/tmp/community-storage-test",
      STORAGE_RECIPE_BUILD: "test-v1",
      STORAGE_WEB_ACCESS_KEY_ID: access,
      STORAGE_WEB_SECRET_ACCESS_KEY: secret,
      STORAGE_INTERNAL_MEDIA_SECRET: "test-internal-secret-0123456789abcdef",
    },
    "web",
  );
}
const bytes = new TextEncoder().encode("authenticated storage fixture");
const hash = createHash("sha256").update(bytes).digest("hex");
const stream = (data = bytes) => new Blob([data]).stream();
const prefix = `tmp/task2-${randomUUID()}/`;
const input = (key: string, data = bytes) => ({
  bucket: "original" as const,
  key,
  body: stream(data),
  size: data.length,
  mime: "image/jpeg",
  sha256: createHash("sha256").update(data).digest("hex"),
});

describe.skipIf(!enabled)("real authenticated S3 adapter", () => {
  let driver: ObjectDriver;
  beforeAll(async () => {
    driver = createS3Driver(await config());
    await driver.ready();
  });
  afterAll(async () => {
    for (const bucket of ["original", "derived"] as const) {
      let cursor: string | undefined;
      do {
        const page = await driver.list({ bucket, prefix, cursor });
        for (const item of page.objects) await driver.delete({ bucket, key: item.key });
        cursor = page.cursor;
      } while (cursor);
    }
  });
  test("signed PUT HEAD GET range COPY LIST DELETE retain verified metadata", async () => {
    const key = `${prefix}crud`;
    await driver.put(input(key));
    const head = await driver.head({ bucket: "original", key });
    expect(head).toMatchObject({
      size: bytes.length,
      mime: "image/jpeg",
      sha256: hash,
    });
    const read = await driver.get({ bucket: "original", key });
    expect(await new Response(read.body).text()).toBe("authenticated storage fixture");
    const range = await driver.get({
      bucket: "original",
      key,
      range: { start: 2, end: 6 },
    });
    expect(range.size).toBe(5);
    expect(await new Response(range.body).text()).toBe("thent");
    const copy = `${prefix}copied`;
    await driver.copy({ bucket: "original", sourceKey: key, key: copy });
    expect(await driver.head({ bucket: "original", key: copy })).toMatchObject({
      sha256: hash,
      size: bytes.length,
    });
    expect(
      (await driver.list({ bucket: "original", prefix })).objects.some(
        (item) => item.key === copy && item.size === bytes.length && item.modifiedAt instanceof Date,
      ),
    ).toBe(true);
    await driver.delete({ bucket: "original", key });
    expect(await driver.head({ bucket: "original", key })).toBeNull();
    await expect(driver.get({ bucket: "original", key })).rejects.toBeInstanceOf(ObjectMissingError);
  });
  test.skipIf(!process.env.STORAGE_TEST_PERSISTED_KEY)(
    "adapter verifies fixture retained by earlier owned-volume server restart",
    async () => {
      const persisted = await driver.get({
        bucket: "original",
        key: process.env.STORAGE_TEST_PERSISTED_KEY!,
      });
      const expected = "community storage isolated nonpersonal fixture\n";
      expect(persisted.sha256).toBe(createHash("sha256").update(expected).digest("hex"));
      expect(persisted.size).toBe(47);
      expect(await new Response(persisted.body).text()).toBe(expected);
    },
  );
  test("anonymous GET and PUT are forbidden", async () => {
    const key = `${prefix}anonymous`;
    await driver.put(input(key));
    const url = `${(await config()).endpoint}/blobs/${key}`;
    expect((await fetch(url)).status).toBe(403);
    expect((await fetch(url, { method: "PUT", body: "unauthorized" })).status).toBe(403);
  });
  test("read permit survives headers, releases on cancel/EOF and caller abort", async () => {
    const one = createS3Driver(await config(), { readLimit: 1 });
    const key = `${prefix}read`;
    await driver.put(input(key, new Uint8Array(256 * 1024).fill(7)));
    const read = await one.get({ bucket: "original", key });
    await expect(one.head({ bucket: "original", key })).rejects.toBeInstanceOf(StorageUnavailableError);
    await read.body.cancel();
    expect((await one.head({ bucket: "original", key }))?.size).toBe(256 * 1024);
    const consumed = await one.get({ bucket: "original", key });
    expect((await new Response(consumed.body).arrayBuffer()).byteLength).toBe(256 * 1024);
    const controller = new AbortController();
    const aborted = await one.get({
      bucket: "original",
      key,
      signal: controller.signal,
    });
    controller.abort();
    await expect(new Response(aborted.body).arrayBuffer()).rejects.toBeInstanceOf(StorageUnavailableError);
    expect((await one.head({ bucket: "original", key }))?.size).toBe(256 * 1024);
  });
  test("actual role prefix ACLs reject web durable writes and backup mutations", async () => {
    const web = createS3Driver(await config("web"));
    await web.ready();
    await web.put(input(`${prefix}web`));
    const forbidden = () => input(`sha256/${hash.slice(0, 2)}/${hash}`);
    for (let i = 0; i < 6; i++)
      await expect(web.put(forbidden())).rejects.toBeInstanceOf(StorageUnavailableError);
    await web.ready(); // Forbidden attempts never open the real failure breaker.
    await expect(web.put({ ...input(`${prefix}derived`), bucket: "derived" })).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
    const backup = createS3Driver(await config("backup"));
    await backup.ready();
    expect(await backup.head({ bucket: "original", key: `${prefix}web` })).not.toBeNull();
    await expect(backup.put(input(`${prefix}backup`))).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(backup.delete({ bucket: "original", key: `${prefix}web` })).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
  });
  test("media writes canonical originals/derivatives and control removes them", async () => {
    const media = createS3Driver(await config("media"));
    const control = createS3Driver(await config("control"));
    const key = `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
    await media.ready();
    await control.ready();
    try {
      await media.put(input(key));
      await media.put({ ...input(key), bucket: "derived" });
      expect(await driver.head({ bucket: "derived", key })).toMatchObject({
        sha256: hash,
        size: bytes.length,
      });
      await expect(media.put(input(`${prefix}media-tmp`))).rejects.toBeInstanceOf(StorageUnavailableError);
      await control.delete({ bucket: "original", key });
      await control.delete({ bucket: "derived", key });
      expect(await driver.head({ bucket: "original", key })).toBeNull();
    } finally {
      await driver.delete({ bucket: "original", key });
      await driver.delete({ bucket: "derived", key });
    }
  });
  test("pre-aborted PUT cancels source and frees a write permit", async () => {
    const one = createS3Driver(await config(), { putLimit: 1 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      one.put({ ...input(`${prefix}pre-abort`), signal: controller.signal }),
    ).rejects.toBeInstanceOf(StorageUnavailableError);
    await one.put(input(`${prefix}after-abort`));
  });
});
