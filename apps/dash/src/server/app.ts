import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";

import type { GitHubClient } from "./github/client";
import { accessJwt, type AccessConfig, type AccessVariables } from "./middleware/access-jwt";
import { registerActionsRoutes } from "./routes/actions";
import { registerEventsRoute, type EventsPoller } from "./routes/events";
import { registerMeRoute } from "./routes/me";

export type AppDeps = {
  /** SPA 构建产物目录，相对于进程的工作目录。 */
  clientRoot: string;
  github: GitHubClient;
  accessConfig: AccessConfig;
  poller: EventsPoller;
  /**
   * 浏览器实际会发的公网 origin（如 https://dash.saop.cc），喂给
   * csrf() 的白名单。见下面 csrf() 调用处的长注释——这个值绝不能留空
   * 或者猜一个默认值。
   */
  dashPublicOrigin: string;
};

export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: AccessVariables }>();

  // 找 I-5：写端点（dispatch/rerun/cancel……）之前七处 catch 各自拼一个
  // c.json(...) 回给客户端，但没有一处顺手打个服务端日志——GitHub 那侧的
  // 权限被收回、token 过期，日志上一点痕迹都没有，只有客户端看到的一个
  // 裸 502。这里换成 Hono 的 app.onError：路由不再自己接住 GitHub 错误、
  // 自己拼状态码，而是让 withGitHubErrors（见 github/status.ts）把它收敛成
  // 一个已经带对了状态码与 JSON body 的 HTTPException 再抛出来，这里是
  // 唯一记日志、唯一把它转成最终 Response 的地方。
  //
  // 非 HTTPException 的错误（理论上不该发生——GitHub 相关的路径都走了
  // withGitHubErrors）按 500 处理，不套用 statusFor 的 502：502 是「GitHub
  // 这边出了问题」的专属含义，一个真正意料之外的内部错误不该被误读成那样。
  app.onError((err, c) => {
    const status = err instanceof HTTPException ? err.status : 500;
    const message = err.message || "(no error message)";
    // 只记 method/path/status/message——不记 body、不记 header，尤其不能
    // 记 Cf-Access-Jwt-Assertion 或任何 GitHub 凭证。err.message 到这里
    // 之前已经在 withGitHubErrors 里从 error.message（不是 String(error)）
    // 取过一次，不含类名前缀，也不含 token。
    console.error(`[api] ${c.req.method} ${c.req.path} -> ${status}: ${message}`);
    if (err instanceof HTTPException) return err.getResponse();
    return c.json({ error: message }, status);
  });

  // 健康检查放在鉴权之前：docker 的 healthcheck 拿不到 Access 断言，
  // 而它要回答的只是「进程还活着吗」，不涉及任何仓库数据。它是个终止
  // handler（不调用 next()），所以下面的 accessJwt/csrf 对它形同不存在，
  // 不用额外做例外处理。
  app.get("/api/ping", (c) => c.json({ ok: true }));

  app.use("*", accessJwt(deps.accessConfig));

  // 找 I-2：rerun/cancel、以及不带 ref 的 dispatch，都是 `headers: undefined,
  // body: undefined` 的 POST——没有自定义 header、没有需要预检的 body，
  // 属于 CORS 里的「simple request」，浏览器不会先发 OPTIONS 问一遍就直接
  // 把请求发出去。第三方页面用 `fetch(url, {method:"POST",
  // credentials:"include"})` 打这几个端点时，读不到响应内容，但副作用已经
  // 发生了；而这个请求是否带着能通过 accessJwt 的 Cf-Access-Jwt-Assertion，
  // 取决于 Cloudflare 给 Access 那份 cookie 设的 SameSite——这个仓库既没有
  // 配置也没有断言过它，不能假设它总是挡得住。所以 csrf 要挡在 accessJwt
  // 之后，对「已经通过 Access 校验」的请求也照样生效。
  //
  // hono/csrf 默认拿请求 URL 自己算出的 origin 去跟浏览器的 Origin 头比。
  // 这个服务是 cloudflared 反代到 http://localhost:12702，Hono 看到的请求
  // URL 大概率就是这个本地地址，而浏览器发来的 Origin 是公网域名——两者
  // 永远不相等，用默认值会把生产环境里 UI 发出的每一个 POST 都拒掉。所以
  // 必须显式传 origin，且只信 DASH_PUBLIC_ORIGIN 这一个配置好的值，不猜。
  //
  // GET/HEAD/OPTIONS 天然被 hono/csrf 放行（它只检查「不安全」的方法），
  // 所以 /api/events 这条 SSE 长连接、/api/runs 等等 SPA 会发的 GET 一律
  // 不受影响，不需要额外白名单。
  app.use("*", csrf({ origin: deps.dashPublicOrigin }));

  registerMeRoute(app, { github: deps.github });
  registerActionsRoutes(app, { github: deps.github });
  registerEventsRoute(app, { poller: deps.poller });

  // /api 下的未命中显式收口成 JSON 404。放在 SPA fallback 之前，
  // 否则下面的 * 会把它们当成前端路由，回一份 index.html。
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  app.use("/*", serveStatic({ root: deps.clientRoot }));
  // 其余路径交给 SPA 的客户端路由。
  app.get("*", serveStatic({ path: `${deps.clientRoot}/index.html` }));

  return app;
}
