import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { shortId } from "../../src/server/auth/short-id";
import { session, user } from "../../src/server/db/schema";
import { testDbHandle } from "../../src/server/testing/test-db";
import { HTTP_TEST_AUTH_SECRET, type RunningServer, startBuiltServer } from "./server";

const DAY_MS = 24 * 60 * 60 * 1000;
// HTTP 测试走 http，会话 Cookie 不带 __Secure- 前缀。
const SESSION_COOKIE = "adxc.session_token";

// 往测试库里直接放一个用户和一个"该续期了"的会话（上次续期在两天前，还剩 28 天过期），再用构建产物的
// 密钥照 Better Auth 的方式签出会话 Cookie。HTTP 测试走不通真的登录：Google、Turnstile 都要连外网。
async function seedSessionDueForRenewal(name: string) {
  const { db } = testDbHandle();
  const id = shortId();
  await db.insert(user).values({ id, name, email: `${id}@placeholder.invalid` });
  const token = crypto.randomUUID().replaceAll("-", "");
  const now = Date.now();
  await db.insert(session).values({
    token,
    userId: id,
    expiresAt: new Date(now + 28 * DAY_MS),
    createdAt: new Date(now - 2 * DAY_MS),
    updatedAt: new Date(now - 2 * DAY_MS),
  });
  const signed = `${token}.${await makeSignature(token, HTTP_TEST_AUTH_SECRET)}`;
  return { token, cookie: `${SESSION_COOKIE}=${encodeURIComponent(signed)}` };
}

async function expiresAtOf(token: string): Promise<number | undefined> {
  const [row] = await testDbHandle()
    .db.select({ expiresAt: session.expiresAt })
    .from(session)
    .where(eq(session.token, token));
  return row?.expiresAt.getTime();
}

function sessionCookiesIn(res: Response): string[] {
  return res.headers.getSetCookie().filter((line) => line.startsWith(`${SESSION_COOKIE}=`));
}

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

  // 只查授权地址。"网页响应里没有 set-auth-token"在这里查不出来：发起登录的响应本来就不设会话 Cookie，
  // bearer 插件也就不会加这个头。真正的检查在 src/server/auth/auth.test.ts（登录回调、会话续期的响应）。
  test("发起 Google 登录返回 Google 的授权地址", async () => {
    const res = await fetch(server.url("/api/auth/sign-in/social"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ provider: "google", callbackURL: "/" }),
    });
    const body = (await res.json()) as { url?: string };

    expect(res.status).toBe(200);
    expect(body.url?.startsWith("https://accounts.google.com/")).toBe(true);
  });

  test("/api/v1/login-options 给出 Turnstile 站点密钥和 QQ 状态", async () => {
    const res = await fetch(server.url("/api/v1/login-options"));

    expect(await res.json()).toEqual({
      turnstileSiteKey: "1x00000000000000000000AA",
      qq: { available: true, botQq: "10001" },
    });
  });
});

// 每天第一次打开网站多半是服务端渲染：续期发生在 loader 经进程内 API 发的请求里。新的 Cookie 要跟着
// 页面响应回到浏览器，否则 Cookie 永远停在登录后第 30 天过期，天天用也会被登出。
describe("服务端渲染时的会话续期", () => {
  test("文档请求：页面响应带回 30 天的会话 Cookie，库里的有效期也延长到约 30 天后", async () => {
    const { token, cookie } = await seedSessionDueForRenewal("续期测试");

    const res = await fetch(server.url("/"), { headers: { cookie } });
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain("已登录：续期测试");
    const renewed = sessionCookiesIn(res);
    expect(renewed).toHaveLength(1);
    expect(renewed[0]).toContain("Max-Age=2592000");
    expect(await expiresAtOf(token)).toBeGreaterThan(Date.now() + 29 * DAY_MS);
  });

  // 站内切换页面时浏览器请求的是 .data（首页是 /_.data），loader 一样经进程内 API 续期。
  test(".data 请求：响应同样带回 30 天的会话 Cookie", async () => {
    const { token, cookie } = await seedSessionDueForRenewal("续期测试");

    const res = await fetch(server.url("/_.data"), { headers: { cookie } });
    await res.text();

    expect(res.status).toBe(200);
    const renewed = sessionCookiesIn(res);
    expect(renewed).toHaveLength(1);
    expect(renewed[0]).toContain("Max-Age=2592000");
    expect(await expiresAtOf(token)).toBeGreaterThan(Date.now() + 29 * DAY_MS);
  });

  // 会话已经被删掉（比如同一个浏览器重新登录过）时，进程内的请求也不能把"清掉 Cookie"带到页面上。
  test("会话已经被删掉：页面响应不带任何 Set-Cookie", async () => {
    const { token, cookie } = await seedSessionDueForRenewal("续期测试");
    await testDbHandle().db.delete(session).where(eq(session.token, token));

    const res = await fetch(server.url("/"), { headers: { cookie } });
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('href="/login?next=%2F"');
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});
