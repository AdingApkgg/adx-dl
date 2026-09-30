import { beforeAll, describe, expect, test } from "bun:test";
import type { BetterAuthOptions } from "better-auth";
import { eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import { shortId } from "../auth/short-id";
import { account, passkey, profiles, session, user } from "../db/schema";
import { USER_PURGE_QUEUE } from "../jobs/queues";
import { createTestAuth } from "../testing/auth";
import { testSender } from "../testing/test-boss";
import { testDbHandle } from "../testing/test-db";
import {
  cancelDeletion,
  DELETION_COOLING_OFF_MS,
  DELETION_HANDLERS,
  type DeletionHandler,
  purgeUser,
  requestDeletion,
} from "./user-deletion";

let boss: PgBoss;

beforeAll(async () => {
  // testSender 先重建测试库，再建 pg-boss 的表和队列。
  boss = await testSender();
}, 30_000);

function deps(handlers: readonly DeletionHandler[] = []) {
  return { db: testDbHandle().db, boss: async () => boss, handlers };
}

// 一个正常状态的用户：一个 Google 绑定、一个会话、一行 profiles。
async function seedUser() {
  const { db } = testDbHandle();
  const id = shortId();
  await db.insert(user).values({ id, name: "要注销的人", email: `${id}@placeholder.invalid` });
  await db.insert(account).values({ accountId: `g-${crypto.randomUUID()}`, providerId: "google", userId: id });
  await db
    .insert(session)
    .values({ token: `token-${crypto.randomUUID()}`, userId: id, expiresAt: new Date(Date.now() + 86_400_000) });
  await db.insert(profiles).values({ userId: id, bio: "简介" });
  return id;
}

async function userRow(id: string) {
  const [row] = await testDbHandle().db.select().from(user).where(eq(user.id, id));
  return row;
}

async function rowsLeft(id: string) {
  const { db } = testDbHandle();
  return {
    user: await db.$count(user, eq(user.id, id)),
    sessions: await db.$count(session, eq(session.userId, id)),
    accounts: await db.$count(account, eq(account.userId, id)),
    passkeys: await db.$count(passkey, eq(passkey.userId, id)),
    profiles: await db.$count(profiles, eq(profiles.userId, id)),
  };
}

// 把清除时间挪到过去：冷静期到了。
async function makeDue(id: string) {
  await testDbHandle().db.execute(sql`update "user" set deletion_purge_at = now() - interval '1 second' where id = ${id}`);
}

function withContent(name = "charts"): DeletionHandler {
  return { name, hasContent: async () => true, purge: async () => {} };
}

describe("发起注销", () => {
  test("空账号：标记成注销中、清除时间是现在；会话全部撤销；投递一个立即执行的清除任务", async () => {
    const id = await seedUser();
    const before = Date.now();

    const result = await requestDeletion(deps(), id, { deleteContent: false });

    expect(result.status).toBe("requested");
    const purgeAt = result.status === "requested" ? result.purgeAt.getTime() : 0;
    expect(purgeAt).toBeGreaterThanOrEqual(before);
    expect(purgeAt).toBeLessThanOrEqual(Date.now());
    expect(await userRow(id)).toMatchObject({
      status: "pending_deletion",
      deletionRequestedAt: expect.any(Date),
      deletionDeleteContent: false,
    });
    expect((await userRow(id))?.deletionPurgeAt?.getTime()).toBe(purgeAt);
    expect(await rowsLeft(id)).toMatchObject({ user: 1, sessions: 0, accounts: 1, profiles: 1 });
    const jobs = await boss.findJobs(USER_PURGE_QUEUE, { key: id });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ state: "created", data: { userId: id }, singletonKey: id });
    expect(jobs[0]?.startAfter.getTime()).toBe(purgeAt);
  }, 30_000);

  test("有内容的账号：清除时间是 7 天后，记下要不要同时删除内容", async () => {
    const id = await seedUser();
    const before = Date.now();

    const result = await requestDeletion(deps([withContent()]), id, { deleteContent: true });

    const purgeAt = result.status === "requested" ? result.purgeAt.getTime() : 0;
    expect(purgeAt).toBeGreaterThanOrEqual(before + DELETION_COOLING_OFF_MS);
    expect(purgeAt).toBeLessThanOrEqual(Date.now() + DELETION_COOLING_OFF_MS);
    expect(await userRow(id)).toMatchObject({ status: "pending_deletion", deletionDeleteContent: true });
    const [job] = await boss.findJobs(USER_PURGE_QUEUE, { key: id });
    expect(job?.startAfter.getTime()).toBe(purgeAt);
  }, 30_000);

  test("已经在注销中：not_active，什么也不变", async () => {
    const id = await seedUser();
    await requestDeletion(deps([withContent()]), id, { deleteContent: false });
    const before = await userRow(id);

    const again = await requestDeletion(deps(), id, { deleteContent: true });

    expect(again).toEqual({ status: "not_active" });
    expect(await userRow(id)).toEqual(before);
    expect(await boss.findJobs(USER_PURGE_QUEUE, { key: id })).toHaveLength(1);
  }, 30_000);

  // 标记、撤销会话和投递任务在同一个事务里：投递失败时，账号照旧能用、会话都还在。
  test("投递任务失败：整个回滚，账号还是正常状态，会话还在", async () => {
    const id = await seedUser();
    const broken = { send: async () => Promise.reject(new Error("queue is down")) } as unknown as PgBoss;

    await expect(
      requestDeletion({ ...deps(), boss: async () => broken }, id, { deleteContent: false })
    ).rejects.toThrow("queue is down");

    expect(await userRow(id)).toMatchObject({ status: "active", deletionPurgeAt: null });
    expect(await rowsLeft(id)).toMatchObject({ sessions: 1 });
  }, 30_000);

  test("这个用户已经有清除任务在排队（正常流程里不会出现）：conflict，整个回滚", async () => {
    const id = await seedUser();
    await boss.send(USER_PURGE_QUEUE, { userId: id }, { singletonKey: id, startAfter: new Date(Date.now() + 3_600_000) });

    const result = await requestDeletion(deps(), id, { deleteContent: false });

    expect(result).toEqual({ status: "conflict" });
    expect(await userRow(id)).toMatchObject({ status: "active" });
    expect(await rowsLeft(id)).toMatchObject({ sessions: 1 });
  }, 30_000);
});

