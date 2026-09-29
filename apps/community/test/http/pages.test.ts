import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { type RunningServer, startBuiltServer } from "./server";

let server: RunningServer;

beforeAll(async () => {
  server = await startBuiltServer();
}, 30_000);

afterAll(() => {
  server.stop();
});

describe("页面", () => {
  test("首页：中文，200，不缓存", async () => {
    const res = await fetch(server.url("/"));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toContain('<html lang="zh-CN"');
  });

  // 漏掉 nonce 的内联脚本会被 CSP 拦下，页面在生产环境就 hydrate 不起来，而开发环境
  // 只报告不拦截，看不出来。
  test("每个内联脚本都带着本次响应 CSP 里的 nonce", async () => {
    const res = await fetch(server.url("/"));
    const html = await res.text();
    const nonce = /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];
    const inlineScripts = (html.match(/<script\b[^>]*>/g) ?? []).filter((tag) => !/\ssrc=/.test(tag));

    expect(nonce).toBeTruthy();
    expect(inlineScripts.length).toBeGreaterThan(0);
    for (const tag of inlineScripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });

  test("首页经由进程内 API 拿到了数据", async () => {
    expect(await (await fetch(server.url("/"))).text()).toContain("接口版本 v1");
  });

  // 首页的 loader 经进程内 API 问了当前用户（没登录是 401），页面据此显示"登录"链接。
  test("首页：未登录显示登录链接，登录后回到首页", async () => {
    const html = await (await fetch(server.url("/"))).text();

    expect(html).toContain('href="/login?next=%2F"');
    expect(html).not.toContain('href="/settings/account"');
  });

  // 文案对了，说明 Paraglide 的中间件把语言带进了服务端渲染。
  test("英文和日文前缀：服务端用对应的语言渲染", async () => {
    const en = await (await fetch(server.url("/en"))).text();
    const ja = await (await fetch(server.url("/ja/"))).text();

    expect(en).toContain('<html lang="en"');
    expect(en).toContain("AstroDX Community");
    expect(en).toContain("API v1");
    expect(ja).toContain('<html lang="ja"');
    expect(ja).toContain("AstroDX コミュニティ");
  });

  test("/zh 前缀 301 到不带前缀的地址", async () => {
    const res = await fetch(server.url("/zh/foo?x=1"), { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/foo?x=1");
  });

  // Cloudflare 原样转发路径，//evil.com 这样的 Location 会把访客带到别的站。
  test("/zh//evil.com 仍然跳回本站", async () => {
    const res = await fetch(server.url("/zh//evil.com"), { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/evil.com");
  });

  test("未知地址返回真正的 404，也不缓存", async () => {
    const res = await fetch(server.url("/definitely-missing"));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("英文下的未知地址也是 404，用英文显示", async () => {
    const res = await fetch(server.url("/en/definitely-missing"));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Page not found");
  });

  test("大小写不对的语言前缀也是 404", async () => {
    expect((await fetch(server.url("/EN"))).status).toBe(404);
  });

  test("构建产物带 immutable", async () => {
    const html = await (await fetch(server.url("/"))).text();
    const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0];

    expect(asset).toBeTruthy();
    const res = await fetch(server.url(asset ?? ""));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  test("Permissions-Policy 没有禁用通行密钥", async () => {
    const policy = (await fetch(server.url("/"))).headers.get("permissions-policy") ?? "";
    expect(policy).toContain("camera=()");
    expect(policy).not.toContain("publickey-credentials");
  });
});

describe("接口和健康检查", () => {
  test("GET /api/v1/meta", async () => {
    const res = await fetch(server.url("/api/v1/meta"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "astrodx-community", apiVersion: 1 });
  });

  test("未知接口返回 JSON 404", async () => {
    const res = await fetch(server.url("/api/v1/nope"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  test("表单提交被 CSRF 规则拒绝", async () => {
    const res = await fetch(server.url("/api/v1/meta"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: server.origin },
      body: "a=1",
    });
    expect(res.status).toBe(415);
  });

  test("/readyz：PG 和 Redis 都可用", async () => {
    const res = await fetch(server.url("/readyz"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: { db: "ok", redis: "ok" } });
  });
});
