// Real native/fallback navigation acceptance; run only on the build host.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

assert.equal(process.platform, "linux");
const playwright = await import(process.env.ASTRODX_PLAYWRIGHT_PATH || "playwright");
const origin = process.env.ASTRODX_PREVIEW_ORIGIN || "http://127.0.0.1:3315";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const output = process.env.ASTRODX_MOTION_EVIDENCE;
assert.ok(output);
await mkdir(output, { recursive: true });
const results = [];
const wav = Buffer.alloc(44 + 16000);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
for (const engine of (process.env.ASTRODX_BROWSER_ENGINE ? [process.env.ASTRODX_BROWSER_ENGINE] : ["webkit", "chromium"])) {
  assert.ok(["webkit", "chromium"].includes(engine));
  const browser = await playwright[engine].launch({ headless: true });
  try {
    // A compact page with the application's actual boot script and transition
    // CSS characterizes the native-success branch independently of dev-server
    // compilation and streaming. The application scenarios below test recovery.
    const seed = await browser.newPage();
    await seed.goto(origin, { waitUntil: "domcontentloaded" });
    const fixture = await seed.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const variables = [...style].filter((name) => name.startsWith("--adx-motion-")).map((name) => `${name}:${style.getPropertyValue(name)};`).join("");
      const rules = [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules].map((rule) => rule.cssText).filter((text) => text.includes("::view-transition") || text.includes("adx-page-enter") || text.startsWith("@view-transition") || text.startsWith("@keyframes adx-page-exit")); } catch { return []; } });
      return { boot: document.getElementById("theme-init").textContent, css: rules.join("\n") + `:root{${variables}}` };
    });
    await seed.close();
    const control = await browser.newContext();
    await control.route(`${origin}/__navigation-native-*`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><html><head><style>${fixture.css}</style></head><body><script>${fixture.boot}</script><main id="main-content"><h1>Native control</h1><a href="/__navigation-native-b">Next</a></main></body></html>` }));
    await control.addInitScript(() => {
      window.__nativeControl = {};
      addEventListener("pagereveal", (event) => {
        window.__nativeControl.active = !!event.viewTransition;
        event.viewTransition?.ready.then(() => { window.__nativeControl.animations = document.getAnimations().map((a) => ({ name: a.animationName, duration: a.effect?.getTiming().duration })); });
        event.viewTransition?.finished.then(() => { window.__nativeControl.finished = true; });
      });
    });
    const controlPage = await control.newPage();
    await controlPage.goto(`${origin}/__navigation-native-a`);
    await controlPage.getByRole("link", { name: "Next", exact: true }).click();
    await controlPage.waitForURL(`${origin}/__navigation-native-b`);
    await controlPage.waitForFunction(() => window.__nativeControl.finished);
    const nativeControl = await controlPage.evaluate(() => window.__nativeControl);
    assert.ok(nativeControl.active);
    assert.ok(nativeControl.animations.some((a) => a.name === "adx-page-enter" && a.duration === 320));
    assert.equal(await controlPage.locator("html").getAttribute("data-navigation-fallback"), null);
    results.push({ engine, label: "native-success-control", passed: true, ...nativeControl });
    console.log(`PASS ${engine} native-success-control`);
    await control.close();
    for (const [label, width, cancel, reducedMotion] of [
      ["normal-desktop", 1440, false, "no-preference"],
      ["normal-mobile", 390, false, "no-preference"],
      ["cancelled-desktop", 1440, true, "no-preference"],
      ["cancelled-mobile", 390, true, "no-preference"],
      ["cancelled-reduced", 390, true, "reduce"],
    ]) {
      console.log(`START ${engine} ${label}`);
      const result = { engine, version: browser.version(), label, errors: [] };
      results.push(result);
      const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, reducedMotion, locale: "zh-CN" });
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/track.mp3")) return route.fulfill({ status: 200, contentType: "audio/wav", headers: { "access-control-allow-origin": "*" }, body: wav });
        return url.origin === origin ? route.continue() : route.abort();
      });
      await context.addInitScript(({ cancel }) => {
        window.__navigationCheck = { id: crypto.randomUUID(), reveals: [], frames: [] };
        const capture = () => ({
          fallback: document.documentElement.hasAttribute("data-navigation-fallback"),
          animations: document.getAnimations().map((a) => ({ name: a.animationName, duration: a.effect?.getTiming().duration, pseudo: a.effect?.pseudoElement, target: a.effect?.target?.id, state: a.playState })),
          chrome: ["music-player", "download-dock", "site-header"].map((name) => ({ name, parsed: [...document.querySelectorAll("[style]")].some((e) => e.style.viewTransitionName === name) })),
        });
        addEventListener("pageswap", (event) => {
          if (cancel) event.viewTransition?.skipTransition();
        });
        addEventListener("pagereveal", (event) => {
          const record = { native: !!event.viewTransition, ready: null };
          window.__navigationCheck.reveals.push(record);
          event.viewTransition?.ready.then(() => { record.ready = capture(); }, (error) => { record.error = String(error); });
          let count = 0;
          const sample = () => {
            window.__navigationCheck.frames.push(capture());
            if (++count < 70) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
      }, { cancel });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on("pageerror", (error) => result.errors.push(String(error)));
      // Warm compilation before measuring browser lifecycle, not the browser's
      // navigation itself. No clock- or browser-API wrappers are installed.
      await context.request.get(`${origin}/guide`);
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => {
        const e = document.querySelector('[data-music-player-surface="collapsed"]');
        return e && Object.keys(e).some((k) => k.startsWith("__reactProps"));
      });
      assert.equal(await page.locator("html").getAttribute("data-navigation-fallback"), null, "direct visit must not recover");
      const id = await page.evaluate(() => window.__navigationCheck.id);
      await page.evaluate(() => {
        const a = document.createElement("a");
        a.id = "navigation-acceptance-link";
        a.href = "/guide";
        a.textContent = "Navigation acceptance";
        Object.assign(a.style, { position: "fixed", top: "80px", left: "8px", zIndex: "99999", background: "white", color: "black" });
        document.body.append(a);
      });
      await page.locator("#navigation-acceptance-link").click({ noWaitAfter: true });
      await page.waitForURL(`${origin}/guide`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction((previous) => window.__navigationCheck.id !== previous, id);
      await page.waitForFunction(() => window.__navigationCheck.frames.length >= 50);
      const state = await page.evaluate(() => window.__navigationCheck);
      result.reveals = state.reveals;
      const native = state.reveals.find((r) => r.native && r.ready);
      const recovered = state.frames.filter((f) => f.fallback && f.animations.some((a) => a.name === "adx-page-enter" && a.target === "main-content" && a.duration === 320));
      result.recoveredFrames = recovered.length;
      if (reducedMotion === "reduce") {
        assert.equal(state.frames.some((f) => f.fallback), false);
        assert.equal(state.frames.some((f) => f.animations.some((a) => a.name === "adx-page-enter")), false);
        result.mode = "reduced";
      } else if (cancel) {
        assert.ok(recovered.length > 0, "cancelled native navigation must visibly recover with the 320ms content entrance");
        assert.equal(state.frames.some((f) => f.fallback && f.animations.some((a) => a.pseudo?.startsWith("::view-transition") && a.state === "running")), false, "do not run two transitions together");
        result.mode = "fallback";
      } else if (native) {
        assert.ok(native.ready.animations.some((a) => a.name === "adx-page-enter" && a.duration === 320));
        assert.ok(native.ready.chrome.every((c) => c.parsed), JSON.stringify(native.ready.chrome));
        assert.equal(state.frames.some((f) => f.fallback), false, "successful native navigation must not replay fallback");
        result.mode = "native";
      } else {
        assert.ok(recovered.length > 0, "a real navigation without a native snapshot must actually animate its content");
        result.mode = "recovered";
      }
      await page.waitForFunction(() => !document.documentElement.hasAttribute("data-navigation-fallback"));
      assert.equal(await page.locator("main#main-content").evaluate((e) => getComputedStyle(e).opacity), "1");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: `${output}/${engine}-${label}.png` });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__navigationCheck.reveals.length > 0);
      assert.equal(await page.locator("html").getAttribute("data-navigation-fallback"), null, "reload must not replay recovery");
      assert.deepEqual(result.errors, []);
      result.passed = true;
      console.log(`PASS ${engine} ${label}: ${result.mode}`);
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
      await context.close();
    }
  } catch (error) {
    results.at(-1).error = String(error.stack || error);
    await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
}
