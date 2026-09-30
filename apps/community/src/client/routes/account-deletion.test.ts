import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { MemoryRouter, RouterContextProvider } from "react-router";

import { m } from "@/paraglide/messages.js";
import type { ApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { loginHref } from "../lib/require-user";
import AccountDeletion, { loader, meta } from "./account-deletion";

const PURGE_AT = "2026-10-06T08:00:00.000Z";

type LoaderArgs = Parameters<typeof loader>[0];
type LoaderData = Awaited<ReturnType<typeof loader>>;
type Visit = { redirect: string | null } | { data: LoaderData };

// 只实现注销提示页 loader 会调用的 /api/v1/me。status 是 null 表示没登录。
function contextFor(status: string | null) {
  const me = { id: "abc2345678", name: "阿丁", image: null, status, createdAt: "", deletionPurgeAt: status === "pending_deletion" ? PURGE_AT : null };
  const api = {
    api: { v1: { me: { $get: async () => (status ? Response.json(me) : new Response(null, { status: 401 })) } } },
  } as unknown as ApiClient;
  const context = new RouterContextProvider();
  context.set(queryClientContext, makeQueryClient());
  context.set(apiContext, api);
  return context;
}

async function visit(status: string | null): Promise<Visit> {
  const args = { context: contextFor(status), url: new URL("https://x.test/account-deletion") } as unknown as LoaderArgs;
  try {
    return { data: await loader(args) };
  } catch (thrown) {
    if (thrown instanceof Response) {
      return { redirect: thrown.headers.get("location") };
    }
    throw thrown;
  }
}

describe("注销提示页 loader", () => {
  test("没登录：去登录页，登录后回来", async () => {
    expect(await visit(null)).toEqual({ redirect: loginHref("/account-deletion") });
  });

  test("正常状态的用户：回首页", async () => {
    expect(await visit("active")).toEqual({ redirect: "/" });
  });

  test("注销中：渲染页面，dehydrate 带着当前用户（有清除时间）", async () => {
    const result = await visit("pending_deletion");
    if (!("data" in result)) {
      throw new Error(`应当渲染页面，实际被跳转到 ${result.redirect}`);
    }

    const me = result.data.dehydratedState.queries.find((query) => query.queryKey[0] === "me");
    expect(me?.state.data).toMatchObject({ status: "pending_deletion", deletionPurgeAt: PURGE_AT });
  });
});

describe("注销提示页渲染", () => {
  // 剩下几天取决于现在的时间：hydrate 之前（服务端渲染）不输出，只给标题和两个按钮。
  test("服务端渲染：标题、撤销注销和退出登录；不输出日期和剩余天数", async () => {
    const result = await visit("pending_deletion");
    if (!("data" in result)) {
      throw new Error("应当渲染页面");
    }
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: makeQueryClient() },
        createElement(
          MemoryRouter,
          { initialEntries: ["/account-deletion"] },
          createElement(AccountDeletion as unknown as ComponentType<{ loaderData: LoaderData }>, { loaderData: result.data })
        )
      )
    );

    expect(html).toContain(m.account_deletion_title());
    expect(html).toContain(`>${m.account_deletion_cancel()}</button>`);
    expect(html).toContain(`>${m.settings_sign_out()}</button>`);
    expect(html).not.toContain(m.account_deletion_cancel_hint());
    expect(html).not.toContain(m.account_deletion_due());
  });

  test("不收录", () => {
    expect(meta()).toContainEqual({ name: "robots", content: "noindex" });
  });
});
