import assert from "node:assert/strict";
import { join } from "node:path";

/** UI journeys on disposable accounts; external authorization and production mutations are not exercised here. */
export async function exerciseAccountAdminUx({ owner, other, anonymous, origin, step, evidenceDirectory }) {
  const visitor = await anonymous.newPage(), member = await owner.newPage(), errors = [];
  for (const page of [visitor, member]) page.on("pageerror", error => errors.push(error.message));
  await visitor.route("https://challenges.cloudflare.com/**", route => route.abort("blockedbyclient"));
  const url = path => new URL(path, origin).href;
  const read = async (context, path) => { const response = await context.request.get(url(path)); assert.equal(response.status(), 200, path); return response.json(); };
  const visit = async (page, path) => { const response = await page.goto(url(path)); assert.equal(response.status(), 200, path); await page.locator("main").waitFor(); };
  async function geometry(page) { for (const width of [320, 390, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `account/admin fits ${width}`); } }
  async function settle(page) { await page.evaluate(() => document.fonts.ready); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))); }
  async function theme(page, label) {
    await page.waitForLoadState("load"); await page.getByRole("button", { name: "打开设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true }); await settings.waitFor(); await settings.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction(dark => document.documentElement.classList.contains("dark") === dark, label === "深色"); await settings.getByRole("button", { name: "关闭设置", exact: true }).click(); await settings.waitFor({ state: "hidden" }); await settle(page);
  }
  async function pictures(page, key) {
    if (!evidenceDirectory) return; await page.setViewportSize({ width: 1280, height: 900 }); await theme(page, "浅色"); await page.screenshot({ path: join(evidenceDirectory, `account-admin-${key}-desktop.png`), fullPage: true });
    const light = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--background"));
    await page.emulateMedia({ reducedMotion: "reduce" }); await theme(page, "深色"); assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--background")), light); await page.screenshot({ path: join(evidenceDirectory, `account-admin-${key}-dark.png`), fullPage: true });
    await page.emulateMedia({ reducedMotion: "no-preference" }); await theme(page, "浅色"); await page.setViewportSize({ width: 390, height: 844 }); await settle(page); await page.screenshot({ path: join(evidenceDirectory, `account-admin-${key}-mobile.png`), fullPage: true });
  }
  async function saveProfile(name, bio) {
    await member.getByRole("textbox", { name: "昵称", exact: true }).fill(name); await member.getByRole("textbox", { name: "简介", exact: true }).fill(bio);
    const response = member.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/me/profile" && response.request().method() === "PATCH");
    await member.getByRole("button", { name: "保存", exact: true }).click(); assert.equal((await response).status(), 200);
  }
  try {
    await step("account_ux_login_methods_and_safe_return_layout", async () => {
      await visit(visitor, "/login?reauth=1&next=%2Fcharts%2F1"); await visitor.getByRole("navigation", { name: "登录方式导航", exact: true }).waitFor();
      assert.equal(await visitor.getByRole("button", { name: "用 Google 登录", exact: true }).count(), 1); assert.equal(await visitor.locator("#login-qq").count(), 1); assert.equal(await visitor.locator("#login-passkey").count(), 1);
      await geometry(visitor); await pictures(visitor, "login");
    });
    await step("account_ux_profile_save_and_session_management_layout", async () => {
      const original = await read(owner, "/api/v1/me/profile");
      await visit(member, "/settings/profile"); await member.getByRole("navigation", { name: "账号设置导航", exact: true }).waitFor();
      assert.equal(await member.getByRole("link", { name: "个人资料", exact: true }).getAttribute("aria-current"), "page");
      try { await saveProfile("UX creator", "Visible profile UI acceptance"); assert.equal((await read(owner, "/api/v1/me/profile")).name, "UX creator"); await geometry(member); await pictures(member, "profile"); }
      finally { await visit(member, "/settings/profile"); await saveProfile(original.name, original.bio); }
      await visit(member, "/settings/account"); assert.equal(await member.getByRole("link", { name: "账号设置", exact: true }).getAttribute("aria-current"), "page");
      for (const id of ["account-logins", "account-devices", "account-danger"]) await member.locator(`#${id}`).waitFor();
      const sessions = await read(owner, "/api/v1/me/sessions"); assert.ok(sessions.sessions.some(session => session.current)); assert.equal(await member.getByRole("button", { name: "注销账号", exact: true }).isEnabled(), false);
      assert.equal(await member.getByRole("checkbox", { name: "同时删除我发布的内容", exact: true }).isChecked(), false); await geometry(member); await pictures(member, "settings");
    });
    await step("account_ux_admin_navigation_filters_status_and_layout", async () => {
      for (const path of ["/dash", "/dash/users", "/dash/charts", "/dash/discussions", "/dash/lists", "/dash/featured", "/dash/notices", "/dash/governance", "/dash/appeals", "/dash/audit", "/dash/reports", "/dash/status"]) {
        await visit(member, path); await member.setViewportSize({ width: 1280, height: 900 }); const current = member.locator('.community-dash-nav > div a[aria-current="page"]'); assert.equal(await current.count(), 1); assert.equal(await current.getAttribute("href"), path);
        await geometry(member);
      }
      await member.getByRole("navigation", { name: "本页导航", exact: true }).getByRole("link", { name: "备份记录", exact: true }).click();
      await pictures(member, "status");
      await visit(member, "/dash/lists?q=UX-no-match&status=all"); assert.equal(await member.getByRole("searchbox").inputValue(), "UX-no-match"); await member.getByRole("button", { name: "搜索", exact: true }).click(); await member.waitForURL(url => url.searchParams.get("q") === "UX-no-match" && url.searchParams.get("status") === "all" && !url.searchParams.has("cursor"));
      await member.getByRole("link", { name: "清除筛选", exact: true }).click(); await member.waitForURL(url => url.pathname === "/dash/lists" && !url.search);
      await visit(member, "/dash"); await member.getByRole("navigation", { name: "管理常用入口", exact: true }).waitFor(); await geometry(member); await pictures(member, "overview");
      assert.equal((await other.request.get(url("/api/v1/dash/access"))).status(), 403);
    });
    assert.deepEqual(errors, [], "account/admin UI page errors");
  } finally { await Promise.allSettled([visitor.close(), member.close()]); }
}
