import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server.edge";
import { MemoryRouter } from "react-router";

import { m } from "@/paraglide/messages.js";
import { paraglideMiddleware } from "@/paraglide/server.js";
import { makeQueryClient } from "@/shared/query-client";

import { languageLinks } from "./language-menu";
import { SiteHeader } from "./site-header";

const USER = { id: "abc2345678", name: "阿丁", image: null, status: "active", createdAt: "", deletionPurgeAt: null };

// 页头在服务端渲染出的样子：地址决定语言（和真实请求一样经过 Paraglide 的中间件），me 是缓存里的当前用户
// （undefined 表示没取到，比如 429）。下拉菜单和设置面板的内容只在打开后才渲染，这里只看得到按钮。
async function renderHeader(path: string, me?: typeof USER | null): Promise<string> {
  const queryClient = makeQueryClient();
  if (me !== undefined) {
    queryClient.setQueryData(["me"], me);
  }
  let html = "";
  await paraglideMiddleware(new Request(`https://x.test${path}`), async () => {
    html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <SiteHeader />
        </MemoryRouter>
      </QueryClientProvider>
    );
    return new Response();
  });
  return html;
}

// 页面里所有链接的地址和文字（React Router 的 Link 还会带 data-discover，这里不管）。
function links(html: string): { href: string | undefined; text: string }[] {
  return [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].map((match) => ({
    href: /\shref="([^"]*)"/.exec(match[1] ?? "")?.[1],
    text: match[2] ?? "",
  }));
}

describe("语言切换的地址", () => {
  test("三种语言都指向同一个页面，查询串照带", () => {
    for (const path of ["/u/abc2345678?tab=2", "/en/u/abc2345678?tab=2", "/ja/u/abc2345678?tab=2"]) {
      expect(languageLinks(path), path).toEqual([
        { locale: "zh", href: "/u/abc2345678?tab=2" },
        { locale: "en", href: "/en/u/abc2345678?tab=2" },
        { locale: "ja", href: "/ja/u/abc2345678?tab=2" },
      ]);
    }
  });

  test("首页", () => {
    for (const path of ["/", "/en", "/ja/"]) {
      expect(languageLinks(path).map((link) => link.href), path).toEqual(["/", "/en/", "/ja/"]);
    }
  });
});

describe("页头的服务端渲染", () => {
  test("站名回到当前语言的首页；语言按钮写着当前语言", async () => {
    for (const [path, locale, home] of [
      ["/u/abc2345678", "zh", "/"],
      ["/en/u/abc2345678", "en", "/en/"],
      ["/ja/u/abc2345678", "ja", "/ja/"],
    ] as const) {
      const html = await renderHeader(path, null);

      expect(links(html)[0], path).toEqual({ href: home, text: m.site_name({}, { locale }) });
      expect(links(html), path).toContainEqual({ href: `${home === "/" ? "" : home.replace(/\/$/, "")}/charts`, text: m.public_charts_title({}, { locale }) });
      expect(links(html), path).toContainEqual({ href: `${home === "/" ? "" : home.replace(/\/$/, "")}/lists`, text: m.library_public_title({}, { locale }) });
      expect(links(html), path).toContainEqual({ href: `${home === "/" ? "" : home.replace(/\/$/, "")}/downloads`, text: m.download_title({}, { locale }) });
      expect(links(html), path).toContainEqual({href:`${home === "/" ? "" : home.replace(/\/$/, "")}/discover`,text:m.discovery_title({}, {locale})});
      const language = m[`language_${locale}`]();
      expect(html, path).toContain(`aria-label="${m.nav_language({ language }, { locale })}"`);
    }
  });

  test("没登录：'登录'按钮带着当前地址，登录后回来", async () => {
    const zh = await renderHeader("/u/abc2345678?tab=2", null);
    const en = await renderHeader("/en/u/abc2345678", null);

    expect(links(zh)).toContainEqual({ href: "/login?next=%2Fu%2Fabc2345678%3Ftab%3D2", text: m.nav_sign_in() });
    expect(links(en)).toContainEqual({ href: "/en/login?next=%2Fen%2Fu%2Fabc2345678", text: m.nav_sign_in({}, { locale: "en" }) });
  });

  test("没登录、已经在登录页上：不再显示'登录'按钮", async () => {
    for (const path of ["/login?next=%2F", "/en/login", "/login/", "/en/login/"]) {
      expect(links(await renderHeader(path, null)), path).toHaveLength(8);
    }
  });

  test("登录了：头像按钮，名字写在它的无障碍名称里；没有'登录'按钮", async () => {
    for (const me of [USER, { ...USER, status: "pending_deletion" }]) {
      const html = await renderHeader("/", me);

      expect(html).toContain(`aria-label="${m.nav_account_menu({ name: "阿丁" })}"`);
      expect(html).toContain(">阿</text>");
      expect(html).not.toContain(m.nav_sign_in());
      expect(links(html)).toHaveLength(me.status === "active" ? 9 : 8);
      expect(links(html).some(link => link.href === "/me/notifications")).toBe(me.status === "active");
    }
  });

  // 服务端取当前用户遇到 429、5xx 时缓存里没有它：账号区留空，等浏览器取到再显示，已登录的人不会先看到"登录"。
  test("当前用户没取到：账号区什么都不显示", async () => {
    const html = await renderHeader("/");

    expect(html).not.toContain(m.nav_sign_in());
    expect(html).not.toContain(m.nav_account_menu({ name: "阿丁" }));
    expect(links(html)).toHaveLength(8);
  });
});
