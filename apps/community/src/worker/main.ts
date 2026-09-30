import { createDb } from "@/server/db/client";
import { parseEnv } from "@/server/env";
import { createBoss } from "@/server/jobs/boss";
import {
  ensureQueues,
  NAPCAT_HEALTH_QUEUE,
  QUEUES,
  SESSION_CLEANUP_QUEUE,
  USER_PURGE_QUEUE,
  USER_PURGE_SWEEP_QUEUE,
  type UserPurgeData,
} from "@/server/jobs/queues";
import { createOneBotClient } from "@/server/napcat/client";
import { recordNapcatHealth } from "@/server/napcat/health";
import { connectRedis, getRedis } from "@/server/redis/client";
import { DELETION_HANDLERS } from "@/server/services/user-deletion";
import { describeError } from "@/shared/describe-error";
import { createLogger } from "@/shared/log";

import { startNapcatEvents } from "./napcat-events";
import { createUserPurgeHandler } from "./purge";
import { PURGE_SWEEP_CRON, PURGE_SWEEP_TZ, runPurgeSweep } from "./purge-sweep";
import { runSessionCleanup, SESSION_CLEANUP_CRON, SESSION_CLEANUP_TZ } from "./session-cleanup";

const env = parseEnv(process.env);
const log = createLogger();
const boss = createBoss(env.databaseUrl, "worker");
const redis = getRedis(env.redisUrl);
const { db, pool } = createDb(env.databaseUrl, {
  onPoolError: (error) => log.error("pg_pool_error", describeError(error)),
});

// 必须在 start() 之前注册，否则启动阶段的错误没人接。
// 经 describeError 记：数据库错误的 message 可能带着参数值。
boss.on("error", (error) => log.error("pgboss_error", describeError(error)));

await connectRedis(redis, log);
await boss.start();
// 部署时 db:migrate 已经建过；再调一次无害（幂等），开发库在加了新队列之后没重跑 db:migrate 时也能补上。
await ensureQueues(boss);

// 注销的最终清除（spec 第 10.6 节）、每天的补投和过期行清理，都和有没有 QQ 机器人无关。
await boss.work<UserPurgeData>(USER_PURGE_QUEUE, createUserPurgeHandler({ db, handlers: DELETION_HANDLERS, log }));
await boss.work(USER_PURGE_SWEEP_QUEUE, async () => {
  await runPurgeSweep({ db, boss, log });
});
await boss.work(SESSION_CLEANUP_QUEUE, async () => {
  await runSessionCleanup({ db, log });
});
// schedule 按（队列，key）更新，每次启动都调一遍没问题。missed: "once"：worker 停着的时候错过了，起来后补跑一次。
await boss.schedule(USER_PURGE_SWEEP_QUEUE, PURGE_SWEEP_CRON, {}, { tz: PURGE_SWEEP_TZ, missed: "once" });
await boss.schedule(SESSION_CLEANUP_QUEUE, SESSION_CLEANUP_CRON, {}, { tz: SESSION_CLEANUP_TZ, missed: "once" });

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
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
