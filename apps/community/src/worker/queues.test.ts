import { describe, expect, test } from "bun:test";

import { ensureQueues, type QueueDefinition } from "./queues";

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
