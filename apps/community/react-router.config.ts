import type { Config } from "@react-router/dev/config";

export default {
  // 前端代码放 src/client，和 src/server 并列，沿用 dash 的目录划分。
  appDirectory: "src/client",
  buildDirectory: "build",
  ssr: true,
} satisfies Config;
