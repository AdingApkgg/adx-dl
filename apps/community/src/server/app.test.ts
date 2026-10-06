import { describe, expect, test } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { createApp } from "./app";
import { createInProcessApi } from "./in-process-api";
import { createMemoryRateLimitStore, type RateLimitStore } from "./middleware/rate-limit";
import { TEST_PUBLIC_ORIGIN, testAppDeps } from "./testing/app-deps";
import { createTestAuth } from "./testing/auth";

describe("createApp", () => {
  test("/healthz 返回 ok，并带上请求 ID", async () => {
    const res = await createApp(testAppDeps().deps).request("/healthz");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  test("未知的 /api 路径返回 JSON 404，不落到页面渲染", async () => {
    const res = await createApp(testAppDeps().deps).request("/api/nope");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  // 子项目 2 实现；这里先占住位置，保证它挂在以后的会话中间件之前。
  // 响应里一旦带 Set-Cookie，Cloudflare 就不会缓存它（spec 第 8.1 节第 4 条）。
  test("/media 目前返回 404，并且不带 Set-Cookie", async () => {
    const res = await createApp(testAppDeps().deps).request("/media/abc.jpg");
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  test("未处理的异常返回通用 500，细节只进日志", async () => {
    const { deps, logs } = testAppDeps();
    const app = createApp(deps);
    app.get("/test-boom", () => {
      throw new Error("db password is hunter2");
    });

    const res = await app.request("/test-boom");

    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("INTERNAL");
    expect(body).not.toContain("hunter2");
    expect(logs().find((entry) => entry.event === "unhandled_error")).toMatchObject({
      path: "/test-boom",
      message: "db password is hunter2",
    });
  });

  // DrizzleQueryError 的 message 是 "Failed query: <sql>\nparams: <参数值>"，参数里会有
  // 令牌、QQ 号这类绝不能进日志的值。
  test("数据库查询出错时，日志里有 SQL，没有查询参数", async () => {
    const { deps, logs } = testAppDeps();
    const app = createApp(deps);
    const query = 'select * from "sessions" where "token" = $1';
    app.get("/test-db-error", () => {
      throw new DrizzleQueryError(query, ["sess_secret_token"], new Error("boom"));
    });

    const res = await app.request("/test-db-error");

    expect(res.status).toBe(500);
    expect(logs().find((entry) => entry.event === "unhandled_error")).toMatchObject({ path: "/test-db-error", query });
    expect(JSON.stringify(logs())).not.toContain("sess_secret_token");
  });

  test("HTTPException 按状态码给出错误码，message 原样返回", async () => {
    const app = createApp(testAppDeps().deps);
    app.get("/test-forbidden", () => {
      throw new HTTPException(403, { message: "Not your post" });
    });
    app.get("/test-http-500", () => {
      throw new HTTPException(500);
    });

    const forbidden = await app.request("/test-forbidden");
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: { code: "FORBIDDEN", message: "Not your post" } });

    const internal = await app.request("/test-http-500");
    expect(internal.status).toBe(500);
    expect(await internal.json()).toEqual({ error: { code: "INTERNAL", message: "Request failed" } });
  });

  // 页面由 createHonoServer 在 createApp 之后挂上的 React Router 处理：这里照样在 createApp 之后挂一个
  // "页面"，像 getLoadContext 那样把进程内请求收到的 Set-Cookie 放进 inProcessSetCookies。
  test("进程内请求收到的 Set-Cookie 补到页面响应上，同名的只留最后一条", async () => {
    const app = createApp(testAppDeps().deps);
    app.get("/test-page", (c) => {
      c.set("inProcessSetCookies", [
        "adxc.session_token=first; Max-Age=2592000; Path=/",
        "other=1; Path=/",
        "adxc.session_token=second; Max-Age=2592000; Path=/",
      ]);
      return c.html("<p>ok</p>");
    });

    const res = await app.request("/test-page");

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual(["adxc.session_token=second; Max-Age=2592000; Path=/", "other=1; Path=/"]);
  });

  // 页面上的跳转（未登录去登录页、待注销的去注销提示页、/zh 去掉前缀……）是 React Router 的 loader 和中间件抛出来的，
  // 不经过 entry.server.tsx，原来没有 Cache-Control；它们常带着续期的会话 Cookie。这里照样在 createApp 之后挂"页面"。
  test("跳转一律 private, no-store；自己设了 Cache-Control 的不动；Set-Cookie 原样带着", async () => {
    const app = createApp(testAppDeps().deps);
    app.get("/test-redirect", (c) => {
      c.set("inProcessSetCookies", ["adxc.session_token=renewed; Max-Age=2592000; Path=/"]);
      return c.redirect("/login?next=%2Fsettings", 302);
    });
    app.get("/test-moved", () => new Response(null, { status: 301, headers: { location: "/foo" } }));
    app.get(
      "/test-cached-redirect",
      () => new Response(null, { status: 302, headers: { location: "/x", "cache-control": "public, max-age=60" } })
    );

    const redirect = await app.request("/test-redirect");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("cache-control")).toBe("private, no-store");
    expect(redirect.headers.getSetCookie()).toEqual(["adxc.session_token=renewed; Max-Age=2592000; Path=/"]);
    expect((await app.request("/test-moved")).headers.get("cache-control")).toBe("private, no-store");
    expect((await app.request("/test-cached-redirect")).headers.get("cache-control")).toBe("public, max-age=60");
  });

  test("/robots.txt：允许收录页面，挡住接口和统计转发", async () => {
    const res = await createApp(testAppDeps().deps).request("/robots.txt");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await res.text()).toBe("User-agent: *\nDisallow: /api/\nDisallow: /_s/\n");
  });

  test("安全响应头已经挂上", async () => {
    const res = await createApp(testAppDeps().deps).request("/healthz");
    expect(res.headers.get("content-security-policy")).toContain("'nonce-");
  });

  test("/readyz 在所有检查通过时返回 200", async () => {
    const { deps } = testAppDeps({ checks: { db: async () => {}, redis: async () => {} } });
    const res = await createApp(deps).request("/readyz");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { db: "ok", redis: "ok" } });
  });

  test("/readyz 有一项失败时返回 503，原因写进日志", async () => {
    const { deps, logs } = testAppDeps({
      checks: {
        db: async () => {},
        redis: async () => {
          throw new Error("connection refused");
        },
      },
    });
    const res = await createApp(deps).request("/readyz");

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, checks: { db: "ok", redis: "fail" } });
    expect(logs().find((entry) => entry.event === "readiness_check_failed")).toMatchObject({
      check: "redis",
      message: "connection refused",
    });
  });

  // /readyz 列出依赖的名字和状态，只给本机的探针看（deploy.sh、健康检查）。经 Cloudflare 隧道来的请求一定带
  // CF-Connecting-IP（Cloudflare 自己加，访客去不掉），本机的探针不带（1a 评审遗留 #9）。
  test("/readyz 只回答本机的探针：带 CF-Connecting-IP 的一律 404，也不跑检查", async () => {
    let ran = 0;
    const { deps } = testAppDeps({
      checks: {
        db: async () => {
          ran += 1;
        },
      },
    });
    const app = createApp(deps);

    const outside = await app.request("/readyz", { headers: { "cf-connecting-ip": "203.0.113.7" } });
    expect(outside.status).toBe(404);
    expect(await outside.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
    expect(ran).toBe(0);
    expect((await app.request("/readyz")).status).toBe(200);
    expect(ran).toBe(1);
  });

  test("/readyz 的失败原因同样不带查询参数", async () => {
    const { deps, logs } = testAppDeps({
      checks: {
        db: async () => {
          throw new DrizzleQueryError("select $1::text", ["sess_secret_token"], new Error("boom"));
        },
      },
    });
    const res = await createApp(deps).request("/readyz");

    expect(res.status).toBe(503);
    expect(logs().find((entry) => entry.event === "readiness_check_failed")).toMatchObject({
      check: "db",
      query: "select $1::text",
    });
    expect(JSON.stringify(logs())).not.toContain("sess_secret_token");
  });

  test("/api 按 IP 限流，每分钟 300 次", async () => {
    const { deps } = testAppDeps({ rateLimitStore: createMemoryRateLimitStore() });
    const app = createApp(deps);
    const headers = { "cf-connecting-ip": "198.51.100.1" };

    for (let i = 0; i < 300; i++) {
      expect((await app.request("/api/anything", { headers })).status).toBe(404);
    }
    expect((await app.request("/api/anything", { headers })).status).toBe(429);
    // 别的 IP 不受影响；页面和健康检查不走这条规则。
    expect((await app.request("/api/anything", { headers: { "cf-connecting-ip": "198.51.100.2" } })).status).toBe(404);
    expect((await app.request("/healthz", { headers })).status).toBe(200);
  });

  // 服务端渲染时 loader 经进程内 API 调 /api/v1（in-process-api.ts），一次页面请求要调好几个接口。这些调用要是也按访客的
  // IP 计数，同一个 IP 后面的很多人（运营商的 CGNAT、学校、公司）刷几下页面，页面就因为接口 429 渲染出错。
  test("进程内请求（服务端渲染时 loader 调接口）不占 /api 按 IP 的额度", async () => {
    const { deps } = testAppDeps({ rateLimitStore: createMemoryRateLimitStore() });
    const app = createApp(deps);
    const ip = "198.51.100.3";
    for (let i = 0; i < 300; i++) {
      await app.request("/api/anything", { headers: { "cf-connecting-ip": ip } });
    }
    expect((await app.request("/api/v1/meta", { headers: { "cf-connecting-ip": ip } })).status).toBe(429);

    const page = new Request(`${TEST_PUBLIC_ORIGIN}/`, { headers: { "cf-connecting-ip": ip } });
    const api = createInProcessApi(app, page, { origin: TEST_PUBLIC_ORIGIN, requestId: "r1", clientIp: ip }, () => {});
    expect((await api.api.v1.meta.$get()).status).toBe(200);
  });

  // Redis 整段宕掉时，每个请求都会在限流这一步出错一次：照原样记，日志会被同一行刷满（1a 评审 R14）。
  test("限流的计数存储出错：照常放行，rate_limit_store_error 一分钟最多记一条", async () => {
    const broken: RateLimitStore = {
      hit: async () => {
        throw new Error("Connection closed");
      },
    };
    const { deps, logs } = testAppDeps({ rateLimitStore: broken });
    const app = createApp(deps);

    for (let i = 0; i < 5; i++) {
      expect((await app.request("/api/v1/meta")).status).toBe(200);
    }
    expect(logs().filter((entry) => entry.event === "rate_limit_store_error")).toHaveLength(1);
  });

  test("GET /api/v1/meta", async () => {
    const res = await createApp(testAppDeps().deps).request("/api/v1/meta");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "astrodx-community", apiVersion: 1 });
  });

  // /api/v1/me 这类是每个用户自己的数据：接口的响应一律不让浏览器和 Cloudflare 缓存，出错的也一样。
  test("/api 的响应都带 Cache-Control: private, no-store：正常的、未知接口的 404、未登录的 401", async () => {
    const app = createApp(testAppDeps().deps);
    const cases = [
      ["/api/v1/meta", 200],
      ["/api/nope", 404],
      ["/api/v1/me", 401],
    ] as const;

    for (const [path, status] of cases) {
      const res = await app.request(path);
      expect(res.status, path).toBe(status);
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
    }
  });

  // 登录页用它拿 Turnstile 的站点密钥和 QQ 登录能不能用；不要求登录，所以这里不带 Cookie。
  test("GET /api/v1/login-options：不用登录，返回 testAppDeps 里的那份配置", async () => {
    const res = await createApp(testAppDeps().deps).request("/api/v1/login-options");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      turnstileSiteKey: "1x00000000000000000000AA",
      qq: { available: true, botQq: "10001" },
    });
  });

  test("GET /api/v1/login-options 返回的是服务给出的值，QQ 登录不可用时也一样", async () => {
    const { deps } = testAppDeps();
    const loginOptions = async () => ({ turnstileSiteKey: "site", qq: { available: false, botQq: "10001" } });

    const res = await createApp({ ...deps, services: { ...deps.services, loginOptions } }).request(
      "/api/v1/login-options"
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(await loginOptions());
  });

  test("/api/v1 的写请求要过 CSRF 检查", async () => {
    const res = await createApp(testAppDeps().deps).request("/api/v1/meta", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(res.status).toBe(415);
  });

  test("/api/auth/* 按 IP 每分钟 30 次，同一个 /64 里的 IPv6 地址共用计数", async () => {
    const app = createApp(testAppDeps().deps);
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const ip = i % 2 === 0 ? "2001:db8:1:2::a" : "2001:db8:1:2::b";
      statuses.push((await app.request("/api/auth/ok", { headers: { "cf-connecting-ip": ip } })).status);
    }

    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

// 没有请求体的请求（空的请求体流，没有 Content-Length 和 Transfer-Encoding，curl -X DELETE 就是这样）不能被请求体上限读取：
// 开发服务器里它一读，就把这个请求换成丢了方法的 GET（middleware/body-limit.ts）。这里的 Request 是原生的，方法丢不了，
// 能看到的是：请求体流没被读过，交给处理函数的还是原来那个对象。
describe("没有请求体的请求不被请求体上限读取", () => {
  // Node 要求流式请求体带 duplex，Bun 不在乎；TS 的 RequestInit 里没有它，所以要断言一下。
  function bodylessRequest(method: string, path: string) {
    return new Request(`${TEST_PUBLIC_ORIGIN}${path}`, {
      method,
      headers: { origin: TEST_PUBLIC_ORIGIN, "content-type": "application/json" },
      body: new ReadableStream({ start: (controller) => controller.close() }),
      duplex: "half",
    } as RequestInit);
  }

  test("/api/v1/*：撤销注销用的 DELETE", async () => {
    const request = bodylessRequest("DELETE", "/api/v1/me/deletion");

    const res = await createApp(testAppDeps().deps).request(request);

    // 没登录，一路走到接口才 401：前面的中间件（包括请求体上限）都放行了。
    expect(res.status).toBe(401);
    expect(request.bodyUsed).toBe(false);
  });

  test("/api/auth/*：原样交给 Better Auth", async () => {
    // 这个 auth 是本测试自己建的，换掉 handler 不用还原。
    const { auth } = createTestAuth();
    let received: Request | undefined;
    auth.handler = async (request) => {
      received = request;
      return new Response(null, { status: 204 });
    };
    const request = bodylessRequest("POST", "/api/auth/sign-out");

    const res = await createApp(testAppDeps({ auth }).deps).request(request);

    expect(res.status).toBe(204);
    expect(received).toBe(request);
  });
});
