import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { MemoryRouter, RouterContextProvider } from "react-router";

import { m } from "@/paraglide/messages.js";
import type { ApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";
import { apiContext, queryClientContext } from "@/shared/router-context";

import Login, { loader } from "./login";

const USER = { id: "abc2345678", name: "阿丁", image: null, status: "active", createdAt: "2026-09-29T00:00:00.000Z" };
const OPTIONS = { turnstileSiteKey: "site", qq: { available: true, botQq: "10001" } };

type LoaderArgs = Parameters<typeof loader>[0];
type LoaderData = Awaited<ReturnType<typeof loader>>;
type Visit = { redirect: { status: number; location: string | null } } | { data: LoaderData };
/** 让 /api/v1/me 返回这个错误状态码（限流 429、服务端出错 5xx）。 */
type Failures = { meStatus?: number };

// 只实现登录页 loader 会调用的两个接口（/api/v1/me 和 /api/v1/login-options）。QueryClient 用真的
// （和服务端每个请求一份的那个一样）。
function contextFor(signedIn: boolean, { meStatus }: Failures = {}) {
  const api = {
    api: {
      v1: {
        me: {
          $get: async () => {
            if (meStatus) {
              return new Response(null, { status: meStatus });
            }
            return signedIn ? Response.json(USER) : new Response(null, { status: 401 });
          },
        },
        "login-options": { $get: async () => Response.json(OPTIONS) },
      },
    },
  } as unknown as ApiClient;
  const context = new RouterContextProvider();
  context.set(queryClientContext, makeQueryClient());
  context.set(apiContext, api);
  return context;
}

// 访问 /login：要么渲染（返回 loader 的数据），要么被 loader 跳走（redirect() 抛出的是 Response）。
async function visit(signedIn: boolean, search = "", failures: Failures = {}): Promise<Visit> {
  const args = {
    context: contextFor(signedIn, failures),
    url: new URL(`https://x.test/login${search}`),
  } as unknown as LoaderArgs;
  try {
    return { data: await loader(args) };
  } catch (thrown) {
    if (thrown instanceof Response) {
      return { redirect: { status: thrown.status, location: thrown.headers.get("location") } };
    }
    throw thrown;
  }
}

function renderedData(result: Visit): LoaderData {
  if (!("data" in result)) {
    throw new Error(`应当渲染登录页，实际被跳转到 ${result.redirect.location}`);
  }
  return result.data;
}

describe("登录页 loader", () => {
  test("未登录：渲染页面，不跳转；dehydrate 带着 me（null）和登录方式", async () => {
    const { dehydratedState } = renderedData(await visit(false, "?next=%2Fsettings%2Faccount"));

    const byKey = Object.fromEntries(dehydratedState.queries.map((query) => [String(query.queryKey[0]), query.state.data]));
    expect(byKey.me).toBeNull();
    expect(byKey["login-options"]).toEqual(OPTIONS);
  });

  test("已登录：302 到 next", async () => {
    expect(await visit(true, "?next=%2Fsettings%2Faccount")).toEqual({
      redirect: { status: 302, location: "/settings/account" },
    });
  });

  test("已登录但没有 next：回首页", async () => {
    expect(await visit(true)).toEqual({ redirect: { status: 302, location: "/" } });
  });

  // 登录后跳回的地址只认站内路径（safeNextPath）：别的网站的地址一律换成首页。
  test("已登录，next 指向别的网站（//evil.com、/\\evil.com、https://evil.com）：一律回首页", async () => {
    for (const next of ["//evil.com", "/\\evil.com", "https://evil.com"]) {
      expect(await visit(true, `?next=${encodeURIComponent(next)}`), next).toEqual({
        redirect: { status: 302, location: "/" },
      });
    }
  });

  // "重新登录"要的正是一个刚创建的会话，所以已登录也要显示登录页。
  test("已登录且 reauth=1：不跳转，dehydrate 带着当前用户", async () => {
    const { dehydratedState } = renderedData(await visit(true, "?reauth=1&next=%2Fsettings%2Faccount"));

    const me = dehydratedState.queries.find((query) => query.queryKey[0] === "me");
    expect(me?.state.data).toEqual(USER);
  });

  test("已登录，reauth 不是 1（比如 0）：照常跳走", async () => {
    expect(await visit(true, "?reauth=0&next=%2Fsettings%2Faccount")).toEqual({
      redirect: { status: 302, location: "/settings/account" },
    });
  });

  // Google 登录出错时 Better Auth 把用户送回 errorCallbackURL 并在后面接上 &error=。
  // "重新登录"的用户（已登录）要靠地址里的 reauth=1 才留得在页面上，看到错误提示。
  test("已登录、reauth=1、带 error：不跳转", async () => {
    renderedData(await visit(true, "?next=%2Fsettings%2Faccount&reauth=1&error=state_mismatch"));
  });

  // Google 回调的 state 过期这类错误，Better Auth 走全局的 errorURL（/login?error=…，不带 reauth）：
  // 已登录的用户要是被直接跳走，就看不到错误提示了。
  test("已登录、带 error、没有 reauth：也不跳转", async () => {
    renderedData(await visit(true, "?error=state_mismatch"));
  });
});

// 和首页一样：当前用户取不到（429 限流、5xx）时照常显示成未登录，不进错误页。
describe("登录页 loader：当前用户取不到", () => {
  // 500 会被查询客户端重试一次（间隔约 1 秒）才算失败，429 这类 4xx 不重试。
  for (const status of [429, 500]) {
    test(`/api/v1/me 返回 ${status}：照常渲染成未登录，登录方式照样在`, async () => {
      // 用户其实登录着也一样：取不到就当没登录，不能猜。
      const data = renderedData(await visit(true, "?next=%2Fsettings%2Faccount", { meStatus: status }));
      const html = renderLoaderData(data, "?next=%2Fsettings%2Faccount");

      expect(data.dehydratedState.queries.map((query) => String(query.queryKey[0]))).toEqual(["login-options"]);
      expect(html).toContain(m.login_google());
      expect(html).toContain(m.login_passkey_signup());
    });
  }
});

// 页面按 loader 的数据渲染出来的样子。服务端渲染只输出静态标记（不跑 effect 和事件），
// 这里要的正是这个：登录页在服务端渲染时该有哪些块。
async function renderLogin(signedIn: boolean, search = ""): Promise<string> {
  return renderLoaderData(renderedData(await visit(signedIn, search)), search);
}

function renderLoaderData(data: LoaderData, search = ""): string {
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: makeQueryClient() },
      createElement(
        MemoryRouter,
        { initialEntries: [`/login${search}`] },
        createElement(Login as unknown as ComponentType<{ loaderData: LoaderData }>, { loaderData: data })
      )
    )
  );
}

