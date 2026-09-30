import { sql } from "drizzle-orm";

import { testDbHandle } from "./test-db";

// 空账号的清除时间是 JS 时钟算出来的"现在"，而测试库跑在虚拟机里，库里的时钟可能和 JS 的差几毫秒：等库里的时钟走到这个时间，再清除或撤销。
export async function waitUntilDue(userId: string): Promise<void> {
  const { db } = testDbHandle();
  const deadline = Date.now() + 2000;
  for (;;) {
    const { rows } = await db.execute<{ due: boolean | null }>(
      sql`select clock_timestamp() >= deletion_purge_at as due from "user" where id = ${userId}`
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`waitUntilDue: user ${userId} does not exist`);
    }
    if (row.due === null) {
      throw new Error(`waitUntilDue: user ${userId} has no deletion_purge_at (deletion was never requested)`);
    }
    if (row.due) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`waitUntilDue: the purge time of user ${userId} was still in the future after 2 s`);
    }
    await Bun.sleep(5);
  }
}
