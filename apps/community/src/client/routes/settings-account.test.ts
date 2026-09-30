import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import type { InferResponseType } from "hono/client";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { MemoryRouter, RouterContextProvider } from "react-router";

import { m } from "@/paraglide/messages.js";
import type { ApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";
import { apiContext, queryClientContext } from "@/shared/router-context";

import { loginHref } from "../lib/require-user";
import SettingsAccount, { loader, meta, returnPath } from "./settings-account";

const NOW = "2026-09-29T00:00:00.000Z";
const USER = { id: "abc2345678", name: "阿丁", image: null, status: "active", createdAt: NOW };
const OPTIONS = { turnstileSiteKey: "site", qq: { available: true, botQq: "10001" } };
const MASKED_QQ = "12****89";

// 假数据的类型直接取自接口的响应类型：接口的形状变了，这里编译就过不了，不会悄悄测着一个过期的形状。
type Logins = InferResponseType<ApiClient["api"]["v1"]["me"]["logins"]["$get"], 200>;
type Sessions = InferResponseType<ApiClient["api"]["v1"]["me"]["sessions"]["$get"], 200>;
type Account = Logins["accounts"][number];
type Device = Sessions["sessions"][number];

const qqAccount = (nickname: string | null): Account => ({
  id: "account-qq",
  provider: "qq",
  nickname,
  maskedQq: MASKED_QQ,
  createdAt: NOW,
});
const googleAccount = (email: string | null): Account => ({ id: "account-google", provider: "google", email, createdAt: NOW });
const device = (overrides: Partial<Device> = {}): Device => ({
  id: "session-1",
  browser: "Chrome",
  os: "macOS",
  country: "JP",
  createdAt: NOW,
  lastActiveAt: NOW,
  current: false,
  ...overrides,
});

type Fixture = {
  signedIn?: boolean;
  accounts?: Account[];
  passkeys?: Logins["passkeys"];
  devices?: Device[];
  /** 记下 loader 请求过哪些接口。 */
  calls?: string[];
};

type LoaderArgs = Parameters<typeof loader>[0];
type LoaderData = Awaited<ReturnType<typeof loader>>;
type Visit = { redirect: { status: number; location: string | null } } | { data: LoaderData };

// 只实现设置页 loader 会调用的四个接口（me、me/logins、me/sessions、login-options）。QueryClient 用真的
// （和服务端每个请求一份的那个一样）。
function contextFor({
  signedIn = true,
  accounts = [googleAccount("a@example.com")],
  passkeys = [],
  devices = [device({ current: true })],
  calls = [],
}: Fixture) {
  const respond = (name: string, body: () => Response) => async () => {
    calls.push(name);
    return body();
  };
  const api = {
    api: {
      v1: {
        me: {
          $get: respond("me", () => (signedIn ? Response.json(USER) : new Response(null, { status: 401 }))),
          logins: { $get: respond("logins", () => Response.json({ accounts, passkeys } satisfies Logins)) },
          sessions: { $get: respond("sessions", () => Response.json({ sessions: devices } satisfies Sessions)) },
        },
        "login-options": { $get: respond("login-options", () => Response.json(OPTIONS)) },
      },
    },
  } as unknown as ApiClient;
  const context = new RouterContextProvider();
  context.set(queryClientContext, makeQueryClient());
  context.set(apiContext, api);
  return context;
}

// 访问 /settings/account：要么渲染（返回 loader 的数据），要么被 loader 跳走（redirect() 抛出的是 Response）。
async function visit(fixture: Fixture = {}, search = ""): Promise<Visit> {
  const args = {
    context: contextFor(fixture),
    url: new URL(`https://x.test/settings/account${search}`),
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
    throw new Error(`应当渲染设置页，实际被跳转到 ${result.redirect.location}`);
  }
  return result.data;
}

describe("账号设置页 loader", () => {
  test("未登录：302 到登录页，next 是当前地址（带查询串）；不会去取登录方式和设备", async () => {
    const calls: string[] = [];

    expect(await visit({ signedIn: false, calls })).toEqual({
      redirect: { status: 302, location: loginHref("/settings/account") },
    });
    expect(await visit({ signedIn: false, calls }, "?welcome=1")).toEqual({
      redirect: { status: 302, location: loginHref("/settings/account?welcome=1") },
    });
    expect(loginHref("/settings/account?welcome=1")).toBe("/login?next=%2Fsettings%2Faccount%3Fwelcome%3D1");
    expect(calls).toEqual(["me", "me"]);
  });

  test("已登录：不跳转；dehydrate 带着当前用户、登录方式、设备和登录选项", async () => {
    const accounts = [qqAccount(null)];
    const devices = [device({ current: true })];

    const { dehydratedState } = renderedData(await visit({ accounts, devices }));

    const byKey = Object.fromEntries(dehydratedState.queries.map((query) => [query.queryKey.join("/"), query.state.data]));
    expect(byKey.me).toEqual(USER);
    expect(byKey["me/logins"]).toEqual({ accounts, passkeys: [] });
    expect(byKey["me/sessions"]).toEqual({ sessions: devices });
    expect(byKey["login-options"]).toEqual(OPTIONS);
  });
});

describe("账号设置页 meta", () => {
  // 登录和账号设置页不该出现在搜索结果里（计划的全局约束）。
  test("noindex，标题带站名", () => {
    const tags = meta();

    expect(tags).toContainEqual({ name: "robots", content: "noindex" });
    expect(tags).toContainEqual({ title: `${m.settings_account_title()} - ${m.site_name()}` });
  });
});

// "重新登录"的链接、QQ 绑定的重新登录链接和未登录时的跳转，登录后都回到这个地址。error（Google 绑定失败的原因）
// 和 welcome（欢迎语）是一次性的提示：带回来的话，旧的错误提示会一直显示，欢迎语也会在重新登录后再出现一次。
// 这些链接只在点了按钮、出错之后才出现，静态标记里看不到，所以地址的构造单独测。
describe("returnPath", () => {
  test("去掉 error 和 welcome，其他参数原样留着", () => {
    expect(returnPath("/settings/account", "?welcome=1&error=x&tab=2")).toBe("/settings/account?tab=2");
    expect(returnPath("/en/settings/account", "?tab=2&error=state_mismatch")).toBe("/en/settings/account?tab=2");
  });

  test("去掉之后没有别的参数：不带问号", () => {
    expect(returnPath("/settings/account", "?welcome=1")).toBe("/settings/account");
    expect(returnPath("/settings/account", "?error=state_mismatch&welcome=1")).toBe("/settings/account");
  });

  test("本来就没有查询串：原样返回路径", () => {
    expect(returnPath("/settings/account", "")).toBe("/settings/account");
    expect(returnPath("/ja/settings/account", "?")).toBe("/ja/settings/account");
  });

  test("同名参数出现几次都去掉；其他参数的顺序不变", () => {
    expect(returnPath("/settings/account", "?a=1&error=x&b=2&error=y&welcome=1&welcome=2&c=3")).toBe(
      "/settings/account?a=1&b=2&c=3"
    );
  });

  test("交给 loginHref 之后，next 里没有 error 和 welcome", () => {
    const href = loginHref(returnPath("/settings/account", "?welcome=1&error=x&tab=2"), { reauth: "1" });

    expect(href).toBe("/login?next=%2Fsettings%2Faccount%3Ftab%3D2&reauth=1");
  });
});

// 页面按 loader 的数据渲染出来的样子。服务端渲染只输出静态标记（不跑 effect 和事件），
// 这里要的正是这个：设置页在服务端渲染时（hydrate 之前）该有哪些内容。
async function renderPage(fixture: Fixture = {}, search = ""): Promise<string> {
  const data = renderedData(await visit(fixture, search));
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: makeQueryClient() },
      createElement(
        MemoryRouter,
        { initialEntries: [`/settings/account${search}`] },
        createElement(SettingsAccount as unknown as ComponentType<{ loaderData: LoaderData }>, { loaderData: data })
      )
    )
  );
}

