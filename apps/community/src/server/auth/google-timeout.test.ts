import { describe, expect, test } from "bun:test";

import { createApp } from "../app";
import { testAppDeps } from "../testing/app-deps";
import { createTestAuth } from "../testing/auth";
import { Browser } from "../testing/auth-browser";
import { limitGoogleTokenExchange } from "./google-timeout";

// 代理出问题时，换令牌的请求连不上 Google 也不报错，就一直挂着：这里让它永远不返回。
function installHangingGoogle(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://oauth2.googleapis.com/token") {
      return new Promise<Response>(() => {});
    }
    throw new Error(`unexpected network call in a test: ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("Google 换令牌的超时", () => {
  test("Google 一直不回：到时间就按换令牌失败处理，跳回登录页并带上 error，日志里有超时", async () => {
    const { auth, logs } = createTestAuth();
    await limitGoogleTokenExchange(auth, 200);
    const browser = new Browser(createApp(testAppDeps({ auth }).deps));
    const start = await browser.request("POST", "/api/auth/sign-in/social", {
      body: { provider: "google", callbackURL: "/", errorCallbackURL: "/login" },
    });
    const state = new URL(start.json.url).searchParams.get("state") ?? "";

    const restore = installHangingGoogle();
    const started = performance.now();
    try {
      const callback = await browser.request(
        "GET",
        `/api/auth/callback/google?code=fake-code&state=${encodeURIComponent(state)}`,
        { origin: null }
      );
      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe("/login?error=invalid_code");
    } finally {
      restore();
    }
    expect(performance.now() - started).toBeLessThan(2000);
    expect(logs().some((entry) => entry.event === "better_auth" && entry.message === "timed out after 200ms")).toBe(true);
  });
});
