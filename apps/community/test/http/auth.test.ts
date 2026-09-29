import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { type RunningServer, startBuiltServer } from "./server";

let server: RunningServer;

beforeAll(async () => {
  server = await startBuiltServer();
}, 60_000);

afterAll(() => {
  server.stop();
});

describe("登录页", () => {
  test("200、不缓存、不收录，三种登录方式都在", async () => {
    const res = await fetch(server.url("/login"));
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).toContain("用 Google 登录");
    // React 19 的服务端渲染保留驼峰，输出的是 autoComplete，所以不区分大小写地匹配。
    expect(html).toMatch(/autocomplete="username webauthn"/i);
    expect(html).toContain("用通行密钥登录");
    // HTTP 测试用 napcat 模式启动，Redis 里没有机器人状态时当作可用，显示机器人的 QQ 号。
    expect(html).toContain("10001");
  });

  test("/en/login 是英文", async () => {
    const html = await (await fetch(server.url("/en/login"))).text();

    expect(html).toContain('<html lang="en"');
    expect(html).toContain("Sign in with Google");
  });

  test("每个内联脚本都带着本次响应 CSP 里的 nonce", async () => {
    const res = await fetch(server.url("/login"));
    const html = await res.text();
    const nonce = /'nonce-([^']+)'/.exec(res.headers.get("content-security-policy") ?? "")?.[1];
    const inlineScripts = (html.match(/<script\b[^>]*>/g) ?? []).filter((tag) => !/\ssrc=/.test(tag));

    expect(nonce).toBeTruthy();
    expect(inlineScripts.length).toBeGreaterThan(0);
    for (const tag of inlineScripts) {
      expect(tag).toContain(`nonce="${nonce}"`);
    }
  });
});

describe("需要登录的页面", () => {
  test("未登录访问账号设置，跳到登录页并带上原地址", async () => {
    const zh = await fetch(server.url("/settings/account"), { redirect: "manual" });
    const ja = await fetch(server.url("/ja/settings/account"), { redirect: "manual" });

    expect(zh.status).toBe(302);
    expect(zh.headers.get("location")).toBe("/login?next=%2Fsettings%2Faccount");
    expect(ja.headers.get("location")).toBe("/ja/login?next=%2Fja%2Fsettings%2Faccount");
  });

  // 语言校验在路由中间件里，先于子路由的 loader：不认识的前缀直接 404，不会先跳去登录页。
  test("不认识的语言前缀直接 404", async () => {
    const res = await fetch(server.url("/fr/settings/account"), { redirect: "manual" });

    expect(res.status).toBe(404);
  });
});

describe("账号接口", () => {
  test("未登录时取会话是 null", async () => {
    const res = await fetch(server.url("/api/auth/get-session"));

    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  test("关掉的 Better Auth 接口返回 404", async () => {
    const res = await fetch(server.url("/api/auth/update-user"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: "{}",
    });

    expect(res.status).toBe(404);
  });

  test("发起 Google 登录返回授权地址，网页响应里没有会话令牌头", async () => {
    const res = await fetch(server.url("/api/auth/sign-in/social"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    });
    const body = (await res.json()) as { url?: string };

    expect(res.status).toBe(200);
    expect(body.url?.startsWith("https://accounts.google.com/")).toBe(true);
    expect(res.headers.get("set-auth-token")).toBeNull();
  });

  test("/api/v1/login-options 给出 Turnstile 站点密钥和 QQ 状态", async () => {
    const res = await fetch(server.url("/api/v1/login-options"));

    expect(await res.json()).toEqual({
      turnstileSiteKey: "1x00000000000000000000AA",
      qq: { available: true, botQq: "10001" },
    });
  });
});
