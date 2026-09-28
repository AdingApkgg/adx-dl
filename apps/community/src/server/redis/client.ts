import { RedisClient } from "bun";

import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

import type { RedisCommandSender } from "../middleware/rate-limit";
import { withTimeout } from "../with-timeout";

// Bun 的默认值在 Redis 宕机时有两个坑：命令排进离线队列，约 31 秒后才失败，
// 页面就跟着一直等；重连 20 次失败后客户端永久失效，Redis 恢复了也连不回去，
// 限流从此关掉。所以不排队（断线时命令立刻失败，限流按出错放行），并且一直重连。
// maxRetries 是 u32，2^32 - 1 是 Bun 接受的最大值（Number.MAX_SAFE_INTEGER 会直接报错）；
// 退避封顶 2 秒，等于永远重连。
export function createRedis(url: string): RedisClient {
  return new RedisClient(url, { enableOfflineQueue: false, maxRetries: 2 ** 32 - 1 });
}

// 和数据库连接池一样挂在 globalThis 上，开发时热更新不会重复建连接。
const globalForRedis = globalThis as typeof globalThis & { __communityRedis?: RedisClient };

export function getRedis(url: string): RedisClient {
  globalForRedis.__communityRedis ??= createRedis(url);
  return globalForRedis.__communityRedis;
}

// 命令不排队，还没连上时发的命令会直接失败，所以启动时先连上。连不上也照常启动：
// 限流放行，/readyz 报告 redis 失败。Redis 不在时 connect() 会一直重连、不返回，
// 所以只等 timeoutMs；它在后台接着连，Redis 起来后自己连上。
export async function connectRedis(redis: RedisClient, log: Logger, timeoutMs = 2000): Promise<void> {
  try {
    await withTimeout(redis.connect(), timeoutMs);
  } catch (error) {
    log.error("redis_connect_failed", describeError(error));
  }
}

export async function pingRedis(redis: RedisCommandSender): Promise<void> {
  const reply = await redis.send("PING", []);
  if (reply !== "PONG") {
    throw new Error(`unexpected PING reply: ${String(reply)}`);
  }
}