// 页面里每个 <li> 的内容（静态标记里 <li> 没有属性）。
function listItems(html: string): string[] {
  return [...html.matchAll(/<li>(.*?)<\/li>/gs)].map((match) => match[1] ?? "");
}

describe("账号设置页渲染：登录方式", () => {
  // Bot 查不到昵称时（很常见）nickname 是 null。拿它拼 settings_login_qq 会显示成"QQ：（12****89）"。
  test("QQ 绑定没有昵称：显示 QQ 和打码的号码，不留空昵称的括号", async () => {
    const html = await renderPage({ accounts: [qqAccount(null)] });

    expect(html).toContain(m.settings_login_qq_number({ number: MASKED_QQ }));
    expect(html).toContain(`QQ：${MASKED_QQ}`);
    expect(html).not.toContain(m.settings_login_qq({ nickname: "", number: MASKED_QQ }));
    expect(html).not.toContain("QQ：（");
  });

  test("QQ 绑定有昵称：显示昵称和打码的号码", async () => {
    const html = await renderPage({ accounts: [qqAccount("阿丁")] });

    expect(html).toContain(m.settings_login_qq({ nickname: "阿丁", number: MASKED_QQ }));
    expect(html).toContain(`QQ：阿丁（${MASKED_QQ}）`);
    expect(html).not.toContain(m.settings_login_qq_number({ number: MASKED_QQ }));
  });

  test("Google 绑定：有邮箱显示邮箱，没有时只显示品牌名", async () => {
    const withEmail = await renderPage({ accounts: [googleAccount("a@example.com")] });
    const withoutEmail = await renderPage({ accounts: [googleAccount(null)] });

    expect(withEmail).toContain(m.settings_login_google({ email: "a@example.com" }));
    expect(listItems(withoutEmail)[0]).toStartWith("Google ");
    expect(withoutEmail).not.toContain(m.settings_login_google({ email: "" }));
  });

  test("没有名字的通行密钥显示默认名字；没用过的显示'还没用过'", async () => {
    const html = await renderPage({
      accounts: [],
      passkeys: [{ id: "passkey-1", name: null, createdAt: NOW, lastUsedAt: null }],
    });

    expect(html).toContain(m.settings_passkey_default_name());
    expect(html).toContain(m.settings_passkey_never_used());
  });

  test("页面有登录方式、登录设备两块，以及绑定、添加、退出的按钮", async () => {
    const html = await renderPage();

    for (const text of [
      m.settings_account_title(),
      m.settings_logins_heading(),
      m.settings_link_google(),
      m.settings_add_passkey(),
      m.settings_link_qq(),
      m.settings_devices_heading(),
      m.settings_revoke_others(),
      m.settings_sign_out(),
    ]) {
      expect(html, text).toContain(text);
    }
  });
});

