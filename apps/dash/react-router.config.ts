import type { Config } from "@react-router/dev/config";

export default {
  // 客户端源码不放默认的 app/，而是与 src/server 并列，保持 src/ 单一入口目录。
  appDirectory: "src/client",
  buildDirectory: "build",
  // SPA 模式：关掉运行时 SSR。根路由仍会在构建期渲染成 index.html，
  // 由 Hono 作为所有未命中路径的 fallback 吐出去。
  ssr: false,
} satisfies Config;
