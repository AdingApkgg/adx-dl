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
import Onboarding, { loader, meta } from "./onboarding";

const USER = {
  id: "abc2345678",
  name: "QQ 12****89",
  image: null,
  status: "active",
  createdAt: "2026-09-29T00:00:00.000Z",
  deletionPurgeAt: null,
};

type LoaderArgs = Parameters<typeof loader>[0];
type LoaderData = Awaited<ReturnType<typeof loader>>;
type Visit = { redirect: string | null } | { data: LoaderData };

// 只实现引导页 loader 会调用的两个接口（/api/v1/me 和 /api/v1/me/profile）。
function contextFor(signedIn: boolean, onboardedAt: string | null) {
  const api = {
    api: {
      v1: {
        me: {
          $get: async () => (signedIn ? Response.json(USER) : new Response(null, { status: 401 })),
          profile: { $get: async () => Response.json({ name: USER.name, bio: "", onboardedAt }) },
        },
      },
    },
  } as unknown as ApiClient;
  const context = new RouterContextProvider();
  context.set(queryClientContext, makeQueryClient());
  context.set(apiContext, api);
  return context;
}

async function visit(search: string, { signedIn = true, onboardedAt = null as string | null } = {}): Promise<Visit> {
  const args = {
    context: contextFor(signedIn, onboardedAt),
    url: new URL(`https://x.test/onboarding${search}`),
  } as unknown as LoaderArgs;
  try {
    return { data: await loader(args) };
  } catch (thrown) {
    if (thrown instanceof Response) {
      return { redirect: thrown.headers.get("location") };
    }
    throw thrown;
  }
}

function render(result: Visit, search: string): string {
  if (!("data" in result)) {
    throw new Error(`应当渲染引导页，实际被跳转到 ${result.redirect}`);
  }
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: makeQueryClient() },
      createElement(
        MemoryRouter,
        { initialEntries: [`/onboarding${search}`] },
        createElement(Onboarding as unknown as ComponentType<{ loaderData: LoaderData }>, { loaderData: result.data })
      )
    )
  );
}

describe("首次登录引导页 loader", () => {
  test("未登录：跳到登录页，登录后回到引导页", async () => {
    expect(await visit("?next=%2Fsettings%2Faccount", { signedIn: false })).toEqual({
      redirect: loginHref("/onboarding?next=%2Fsettings%2Faccount"),
    });
  });

  // 点过"完成"或"以后再说"就不再显示。
  test("已经看过：直接去 next；next 不是站内地址时回首页", async () => {
    const onboardedAt = "2026-09-29T00:00:00.000Z";

    expect(await visit("?next=%2Fsettings%2Faccount", { onboardedAt })).toEqual({ redirect: "/settings/account" });
    expect(await visit("?next=%2F%2Fevil.com", { onboardedAt })).toEqual({ redirect: "/" });
    expect(await visit("", { onboardedAt })).toEqual({ redirect: "/" });
  });
});

describe("首次登录引导页渲染", () => {
  test("昵称预填；简介、添加通行密钥、去账号设置绑定、完成和以后再说都在", async () => {
    const html = render(await visit("?next=%2F"), "?next=%2F");

    expect(html).toContain(m.onboarding_title());
    expect(html).toContain('value="QQ 12****89"');
    expect(html).toContain('name="bio"');
    expect(html).toContain(m.onboarding_add_passkey());
    expect(html).toContain(`href="/settings/account">${m.onboarding_link_accounts()}</a>`);
    expect(html).toContain(`>${m.onboarding_done()}</button>`);
    expect(html).toContain(`>${m.onboarding_skip()}</button>`);
  });

  test("不收录", () => {
    expect(meta()).toContainEqual({ name: "robots", content: "noindex" });
  });
});
