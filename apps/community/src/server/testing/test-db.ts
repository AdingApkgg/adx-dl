import { fileURLToPath } from "node:url";

import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb, type DbHandle } from "../db/client";
import { testDatabaseUrl } from "./services";

let handle: DbHandle | undefined;

// 测试共用一个连接池：每个测试文件各建一个会留下一堆空闲连接。
export function testDbHandle(): DbHandle {
  handle ??= createDb(testDatabaseUrl(), { max: 5 });
  return handle;
}

let reset: Promise<void> | undefined;

// 每个测试进程第一次用到数据库时重建一次测试库（spec 第 9.6 节）：删掉我们的表、Drizzle 的
// 迁移记录和 pg-boss 的表，再跑一遍迁移，保证测试总是在当前的表结构上跑。同一进程里只做一次，
// 所以各测试文件之间的数据会留着：测试里的用户、QQ 号一律用随机值，不要假设表是空的。
export function resetTestDatabase(): Promise<void> {
  reset ??= (async () => {
    const { db, pool } = createDb(testDatabaseUrl(), { max: 1 });
    try {
      await db.execute(sql`drop schema if exists public cascade`);
      await db.execute(sql`drop schema if exists drizzle cascade`);
      await db.execute(sql`drop schema if exists pgboss cascade`);
      await db.execute(sql`create schema public`);
      await migrate(db, { migrationsFolder: fileURLToPath(new URL("../db/migrations", import.meta.url)) });
    } finally {
      await pool.end();
    }
  })();
  return reset;
}
