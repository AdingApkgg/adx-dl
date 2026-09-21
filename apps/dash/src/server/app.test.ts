import { describe, expect, test } from "bun:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { createApp, type AppDeps } from "./app";
import { createFakeGitHubClient } from "./github/fake-client";

const TEAM = "https://example.cloudflareaccess.com";
const AUD = "aud-tag-abc";

/** 造一组测试密钥，返回可注入的 accessConfig 与一个合法断言。 */
async function makeAccess() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";

  const assertion = await new SignJWT({ email: "someone@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt()
    .setSubject("user-1")
    .setIssuer(TEAM)
    .setAudience(AUD)
    .setExpirationTime("1h")
    .sign(privateKey);

  return {
    config: { teamDomain: TEAM, aud: AUD, getKey: createLocalJWKSet({ keys: [jwk] }) },
    assertion,
  };
}

async function makeApp(overrides: Partial<AppDeps> = {}) {
  const access = await makeAccess();
  const deps: AppDeps = {
    clientRoot: "./build/client",
    github: createFakeGitHubClient(),
    accessConfig: access.config,
    ...overrides,
  };
  return { app: createApp(deps), assertion: access.assertion };
}

describe("createApp", () => {
  test("GET /api/ping 不需要鉴权就能通", async () => {
    // 健康检查在 Access 中间件之前：docker 的 healthcheck 拿不到断言，
    // 而它要回答的只是「进程还活着吗」。
    const { app } = await makeApp();

    const res = await app.request("/api/ping");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("没有 Access 断言时，受保护路径 403", async () => {
    const { app } = await makeApp();

    const res = await app.request("/api/me");

    expect(res.status).toBe(403);
  });

  test("未鉴权时连「路径存不存在」都不该泄漏", async () => {
    // 这里是 403 而不是 404：中间件在路由之前，没通过鉴权的请求不该
    // 能靠状态码探出哪些端点存在。
    const { app } = await makeApp();

    const res = await app.request("/api/does-not-exist");

    expect(res.status).toBe(403);
  });

  test("已鉴权时，未知的 /api 路径回 JSON 404 而不是 SPA 的 index.html", async () => {
    // 防的是一类很具体的 bug：SPA fallback 写成 app.get("*") 会把 /api/typo
    // 也吞掉，回 200 + HTML，前端拿一坨 HTML 去 JSON.parse，报出的错和真实
    // 原因毫无关系。
    const { app, assertion } = await makeApp();

    const res = await app.request("/api/does-not-exist", {
      headers: { "Cf-Access-Jwt-Assertion": assertion },
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("已鉴权时 /api/me 通", async () => {
    const { app, assertion } = await makeApp();

    const res = await app.request("/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": assertion },
    });

    expect(res.status).toBe(200);
  });
});
