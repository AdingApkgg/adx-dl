import { RedisClient } from "bun";

import type { RedisCommandSender } from "../middleware/rate-limit";

export function createRedis(url: string): RedisClient {
  return new RedisClient(url);
}

// 和数据库连接池一样挂在 globalThis 上，开发时热更新不会重复建连接。
const globalForRedis = globalThis as typeof globalThis & { __communityRedis?: RedisClient };

export function getRedis(url: string): RedisClient {
  globalForRedis.__communityRedis ??= createRedis(url);
  return globalForRedis.__communityRedis;
}

export async function pingRedis(redis: RedisCommandSender): Promise<void> {
  const reply = await redis.send("PING", []);
  if (reply !== "PONG") {
    throw new Error(`unexpected PING reply: ${String(reply)}`);
  }
}
