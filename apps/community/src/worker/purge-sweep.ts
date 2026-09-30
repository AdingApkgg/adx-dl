import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";

import type { Db } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { USER_PURGE_DEAD_QUEUE, USER_PURGE_QUEUE, type UserPurgeData } from "@/server/jobs/queues";
import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

/** user.purge.sweep 每天什么时候跑：东八区凌晨 4 点 47 分（和 04:17 的 session.cleanup、03:30 的备份错开）。 */
export const PURGE_SWEEP_CRON = "47 4 * * *";
export const PURGE_SWEEP_TZ = "Asia/Shanghai";

/** 一次最多补投多少个账号。平时一个也没有；积压多了就分几天补完。 */
export const PURGE_SWEEP_LIMIT = 500;

export type PurgeSweepDeps = { db: Db; boss: Pick<PgBoss, "send" | "findJobs">; log: Logger };

export type PurgeSweepResult = { requeued: number; deadLetters: number };

// 清除时间过了一小时还在"注销中"：这个账号的清除任务要么没了（worker 停摆超过 90 天的保留期、被误删、
// 重试用完进了死信），要么还在重试。重新投递一次：singletonKey 和 requestDeletion 投递时一样是用户 id，
// 已有任务在排队、重试或执行时 exclusive 让 send 返回 null，不会重复；撤销时也按这个 key 找任务。
// 不带 startAfter：清除时间早就过了。
async function requeueOverduePurges(deps: PurgeSweepDeps): Promise<number> {
  const overdue = await deps.db
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.status, "pending_deletion"), lt(user.deletionPurgeAt, sql`now() - interval '1 hour'`)))
    .orderBy(asc(user.deletionPurgeAt))
    .limit(PURGE_SWEEP_LIMIT);
  let requeued = 0;
  try {
    for (const { id } of overdue) {
      const jobId = await deps.boss.send(USER_PURGE_QUEUE, { userId: id } satisfies UserPurgeData, { singletonKey: id });
      if (jobId !== null) {
        requeued += 1;
      }
    }
  } finally {
    // 中途出错也把已经补投的记上。只记数量：是哪些账号，查 user 表里注销中的就知道。
    if (requeued > 0) {
      deps.log.warn("user_purge_requeued", { count: requeued });
    }
  }
  return requeued;
}

// 重试用完的清除任务在死信队列里等人处理（查日志里的 user_purge_failed，修好后 redrive）：没处理之前每天记一条。
async function checkPurgeDeadLetters(deps: PurgeSweepDeps): Promise<number> {
  const dead = await deps.boss.findJobs(USER_PURGE_DEAD_QUEUE, { queued: true });
  if (dead.length > 0) {
    deps.log.error("user_purge_dead_letters", { count: dead.length });
  }
  return dead.length;
}

// 一件事出错只记下来（user_purge_sweep_failed）、返回 null，不拦着另一件。
async function attempt(
  deps: PurgeSweepDeps,
  step: string,
  run: (deps: PurgeSweepDeps) => Promise<number>
): Promise<number | null> {
  try {
    return await run(deps);
  } catch (error) {
    deps.log.error("user_purge_sweep_failed", { step, ...describeError(error) });
    return null;
  }
}

// user.purge.sweep 的处理函数：补投丢了的清除任务，再看一眼死信队列，两件事互不影响。
// 有一件出错时，两件都做完再抛给 pg-boss，让这次任务记成失败（这个队列不重试，明天照常再跑）。
export async function runPurgeSweep(deps: PurgeSweepDeps): Promise<PurgeSweepResult> {
  const requeued = await attempt(deps, "requeue", requeueOverduePurges);
  const deadLetters = await attempt(deps, "dead_letters", checkPurgeDeadLetters);
  if (requeued === null || deadLetters === null) {
    throw new Error("user.purge.sweep failed");
  }
  return { requeued, deadLetters };
}
