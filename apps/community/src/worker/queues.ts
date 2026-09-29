import type { Queue } from "pg-boss";

export type QueueDefinition = { name: string; options: Omit<Queue, "name"> };

export const NAPCAT_HEALTH_QUEUE = "napcat.health";

// 所有队列在这里登记，重试、死信、心跳、超时策略集中定义（spec 第 9.5 节）。
// 1c 起加入 user.purge。
export const QUEUES: readonly QueueDefinition[] = [
  // 每分钟检查一次机器人在不在线，结果写进 Redis，登录页据此显示"QQ 登录暂不可用"。
  // 检查本身就是周期性的，失败不重试；stately：同一时刻最多一个排队、一个在跑，
  // worker 停一阵再起来也不会堆出一串任务。
  {
    name: NAPCAT_HEALTH_QUEUE,
    options: { policy: "stately", retryLimit: 0, expireInSeconds: 30, deleteAfterSeconds: 3600 },
  },
];

type QueueAdmin = {
  getQueue(name: string): Promise<unknown>;
  createQueue(name: string, options?: Omit<Queue, "name">): Promise<void>;
};

// 已经存在的队列不改：改策略要写一次性的迁移调用 updateQueue，policy 和 partition 改不了。
export async function ensureQueues(boss: QueueAdmin, queues: readonly QueueDefinition[] = QUEUES): Promise<void> {
  for (const queue of queues) {
    if (!(await boss.getQueue(queue.name))) {
      await boss.createQueue(queue.name, queue.options);
    }
  }
}
