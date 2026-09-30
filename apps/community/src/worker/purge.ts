import type { Job } from "pg-boss";

import type { Db } from "@/server/db/client";
import type { UserPurgeData } from "@/server/jobs/queues";
import { type DeletionHandler, purgeUser } from "@/server/services/user-deletion";
import { describeError } from "@/shared/describe-error";
import type { Logger } from "@/shared/log";

/** 处理函数只用到任务的 data：测试里直接传 [{ data }]，不用造完整的 Job。 */
export type PurgeJob = Pick<Job<UserPurgeData>, "data">;

export type UserPurgeDeps = { db: Db; handlers: readonly DeletionHandler[]; log: Logger };

// user.purge 的处理函数（spec 第 10.6 节）。pg-boss 总是传一个数组（batchSize 默认 1）。清除本身是否该做、做到哪一步，
// 都由 purgeUser 按数据库里的 user 行判断：撤销过的、已经清除完的旧任务在那里落空，直接完成。
export function createUserPurgeHandler(deps: UserPurgeDeps) {
  return async (jobs: PurgeJob[]): Promise<void> => {
    for (const job of jobs) {
      const userId = job.data?.userId;
      if (typeof userId !== "string") {
        // 不是我们投递的任务：直接失败，重试用完后进死信队列等人来看。
        throw new Error("user.purge job has no userId");
      }
      try {
        const result = await purgeUser(deps, userId);
        deps.log.info("user_purge", { userId, result });
      } catch (error) {
        // 只记用户 id 和错误本身（describeError 不带 SQL 的参数值）；抛出去交给 pg-boss 按退避重试。
        deps.log.error("user_purge_failed", { userId, ...describeError(error) });
        throw error;
      }
    }
  };
}
