import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";

import { m } from "@/paraglide/messages.js";
import { AppProviders } from "@/client/components/app-providers";
import { SiteHeader } from "@/client/components/site-header";
import { DeleteAccountSection } from "@/client/routes/settings-account";
import { makeQueryClient } from "@/shared/query-client";

const USER = { id: "abc2345678", name: "阿丁", image: null, status: "active", createdAt: "", deletionPurgeAt: null };
const PURGE_AT = "2026-10-06T00:00:00.000Z";
const HERE = "/settings/account";

// 和账号设置页上一样：页头和注销卡片读同一个 QueryClient，缓存里是已经登录的当前用户。
function renderPage(onDeleted: (purgeAt: string) => void) {
  window.history.replaceState(null, "", HERE);
  const queryClient = makeQueryClient();
  queryClient.setQueryData(["me"], USER);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[HERE]}>
        <AppProviders>
          <SiteHeader />
          <DeleteAccountSection userId={USER.id} here={HERE} onDeleted={onDeleted} />
        </AppProviders>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return userEvent.setup();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("申请注销账号", () => {
  // 服务端在响应里清掉了会话 Cookie：页头不能还显示头像菜单（公用电脑上，页面会让人以为还登录着）。
  test("申请成功：页头不再显示账号菜单，换成'登录'链接", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ purgeAt: PURGE_AT, signedOut: true }));
    const onDeleted = vi.fn();
    const user = renderPage(onDeleted);
    const accountMenu = () => screen.queryByRole("button", { name: m.nav_account_menu({ name: USER.name }) });
    expect(accountMenu()).not.toBeNull();

    await user.type(screen.getByRole("textbox", { name: m.settings_delete_confirm({ id: USER.id }) }), USER.id);
    await user.click(screen.getByRole("button", { name: m.settings_delete_submit() }));

    const signIn = await screen.findByRole("link", { name: m.nav_sign_in() });
    expect(signIn.getAttribute("href")).toBe("/login?next=%2Fsettings%2Faccount");
    expect(accountMenu()).toBeNull();
    expect(onDeleted).toHaveBeenCalledWith(PURGE_AT);
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/api\/v1\/me\/deletion$/);
  });
});
