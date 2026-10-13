import { expect, test } from "bun:test";
import { createSnapshotReader } from "./catalog-snapshot";

test("a build shares one catalog load across concurrent and successive pages", async () => {
  let reads = 0;
  const read = createSnapshotReader(async () => ({ revision: ++reads }), true);
  const [first, second] = await Promise.all([read(), read()]);
  expect(second).toBe(first);
  expect(await read()).toBe(first);
  expect(reads).toBe(1);
});

test("development reads updated catalog data", async () => {
  let revision = 1;
  const read = createSnapshotReader(async () => ({ revision }), false);
  expect((await read()).revision).toBe(1);
  revision = 2;
  expect((await read()).revision).toBe(2);
});

test("a failed load can be retried without retaining rejected cache state", async () => {
  let reads = 0;
  const read = createSnapshotReader(async () => {
    if (++reads === 1) throw new Error("temporary read failure");
    return { revision: reads };
  }, true);
  await expect(read()).rejects.toThrow("temporary read failure");
  expect((await read()).revision).toBe(2);
  expect((await read()).revision).toBe(2);
});
