import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { describeError } from "@/shared/describe-error";
import { createLogger } from "@/shared/log";

import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type DbHandle = { db: Db; pool: Pool };

export type DbOptions = {
  max?: number;
  /** 空闲连接出错（Postgres 重启、网络断开）时调用。不传就写一行 JSON 日志到 stderr。 */
  onPoolError?: (error: Error) => void;
};

const stderrLog = createLogger((line) => console.error(line));

// 驱动用 node-postgres，不用 Bun 自带的 SQL 客户端：后者到 1.4.2 为止还会把
// jsonb 参数多编码一次（oven-sh/bun#28819），见 client.test.ts 的守卫测试。
export function createDb(url: string, options: DbOptions = {}): DbHandle {
  // pg 默认没有连接超时：Postgres 不回应时，请求会一直挂着。
  const pool = new Pool({ connectionString: url, max: options.max ?? 10, connectionTimeoutMillis: 5000 });
  // 空闲连接断开时 pg 在连接池上发 error 事件，没人监听进程就直接退出。
  // 连接池会丢掉这个连接，下次查询时新建，这里只需要记下来。
  pool.on("error", options.onPoolError ?? ((error) => stderrLog.error("pg_pool_error", describeError(error))));
  return { pool, db: drizzle({ client: pool, schema, casing: "snake_case" }) };
}

// 开发时 Vite 每次改动都会重新执行服务端入口；连接池挂在 globalThis 上，
// 避免每次热更新都多开一个池。
const globalForDb = globalThis as typeof globalThis & { __communityDb?: DbHandle };

export function getDb(url: string, options?: DbOptions): DbHandle {
  globalForDb.__communityDb ??= createDb(url, options);
  return globalForDb.__communityDb;
}

export async function pingDb(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}
