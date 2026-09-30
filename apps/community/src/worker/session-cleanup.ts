import { lt, sql } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { session, verification } from "@/server/db/schema";
import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

/** session.cleanup 每天什么时候跑：东八区凌晨 4 点 17 分（避开整点和 03:30 的备份）。 */
export const SESSION_CLEANUP_CRON = "17 4 * * *";
export const SESSION_CLEANUP_TZ = "Asia/Shanghai";

// 过期的会话和 verification 行 Better Auth 自己不删（verification 只在读到时顺手删；通行密钥的自动填充每次打开登录页
// 都会留一行）。按数据库的时钟判断过期。
export async function cleanupExpiredAuthRows(db: Db): Promise<{ sessions: number; verifications: number }> {
  const sessions = await db.delete(session).where(lt(session.expiresAt, sql`now()`));
  const verifications = await db.delete(verification).where(lt(verification.expiresAt, sql`now()`));
  return { sessions: sessions.rowCount ?? 0, verifications: verifications.rowCount ?? 0 };
}

// session.cleanup 的处理函数。user.purge 的死信检查在每天的 user.purge.sweep 里（purge-sweep.ts）。
// 这个队列不重试，pg-boss 只把失败记在任务行里：出错要自己记进日志，否则清理一直失败也没人看得见；
// 再抛出去，让 pg-boss 把这次任务记成失败。
export async function runSessionCleanup(deps: { db: Db; log: Logger }): Promise<void> {
  try {
    const removed = await cleanupExpiredAuthRows(deps.db);
    deps.log.info("session_cleanup", removed);
  } catch (error) {
    deps.log.error("session_cleanup_failed", describeError(error));
    throw error;
  }
}
