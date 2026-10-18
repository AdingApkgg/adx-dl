import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";

import { m } from "@/paraglide/messages.js";
import { AppProviders } from "@/client/components/app-providers";
import { SiteHeader } from "@/client/components/site-header";
import { makeQueryClient } from "@/shared/query-client";

// 退出登录走 Better Auth 的客户端；它在创建时就记下了 fetch，换不掉，所以直接换掉它的 signOut。
const signOut = vi.hoisted(() => vi.fn());
vi.mock("@/client/lib/auth-client", () => ({ authClient: { signOut } }));

const USER = { id: "abc2345678", name: "阿丁", image: null as string | null, status: "active", createdAt: "", deletionPurgeAt: null };

// 页头装在真的 Provider 里；path 同时是浏览器地址（Paraglide 按它判断语言）和路由的当前地址。
function renderHeader(path: string, me: typeof USER | null) {
  window.history.replaceState(null, "", path);
  const queryClient = makeQueryClient();
  queryClient.setQueryData(["me"], me);
  queryClient.setQueryData(["me","notifications","count",me?.id],0);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppProviders>
          <SiteHeader />
        </AppProviders>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return userEvent.setup();
}

// 菜单里每一项：名字和链接地址（"退出登录"是按钮，没有地址）。
function menuItems() {
  return within(screen.getByRole("menu"))
    .getAllByRole("menuitem")
    .map((item) => ({ name: item.textContent, href: item.getAttribute("href") }));
}

afterEach(() => {
  vi.restoreAllMocks();
  signOut.mockReset();
});

describe("页头的账号菜单", () => {
  test("登录了：点头像打开菜单，有我的谱面、我的主页、个人资料、账号设置和退出登录", async () => {
    const user = renderHeader("/", USER);
    await user.click(screen.getByRole("button", { name: m.nav_account_menu({ name: USER.name }) }));

    expect(menuItems()).toEqual([
      { name: m.charts_title(), href: "/me/charts" },
      { name: m.following_feed_title(), href: "/me/feed" },
      { name: m.following_title(), href: "/me/following" },
      { name:m.site_my_discussions(),href:"/me/discussions" },{ name:m.site_notifications(),href:"/me/notifications" },
      { name:m.my_favorites(),href:"/me/favorites" },{ name:m.my_reports(),href:"/me/reports" },
      { name: m.nav_my_page(), href: `/u/${USER.id}` },
      { name: m.nav_profile(), href: "/settings/profile" },
      { name: m.nav_account(), href: "/settings/account" },
      { name: m.nav_sign_out(), href: null },
    ]);
  });

  test("英文页面上，菜单里的链接带 /en 前缀", async () => {
    const user = renderHeader("/en/settings/profile", USER);
    await user.click(screen.getByRole("button", { name: m.nav_account_menu({ name: USER.name }, { locale: "en" }) }));

    expect(menuItems().map((item) => item.href)).toEqual(["/en/me/charts","/en/me/feed","/en/me/following","/en/me/discussions","/en/me/notifications","/en/me/favorites","/en/me/reports", `/en/u/${USER.id}`, "/en/settings/profile", "/en/settings/account", null]);
  });

  test("待注销的用户（在注销提示页上）：菜单里只有退出登录", async () => {
    const user = renderHeader("/account-deletion", { ...USER, status: "pending_deletion" });
    await user.click(screen.getByRole("button", { name: m.nav_account_menu({ name: USER.name }) }));

    expect(menuItems()).toEqual([{ name: m.nav_sign_out(), href: null }]);
  });

  test("退出登录成功：整页回到当前语言的首页", async () => {
    localStorage.setItem(`astrodx-uploads:${USER.id}`, "[]");
    localStorage.setItem("astrodx-uploads:another", "[]");
    signOut.mockResolvedValue({ data: { success: true }, error: null });
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const user = renderHeader("/en/settings/profile", USER);
    await user.click(screen.getByRole("button", { name: m.nav_account_menu({ name: USER.name }, { locale: "en" }) }));
    await user.click(screen.getByRole("menuitem", { name: m.nav_sign_out({}, { locale: "en" }) }));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/en/");
    expect(localStorage.getItem(`astrodx-uploads:${USER.id}`)).toBeNull();
    expect(localStorage.getItem("astrodx-uploads:another")).toBe("[]");
  });

  // 会话还在：不能让用户以为已经退出，提示失败、留在本页。
  test("退出登录失败（服务器 500）：toast 提示出错，页面不跳走", async () => {
    localStorage.setItem(`astrodx-uploads:${USER.id}`, "[]");
    signOut.mockResolvedValue({ data: null, error: { status: 500, statusText: "Internal Server Error" } });
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const user = renderHeader("/", USER);
    await user.click(screen.getByRole("button", { name: m.nav_account_menu({ name: USER.name }) }));
    await user.click(screen.getByRole("menuitem", { name: m.nav_sign_out() }));

    expect(await screen.findByText(m.error_unknown())).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect(localStorage.getItem(`astrodx-uploads:${USER.id}`)).toBe("[]");
  });

  test("没登录：'登录'链接带着当前地址", () => {
    renderHeader("/u/abc2345678?tab=2", null);

    expect(screen.getByRole("link", { name: m.nav_sign_in() }).getAttribute("href")).toBe(
      "/login?next=%2Fu%2Fabc2345678%3Ftab%3D2"
    );
  });
});

describe("页头的语言切换", () => {
  test("下拉菜单里是同一页面的三种语言，当前语言标了出来", async () => {
    const user = renderHeader("/en/u/abc2345678?tab=2", null);
    await user.click(screen.getByRole("button", { name: m.nav_language({ language: m.language_en() }, { locale: "en" }) }));

    const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
    expect(items.map((item) => [item.textContent, item.getAttribute("href"), item.getAttribute("hreflang")])).toEqual([
      [m.language_zh(), "/u/abc2345678?tab=2", "zh-CN"],
      [m.language_en(), "/en/u/abc2345678?tab=2", "en"],
      [m.language_ja(), "/ja/u/abc2345678?tab=2", "ja"],
    ]);
    expect(items.map((item) => item.getAttribute("aria-current"))).toEqual([null, "true", null]);
    expect(items.map((item) => item.getAttribute("lang"))).toEqual(["zh-CN", "en", "ja"]);
    // 普通的 <a>，整页跳转（spec 第 11.1 节）：React Router 的 Link 会带 data-discover。
    expect(items.map((item) => [item.tagName, item.hasAttribute("data-discover")])).toEqual([
      ["A", false],
      ["A", false],
      ["A", false],
    ]);
  });
});

test("account menu image is decorative; broken image keeps the accessible account button",()=> {
  renderHeader("/",{...USER,image:"/media/broken.jpg"});
  const button=screen.getByRole("button",{name:m.nav_account_menu({name:USER.name})});
  const image=button.querySelector("img")!;expect(image.getAttribute("aria-hidden")).toBe("true");expect(image.getAttribute("alt")).toBe("");
  fireEvent.error(image);expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");expect(screen.queryByRole("img")).toBeNull();
});
