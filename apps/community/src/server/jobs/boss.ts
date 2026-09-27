import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss, type SendOptions } from "pg-boss";

import type { Db } from "../db/client";

export type BossRole = "sender" | "worker" | "migrator";

export const BOSS_SCHEMA = "pgboss";

// 三种角色（spec 第 9.5 节）：
// - sender：网页进程里只负责投递，不跑监督和定时调度，也不自己迁移；
// - worker：执行任务和定时调度；
// - migrator：部署时由 db:migrate 用来建好 pg-boss 自己的表，然后就停掉。
export function createBoss(databaseUrl: string, role: BossRole): PgBoss {
  return new PgBoss({
    connectionString: databaseUrl,
    schema: BOSS_SCHEMA,
    supervise: role === "worker",
    schedule: role === "worker",
    migrate: role !== "sender",
    max: role === "sender" ? 3 : 5,
  });
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
