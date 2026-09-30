import { beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../app";
import { shortId } from "../auth/short-id";
import { testAppDeps } from "../testing/app-deps";
import { createTestAuth, currentUserId, googleProfile, signInWithGoogle } from "../testing/auth";
import { Browser } from "../testing/auth-browser";
import { TEST_PUBLIC_ORIGIN } from "../testing/constants";
import { SoftAuthenticator } from "../testing/soft-authenticator";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import { account, passkey, user } from "./schema";

// 迁移 0003 里触发器报错时用的 SQLSTATE。
const LAST_LOGIN_METHOD_SQLSTATE = "AX001";

beforeAll(async () => {
  await resetTestDatabase();
}, 30_000);

// 直接往库里放一个用户，带 accounts 个平台绑定和 passkeys 个通行密钥。
async function seedUser({ accounts, passkeys }: { accounts: number; passkeys: number }) {
  const { db } = testDbHandle();
  const id = shortId();
  await db.insert(user).values({ id, name: "测试", email: `${id}@placeholder.invalid` });
  const accountIds: string[] = [];
  for (let i = 0; i < accounts; i++) {
    const [row] = await db
      .insert(account)
      .values({ accountId: `g-${crypto.randomUUID()}`, providerId: "google", userId: id })
      .returning({ id: account.id });
    accountIds.push(row?.id ?? "");
  }
  const passkeyIds: string[] = [];
  for (let i = 0; i < passkeys; i++) {
    const [row] = await db
      .insert(passkey)
      .values({
        publicKey: "pk",
        userId: id,
        credentialID: `cred-${crypto.randomUUID()}`,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      })
      .returning({ id: passkey.id });
    passkeyIds.push(row?.id ?? "");
  }
  return { id, accountIds, passkeyIds };
}

async function loginMethodsOf(userId: string): Promise<number> {
  const { db } = testDbHandle();
  return (await db.$count(account, eq(account.userId, userId))) + (await db.$count(passkey, eq(passkey.userId, userId)));
}

// Drizzle 包一层的错误（DrizzleQueryError）把驱动的错误放在 cause 里。
function sqlStateOf(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

async function rejectionOf(promise: PromiseLike<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("应当失败");
}

describe("至少一种登录方式：数据库的兜底", () => {
  test("删掉唯一的平台绑定：提交时报 AX001，绑定还在", async () => {
    const { id, accountIds } = await seedUser({ accounts: 1, passkeys: 0 });

    const error = await rejectionOf(testDbHandle().db.delete(account).where(eq(account.id, accountIds[0] ?? "")));

    expect(sqlStateOf(error)).toBe(LAST_LOGIN_METHOD_SQLSTATE);
    expect(await loginMethodsOf(id)).toBe(1);
  });

  test("还有别的登录方式时照常删；删到最后一个（通行密钥）时报错", async () => {
    const { id, accountIds, passkeyIds } = await seedUser({ accounts: 1, passkeys: 1 });
    const { db } = testDbHandle();

    await db.delete(account).where(eq(account.id, accountIds[0] ?? ""));
    const error = await rejectionOf(db.delete(passkey).where(eq(passkey.id, passkeyIds[0] ?? "")));

    expect(sqlStateOf(error)).toBe(LAST_LOGIN_METHOD_SQLSTATE);
    expect(await loginMethodsOf(id)).toBe(1);
  });

  test("同一个事务里先加一个、再删掉原来的：提交时还有一种，照常提交", async () => {
    const { id, accountIds } = await seedUser({ accounts: 1, passkeys: 0 });

    await testDbHandle().db.transaction(async (tx) => {
      await tx.delete(account).where(eq(account.id, accountIds[0] ?? ""));
      await tx.insert(account).values({ accountId: `qq-${crypto.randomUUID()}`, providerId: "qq", userId: id });
    });

    expect(await loginMethodsOf(id)).toBe(1);
  });

  // 注销的最终清除直接删用户行，绑定和通行密钥跟着级联删除：用户行已经不在了，放行。
  test("删用户行时只剩一种登录方式也照常删掉，绑定和通行密钥一起没了", async () => {
    const { id } = await seedUser({ accounts: 1, passkeys: 0 });
    const other = await seedUser({ accounts: 0, passkeys: 1 });
    const { db } = testDbHandle();

    await db.delete(user).where(eq(user.id, id));
    await db.delete(user).where(eq(user.id, other.id));

    expect(await loginMethodsOf(id)).toBe(0);
    expect(await loginMethodsOf(other.id)).toBe(0);
  });

  // 钩子各自数到 2 的情况：先锁住用户行，让两个请求的删除都做完、都卡在提交时的检查上，再放开。
  // 放开后先提交的那个看得到另一个还没提交的行，通过；后提交的看到两个都删了，报错回滚。
  test("并发的解绑和删通行密钥（各自都数到 2）：只有一个成功，还剩一种登录方式", async () => {
    const app = createApp(testAppDeps({ auth: createTestAuth().auth }).deps);
    const browser = new Browser(app);
    await signInWithGoogle(browser, googleProfile());
    const userId = await currentUserId(browser);
    const options = await browser.request("GET", "/api/auth/passkey/generate-register-options");
    const authn = new SoftAuthenticator(TEST_PUBLIC_ORIGIN, new URL(TEST_PUBLIC_ORIGIN).hostname);
    await browser.request("POST", "/api/auth/passkey/verify-registration", {
      body: { response: await authn.createCredential(options.json) },
    });
    const { db, pool } = testDbHandle();
    const [google] = await db.select().from(account).where(eq(account.userId, userId));
    const [key] = await db.select().from(passkey).where(eq(passkey.userId, userId));
    expect(await loginMethodsOf(userId)).toBe(2);

    const locker = await pool.connect();
    let committed = false;
    let results: { status: number }[];
    try {
      await locker.query("begin");
      await locker.query(`select 1 from "user" where id = $1 for update`, [userId]);
      const requests = Promise.all([
        browser.request("POST", "/api/auth/unlink-account", { body: { accountId: google?.id } }),
        browser.request("POST", "/api/auth/passkey/delete-passkey", { body: { id: key?.id } }),
      ]);
      // 两个删除都在等用户行的锁（提交时的检查），说明钩子的计数都已经过了。
      const deadline = Date.now() + 10_000;
      for (;;) {
        const waiting = await db.execute<{ n: number }>(
          sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
        );
        if ((waiting.rows[0]?.n ?? 0) >= 2) {
          break;
        }
        if (Date.now() > deadline) {
          throw new Error("两个删除没有同时卡在提交时的检查上");
        }
        await Bun.sleep(20);
      }
      await locker.query("commit");
      committed = true;
      results = await requests;
    } finally {
      // 没提交就出错时销毁连接，不放回连接池：否则未提交的事务连同用户行的锁会留在共用的连接池里。
      locker.release(!committed);
    }

    // 失败的那个是 500：Better Auth 把数据库的错误当成服务器错误（它还会在 stderr 打一行 # SERVER_ERROR）。
    // 这种撞车很少见，页面上显示通用的出错提示，刷新后看到剩下的那种登录方式。
    expect(results.map((res) => res.status).sort()).toEqual([200, 500]);
    expect(await loginMethodsOf(userId)).toBe(1);
  }, 30_000);
});
