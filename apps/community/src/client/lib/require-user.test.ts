import { describe, expect, test } from "bun:test";
import { RouterContextProvider } from "react-router";

import type { ApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { googleRedirects, loginHref, onboardingHref, requireUser, signedInHref } from "./require-user";

describe("loginHref", () => {
  test("带上 next；额外参数一并编码", () => {
    expect(loginHref("/settings/account")).toBe("/login?next=%2Fsettings%2Faccount");
    expect(loginHref("/settings/account", { reauth: "1" })).toBe("/login?next=%2Fsettings%2Faccount&reauth=1");
  });
});

describe("onboardingHref", () => {
  test("引导页带上看完要回去的地址", () => {
    expect(onboardingHref("/settings/account")).toBe("/onboarding?next=%2Fsettings%2Faccount");
    expect(onboardingHref("/")).toBe("/onboarding?next=%2F");
  });
});

describe("登录成功后去的地址", () => {
  test("老用户回 next，新用户先去引导页；# 后面带上登录方式（统计的 login 事件）", () => {
    expect(signedInHref("/settings/account", "qq", false)).toBe("/settings/account#login=qq");
    expect(signedInHref("/settings/account", "passkey", true)).toBe(
      "/onboarding?next=%2Fsettings%2Faccount#login=passkey"
    );
  });

  test("Google：成功的两个回跳地址带标记，出错回登录页的不带", () => {
    expect(googleRedirects("/u/abc2345678", false)).toEqual({
      callbackURL: "/u/abc2345678#login=google",
      newUserCallbackURL: "/onboarding?next=%2Fu%2Fabc2345678#login=google",
      errorCallbackURL: "/login?next=%2Fu%2Fabc2345678",
    });
    expect(googleRedirects("/settings/account", true).errorCallbackURL).toBe(
      "/login?next=%2Fsettings%2Faccount&reauth=1"
    );
  });
});

// 只实现 requireUser 会调用的 api.v1.me.$get，其余的它用不到。QueryClient 用真的（和服务端每个请求一份的那个一样）。
function contextWithMe(respond: () => Response) {
  const queryClient = makeQueryClient();
  const api = { api: { v1: { me: { $get: async () => respond() } } } } as unknown as ApiClient;
  const context = new RouterContextProvider();
  context.set(queryClientContext, queryClient);
  context.set(apiContext, api);
  return { context, queryClient };
}

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("应当抛出");
}

describe("requireUser", () => {
  test("未登录（/api/v1/me 返回 401）：抛出跳到登录页的重定向，next 是当前地址", async () => {
    const { context } = contextWithMe(() => new Response(null, { status: 401 }));

    const thrown = await thrownBy(requireUser(context, new URL("https://x.test/settings/account?tab=1")));

    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(loginHref("/settings/account?tab=1"));
    expect(response.headers.get("location")).toBe("/login?next=%2Fsettings%2Faccount%3Ftab%3D1");
  });

  test("已登录：原样返回这个用户，并留在本次请求的 QueryClient 里", async () => {
    const user: Awaited<ReturnType<typeof requireUser>> = {
      id: "abc2345678",
      name: "阿丁",
      image: null,
      status: "active",
      createdAt: "2026-09-29T00:00:00.000Z",
      deletionPurgeAt: null,
    };
    const { context, queryClient } = contextWithMe(() => Response.json(user));

    expect(await requireUser(context, new URL("https://x.test/settings/account"))).toEqual(user);
    expect(queryClient.getQueryData<typeof user>(["me"])).toEqual(user);
  });
});
