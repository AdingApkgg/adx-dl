import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { m } from "@/paraglide/messages.js";
import { LanguageMenu } from "@/client/components/language-menu";
import { LocaleSuggestion } from "@/client/components/locale-suggestion";

// path 同时是浏览器地址（Paraglide 按它判断当前语言）和路由的当前地址；languages 是浏览器的语言偏好，
// undefined 表示浏览器没有 navigator.languages。
function renderPage(path: string, languages: readonly string[] | undefined, children = <LocaleSuggestion />) {
  window.history.replaceState(null, "", path);
  vi.spyOn(navigator, "languages", "get").mockReturnValue(languages as readonly string[]);
  const result = render(<MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>);
  return { ...result, user: userEvent.setup() };
}

// 点链接时 happy-dom 会真的去加载那个地址：只拦下跳转本身，页面上的点击处理照常执行。
const stopNavigation = (event: MouseEvent) => event.preventDefault();
beforeEach(() => {
  window.addEventListener("click", stopNavigation, { capture: true });
});
afterEach(() => {
  window.removeEventListener("click", stopNavigation, { capture: true });
  vi.restoreAllMocks();
});

describe("浏览器语言不一致提示", () => {
  test("浏览器偏好英文、页面是中文：用英文提示，'切换'指向同一页面的英文版", () => {
    renderPage("/u/abc2345678?tab=2", ["en-US", "zh-CN"]);

    const prompt = screen.getByRole("status");
    expect(prompt.getAttribute("lang")).toBe("en");
    expect(prompt.textContent).toContain(m.locale_suggestion({}, { locale: "en" }));
    expect(screen.getByRole("link", { name: m.locale_suggestion_switch({}, { locale: "en" }) }).getAttribute("href")).toBe(
      "/en/u/abc2345678?tab=2"
    );
  });

  test("浏览器偏好和页面一致，或者认不出：不提示", () => {
    const { unmount } = renderPage("/en/u/abc2345678", ["en-GB"]);
    expect(screen.queryByRole("status")).toBeNull();
    unmount();

    renderPage("/", ["fr-FR"]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  // 有的浏览器（比如一些 WebView）没有 navigator.languages：退回 navigator.language，不能在 effect 里抛错。
  test("没有 navigator.languages：按 navigator.language 判断", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("ja-JP");
    renderPage("/", undefined);

    expect(screen.getByRole("status").getAttribute("lang")).toBe("ja");
  });

  test("'不用了'：提示关掉，记在 localStorage 里，下次打开页面不再提示", async () => {
    const { user, unmount } = renderPage("/", ["ja-JP"]);
    await user.click(screen.getByRole("button", { name: m.locale_suggestion_dismiss({}, { locale: "ja" }) }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(localStorage.getItem("astrodx-locale-prompt")).not.toBeNull();
    unmount();
    renderPage("/", ["ja-JP"]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("点提示里的'切换'：同样记下", async () => {
    const { user } = renderPage("/", ["en-US"]);
    await user.click(screen.getByRole("link", { name: m.locale_suggestion_switch({}, { locale: "en" }) }));

    expect(localStorage.getItem("astrodx-locale-prompt")).not.toBeNull();
  });

  test("用页头的语言切换换过语言：同样记下，之后不再提示", async () => {
    const { user, unmount } = renderPage("/", ["en-US"], <LanguageMenu />);
    await user.click(screen.getByRole("button", { name: m.nav_language({ language: m.language_zh() }) }));
    await user.click(screen.getByRole("menuitem", { name: m.language_ja() }));

    expect(localStorage.getItem("astrodx-locale-prompt")).not.toBeNull();
    unmount();
    renderPage("/", ["en-US"]);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
