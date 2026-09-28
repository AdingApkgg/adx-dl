import type { Context, Env, MiddlewareHandler } from "hono";

import { jsonError } from "../errors";
import { withTimeout } from "../with-timeout";

export type RateLimitHit = { count: number; resetSec: number };

export type RateLimitStore = {
  hit(key: string, windowSec: number): Promise<RateLimitHit>;
};

export type RedisCommandSender = {
  send(command: string, args: string[]): Promise<unknown>;
};

export function createMemoryRateLimitStore(now: () => number = Date.now): RateLimitStore {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, windowSec) {
      const time = now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= time) {
        buckets.set(key, { count: 1, resetAt: time + windowSec * 1000 });
        return { count: 1, resetSec: windowSec };
      }
      bucket.count += 1;
      return { count: bucket.count, resetSec: Math.ceil((bucket.resetAt - time) / 1000) };
    },
  };
}

// INCR 和 EXPIRE 放进同一段 Lua 里原子执行：分两条命令时，进程在两条之间挂掉
// 会留下一个没有过期时间的计数，这个 IP 就被永久限流了。ttl < 0 也顺手补上过期时间。
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

export function createRedisRateLimitStore(redis: RedisCommandSender): RateLimitStore {
  return {
    async hit(key, windowSec) {
      const reply = await redis.send("EVAL", [HIT_SCRIPT, "1", key, String(windowSec)]);
      if (!Array.isArray(reply) || reply.length !== 2) {
        throw new Error("unexpected rate limit reply");
      }
      return { count: Number(reply[0]), resetSec: Number(reply[1]) };
    },
  };
}

export type RateLimitOptions<E extends Env> = {
  store: RateLimitStore;
  /** 规则名，拼进计数的 key，不同规则互不影响。 */
  name: string;
  limit: number;
  windowSec: number;
  /** 按什么计数（IP、用户 id……）。返回 null 表示这次不限流。 */
  key: (c: Context<E>) => string | null;
  onStoreError?: (error: unknown) => void;
};

// 计数存储最多等这么久。服务端渲染时 loader 调的接口也要过限流，Redis 卡住时
// 页面不能跟着卡住，超时和出错一样放行。
const STORE_TIMEOUT_MS = 250;

export function rateLimit<E extends Env>(options: RateLimitOptions<E>): MiddlewareHandler<E> {
  return async (c, next) => {
    const id = options.key(c);
    if (!id) {
      await next();
      return;
    }

    let hit: RateLimitHit;
    try {
      hit = await withTimeout(options.store.hit(`rl:${options.name}:${id}`, options.windowSec), STORE_TIMEOUT_MS);
    } catch (error) {
      options.onStoreError?.(error);
      await next();
      return;
    }

    if (hit.count > options.limit) {
      c.header("Retry-After", String(Math.max(hit.resetSec, 1)));
      return jsonError(c, 429, "RATE_LIMITED", "Too many requests");
    }
    await next();
  };
}
