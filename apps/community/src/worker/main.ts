import { parseEnv } from "@/server/env";
import { createBoss } from "@/server/jobs/boss";
import { createLogger } from "@/server/log";

import { ensureQueues, QUEUES } from "./queues";

const env = parseEnv(process.env);
const log = createLogger();
const boss = createBoss(env.databaseUrl, "worker");

// 必须在 start() 之前注册，否则启动阶段的错误没人接。
boss.on("error", (error) => log.error("pgboss_error", { message: error.message }));

await boss.start();
await ensureQueues(boss);
log.info("worker_started", { queues: QUEUES.length });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) {
    return;
  }
  stopping = true;
  log.info("worker_stopping", { signal });
  // graceful：等正在执行的任务做完，最多 30 秒。
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
