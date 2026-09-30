import type { PgBoss } from "pg-boss";

import { createBoss } from "../jobs/boss";
import { ensureQueues } from "../jobs/queues";
import { testDatabaseUrl } from "./services";
import { resetTestDatabase } from "./test-db";

let installed: Promise<void> | undefined;
let sender: Promise<PgBoss> | undefined;

// resetTestDatabase() 会删掉整个 pgboss schema，所以 pg-boss 的表和队列要在它之后建：和部署时的 db:migrate 一样，
// 用 migrator 角色建表、建队列，然后停掉。每个测试进程只做一次（发送端的 start() 不迁移，表不在时会报
// "pg-boss is not installed"）。
export function prepareTestQueues(): Promise<void> {
  installed ??= (async () => {
    await resetTestDatabase();
    const migrator = createBoss(testDatabaseUrl(), "migrator");
    migrator.on("error", (error) => console.error(error));
    try {
      await migrator.start();
      await ensureQueues(migrator);
    } finally {
      await migrator.stop({ graceful: false, timeout: 1000 });
    }
  })();
  return installed;
}

// 测试共用一个发送端，和网页进程里的一样只投递、不执行。不在测试里 stop：bun test 跑完会直接退出进程，
// 和 testDbHandle() 的连接池一样。需要 fetch 任务的测试（它会领走队列里任何到期的任务）不要用真实的队列。
export function testSender(): Promise<PgBoss> {
  sender ??= (async () => {
    await prepareTestQueues();
    const boss = createBoss(testDatabaseUrl(), "sender");
    boss.on("error", (error) => console.error(error));
    await boss.start();
    return boss;
  })();
  return sender;
}
