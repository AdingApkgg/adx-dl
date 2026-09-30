import { and, eq, sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss } from "pg-boss";

import type { Db } from "../db/client";
import { profiles, session, user } from "../db/schema";
import { type DbTransaction, enqueueInTx } from "../jobs/boss";
import { USER_PURGE_QUEUE, type UserPurgeData } from "../jobs/queues";

/**
 * 注销处理器（spec 第 10.6 节）：每个存了用户数据的模块提供一个，加进下面的 DELETION_HANDLERS。
 * - hasContent：这个用户在本模块有没有内容。任何一个模块有，注销就要走 7 天冷静期。
 * - purge：最终清除时调用，跑在清除的事务里（tx）。deleteContent 为 false 时内容匿名保留（作者列的外键是
 *   ON DELETE SET NULL，删用户行时自动置空，通常什么也不用做）；为 true 时删掉。必须能重复执行：
 *   事务回滚后任务会重试，同一个用户可能被清除好几次。
 */
export type DeletionHandler = {
  name: string;
  hasContent(userId: string, db: Db): Promise<boolean>;
  purge(userId: string, options: { deleteContent: boolean }, tx: DbTransaction): Promise<void>;
};

/** 各模块的注销处理器，清除时按这个顺序调用。子项目 1 还没有模块注册，所有账号都按空账号处理。 */
export const DELETION_HANDLERS: readonly DeletionHandler[] = [];

/** 有内容的账号的冷静期。 */
export const DELETION_COOLING_OFF_MS = 7 * 24 * 60 * 60 * 1000;

export type DeletionDeps = {
  db: Db;
  boss: () => Promise<PgBoss>;
  handlers: readonly DeletionHandler[];
};

export type RequestDeletionResult =
  | { status: "requested"; purgeAt: Date }
  /** 账号已经不是正常状态（已经在注销中，或者已经删掉了）。 */
  | { status: "not_active" }
  /** 这个用户已经有一个清除任务在排队、重试或执行（正常流程里不会出现）。 */
  | { status: "conflict" };

class PurgeAlreadyQueued extends Error {}

// 发起注销（spec 第 10.6 节）。空账号和有内容的账号走同一条路：都标记成"注销中"，只是清除时间不同
// （空账号是现在，有内容的是 7 天后）。这样清除任务只认一条规则："注销中并且到了清除时间"。
export async function requestDeletion(
  deps: DeletionDeps,
  userId: string,
  options: { deleteContent: boolean }
): Promise<RequestDeletionResult> {
  // 在开事务之前拿到发送端：它第一次启动时可能要等连接，不能占着一个数据库连接等。
  const boss = await deps.boss();
  const contents = await Promise.all(deps.handlers.map((handler) => handler.hasContent(userId, deps.db)));
  const now = Date.now();
  // 同一个值既写进 deletion_purge_at，也当任务的 startAfter。清除时以库里的值和数据库的时钟为准。
  const purgeAt = new Date(contents.some(Boolean) ? now + DELETION_COOLING_OFF_MS : now);
  try {
    return await deps.db.transaction(async (tx) => {
      const marked = await tx
        .update(user)
        .set({
          status: "pending_deletion",
          deletionRequestedAt: new Date(now),
          deletionPurgeAt: purgeAt,
          deletionDeleteContent: options.deleteContent,
        })
        .where(and(eq(user.id, userId), eq(user.status, "active")))
        .returning({ id: user.id });
      if (marked.length === 0) {
        return { status: "not_active" } as const;
      }
      // 撤销这个用户的所有会话，包括发起这次请求的那个。
      await tx.delete(session).where(eq(session.userId, userId));
      const jobId = await enqueueInTx(boss, tx, USER_PURGE_QUEUE, { userId } satisfies UserPurgeData, {
        singletonKey: userId,
        startAfter: purgeAt,
      });
      if (jobId === null) {
        // 队列是 exclusive：同一个用户已经有任务在排队、重试或执行时不再接受新的。整个回滚，
        // 免得用户停在"注销中"，却没有属于这次申请的清除任务。
        throw new PurgeAlreadyQueued();
      }
      return { status: "requested", purgeAt } as const;
    });
  } catch (error) {
    if (error instanceof PurgeAlreadyQueued) {
      return { status: "conflict" };
    }
    throw error;
  }
}

