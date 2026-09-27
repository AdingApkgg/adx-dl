import { afterAll, describe, test } from "bun:test";

import { testRedisUrl } from "../testing/services";
import { createRedis, pingRedis } from "./client";

const redis = createRedis(testRedisUrl());

afterAll(() => {
  redis.close();
});

describe("Redis 连接", () => {
  test("pingRedis 成功", async () => {
    await pingRedis(redis);
  });
});
