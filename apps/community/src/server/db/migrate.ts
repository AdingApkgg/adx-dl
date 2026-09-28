import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { parseEnv } from "../env";
import { createBoss } from "../jobs/boss";
import { createDb } from "./client";

// 部署时由 compose 的 migrate 服务单独执行（spec 第 9.3 节），不在应用启动时跑。
// 网页进程里的 pg-boss 不自己迁移，所以它的表也在这里建好。
const env = parseEnv(process.env);
const { db, pool } = createDb(env.databaseUrl, { max: 1 });

try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)) });

  const boss = createBoss(env.databaseUrl, "migrator");
  boss.on("error", (error) => console.error(error));
  await boss.start();
  await boss.stop({ graceful: false, timeout: 1000 });

  console.log(JSON.stringify({ time: new Date().toISOString(), level: "info", event: "migrations_applied" }));
} finally {
  await pool.end();
}
