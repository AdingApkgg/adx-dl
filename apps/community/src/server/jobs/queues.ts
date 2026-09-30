import type { Queue } from "pg-boss";

export type QueueDefinition = { name: string; options: Omit<Queue, "name"> };

export const NAPCAT_HEALTH_QUEUE = "napcat.health";
export const USER_PURGE_QUEUE = "user.purge";
export const USER_PURGE_DEAD_QUEUE = "user.purge.dead";
export const USER_PURGE_SWEEP_QUEUE = "user.purge.sweep";
export const SESSION_CLEANUP_QUEUE = "session.cleanup";

/** user.purge 任务的内容：只有用户 id，其余都以数据库里的 user 行为准。 */
export type UserPurgeData = { userId: string };

const DAY = 86_400;

// 所有队列在这里登记，重试、死信、心跳、超时策略集中定义（spec 第 9.5 节）。网页进程（投递）、worker（执行）和
// db:migrate（部署时建队列）都从这里读，所以放在 src/server 下，而不是 src/worker。
// 顺序有要求：死信队列必须排在指向它的队列前面，createQueue 会先检查死信队列存在。
export const QUEUES: readonly QueueDefinition[] = [
  // 每分钟检查一次机器人在不在线，结果写进 Redis，登录页据此显示"QQ 登录暂不可用"。
  // 检查本身就是周期性的，失败不重试；stately：同一时刻最多一个排队、一个在跑，
  // worker 停一阵再起来也不会堆出一串任务。
  {
    name: NAPCAT_HEALTH_QUEUE,
    options: { policy: "stately", retryLimit: 0, expireInSeconds: 30, deleteAfterSeconds: 3600 },
  },
  // 没人处理的死信任务会在保留期满后被 pg-boss 悄悄删掉（默认 14 天）：留 90 天给人处理。
  { name: USER_PURGE_DEAD_QUEUE, options: { retentionSeconds: 90 * DAY } },
  // 注销的最终清除（spec 第 10.6 节）。
  {
    name: USER_PURGE_QUEUE,
    options: {
      // 同一个用户（singletonKey 是用户 id）排队、重试、执行中的任务合起来最多一个。
      policy: "exclusive",
      // 共跑 9 次；退避从 1 到 2 分钟起翻倍，封顶 1 小时，能扛过约 3 到 4 小时的故障，之后进死信队列。
      retryLimit: 8,
      retryDelay: 60,
      retryBackoff: true,
      retryDelayMax: 3600,
      // 大账号的清除可能要几分钟；超时算失败，各步骤都能重跑，下次接着做。
      expireInSeconds: 1800,
      // worker 崩了以后 1 到 2 分钟就判定失败、重新投递，不用等 30 分钟。
      heartbeatSeconds: 60,
      // 延迟任务的保留期从到期时刻算起：worker 停摆再久（90 天内），到期的清除任务也不会被删掉。
      retentionSeconds: 90 * DAY,
      deleteAfterSeconds: 7 * DAY,
      deadLetter: USER_PURGE_DEAD_QUEUE,
    },
  },
  // 每天一次：清除时间过了一小时还在"注销中"的账号重新投递 user.purge（任务丢了的兜底），再看一眼死信队列。
  // 只看当时的状态，失败了等明天再跑，不重试。
  {
    name: USER_PURGE_SWEEP_QUEUE,
    options: { policy: "stately", retryLimit: 0, expireInSeconds: 600, deleteAfterSeconds: 14 * DAY },
  },
  // 每天清理一次过期的会话和 verification 行。清理只看当时的状态，失败了等明天再跑就行，不重试。
  {
    name: SESSION_CLEANUP_QUEUE,
    options: { policy: "stately", retryLimit: 0, expireInSeconds: 600, deleteAfterSeconds: 14 * DAY },
  },
];

type QueueAdmin = {
  getQueue(name: string): Promise<unknown>;
  createQueue(name: string, options?: Omit<Queue, "name">): Promise<void>;
};

// 已经存在的队列不改：改选项要写一次性的迁移调用 updateQueue，policy 和 partition 改不了。
// 部署时由 db:migrate 调用（web 和 worker 同时起时，web 投递的队列必须已经在了）；worker 启动时再调一次，幂等。
export async function ensureQueues(boss: QueueAdmin, queues: readonly QueueDefinition[] = QUEUES): Promise<void> {
  for (const queue of queues) {
    if (!(await boss.getQueue(queue.name))) {
      await boss.createQueue(queue.name, queue.options);
    }
  }
}
