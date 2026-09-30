import { describe, expect, test } from "bun:test";
import { RouterContextProvider } from "react-router";

import type { ApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { loginHref, requireUser } from "./require-user";

describe("loginHref", () => {
  test("带上 next；额外参数一并编码", () => {
    expect(loginHref("/settings/account")).toBe("/login?next=%2Fsettings%2Faccount");
    expect(loginHref("/settings/account", { reauth: "1" })).toBe("/login?next=%2Fsettings%2Faccount&reauth=1");
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
