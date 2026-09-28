import { parseEnv } from "@/server/env";
import { createBoss } from "@/server/jobs/boss";
import { createOneBotClient } from "@/server/napcat/client";
import { recordNapcatHealth } from "@/server/napcat/health";
import { connectRedis, getRedis } from "@/server/redis/client";
import { createLogger } from "@/shared/log";

import { startNapcatEvents } from "./napcat-events";
import { ensureQueues, NAPCAT_HEALTH_QUEUE, QUEUES } from "./queues";

const env = parseEnv(process.env);
const log = createLogger();
const boss = createBoss(env.databaseUrl, "worker");
const redis = getRedis(env.redisUrl);

// 必须在 start() 之前注册，否则启动阶段的错误没人接。
boss.on("error", (error) => log.error("pgboss_error", { message: error.message }));

await connectRedis(redis, log);
await boss.start();
await ensureQueues(boss);

let napcatEvents: { stop(): void } | null = null;
if (env.qq.sender === "napcat") {
  const napcat = createOneBotClient({ httpUrl: env.qq.httpUrl, accessToken: env.qq.accessToken });
  await boss.work(NAPCAT_HEALTH_QUEUE, async () => {
    await recordNapcatHealth(napcat, redis);
  });
  await boss.schedule(NAPCAT_HEALTH_QUEUE, "* * * * *");
  // spec 第 10.3 节：收到加好友申请就自动通过，之后才能私聊发验证码。
  napcatEvents = startNapcatEvents({
    wsUrl: env.qq.wsUrl,
    accessToken: env.qq.accessToken,
    log,
    onFriendRequest: (flag) => napcat.setFriendAddRequest(flag, true),
  });
} else {
  // 控制台发送器不需要机器人；以前用 napcat 时留下的定时任务一并取消。
  await boss.unschedule(NAPCAT_HEALTH_QUEUE);
}

log.info("worker_started", { queues: QUEUES.length, qqSender: env.qq.sender });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) {
    return;
  }
  stopping = true;
  log.info("worker_stopping", { signal });
  napcatEvents?.stop();
  // graceful：等正在执行的任务做完，最多 30 秒。
  await boss.stop({ graceful: true, timeout: 30_000 });
  redis.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