describe("账号设置页渲染：登录设备", () => {
  // browser 和 os 来自 User-Agent，构造出来的可以有上千个字符（接口只保证不会更长）。
  test("设备名超过 64 个字符：各自截断并加省略号", async () => {
    const html = await renderPage({ devices: [device({ current: true, browser: "B".repeat(200), os: "O".repeat(65) })] });

    expect(html).toContain(`${"B".repeat(64)}… · ${"O".repeat(64)}…`);
    expect(html).not.toContain("B".repeat(65));
    expect(html).not.toContain("O".repeat(65));
  });

  test("设备名正好 64 个字符：原样显示，不加省略号", async () => {
    const html = await renderPage({ devices: [device({ current: true, browser: "B".repeat(64), os: "O".repeat(64) })] });

    expect(html).toContain(`${"B".repeat(64)} · ${"O".repeat(64)} · `);
    expect(html).not.toContain(`${"B".repeat(64)}…`);
    expect(html).not.toContain(`${"O".repeat(64)}…`);
  });

  // 按字符（码点）数，不按 UTF-16 单元：边界上的表情符号不会被劈成半个。
  test("截断按字符算：64 个表情符号加省略号，没有被劈开的代理对", async () => {
    const html = await renderPage({ devices: [device({ current: true, browser: "😀".repeat(70), os: null })] });

    expect(html).toContain(`${"😀".repeat(64)}…`);
    expect(html).not.toContain("😀".repeat(65));
    expect(html).not.toContain("�");
  });

  test("认不出浏览器和系统：显示'未知设备'", async () => {
    const html = await renderPage({ devices: [device({ current: true, browser: null, os: null })] });

    expect(html).toContain(m.settings_device_unknown());
  });

  test("当前设备标出'当前设备'，没有下线按钮；其他设备有", async () => {
    const html = await renderPage({
      devices: [
        device({ id: "session-current", current: true, browser: "Chrome" }),
        device({ id: "session-other", browser: "Firefox", os: "Windows" }),
      ],
    });
    const rows = listItems(html);
    const current = rows.find((row) => row.includes("Chrome"));
    const other = rows.find((row) => row.includes("Firefox"));

    expect(current).toContain(m.settings_device_current());
    expect(current).not.toContain("<button");
    expect(other).toContain(`>${m.settings_revoke()}</button>`);
    expect(other).not.toContain(m.settings_device_current());
  });

  // 日期和国家名依赖时区、ICU 版本：服务端渲染时不输出，等浏览器 hydrate 之后再显示，两边的文字才一致
  // （useHydrated 首次渲染返回 false）。
  test("服务端渲染不输出日期和国家名；认不出国家的显示'未知地区'", async () => {
    const at = "2026-03-05T12:00:00.000Z";
    const html = await renderPage({
      passkeys: [{ id: "passkey-1", name: null, createdAt: at, lastUsedAt: at }],
      devices: [device({ id: "s1", current: true, country: "JP", lastActiveAt: at }), device({ id: "s2", country: null })],
    });
    const date = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(at));
    const place = new Intl.DisplayNames(["zh-CN"], { type: "region" }).of("JP") ?? "JP";

    expect(html).not.toContain(date);
    expect(html).not.toContain(place);
    expect(html).toContain(m.settings_device_unknown_place());
  });
});

describe("账号设置页渲染：顶部提示", () => {
  // Google 绑定出错时 Better Auth 把用户送回 errorCallbackURL 并在后面接上 ?error=。
  test("?error= 显示 Google 绑定失败的原因", async () => {
    expect(await renderPage({}, "?error=account_already_linked_to_different_user")).toContain(m.error_google_already_linked());
    expect(await renderPage({}, "?error=state_mismatch")).toContain(m.error_google_failed());
    expect(await renderPage({})).not.toContain(m.error_google_failed());
  });
});
