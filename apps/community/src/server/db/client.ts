import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type DbHandle = { db: Db; pool: Pool };

// 驱动用 node-postgres，不用 Bun 自带的 SQL 客户端：后者到 1.4.2 为止还会把
// jsonb 参数多编码一次（oven-sh/bun#28819），见 client.test.ts 的守卫测试。
export function createDb(url: string, options: { max?: number } = {}): DbHandle {
  const pool = new Pool({ connectionString: url, max: options.max ?? 10 });
  return { pool, db: drizzle({ client: pool, schema, casing: "snake_case" }) };
}

// 开发时 Vite 每次改动都会重新执行服务端入口；连接池挂在 globalThis 上，
// 避免每次热更新都多开一个池。
const globalForDb = globalThis as typeof globalThis & { __communityDb?: DbHandle };

export function getDb(url: string): DbHandle {
  globalForDb.__communityDb ??= createDb(url);
  return globalForDb.__communityDb;
}

export async function pingDb(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}
