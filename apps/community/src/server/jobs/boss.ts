import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss, type SendOptions } from "pg-boss";

import type { Db } from "../db/client";

export type BossRole = "sender" | "worker" | "migrator";

export const BOSS_SCHEMA = "pgboss";

// 三种角色（spec 第 9.5 节）：
// - sender：网页进程里只负责投递，不跑监督和定时调度，也不自己迁移；
// - worker：执行任务和定时调度；
// - migrator：部署时由 db:migrate 用来建好 pg-boss 自己的表和队列，然后就停掉。
export function createBoss(databaseUrl: string, role: BossRole): PgBoss {
  return new PgBoss({
    connectionString: databaseUrl,
    schema: BOSS_SCHEMA,
    // 不设的话三种角色的连接都叫 pgboss，pg_stat_activity 里分不清是哪个进程的。
    application_name: `community-${role}`,
    supervise: role === "worker",
    schedule: role === "worker",
    migrate: role !== "sender",
    max: role === "sender" ? 3 : 5,
  });
}

const globalForSender = globalThis as typeof globalThis & { __communitySender?: Promise<PgBoss> };

// 网页进程的发送端：第一次用到时才启动，之后一直用同一个。send() 之前必须 start()，哪怕是在事务里投递：
// send 要先读队列的元数据，缓存里没有就用它自己的连接池去查。挂在 globalThis 上：开发时 Vite 每次热更新
// 都会重新执行服务端入口，不挂的话每次都多开一个连接池和两个定时器（getDb 同理）。
// 启动失败不缓存（比如迁移还没跑、PG 暂时连不上）：下次用到时再试，和 Redis 连不上时照常启动一个道理。
export function getSender(databaseUrl: string, onError: (error: Error) => void): Promise<PgBoss> {
  globalForSender.__communitySender ??= (async () => {
    const boss = createBoss(databaseUrl, "sender");
    // 必须在 start() 之前：没人监听的 error 事件会让进程崩掉（队列缓存每 60 秒刷新一次，PG 重启时会失败）。
    boss.on("error", onError);
    try {
      await boss.start();
    } catch (error) {
      // start() 失败时连接池已经开了，要 stop 才会关。
      await boss.stop({ graceful: false, timeout: 1000 }).catch(() => {});
      delete globalForSender.__communitySender;
      throw error;
    }
    return boss;
  })();
  return globalForSender.__communitySender;
}

// 进程退出前调用（优雅停机时在途请求都已经结束，不会再有事务里的投递）。
export async function stopSender(): Promise<void> {
  const pending = globalForSender.__communitySender;
  if (!pending) {
    return;
  }
  delete globalForSender.__communitySender;
  const boss = await pending.catch(() => null);
  await boss?.stop({ graceful: false, timeout: 1000 });
}

/** /readyz 的 jobs 检查：迁移没跑、队列没建时抛错，部署脚本轮询 /readyz 时就能看到。 */
export async function assertQueueExists(boss: PgBoss, name: string): Promise<void> {
  if (!(await boss.getQueue(name))) {
    throw new Error(`queue ${name} is missing`);
  }
}

export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

// 任务和业务数据写在同一个事务里：事务回滚，任务也不存在（选 pg-boss 的理由，spec 第 2.3 节）。
export function enqueueInTx(
  boss: PgBoss,
  tx: DbTransaction,
  name: string,
  data: object,
  options: SendOptions = {}
): Promise<string | null> {
  return boss.send(name, data, { ...options, db: fromDrizzle(tx, sql) });
}
