import { beforeAll, describe, expect, test } from "bun:test";

import { createMemoryRateLimitStore } from "../../middleware/rate-limit";
import { testRedis } from "../../testing/test-redis";
import { createRedisQqCodeStore, type QqCodeStore } from "./codes";

const prefix = `test:${crypto.randomUUID()}:`;
let store: QqCodeStore;

beforeAll(async () => {
  store = createRedisQqCodeStore({ redis: await testRedis(), limits: createMemoryRateLimitStore(), prefix });
});

describe("createRedisQqCodeStore", () => {
  test("存、取、加尝试次数、作废；作废只成功一次", async () => {
    await store.save("n1", { qqKey: "q", codeHash: "c" }, 300);

    expect(await store.get("n1")).toEqual({ qqKey: "q", codeHash: "c", attempts: 0 });
    expect(await store.incrementAttempts("n1")).toBe(1);
    expect((await store.get("n1"))?.attempts).toBe(1);
    expect(await store.consume("n1")).toBe(true);
    expect(await store.consume("n1")).toBe(false);
    expect(await store.get("n1")).toBeNull();
  });

  test("按秒设过期时间", async () => {
    await store.save("n2", { qqKey: "q", codeHash: "c" }, 300);
    const ttl = Number(await (await testRedis()).send("TTL", [`${prefix}n2`]));

    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  // 记录过期后还用 HINCRBY 的话，会留下一个没有过期时间的键。
  test("记录不在时尝试次数返回 null，也不会建出新键", async () => {
    expect(await store.incrementAttempts("missing")).toBeNull();
    expect(Number(await (await testRedis()).send("EXISTS", [`${prefix}missing`]))).toBe(0);
  });

  test("按 QQ 号限流：每分钟 1 次、每小时 5 次，被每分钟的拦下时不占每小时的额度", async () => {
    let now = 0;
    const limited = createRedisQqCodeStore({
      redis: await testRedis(),
      limits: createMemoryRateLimitStore(() => now),
      prefix,
    });

    expect(await limited.allowSend("k")).toBe(true);
    expect(await limited.allowSend("k")).toBe(false);
    for (let minute = 1; minute <= 4; minute++) {
      now = minute * 61_000;
      expect(await limited.allowSend("k")).toBe(true);
    }
    now = 5 * 61_000;
    expect(await limited.allowSend("k")).toBe(false);
    expect(await limited.allowSend("another")).toBe(true);
  });
});
