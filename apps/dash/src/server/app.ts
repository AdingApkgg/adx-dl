import { Hono } from "hono";
import { serveStatic } from "hono/bun";

export type AppDeps = {
  /** SPA 构建产物目录，相对于进程的工作目录。 */
  clientRoot: string;
};

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/api/ping", (c) => c.json({ ok: true }));

  // /api 下的未命中显式收口成 JSON 404。放在 SPA fallback 之前，
  // 否则下面的 * 会把它们当成前端路由，回一份 index.html。
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  app.use("/*", serveStatic({ root: deps.clientRoot }));
  // 其余路径交给 SPA 的客户端路由。
  app.get("*", serveStatic({ path: `${deps.clientRoot}/index.html` }));

  return app;
}
