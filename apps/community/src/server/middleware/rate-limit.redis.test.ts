import { afterAll, describe, expect, test } from "bun:test";

import { createRedis } from "../redis/client";
import { testRedisUrl } from "../testing/services";
import { createRedisRateLimitStore } from "./rate-limit";

const redis = createRedis(testRedisUrl());
const store = createRedisRateLimitStore(redis);
const key = `test:rl:${crypto.randomUUID()}`;

afterAll(async () => {
  await redis.del(key);
  redis.close();
});

describe("createRedisRateLimitStore", () => {
  test("计数原子递增，并且带过期时间", async () => {
    expect((await store.hit(key, 30)).count).toBe(1);
    expect((await store.hit(key, 30)).count).toBe(2);
    const third = await store.hit(key, 30);

    expect(third.count).toBe(3);
    expect(third.resetSec).toBeGreaterThan(0);
    expect(third.resetSec).toBeLessThanOrEqual(30);
    expect(await redis.ttl(key)).toBeGreaterThan(0);
  });
});
