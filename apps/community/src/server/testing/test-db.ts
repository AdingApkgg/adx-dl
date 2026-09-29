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

// 重建会删掉整个库里的 public、drizzle、pgboss 三个 schema，只能对专用的测试库做：开发库 community 和
// 测试库 community_test 在同一个 PG 上，TEST_DATABASE_URL 写错一个字就会清空开发库。库名不以 _test
// 结尾（或者地址里没写库名）就拒绝。报错里只带库名，不带整个地址（里面有密码）。
export function assertTestDatabaseUrl(url: string): void {
  let name = "";
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    // 解析不了就当没写库名，下面照样拒绝。
  }
  if (!name.endsWith("_test")) {
    throw new Error(
      `refusing to reset database "${name}": TEST_DATABASE_URL must point at a dedicated test database whose name ends with _test`
    );
  }
}

// 每个测试进程第一次用到数据库时重建一次测试库（spec 第 9.6 节）：删掉我们的表、Drizzle 的
// 迁移记录和 pg-boss 的表，再跑一遍迁移，保证测试总是在当前的表结构上跑。同一进程里只做一次，
// 所以各测试文件之间的数据会留着：测试里的用户、QQ 号一律用随机值，不要假设表是空的。
export function resetTestDatabase(): Promise<void> {
  reset ??= (async () => {
    assertTestDatabaseUrl(testDatabaseUrl());
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
