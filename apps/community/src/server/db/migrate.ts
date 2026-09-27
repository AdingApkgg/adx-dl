import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { parseEnv } from "../env";
import { createDb } from "./client";

// 部署时由 compose 的 migrate 服务单独执行（spec 第 9.3 节），不在应用启动时跑。
const env = parseEnv(process.env);
const { db, pool } = createDb(env.databaseUrl, { max: 1 });

try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("./migrations", import.meta.url)) });
  console.log(JSON.stringify({ time: new Date().toISOString(), level: "info", event: "migrations_applied" }));
} finally {
  await pool.end();
}
