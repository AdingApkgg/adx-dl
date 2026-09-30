import { describe, expect, test } from "bun:test";

import { testSender } from "../testing/test-boss";
import {
  ensureQueues,
  QUEUES,
  type QueueDefinition,
  SESSION_CLEANUP_QUEUE,
  USER_PURGE_DEAD_QUEUE,
  USER_PURGE_QUEUE,
  USER_PURGE_SWEEP_QUEUE,
} from "./queues";

const DAY = 86_400;

describe("ensureQueues", () => {
  test("只创建还不存在的队列", async () => {
    const created: string[] = [];
    const existing = new Set(["already.there"]);
    const boss = {
      getQueue: async (name: string) => (existing.has(name) ? { name } : null),
      createQueue: async (name: string) => {
        created.push(name);
      },
    };
    const queues: QueueDefinition[] = [
      { name: "already.there", options: {} },
      { name: "brand.new", options: { retryLimit: 3 } },
    ];

    await ensureQueues(boss, queues);

    expect(created).toEqual(["brand.new"]);
  });
});

describe("QUEUES", () => {
  // createQueue 会先检查死信队列存在：顺序反了，部署时的 db:migrate 就会报 "Queue … does not exist"。
  test("每个死信队列都排在指向它的队列前面", () => {
    QUEUES.forEach((queue, index) => {
      const deadLetter = queue.options.deadLetter;
      if (deadLetter) {
        const deadIndex = QUEUES.findIndex((other) => other.name === deadLetter);
        expect(deadIndex, queue.name).toBeGreaterThanOrEqual(0);
        expect(deadIndex, queue.name).toBeLessThan(index);
      }
    });
  });

  // policy 建了就改不了，ensureQueues 对已经存在的队列也不改：读回来核对，免得悄悄建成了别的策略。
  test(
    "测试库里建出来的队列和定义一致",
    async () => {
      const boss = await testSender();

      expect(await boss.getQueue(USER_PURGE_QUEUE)).toMatchObject({
        policy: "exclusive",
        retryLimit: 8,
        retryDelay: 60,
        retryBackoff: true,
        retryDelayMax: 3600,
        expireInSeconds: 1800,
        heartbeatSeconds: 60,
        retentionSeconds: 90 * DAY,
        deleteAfterSeconds: 7 * DAY,
        deadLetter: USER_PURGE_DEAD_QUEUE,
      });
      expect(await boss.getQueue(USER_PURGE_DEAD_QUEUE)).toMatchObject({ retentionSeconds: 90 * DAY });
      expect(await boss.getQueue(USER_PURGE_SWEEP_QUEUE)).toMatchObject({ policy: "stately", retryLimit: 0 });
      expect(await boss.getQueue(SESSION_CLEANUP_QUEUE)).toMatchObject({ policy: "stately", retryLimit: 0 });
    },
    30_000
  );
});
