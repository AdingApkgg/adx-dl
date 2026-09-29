import type { RateLimitStore, RedisCommandSender } from "../../middleware/rate-limit";

// 一次发码一条记录，键是 nonce。Redis 里只放 HMAC 和尝试次数（spec 第 9.4 节）。
export type QqCodeStore = {
  /** 按 QQ 号限流：每分钟 1 次、每小时 5 次（spec 第 10.2 节）。放行返回 true。 */
  allowSend(qqKey: string): Promise<boolean>;
  save(nonce: string, record: { qqKey: string; codeHash: string }, ttlSec: number): Promise<void>;
  /**
   * 比对验证码之前先占用一次尝试机会：原子地把尝试次数加 1，返回验证码的 HMAC 和加完后的次数。
   * 记录不在、或者不是发给这个 QQ 号的，返回 null，也不加次数。
   *
   * 必须先占用、再比对。"先比对、比错了才计数"在并发时挡不住暴力猜码：第 5 次错误把记录删掉之前，
   * 同时进来的请求都读得到记录、都会被比对，比对正确的那次根本不计数。先占用的话，每个请求拿到的
   * 次数各不相同，超过上限的一律不比对。
   */
  claimAttempt(nonce: string, qqKey: string): Promise<{ codeHash: string; attempts: number } | null>;
  /** 删除并返回是否真的删掉了：两个请求同时带着正确的验证码进来时，只有一个拿到 true。 */
  consume(nonce: string): Promise<boolean>;
};

// 写入和设过期放在同一段 Lua 里：分两条命令时，进程在中间挂掉会留下一个永不过期的键。
const SAVE_SCRIPT = `
redis.call('HSET', KEYS[1], 'q', ARGV[1], 'c', ARGV[2], 'a', 0)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

// 查记录和加次数放在同一段 Lua 里才是原子的。记录不在时直接返回：记录已经过期还 HINCRBY 的话，
// 会建出一个没有过期时间的新键。QQ 号对不上时也不加次数，什么都不透露（和记录不在一样处理）。
const CLAIM_SCRIPT = `
local q = redis.call('HGET', KEYS[1], 'q')
if not q or q ~= ARGV[1] then return nil end
local attempts = redis.call('HINCRBY', KEYS[1], 'a', 1)
return {redis.call('HGET', KEYS[1], 'c'), attempts}
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
    async claimAttempt(nonce, qqKey) {
      const reply = await options.redis.send("EVAL", [CLAIM_SCRIPT, "1", keyOf(nonce), qqKey]);
      if (!Array.isArray(reply) || reply.length !== 2) {
        return null;
      }
      const [codeHash, reported] = reply;
      const attempts = Number(reported);
      // 回复的形状不对就当作记录不在（失败时关闭）：次数要是 NaN 之类，插件里"超过 5 次"的比较永远不成立，
      // 5 次的上限就形同虚设。
      if (typeof codeHash !== "string" || !Number.isSafeInteger(attempts) || attempts <= 0) {
        return null;
      }
      return { codeHash, attempts };
    },
    async consume(nonce) {
      return Number(await options.redis.send("DEL", [keyOf(nonce)])) === 1;
    },
  };
}
