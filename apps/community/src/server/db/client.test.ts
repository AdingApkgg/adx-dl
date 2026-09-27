import { afterAll, describe, expect, test } from "bun:test";
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
