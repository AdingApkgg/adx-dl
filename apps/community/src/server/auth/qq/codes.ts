import type { RateLimitStore, RedisCommandSender } from "../../middleware/rate-limit";

/** 一次发码。Redis 里只放 HMAC 和尝试次数（spec 第 9.4 节）。 */
export type QqCodeRecord = { qqKey: string; codeHash: string; attempts: number };

export type QqCodeStore = {
  /** 按 QQ 号限流：每分钟 1 次、每小时 5 次（spec 第 10.2 节）。放行返回 true。 */
  allowSend(qqKey: string): Promise<boolean>;
  save(nonce: string, record: { qqKey: string; codeHash: string }, ttlSec: number): Promise<void>;
  get(nonce: string): Promise<QqCodeRecord | null>;
  /** 尝试次数加 1，返回加完后的次数；记录已经不在了返回 null。 */
  incrementAttempts(nonce: string): Promise<number | null>;
  /** 删除并返回是否真的删掉了：两个请求同时带着正确的验证码进来时，只有一个拿到 true。 */
  consume(nonce: string): Promise<boolean>;
};

// 写入和设过期放在同一段 Lua 里：分两条命令时，进程在中间挂掉会留下一个永不过期的键。
const SAVE_SCRIPT = `
redis.call('HSET', KEYS[1], 'q', ARGV[1], 'c', ARGV[2], 'a', 0)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

// 记录已经过期时不能直接 HINCRBY：它会建一个没有过期时间的新键。
const INCREMENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
return redis.call('HINCRBY', KEYS[1], 'a', 1)
`;

export function createRedisQqCodeStore(options: {
  redis: RedisCommandSender;
  limits: RateLimitStore;
  prefix?: string;
}): QqCodeStore {
  const prefix = options.prefix ?? "qq:code:";
  const keyOf = (nonce: string) => `${prefix}${nonce}`;

  return {
    async allowSend(qqKey) {
      // 先看每分钟的：被它拦下时不去占每小时的额度。
      const minute = await options.limits.hit(`rl:qq-send-1m:${qqKey}`, 60);
      if (minute.count > 1) {
        return false;
      }
      const hour = await options.limits.hit(`rl:qq-send-1h:${qqKey}`, 3600);
      return hour.count <= 5;
    },
    async save(nonce, record, ttlSec) {
      await options.redis.send("EVAL", [SAVE_SCRIPT, "1", keyOf(nonce), record.qqKey, record.codeHash, String(ttlSec)]);
    },
    async get(nonce) {
      const reply = await options.redis.send("HMGET", [keyOf(nonce), "q", "c", "a"]);
      if (!Array.isArray(reply)) {
        return null;
      }
      const [qqKey, codeHash, attempts] = reply;
      if (typeof qqKey !== "string" || typeof codeHash !== "string") {
        return null;
      }
      return { qqKey, codeHash, attempts: Number(attempts ?? 0) };
    },
    async incrementAttempts(nonce) {
      const reply = Number(await options.redis.send("EVAL", [INCREMENT_SCRIPT, "1", keyOf(nonce)]));
      return reply < 0 ? null : reply;
    },
    async consume(nonce) {
      return Number(await options.redis.send("DEL", [keyOf(nonce)])) === 1;
    },
  };
}
