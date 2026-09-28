import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  // 迁移放在 src 下（spec 第 7 节），镜像复制 src 时一起带上。
  out: "./src/server/db/migrations",
  casing: "snake_case",
});
