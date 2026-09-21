import { Hono } from "hono";
import { serveStatic } from "hono/bun";

import type { GitHubClient } from "./github/client";
import { accessJwt, type AccessConfig, type AccessVariables } from "./middleware/access-jwt";
import { registerMeRoute } from "./routes/me";

export type AppDeps = {
  /** SPA 构建产物目录，相对于进程的工作目录。 */
  clientRoot: string;
  github: GitHubClient;
  accessConfig: AccessConfig;
};

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: AccessVariables }>();

  // 健康检查放在鉴权之前：docker 的 healthcheck 拿不到 Access 断言，
  // 而它要回答的只是「进程还活着吗」，不涉及任何仓库数据。
  app.get("/api/ping", (c) => c.json({ ok: true }));

  app.use("*", accessJwt(deps.accessConfig));

  registerMeRoute(app, { github: deps.github });

  // /api 下的未命中显式收口成 JSON 404。放在 SPA fallback 之前，
  // 否则下面的 * 会把它们当成前端路由，回一份 index.html。
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  app.use("/*", serveStatic({ root: deps.clientRoot }));
  // 其余路径交给 SPA 的客户端路由。
  app.get("*", serveStatic({ path: `${deps.clientRoot}/index.html` }));

  return app;
}