describe("登录页渲染", () => {
  test("未登录：Google、QQ、通行密钥登录和只用通行密钥注册都在", async () => {
    const html = await renderLogin(false);

    expect(html).toContain(m.login_google());
    expect(html).toContain(m.login_qq_heading());
    expect(html).toContain(m.login_passkey_sign_in());
    expect(html).toContain(m.login_passkey_signup_heading());
    expect(html).toContain(m.login_passkey_signup());
    expect(html).not.toContain(m.login_reauth_notice());
  });

  // 已登录时（重新登录模式）插件会用当前会话的用户、跳过注册的校验：这个表单会把通行密钥加到
  // 当前账号上再跳去欢迎页，所以不能显示；通行密钥登录的按钮保留，它能建一个新会话。
  test("已登录（重新登录）：不显示只用通行密钥注册，通行密钥登录的按钮保留", async () => {
    const html = await renderLogin(true, "?reauth=1&next=%2Fsettings%2Faccount");

    expect(html).toContain(m.login_reauth_notice());
    expect(html).toContain(m.login_passkey_heading());
    expect(html).toContain(m.login_passkey_sign_in());
    expect(html).not.toContain(m.login_passkey_signup_heading());
    expect(html).not.toContain(m.login_passkey_signup());
    expect(html).not.toContain('name="nickname"');
    // 其他登录方式不受影响。
    expect(html).toContain(m.login_google());
    expect(html).toContain(m.login_qq_heading());
  });

  test("已登录、reauth=1、Google 出错回来：错误提示看得到", async () => {
    const html = await renderLogin(true, "?next=%2Fsettings%2Faccount&reauth=1&error=state_mismatch");

    expect(html).toContain(m.error_google_failed());
  });

  test("已登录、没有 reauth、Google 出错回来（全局的 errorURL）：错误提示也看得到", async () => {
    const html = await renderLogin(true, "?error=state_mismatch");

    expect(html).toContain(m.error_google_failed());
  });
});