describe("撤销注销", () => {
  test("冷静期内：恢复正常状态、清空注销的几列，排队中的清除任务被取消", async () => {
    const id = await seedUser();
    await requestDeletion(deps([withContent()]), id, { deleteContent: true });

    expect(await cancelDeletion(deps(), id)).toBe("cancelled");

    expect(await userRow(id)).toMatchObject({
      status: "active",
      deletionRequestedAt: null,
      deletionPurgeAt: null,
      deletionDeleteContent: null,
    });
    const [job] = await boss.findJobs(USER_PURGE_QUEUE, { key: id });
    expect(job?.state).toBe("cancelled");
  }, 30_000);

  // 取消掉的任务不占 singletonKey：撤销以后还能再申请。
  test("撤销以后可以再申请，得到一个新的清除任务", async () => {
    const id = await seedUser();
    await requestDeletion(deps([withContent()]), id, { deleteContent: false });
    await cancelDeletion(deps(), id);

    const again = await requestDeletion(deps([withContent()]), id, { deleteContent: false });

    expect(again.status).toBe("requested");
    const states = (await boss.findJobs(USER_PURGE_QUEUE, { key: id })).map((job) => job.state).sort();
    expect(states).toEqual(["cancelled", "created"]);
  }, 30_000);

  // 到了清除时间，任务可能已经在跑，撤销不了（空账号一申请就到时间了）。
  test("到了清除时间：not_cancellable，还是注销中", async () => {
    const empty = await seedUser();
    await requestDeletion(deps(), empty, { deleteContent: false });
    const due = await seedUser();
    await requestDeletion(deps([withContent()]), due, { deleteContent: false });
    await makeDue(due);

    expect(await cancelDeletion(deps(), empty)).toBe("not_cancellable");
    expect(await cancelDeletion(deps(), due)).toBe("not_cancellable");
    expect((await userRow(empty))?.status).toBe("pending_deletion");
    expect((await userRow(due))?.status).toBe("pending_deletion");
  }, 30_000);

  test("没在注销、用户不存在：not_cancellable", async () => {
    const id = await seedUser();

    expect(await cancelDeletion(deps(), id)).toBe("not_cancellable");
    expect(await cancelDeletion(deps(), shortId())).toBe("not_cancellable");
  }, 30_000);
});

