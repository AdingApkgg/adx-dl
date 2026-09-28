import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createLogger } from "@/shared/log";

import { startFakeRedis, unusedPort } from "../testing/fake-redis";
import { testRedisUrl } from "../testing/services";
import { connectRedis, createRedis, pingRedis } from "./client";

const redis = createRedis(testRedisUrl());

// 命令不排队，没连上之前发的命令会直接失败，所以先连上。
beforeAll(async () => {
  await redis.connect();
});

afterAll(() => {
  redis.close();
});

// 限定时间内 promise 的结局；到时还没结束就是 "pending"。
function outcomeWithin(promise: Promise<unknown>, ms: number): Promise<"resolved" | "rejected" | "pending"> {
  return Promise.race([
    promise.then(
      () => "resolved" as const,
      () => "rejected" as const
    ),
    Bun.sleep(ms).then(() => "pending" as const),
  ]);
}

async function eventually(check: () => Promise<unknown> | unknown, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
    }
    await Bun.sleep(50);
  }
}

describe("Redis 连接", () => {
  test("pingRedis 成功", async () => {
    await pingRedis(redis);
  });

  // Bun 默认把断线期间的命令排进队列，约 31 秒后才失败，页面就跟着一直等；
  // 重连 20 次都失败后客户端永久失效，Redis 恢复了也连不回去。
  test("Redis 断开时命令立刻失败，恢复后自己连回去", async () => {
    const fake = startFakeRedis();
    const client = createRedis(fake.url);
    let back: ReturnType<typeof startFakeRedis> | undefined;
    try {
      await client.connect();
      await pingRedis(client);

      fake.stop();
      await eventually(() => expect(client.connected).toBe(false), 2000);
      expect(await outcomeWithin(pingRedis(client), 500)).toBe("rejected");

      back = startFakeRedis(fake.port);
      await eventually(() => pingRedis(client), 5000);
    } finally {
      client.close();
      back?.stop();
    }
  }, 10_000);

  // Redis 没起来时 connect() 一直重试、不会返回，网页进程不能因此起不来。
  test("启动时 Redis 连不上：connectRedis 限时返回并记日志，Redis 起来后自己连上", async () => {
    const port = unusedPort();
    const client = createRedis(`redis://127.0.0.1:${port}`);
    const lines: string[] = [];
    let fake: ReturnType<typeof startFakeRedis> | undefined;
    try {
      const started = performance.now();
      await connectRedis(client, createLogger((line) => lines.push(line)), 200);

      expect(performance.now() - started).toBeLessThan(1000);
      expect(lines.map((line) => JSON.parse(line).event)).toEqual(["redis_connect_failed"]);

      fake = startFakeRedis(port);
      await eventually(() => pingRedis(client), 5000);
    } finally {
      client.close();
      fake?.stop();
    }
  }, 10_000);
});