type DeletionState = {
  status: "active" | "pending_deletion";
  deleteContent: boolean | null;
  /** 到了清除时间：deletion_purge_at <= 现在。 */
  due: boolean;
  /** 还没到清除时间：现在 < deletion_purge_at。 */
  beforePurge: boolean;
};

// 撤销和清除的裁判：先锁住用户行，发起、撤销、清除互相排队；锁到之后再读数据库的时钟
// （clock_timestamp()，不是事务开始时的 now()），等锁的时间也算进去。用户不存在时返回 null。
async function lockDeletionState(tx: DbTransaction, userId: string): Promise<DeletionState | null> {
  const locked = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
  if (locked.length === 0) {
    return null;
  }
  const [state] = await tx
    .select({
      status: user.status,
      deleteContent: user.deletionDeleteContent,
      due: sql<boolean>`coalesce(${user.deletionPurgeAt} <= clock_timestamp(), false)`,
      beforePurge: sql<boolean>`coalesce(clock_timestamp() < ${user.deletionPurgeAt}, false)`,
    })
    .from(user)
    .where(eq(user.id, userId));
  return state ?? null;
}

export type CancelDeletionResult =
  | "cancelled"
  /** 账号本来就是正常状态（上一次撤销的响应丢了重试，或者另一个标签页已经撤销）：撤销的目的已经达到，什么也没做。 */
  | "not_pending"
  /** 用户已经不存在，或者到了清除时间（清除任务可能已经在跑）。 */
  | "not_cancellable";

// 撤销注销：只有"注销中、还没到清除时间"才行。到了时间清除任务可能已经在跑：pg-boss 的 cancel 拦不住
// 执行中的任务，所以由上面的锁和时间来裁判，取消任务只是顺手。本来就是正常状态的算已经撤销（幂等）。
export async function cancelDeletion(deps: Pick<DeletionDeps, "db" | "boss">, userId: string): Promise<CancelDeletionResult> {
  const boss = await deps.boss();
  return deps.db.transaction(async (tx) => {
    const state = await lockDeletionState(tx, userId);
    if (state?.status === "active") {
      return "not_pending";
    }
    if (state?.status !== "pending_deletion" || !state.beforePurge) {
      return "not_cancellable";
    }
    await tx
      .update(user)
      .set({ status: "active", deletionRequestedAt: null, deletionPurgeAt: null, deletionDeleteContent: null })
      .where(eq(user.id, userId));
    // 任务 id 不存：exclusive 保证这个用户最多一个排队中的任务，按 singletonKey 找就行。和上面的更新在同一个事务里：
    // 事务回滚，任务也没取消。
    const db = fromDrizzle(tx, sql);
    const queued = await boss.findJobs(USER_PURGE_QUEUE, { key: userId, queued: true, db });
    if (queued.length > 0) {
      await boss.cancel(
        USER_PURGE_QUEUE,
        queued.map((job) => job.id),
        { db }
      );
    }
    return "cancelled";
  });
}

export type PurgeResult = "purged" | "skipped";

// 最终清除（spec 第 10.6 节），全部在一个事务里：锁行判断 → 按顺序调各模块的 purge →
// 删 profiles → 删用户行（会话、平台绑定、通行密钥由外键级联删除）。用户已经不在、撤销过了、还没到时间，
// 都什么也不做，所以同一个任务跑几遍、两个任务同时跑，结果都一样。
//
// 不用 Better Auth 的 internalAdapter.deleteUser：它不在事务里，中途失败会留下删了一半的账号。在我们的配置下
// （没有 secondaryStorage、cookie cache 和 delete 钩子）直接删用户行和它等价；user-deletion.test.ts 的守卫测试
// 看着这几个前提，哪天变了测试会失败。
export async function purgeUser(deps: Pick<DeletionDeps, "db" | "handlers">, userId: string): Promise<PurgeResult> {
  return deps.db.transaction(async (tx) => {
    const state = await lockDeletionState(tx, userId);
    if (state?.status !== "pending_deletion" || !state.due) {
      return "skipped";
    }
    for (const handler of deps.handlers) {
      await handler.purge(userId, { deleteContent: state.deleteContent === true }, tx);
    }
    await tx.delete(profiles).where(eq(profiles.userId, userId));
    await tx.delete(user).where(eq(user.id, userId));
    return "purged";
  });
}