describe("最终清除", () => {
  test("到了清除时间：用户、会话、平台绑定、通行密钥、profiles 全部删掉；再跑一遍什么也不做", async () => {
    const id = await seedUser();
    await testDbHandle()
      .db.insert(passkey)
      .values({
        publicKey: "pk",
        userId: id,
        credentialID: `cred-${crypto.randomUUID()}`,
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
      });
    await requestDeletion(deps(), id, { deleteContent: false });

    expect(await purgeUser(deps(), id)).toBe("purged");
    expect(await rowsLeft(id)).toEqual({ user: 0, sessions: 0, accounts: 0, passkeys: 0, profiles: 0 });
    expect(await purgeUser(deps(), id)).toBe("skipped");
  }, 30_000);

  test("两个清除同时跑：一个清除，另一个等锁之后发现用户已经不在", async () => {
    const id = await seedUser();
    await requestDeletion(deps(), id, { deleteContent: false });

    const results = await Promise.all([purgeUser(deps(), id), purgeUser(deps(), id)]);

    expect(results.sort()).toEqual(["purged", "skipped"]);
    expect(await rowsLeft(id)).toMatchObject({ user: 0 });
  }, 30_000);

  test("冷静期还没到、撤销过、从来没申请过：什么也不做", async () => {
    const waiting = await seedUser();
    await requestDeletion(deps([withContent()]), waiting, { deleteContent: false });
    const cancelled = await seedUser();
    await requestDeletion(deps([withContent()]), cancelled, { deleteContent: false });
    await cancelDeletion(deps(), cancelled);
    const active = await seedUser();

    for (const id of [waiting, cancelled, active]) {
      expect(await purgeUser(deps(), id), id).toBe("skipped");
      expect(await rowsLeft(id), id).toMatchObject({ user: 1, accounts: 1, profiles: 1 });
    }
  }, 30_000);

  // spec 第 13 节：注销处理器的执行顺序。
  test("按注册顺序调用各模块的 purge，传入记下的 deleteContent 和清除的事务", async () => {
    const id = await seedUser();
    const calls: string[] = [];
    const recording = (name: string): DeletionHandler => ({
      name,
      hasContent: async () => true,
      purge: async (userId, { deleteContent }, tx) => {
        // 传进来的必须是清除的事务本身，不能是另开的一个：nowait 的行锁只有已经拿着这一行锁的事务才拿得到，
        // 别的连接会因为清除的事务持有这把锁而立刻报 55P03。普通的 SELECT 不等行锁，读得到还没删掉的行，证明不了这一点。
        const locked = await tx.execute(sql`select 1 from "user" where id = ${userId} for update nowait`);
        calls.push(`${name}:${deleteContent}:${locked.rows.length === 1}`);
      },
    });
    const handlers = [recording("charts"), recording("forum")];
    await requestDeletion(deps(handlers), id, { deleteContent: true });
    await makeDue(id);

    expect(await purgeUser(deps(handlers), id)).toBe("purged");
    expect(calls).toEqual(["charts:true:true", "forum:true:true"]);
  }, 30_000);

  test("某个模块的 purge 出错：整个回滚，用户还在注销中，下次重试时从头再来", async () => {
    const id = await seedUser();
    // 排在出错的模块前面，用清除的事务删掉 profiles 里的这一行：后面的模块出错时，这个删除必须跟着回滚。
    // 要是各模块的 purge 各开各的事务，这一行会先提交、删掉，用户却还在注销中：删了一半的账号。
    const deleted: number[] = [];
    const writing: DeletionHandler = {
      name: "writing",
      hasContent: async () => false,
      purge: async (userId, _options, tx) => {
        const rows = await tx
          .delete(profiles)
          .where(eq(profiles.userId, userId))
          .returning({ userId: profiles.userId });
        deleted.push(rows.length);
      },
    };
    const failing: DeletionHandler = {
      name: "broken",
      hasContent: async () => false,
      purge: async () => {
        throw new Error("storage is down");
      },
    };
    const handlers = [writing, failing];
    await requestDeletion(deps(handlers), id, { deleteContent: false });

    await expect(purgeUser(deps(handlers), id)).rejects.toThrow("storage is down");

    // 删除确实执行过（删掉了一行），但没有留下来。
    expect(deleted).toEqual([1]);
    expect(await userRow(id)).toMatchObject({ status: "pending_deletion" });
    expect(await rowsLeft(id)).toMatchObject({ user: 1, accounts: 1, profiles: 1 });
    expect(await purgeUser(deps(), id)).toBe("purged");
  }, 30_000);

  test("1c 里还没有模块注册处理器", () => {
    expect(DELETION_HANDLERS).toEqual([]);
  });
});

// 最终清除直接删用户行，靠外键把其余的行带走，也靠下面这些前提和 Better Auth 的 internalAdapter.deleteUser 等价。
// 哪条前提变了，这里就失败，逼人回头看 purgeUser。
describe("直接删用户行的前提", () => {
  test("所有指向 user 的外键都是 CASCADE（用户自己的数据）或 SET NULL（内容，spec 第 9.2 节）", async () => {
    const result = await testDbHandle().db.execute<{ tbl: string; action: string }>(
      sql`select conrelid::regclass::text as tbl, confdeltype::text as action
          from pg_constraint where contype = 'f' and confrelid = '"user"'::regclass`
    );

    expect(result.rows.map((row) => row.tbl).sort()).toEqual(
      expect.arrayContaining(["account", "passkey", "profiles", "session"])
    );
    for (const row of result.rows) {
      expect(["c", "n"], row.tbl).toContain(row.action);
    }
  });

  test("Better Auth 没有 secondaryStorage、没有 cookie cache、没有删除相关的钩子", async () => {
    // 按 Better Auth 的通用配置类型来读：createAuth 的推断类型里没有这几项，直接读编译不过。
    const options: BetterAuthOptions = (await createTestAuth().auth.$context).options;

    expect(options.secondaryStorage).toBeUndefined();
    expect(options.session?.cookieCache?.enabled).not.toBe(true);
    for (const model of ["user", "session", "account"] as const) {
      expect(options.databaseHooks?.[model]?.delete, model).toBeUndefined();
    }
  });
});
