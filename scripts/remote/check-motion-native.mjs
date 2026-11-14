// Run only on the remote build host. Use Playwright's matching browser bundle;
// an arbitrary system Chromium can break cross-document rendering under CDP.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

assert.equal(process.platform, "linux");
const engine = process.env.ASTRODX_BROWSER_ENGINE || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const { [engine]: browserType } = await import(process.env.ASTRODX_PLAYWRIGHT_PATH || "playwright");
const origin = process.env.ASTRODX_PREVIEW_ORIGIN || "http://127.0.0.1:3311";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const output = process.env.ASTRODX_MOTION_EVIDENCE;
assert.ok(output);
await mkdir(output, { recursive: true });
const browser = await browserType.launch({ headless: true, ...(engine === "chromium" && process.env.ASTRODX_CHROMIUM ? { executablePath: process.env.ASTRODX_CHROMIUM } : {}) });
const results = [];
const errors = [];
const contexts = [];
async function createScene({ mode = "system", reducedMotion = "no-preference", width = 1280, compatibility = false } = {}) {
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width, height: width < 600 ? 844 : 960 }, reducedMotion, storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: "adx-reduce-motion", value: mode }, { name: "astrodx-browser-compatibility-v1", value: compatibility ? "simple" : "normal" }] }] } });
  contexts.push(context);
  // External media is irrelevant here. Interception disables BFCache, so the
  // history tests below verify native traversal with fresh documents.
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript(() => {
    window.__nativeMotion = { id: crypto.randomUUID(), events: [] };
    const save = (type, data) => {
      const record = { type, data, timestamp: Date.now(), path: location.pathname, document: window.__nativeMotion.id };
      window.__nativeMotion.events.push(record);
      const history = JSON.parse(sessionStorage.getItem("native-motion-events") || "[]");
      history.push(record);
      sessionStorage.setItem("native-motion-events", JSON.stringify(history.slice(-100)));
    };
    addEventListener("pageswap", (event) => {
      save("swap", { active: !!event.viewTransition, types: event.viewTransition ? [...event.viewTransition.types] : [] });
      event.viewTransition?.ready.catch(() => {});
    });
    addEventListener("pagereveal", (event) => {
      const transition = event.viewTransition;
      save("reveal", { active: !!transition, time: performance.now(), rules: [...document.styleSheets].flatMap((sheet) => { try { return [...sheet.cssRules].map((rule) => rule.cssText).filter((text) => text.startsWith("@view-transition")); } catch { return []; } }), links: [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => ({ href: new URL(link.href).pathname, ready: !!link.sheet, parent: link.parentElement.tagName })) });
      if (!transition) return;
      transition.ready.then(() => {
        const root = document.documentElement;
        const header = document.querySelector("header");
        save("ready", {
          types: [...transition.types],
          animations: document.getAnimations().filter((a) => a.effect?.pseudoElement).map((a) => ({ name: a.animationName, pseudo: a.effect.pseudoElement, duration: a.effect.getTiming().duration, state: a.playState })),
          main: !!document.querySelector("main#main-content"),
          chrome: ["music-player", "download-dock", "mobile-tabbar"].map((name) => ({ name, exists: [...document.querySelectorAll("[style]")].some((element) => element.style.viewTransitionName === name), oldDisplay: getComputedStyle(root, `::view-transition-old(${name})`).display, newAnimation: getComputedStyle(root, `::view-transition-new(${name})`).animationName, groupAnimation: getComputedStyle(root, `::view-transition-group(${name})`).animationName })),
          header: { name: header ? getComputedStyle(header).viewTransitionName : null, top: header?.getBoundingClientRect().top, oldDisplay: getComputedStyle(root, "::view-transition-old(site-header)").display, newAnimation: getComputedStyle(root, "::view-transition-new(site-header)").animationName, groupAnimation: getComputedStyle(root, "::view-transition-group(site-header)").animationName },
          reduced: root.hasAttribute("data-reduced-motion"), mode: root.dataset.motion,
        });
      }, (error) => save("ready-error", { name: error.name, message: error.message }));
      transition.finished.then(() => save("finished", true), (error) => save("finished-error", String(error)));
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  assert.equal((await page.goto(origin + "/")).status(), 200);
  await page.locator("main h1").first().waitFor();
  // Wait for the real UI to hydrate before adding the native test link outside
  // React's page subtree. The link itself is an ordinary browser navigation.
  await page.getByRole("button", { name: "展开播放器", exact: true }).waitFor();
  await page.locator("#astrodx-global-music-player-audio").waitFor({ state: "attached" });
  return { page, context };
}
async function nativeLink(page, path) {
  const before = await page.evaluate(() => window.__nativeMotion.id);
  await page.evaluate((path) => {
    document.getElementById("native-acceptance-link")?.remove();
    const link = document.createElement("a");
    link.id = "native-acceptance-link";
    link.href = path;
    link.textContent = "Native acceptance navigation";
    Object.assign(link.style, { position: "fixed", top: "80px", left: "8px", zIndex: "2147483647", background: "white", color: "black", padding: "8px" });
    document.body.append(link);
  }, path);
  await page.locator("#native-acceptance-link").click({ noWaitAfter: true });
  await page.waitForURL(origin + path, { waitUntil: "commit" });
  await page.waitForFunction((id) => window.__nativeMotion?.id !== id, before);
}
async function transitionResult(page, animated, { wait = true } = {}) {
  await page.waitForFunction(() => window.__nativeMotion.events.some((event) => event.type === "reveal"), null, { polling: 20 });
  const reveal = await page.evaluate(() => window.__nativeMotion.events.find((event) => event.type === "reveal").data);
  if (!reveal.active) {
    assert.equal(animated, false, `expected native animation, but incoming viewTransition is absent: ${JSON.stringify(reveal)}`);
    assert.equal(await page.evaluate(() => document.getAnimations().some((a) => a.effect?.pseudoElement && a.playState === "running")), false);
    return { nativeSkipped: true, reveal, animations: [] };
  }
  await page.waitForFunction(() => window.__nativeMotion.events.some((event) => event.type === "ready" || event.type === "ready-error"), null, { polling: 20 });
  const events = await page.evaluate(() => window.__nativeMotion.events);
  assert.equal(events.some((event) => event.type === "ready-error"), false, JSON.stringify(events));
  const ready = events.find((event) => event.type === "ready").data;
  assert.ok(ready.types.includes("adx-document"));
  const pages = ready.animations.filter((a) => a.name?.startsWith("adx-page-"));
  if (animated) {
    assert.ok(pages.some((a) => a.name === "adx-page-enter" && a.duration === 320 && a.pseudo === "::view-transition-new(root)"), JSON.stringify(ready));
    assert.ok(pages.some((a) => a.name === "adx-page-exit" && a.duration === 180 && a.pseudo === "::view-transition-old(root)"), JSON.stringify(ready));
  } else assert.deepEqual(ready.animations.filter((a) => a.state === "running"), []);
  assert.equal(ready.main, true, "native snapshot requires parsed main content");
  for (const chrome of ready.chrome) {
    if (chrome.name !== "mobile-tabbar") assert.equal(chrome.exists, true, `${chrome.name} must be parsed before snapshot`);
    assert.equal(chrome.oldDisplay, "none");
    assert.equal(chrome.newAnimation, "none");
    assert.equal(chrome.groupAnimation, "none");
  }
  assert.equal(ready.header.name, "site-header");
  assert.equal(ready.header.oldDisplay, "none");
  assert.equal(ready.header.newAnimation, "none");
  assert.equal(ready.header.groupAnimation, "none");
  assert.equal(ready.header.top, 0);
  if (wait) await page.waitForFunction(() => window.__nativeMotion.events.some((event) => event.type === "finished"), null, { polling: 20 });
  return ready;
}
async function step(name, run) {
  try {
    const data = await run();
    results.push({ name, passed: true, ...data });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: String(error) });
    console.log(`FAIL ${name}: ${error}`);
  }
  await writeFile(`${output}/results.json`, JSON.stringify({ status: "running", browser: browser.version(), results, errors }, null, 2));
}
try {
  const { page } = await createScene();
  await step("real native link, lifecycle and pinned chrome", async () => {
    await nativeLink(page, "/guide");
    const ready = await transitionResult(page, true);
    await page.screenshot({ path: `${output}/native-guide.png` });
    return ready;
  });
  await step("native guide to catalog", async () => {
    await nativeLink(page, "/charts");
    const ready = await transitionResult(page, true);
    await page.locator('[data-layout="card-grid"]').waitFor();
    return ready;
  });
  await step("OS reduced motion disables native snapshots", async () => {
    const { page } = await createScene({ reducedMotion: "reduce" });
    await nativeLink(page, "/guide");
    return transitionResult(page, false);
  });
  await step("site off overrides OS full motion", async () => {
    const { page } = await createScene({ mode: "off" });
    await nativeLink(page, "/guide");
    return transitionResult(page, false);
  });
  await step("site on overrides OS reduced motion", async () => {
    const { page } = await createScene({ mode: "on", reducedMotion: "reduce" });
    await nativeLink(page, "/guide");
    return transitionResult(page, true);
  });
  await step("compatibility mode overrides explicit motion on", async () => {
    const { page } = await createScene({ mode: "on", compatibility: true });
    await nativeLink(page, "/guide");
    return transitionResult(page, false);
  });
  await step("reducing during native entrance cancels motion", async () => {
    const { page } = await createScene();
    await nativeLink(page, "/guide");
    const ready = await transitionResult(page, true, { wait: false });
    assert.equal(await page.evaluate(() => document.getAnimations().some((a) => a.effect?.pseudoElement && a.playState === "running")), true, "must reduce while native entrance is still running");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => !document.getAnimations().some((a) => a.effect?.pseudoElement && a.playState === "running"), null, { polling: 10 });
    await page.waitForFunction(() => window.__nativeMotion.events.some((event) => event.type === "finished"), null, { polling: 10 });
    return { before: ready, cancelled: true };
  });
  await step("390px native navigation and interaction after finish", async () => {
    const { page } = await createScene({ width: 390 });
    await nativeLink(page, "/guide");
    const ready = await transitionResult(page, true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.locator("#astrodx-global-music-player-audio").waitFor({ state: "attached" });
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.getByRole("button", { name: "展开播放器", exact: true }).click();
    const panel = page.locator("[data-music-player-panel]");
    await panel.waitFor();
    await panel.evaluate((element) => Promise.allSettled(element.getAnimations().map((animation) => animation.finished)));
    assert.deepEqual(await panel.boundingBox(), { x: 0, y: 0, width: 390, height: 844 });
    assert.equal(await page.locator("main").evaluate((element) => !!element.closest("[inert]")), true);
    await page.screenshot({ path: `${output}/native-mobile.png` });
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "展开播放器", exact: true }).evaluate((element) => element === document.activeElement), true);
    return ready;
  });
  await step("native history back and forward", async () => {
    const { page } = await createScene();
    await nativeLink(page, "/guide");
    await transitionResult(page, true);
    await page.goBack();
    await page.waitForURL(origin + "/");
    const back = await transitionResult(page, true);
    await page.goForward();
    await page.waitForURL(origin + "/guide");
    const forward = await transitionResult(page, true);
    return { back, forward, bfcache: false };
  });
  assert.deepEqual(errors, []);
  assert.equal(results.every((result) => result.passed), true, "all native acceptance groups must pass");
  await writeFile(`${output}/results.json`, JSON.stringify({ status: "passed", browser: browser.version(), results, errors }, null, 2));
  console.log(`Native motion acceptance passed: ${results.length} groups`);
} catch (error) {
  await writeFile(`${output}/results.json`, JSON.stringify({ status: "failed", browser: browser.version(), error: String(error), results, errors, diagnostics: await Promise.all(contexts.flatMap((c) => c.pages()).map(async (p) => ({ url: p.url(), state: await p.evaluate(() => ({ current: window.__nativeMotion, history: JSON.parse(sessionStorage.getItem("native-motion-events") || "[]"), active: !!document.activeViewTransition, navigation: performance.getEntriesByType("navigation").map((n) => n.type) })).catch(() => null) }))) }, null, 2));
  throw error;
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
