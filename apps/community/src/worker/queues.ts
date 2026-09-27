import type { Queue } from "pg-boss";

export type QueueDefinition = { name: string; options: Omit<Queue, "name"> };

// 所有队列在这里登记，重试、死信、心跳、超时策略集中定义（spec 第 9.5 节）。
// 1c 起加入 user.purge、napcat.health。
export const QUEUES: readonly QueueDefinition[] = [];

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
