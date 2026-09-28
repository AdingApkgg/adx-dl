import { beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { shortId } from "../auth/short-id";
import { passkey, session, user } from "../db/schema";
import { resetTestDatabase, testDbHandle } from "./test-db";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeAll(async () => {
  await resetTestDatabase();
}, 30_000);

describe("Better Auth 的表", () => {
  test("五张表都在", async () => {
    const result = await testDbHandle().db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`
    );
    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining(["user", "session", "account", "verification", "passkey"])
    );
  });

  test("会话的 id 由数据库生成，是 v7 uuid；删用户时会话和通行密钥级联删除", async () => {
    const { db } = testDbHandle();
    const id = shortId();
    await db.insert(user).values({ id, name: "测试", email: `${id}@placeholder.invalid` });
    const [row] = await db
      .insert(session)
      .values({ token: `token-${crypto.randomUUID()}`, userId: id, expiresAt: new Date(Date.now() + 60_000) })
      .returning({ id: session.id });
    await db.insert(passkey).values({
      publicKey: "pk",
      userId: id,
      credentialID: `cred-${crypto.randomUUID()}`,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    });

    expect(row?.id).toMatch(UUID_V7);

    await db.delete(user).where(eq(user.id, id));
    expect(await db.select().from(session).where(eq(session.userId, id))).toEqual([]);
    expect(await db.select().from(passkey).where(eq(passkey.userId, id))).toEqual([]);
  });

  test("同一个平台账号只能绑一次", async () => {
    const { db } = testDbHandle();
    const [first, second] = [shortId(), shortId()];
    for (const id of [first, second]) {
      await db.insert(user).values({ id, name: "测试", email: `${id}@placeholder.invalid` });
    }
    const qq = String(10_000 + Math.floor(Math.random() * 1e9));
    await db.execute(
      sql`insert into account (account_id, provider_id, user_id) values (${qq}, 'qq', ${first})`
    );
    // db.execute() 返回 drizzle 自己的 PgRaw（thenable 但不是 Promise 的实例），Bun 的
    // expect().rejects 认不出来会直接报 "Expected promise"；包一层 Promise.resolve 转成
    // 真正的 Promise。手工验证过：不包的话，重复插入照样在数据库层面报 23505，只是断言本身失败。
    await expect(
      Promise.resolve(
        db.execute(sql`insert into account (account_id, provider_id, user_id) values (${qq}, 'qq', ${second})`)
      )
    ).rejects.toThrow();
  });
});
