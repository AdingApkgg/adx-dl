import { describe, expect, test } from "bun:test";

import { withTimeout } from "./with-timeout";

describe("withTimeout", () => {
  test("按时完成时原样返回结果", async () => {
    expect(await withTimeout(Promise.resolve(42), 100)).toBe(42);
  });

  test("原来的 promise 失败时照样失败", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 100)).rejects.toThrow("boom");
  });

  test("到时没有结束就失败，不再等下去", async () => {
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toThrow("timed out after 20ms");
  });
});
