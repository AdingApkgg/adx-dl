import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { DrizzleQueryError } from "drizzle-orm";

import { createLogger } from "@/shared/log";

import { withSafeAuthErrors } from "./safe-handler";

const ORIGIN = "https://community.test";

function fixture() {
  const lines: string[] = [];
  const log = createLogger((line) => lines.push(line));
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: "safe-handler-test-secret-at-least-thirty-two-characters",
    logger: { disabled: true },
    onAPIError: { throw: true },
    plugins: [{
      id: "safe-handler-test",
      endpoints: {
        denied: createAuthEndpoint("/fixture-denied", { method: "GET" }, async () => {
          throw new APIError("FORBIDDEN", { code: "FIXTURE_DENIED", message: "Not allowed" }, {
            "retry-after": "30",
            "set-cookie": "challenge=; Max-Age=0; Path=/; HttpOnly",
          });
        }),
        crash: createAuthEndpoint("/fixture-crash", { method: "GET" }, async () => {
          throw new DrizzleQueryError("delete from session where token = $1", ["private-session-token"], new Error("database unavailable"));
        }),
        redirect: createAuthEndpoint("/fixture-redirect", { method: "GET" }, async () => {
          throw new APIError("FOUND", undefined, { location: "/login", "set-cookie": "oauth=; Max-Age=0; Path=/; HttpOnly" });
        }),
        serverError: createAuthEndpoint("/fixture-server-error", { method: "GET" }, async () => {
          throw new APIError("INTERNAL_SERVER_ERROR", { code: "TRY_LATER", message: "Try later" });
        }),
      },
    }],
  });
  return { handle: withSafeAuthErrors(auth.handler, log), lines, log };
}

describe("认证 HTTP 错误边界", () => {
  test("真实 Better Auth 路由的未知数据库错误只写脱敏日志并返回通用 500", async () => {
    const { handle, lines } = fixture();
    const response = await handle(new Request(`${ORIGIN}/api/auth/fixture-crash`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "INTERNAL", message: "Internal server error" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "better_auth_error", name: "DrizzleQueryError", query: "delete from session where token = $1" });
    expect(lines.join("\n")).not.toContain("private-session-token");
  });

  test("真实路由的普通 APIError 保留错误码、状态和响应头", async () => {
    const { handle, lines } = fixture();
    const response = await handle(new Request(`${ORIGIN}/api/auth/fixture-denied`));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "FIXTURE_DENIED", message: "Not allowed" });
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.getSetCookie()).toEqual(["challenge=; Max-Age=0; Path=/; HttpOnly"]);
    expect(lines).toEqual([]);
  });

  test("跳转和多个 Set-Cookie 原样返回", async () => {
    const { log } = fixture();
    const response = new Response(null, { status: 302, headers: { location: "/login" } });
    response.headers.append("set-cookie", "first=1; Path=/; HttpOnly");
    response.headers.append("set-cookie", "second=2; Path=/; HttpOnly");
    const result = await withSafeAuthErrors(async () => response, log)(new Request(ORIGIN));
    expect(result).toBe(response);
    expect(result.headers.getSetCookie()).toEqual(["first=1; Path=/; HttpOnly", "second=2; Path=/; HttpOnly"]);
  });

  test("真实路由的 FOUND 保留跳转和 Cookie", async () => {
    const { handle, lines } = fixture();
    const response = await handle(new Request(`${ORIGIN}/api/auth/fixture-redirect`));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(response.headers.getSetCookie()).toEqual(["oauth=; Max-Age=0; Path=/; HttpOnly"]);
    expect(lines).toEqual([]);
  });

  test("真实路由的 APIError 500 保留公开响应，仅记录状态", async () => {
    const { handle, lines } = fixture();
    const response = await handle(new Request(`${ORIGIN}/api/auth/fixture-server-error`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "TRY_LATER", message: "Try later" });
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "better_auth_error", status: 500 });
    expect(lines.join("\n")).not.toContain("Try later");
  });

  test("普通未知异常的 message 也不进入日志", async () => {
    const { log, lines } = fixture();
    const handle = withSafeAuthErrors(async () => { throw new Error("request failed with private-session-token"); }, log);
    expect((await handle(new Request(ORIGIN))).status).toBe(500);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "better_auth_error", name: "Error" });
    expect(lines.join("\n")).not.toContain("private-session-token");
  });

  test("已有 500 响应不读取错误正文，只记录状态", async () => {
    const { log, lines } = fixture();
    const response = new Response("private error details", { status: 503 });
    const result = await withSafeAuthErrors(async () => response, log)(new Request(ORIGIN));
    expect(result).toBe(response);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event: "better_auth_error", status: 503 });
    expect(lines.join("\n")).not.toContain("private error details");
    expect(await result.text()).toBe("private error details");
  });
});
