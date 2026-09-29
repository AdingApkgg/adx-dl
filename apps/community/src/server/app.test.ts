import { describe, expect, test } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { createApp } from "./app";
import { createMemoryRateLimitStore } from "./middleware/rate-limit";
import { testAppDeps } from "./testing/app-deps";

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

  test("GET /api/v1/meta", async () => {
    const res = await createApp(testAppDeps().deps).request("/api/v1/meta");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "astrodx-community", apiVersion: 1 });
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
