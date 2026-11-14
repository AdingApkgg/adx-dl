// Run on the Linux build host with a matching Playwright/WebKit installation.
// Isolated browser state only; external chart downloads are blocked.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

assert.equal(process.platform, "linux");
const { webkit } = await import(process.env.ASTRODX_PLAYWRIGHT_PATH || "playwright");
const output = process.env.ASTRODX_MOTION_EVIDENCE;
assert.ok(output);
await mkdir(output, { recursive: true });
const origin = process.env.ASTRODX_PREVIEW_ORIGIN || "https://adxdls.saop.cc";
const browser = await webkit.launch({ headless: true, proxy: { server: process.env.ASTRODX_BROWSER_PROXY || "http://127.0.0.1:11090", bypass: "localhost,127.0.0.1" } });
const report = { engine: "webkit", version: browser.version(), origin, results: [] };
const wav = Buffer.alloc(44 + 8000 * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
const save = () => writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
try {
  for (const [label, width, height, reducedMotion] of [
    ["desktop", 1440, 1000, "no-preference"],
    ["mobile", 390, 844, "no-preference"],
    ["mobile-reduced", 390, 844, "reduce"],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600, locale: "zh-CN", reducedMotion });
    const result = { label, errors: [] };
    report.results.push(result);
    await context.route("**/track.mp3*", (route) => route.fulfill({ status: 200, contentType: "audio/wav", headers: { "access-control-allow-origin": "*" }, body: wav }));
    await context.addInitScript(() => {
      window.__webkitMotion = { id: crypto.randomUUID(), reveals: [] };
      addEventListener("pageswap", (event) => sessionStorage.setItem("webkit-swap", JSON.stringify({ active: !!event.viewTransition, types: event.viewTransition ? [...event.viewTransition.types] : [] })));
      addEventListener("pagereveal", (event) => {
        const record = { active: !!event.viewTransition, ready: false, finished: false, animations: [] };
        window.__webkitMotion.reveals.push(record);
        if (!event.viewTransition) return;
        event.viewTransition.ready.then(() => {
          record.ready = true;
          record.animations = document.getAnimations().map((a) => ({ name: a.animationName, duration: a.effect?.getTiming().duration }));
        }, (e) => { record.error = String(e); });
        event.viewTransition.finished.then(() => { record.finished = true; });
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => result.errors.push(String(e)));
    result.transitionMessages = [];
    page.on("console", (message) => { if (/transition|snapshot/i.test(message.text())) result.transitionMessages.push(message.text()); });
    console.log(`START ${label}`);
    assert.equal((await page.goto(origin, { waitUntil: "domcontentloaded" })).status(), 200);
    await page.waitForFunction(() => {
      const e = document.querySelector('[data-music-player-surface="collapsed"]');
      return e && Object.keys(e).some((k) => k.startsWith("__reactProps"));
    });
    result.capabilities = await page.evaluate(() => ({ ua: navigator.userAgent, startViewTransition: typeof document.startViewTransition === "function", transitionTypes: CSS.supports("selector(:active-view-transition-type(adx-document))"), pagereveal: "onpagereveal" in window, reduced: document.documentElement.hasAttribute("data-reduced-motion") }));
    assert.equal(result.capabilities.reduced, reducedMotion === "reduce");
    const input = page.locator('form[role="search"] input[role="combobox"]').first();
    await input.fill("XODUS");
    await page.getByRole("listbox").waitFor();
    await input.press("ArrowDown");
    assert.ok(await input.getAttribute("aria-activedescendant"));
    await input.press("Escape");
    await page.getByRole("listbox").waitFor({ state: "hidden" });
    result.search = "passed";
    // Genuine full-document navigation, without wrapping startViewTransition.
    const previous = await page.evaluate(() => window.__webkitMotion.id);
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.id = "webkit-navigation-probe";
      a.href = "/charts/12061";
      a.textContent = "WebKit navigation probe";
      Object.assign(a.style, { position: "fixed", top: "80px", left: "8px", zIndex: "9999", background: "white", color: "black" });
      document.body.append(a);
    });
    await page.locator("#webkit-navigation-probe").click();
    await page.waitForURL(`${origin}/charts/12061`);
    await page.waitForFunction((id) => window.__webkitMotion.id !== id, previous);
    await page.waitForTimeout(800);
    result.navigation = await page.evaluate(() => window.__webkitMotion.reveals);
    result.outgoing = await page.evaluate(() => JSON.parse(sessionStorage.getItem("webkit-swap") || "null"));
    const transition = result.navigation.find((r) => r.active);
    if (transition) {
      assert.ok(transition.ready && transition.finished, JSON.stringify(transition));
      const branded = transition.animations.filter((a) => a.name?.startsWith("adx-page-"));
      if (reducedMotion === "reduce") assert.equal(branded.length, 0);
      else assert.ok(branded.some((a) => a.name === "adx-page-enter" && a.duration === 320), JSON.stringify(transition));
      result.navigationMode = "native-transition";
    } else result.navigationMode = "normal-navigation-fallback";
    await page.waitForFunction(() => {
      const e = document.querySelector('[data-music-player-surface="collapsed"]');
      return e && Object.keys(e).some((k) => k.startsWith("__reactProps"));
    });
    await page.evaluate(() => scrollTo(0, 300));
    await page.getByRole("button", { name: "展开播放器", exact: true }).click();
    const panel = page.locator("[data-music-player-panel]");
    await panel.waitFor();
    await page.waitForTimeout(650);
    result.player = await panel.evaluate((e) => ({ rect: e.getBoundingClientRect().toJSON(), opacity: getComputedStyle(e).opacity, inert: !!document.querySelector("main").closest("[inert]"), scrollLock: getComputedStyle(document.body).overflow }));
    assert.equal(result.player.rect.x, 0);
    assert.equal(result.player.rect.y, 0);
    assert.equal(result.player.rect.width, width);
    assert.equal(result.player.rect.height, height);
    assert.equal(result.player.opacity, "1");
    assert.ok(result.player.inert);
    const scrollBefore = await page.evaluate(() => scrollY);
    if (width < 600) await page.keyboard.press("PageDown");
    else {
      await page.mouse.move(5, 100);
      await page.mouse.wheel(0, 400);
    }
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => scrollY), scrollBefore);
    result.player.scrollBlocked = true;
    result.player.scrollProbe = width < 600 ? "PageDown and overflow:hidden; no native touch swipe" : "mouse wheel";
    await page.screenshot({ path: `${output}/${label}-player.png` });
    await panel.getByRole("button", { name: "打开队列与歌单", exact: true }).click();
    await panel.locator("[data-music-library]").waitFor();
    await panel.locator('ol li button[aria-haspopup="menu"]').first().click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    assert.ok(await menu.evaluate((e) => { const r = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + 15)); }));
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    await panel.getByRole("button", { name: "曲库", exact: true }).click();
    await panel.locator("input").waitFor();
    await panel.getByRole("button", { name: "我的歌单", exact: true }).click();
    await panel.getByRole("button", { name: "新建歌单", exact: true }).waitFor();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      assert.ok(await panel.evaluate((e) => e.contains(document.activeElement)), "focus escaped");
    }
    if (reducedMotion === "no-preference") {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(() => document.documentElement.hasAttribute("data-reduced-motion"));
      result.midSessionReducedMotion = "passed";
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
    await page.getByRole("button", { name: "关闭播放器面板", exact: true }).click();
    await panel.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "展开播放器", null, { timeout: 3000 });
    assert.ok(!await page.locator("main").evaluate((e) => !!e.closest("[inert]")));
    result.player.focusRestored = true;
    // Hold requests in this browser to keep one local download task visible.
    await page.route("https://astrodx-charts.saop.cc/**", (route) => route.abort());
    await page.locator("[data-download-inline] button").first().click();
    const expand = page.getByRole("button", { name: /^展开下载列表/ });
    await expand.waitFor();
    await expand.click();
    const manager = page.locator("[data-download-manager]");
    await manager.waitFor();
    await page.waitForTimeout(650);
    result.download = await manager.boundingBox();
    assert.ok(result.download.x >= 0 && result.download.y >= 0);
    assert.ok(result.download.x + result.download.width <= width + 1);
    assert.ok(result.download.y + result.download.height <= height + 1);
    await page.screenshot({ path: `${output}/${label}-downloads.png` });
    assert.deepEqual(result.errors, []);
    result.status = "passed";
    console.log(`PASS ${label}: ${result.navigationMode}, player, queue, focus, scroll lock, downloads, reduced motion`);
    await save();
    await context.close();
  }
  // Functional fallback is useful evidence, but does not accept native motion.
  report.status = report.results.every((r) => r.navigationMode === "native-transition") ? "passed" : "partial";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack || error);
  throw error;
} finally {
  await save();
  await browser.close();
}
