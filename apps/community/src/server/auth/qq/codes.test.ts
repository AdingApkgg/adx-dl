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
  test("存、占用尝试次数（依次 1、2、3，带回验证码的 HMAC）、作废；作废只成功一次", async () => {
    await store.save("n1", { qqKey: "q", codeHash: "c" }, 300);

    expect(await store.claimAttempt("n1", "q")).toEqual({ codeHash: "c", attempts: 1 });
    expect(await store.claimAttempt("n1", "q")).toEqual({ codeHash: "c", attempts: 2 });
    expect(await store.claimAttempt("n1", "q")).toEqual({ codeHash: "c", attempts: 3 });
    expect(await store.consume("n1")).toBe(true);
    expect(await store.consume("n1")).toBe(false);
    expect(await store.claimAttempt("n1", "q")).toBeNull();
  });

  test("按秒设过期时间", async () => {
    await store.save("n2", { qqKey: "q", codeHash: "c" }, 300);
    const ttl = Number(await (await testRedis()).send("TTL", [`${prefix}n2`]));

    expect(ttl).toBeGreaterThan(290);
    expect(ttl).toBeLessThanOrEqual(300);
  });

  test("占用尝试次数不会去掉过期时间", async () => {
    await store.save("n3", { qqKey: "q", codeHash: "c" }, 300);
    await store.claimAttempt("n3", "q");

    expect(Number(await (await testRedis()).send("TTL", [`${prefix}n3`]))).toBeGreaterThan(0);
  });

  // 记录过期后还用 HINCRBY 的话，会留下一个没有过期时间的键。
  test("记录不在时占用返回 null，也不会建出新键", async () => {
    expect(await store.claimAttempt("missing", "q")).toBeNull();
    expect(Number(await (await testRedis()).send("EXISTS", [`${prefix}missing`]))).toBe(0);
  });

  test("QQ 号对不上时返回 null，也不占次数", async () => {
    await store.save("n4", { qqKey: "q", codeHash: "c" }, 300);

    expect(await store.claimAttempt("n4", "another")).toBeNull();
    expect(await store.claimAttempt("n4", "q")).toEqual({ codeHash: "c", attempts: 1 });
  });

  // 在比对之前占用次数就是为了这个：并发的请求各拿一个不同的次数，不会有两个请求都以为自己是第 1 次。
  test("10 个并发占用恰好拿到 1 到 10 各一次", async () => {
    await store.save("n5", { qqKey: "q", codeHash: "c" }, 300);

    const claims = await Promise.all(Array.from({ length: 10 }, () => store.claimAttempt("n5", "q")));

    expect(claims.map((claim) => claim?.attempts ?? 0).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
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
