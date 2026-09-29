import { expect, test } from "bun:test";

import { createQqHasher } from "./hasher";

test("同样的输入得到同样的 64 位十六进制；输入或密钥不同，结果就不同", async () => {
  const a = createQqHasher("secret-a-secret-a-secret-a-secret-a");
  const b = createQqHasher("secret-b-secret-b-secret-b-secret-b");

  expect(await a.qqKey("10001")).toMatch(/^[0-9a-f]{64}$/);
  expect(await a.qqKey("10001")).toBe(await a.qqKey("10001"));
  expect(await a.qqKey("10001")).not.toBe(await a.qqKey("10002"));
  expect(await a.qqKey("10001")).not.toBe(await b.qqKey("10001"));
  expect(await a.codeHash("nonce-1", "10001", "123456")).not.toBe(await a.codeHash("nonce-2", "10001", "123456"));
  expect(await a.codeHash("nonce-1", "10001", "123456")).not.toBe(await a.codeHash("nonce-1", "10001", "654321"));
});
