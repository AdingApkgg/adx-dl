import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { createMemoryRateLimitStore, type RateLimitStore, rateLimit } from "./rate-limit";

describe("createMemoryRateLimitStore", () => {
  test("窗口内计数递增，窗口过后重新计数", async () => {
    let now = 0;
    const store = createMemoryRateLimitStore(() => now);

    expect(await store.hit("k", 60)).toEqual({ count: 1, resetSec: 60 });
    now = 10_000;
    expect(await store.hit("k", 60)).toEqual({ count: 2, resetSec: 50 });
    now = 61_000;
    expect(await store.hit("k", 60)).toEqual({ count: 1, resetSec: 60 });
  });
});

function probe(store: RateLimitStore, key: string | null, onStoreError?: (error: unknown) => void) {
  return new Hono()
    .use("*", rateLimit({ store, name: "test", limit: 2, windowSec: 60, key: () => key, onStoreError }))
    .get("/", (c) => c.text("ok"));
}

describe("rateLimit", () => {
  test("超过上限返回 429 和 Retry-After", async () => {
    const app = probe(createMemoryRateLimitStore(), "203.0.113.7");

    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(200);
    const res = await app.request("/");

    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.json()).toEqual({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
  });

  test("key 返回 null 时不限流", async () => {
    const app = probe(createMemoryRateLimitStore(), null);
    for (let i = 0; i < 5; i++) {
      expect((await app.request("/")).status).toBe(200);
    }
  });

  // 计数存储（Redis）出问题时放行：限流失效比整站不可用好。
  test("计数存储出错时放行，并报告错误", async () => {
    const errors: unknown[] = [];
    const broken: RateLimitStore = {
      hit: async () => {
        throw new Error("redis down");
      },
    };
    const res = await probe(broken, "203.0.113.7", (error) => errors.push(error)).request("/");

    expect(res.status).toBe(200);
    expect(errors).toHaveLength(1);
  });
});
