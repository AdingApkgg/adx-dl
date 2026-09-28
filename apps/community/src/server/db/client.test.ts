import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { sql } from "drizzle-orm";
import { jsonb, pgTable } from "drizzle-orm/pg-core";

import { testDatabaseUrl } from "../testing/services";
import { createDb, pingDb } from "./client";

const { db, pool } = createDb(testDatabaseUrl(), { max: 5 });

afterAll(async () => {
  await pool.end();
});

describe("数据库连接", () => {
  test("pingDb 成功", async () => {
    await pingDb(db);
  });

  test("50 条查询并发执行，各自拿到自己的结果", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        db.execute<{ n: number }>(sql`select ${i}::int as n, pg_sleep(0.01)`)
      )
    );
    expect(results.map((result) => result.rows[0]?.n)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  test("10 个事务并发执行，互不串", async () => {
    const values = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        db.transaction(async (tx) => {
          const result = await tx.execute<{ v: number }>(sql`select ${i}::int as v, pg_sleep(0.01)`);
          return result.rows[0]?.v;
        })
      )
    );
    expect(values).toEqual(Array.from({ length: 10 }, (_, i) => i));
  });

  // 守的是 oven-sh/bun#28819 那类问题：jsonb 被多编码一次，存成了 JSON 字符串。
  // 换驱动或升级依赖后这条必须仍然通过。
  test("jsonb 字段存进去的是对象，不是 JSON 字符串", async () => {
    const probe = pgTable("jsonb_probe", { doc: jsonb("doc") });

    const kind = await db.transaction(async (tx) => {
      await tx.execute(sql`create temp table jsonb_probe (doc jsonb) on commit drop`);
      await tx.insert(probe).values({ doc: { a: 1 } });
      const result = await tx.execute<{ kind: string }>(sql`select jsonb_typeof(doc) as kind from jsonb_probe`);
      return result.rows[0]?.kind;
    });

    expect(kind).toBe("object");
  });
});

// 这几条不连数据库：建连接池时不会马上连接。
const UNREACHABLE_URL = "postgres://community:community@127.0.0.1:1/none";

describe("连接池出错", () => {
  // Postgres 重启或网络断开时，pg 把空闲连接的错误转发到连接池的 error 事件上；
  // 没人监听，Bun 进程直接退出。
  test("error 事件交给 onPoolError，不会抛出", async () => {
    const errors: Error[] = [];
    const handle = createDb(UNREACHABLE_URL, { onPoolError: (error) => errors.push(error) });
    const error = new Error("terminating connection due to administrator command");

    expect(handle.pool.listenerCount("error")).toBeGreaterThan(0);
    expect(() => handle.pool.emit("error", error)).not.toThrow();
    expect(errors).toEqual([error]);
    await handle.pool.end();
  });

  test("没传 onPoolError 时写一行 JSON 到 console.error", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const handle = createDb(UNREACHABLE_URL);
      expect(() => handle.pool.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({
        level: "error",
        event: "pg_pool_error",
        message: "Connection terminated unexpectedly",
      });
      await handle.pool.end();
    } finally {
      spy.mockRestore();
    }
  });

  // pg 默认没有连接超时：Postgres 不回应时，请求就一直挂着。
  test("连接超时 5 秒", async () => {
    const { pool } = createDb(UNREACHABLE_URL);
    expect(pool.options.connectionTimeoutMillis).toBe(5000);
    await pool.end();
  });
});
