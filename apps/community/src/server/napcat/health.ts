import type { RedisCommandSender } from "../middleware/rate-limit";
import type { OneBotClient } from "./client";

/** online：可以用；offline：NapCat 活着但 QQ 掉线；unreachable：连不上 NapCat。 */
export type NapcatState = "online" | "offline" | "unreachable";

export const NAPCAT_HEALTH_KEY = "napcat:health";

// 只信 get_status 的 online：QQ 掉线时它照常返回 200，只是 online 变成 false（调研报告第 2.4 节）。
export async function checkNapcat(client: OneBotClient): Promise<NapcatState> {
  try {
    return (await client.getStatus({ timeoutMs: 5000 })).online ? "online" : "offline";
  } catch {
    return "unreachable";
  }
}

// worker 每分钟写一次，3 分钟过期：worker 停了以后，登录页不会一直按过时的状态显示。
export async function writeNapcatHealth(
  redis: RedisCommandSender,
  state: NapcatState,
  key = NAPCAT_HEALTH_KEY
): Promise<void> {
  await redis.send("SET", [key, JSON.stringify({ state, checkedAt: new Date().toISOString() }), "EX", "180"]);
}

export async function readNapcatHealth(redis: RedisCommandSender, key = NAPCAT_HEALTH_KEY): Promise<NapcatState | null> {
  const raw = await redis.send("GET", [key]);
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const state = (JSON.parse(raw) as { state?: unknown }).state;
    return state === "online" || state === "offline" || state === "unreachable" ? state : null;
  } catch {
    return null;
  }
}

/** napcat.health 任务的内容：检查一次，写进 Redis。 */
export async function recordNapcatHealth(
  client: OneBotClient,
  redis: RedisCommandSender,
  key = NAPCAT_HEALTH_KEY
): Promise<void> {
  await writeNapcatHealth(redis, await checkNapcat(client), key);
}
