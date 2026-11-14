// Run on the Linux build host against scripts/remote/dev.sh, never on the Mac.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

assert.equal(process.platform, "linux", "Browser verification belongs on the build host");
const engine = process.env.ASTRODX_BROWSER_ENGINE || "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const { [engine]: browserType } = await import(process.env.ASTRODX_PLAYWRIGHT_PATH || "playwright");
const output = process.env.ASTRODX_MOTION_EVIDENCE;
assert.ok(output, "Set ASTRODX_MOTION_EVIDENCE to this run's evidence directory");
await mkdir(output, { recursive: true });
const browser = await browserType.launch({
  headless: true,
  ...(engine === "chromium" && process.env.ASTRODX_CHROMIUM ? { executablePath: process.env.ASTRODX_CHROMIUM } : {}),
});
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "no-preference" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.setDefaultTimeout(15000);
const results = [];
const origin = process.env.ASTRODX_PREVIEW_ORIGIN || "http://127.0.0.1:3310";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Local preview only");
// No external requests are needed for this UI calibration. Block them rather
// than letting browser proxy rules accidentally send loopback through a proxy.
await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const mode = (name) => page.locator("#motion").getByRole("button", { name, exact: false });
async function chooseMode(name) {
  await mode(name).click();
  await page.waitForTimeout(80);
}
try {
  assert.equal((await page.goto(`${origin}/ui#motion`, { waitUntil: "domcontentloaded" })).status(), 200);
  await page.locator("#motion").waitFor();
  const readable = await page.locator("[data-motion-readable]").evaluate((el) => getComputedStyle(el).opacity);
  assert.equal(readable, "1", "ssrVisible remains readable after hydration");
  await chooseMode("始终开启动画");
  await page.locator("#motion").scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/desktop.png` });
  const section = page.locator("#motion");
  const press = section.getByRole("button", { name: "按压反馈", exact: true });
  await press.hover();
  await page.mouse.down();
  const pressFrames = await press.evaluate(async (el) => {
    const frames = [];
    for (let i = 0; i < 18; i++) {
      await new Promise(requestAnimationFrame);
      frames.push({ time: Math.round(performance.now()), transform: getComputedStyle(el).transform });
    }
    return frames;
  });
  await mode("减少动态效果").evaluate((el) => el.click());
  await page.waitForTimeout(50);
  const interruptedPress = await press.evaluate((el) => getComputedStyle(el).transform);
  assert.ok(interruptedPress === "none" || interruptedPress === "matrix(1, 0, 0, 1, 0, 0)", `pressed button must reset under reduction: ${interruptedPress}`);
  await page.mouse.up();
  await chooseMode("始终开启动画");
  assert.ok(pressFrames.some((f) => f.transform !== "none"), "button press must animate");
  results.push({ name: "button press", frames: pressFrames });
  await section.getByRole("link", { name: "链接按压" }).hover();
  await page.mouse.down();
  await page.waitForTimeout(160);
  const linkScale = await section.getByRole("link", { name: "链接按压" }).evaluate((el) => getComputedStyle(el).scale);
  await page.mouse.up();
  assert.ok(Number.parseFloat(linkScale) < 1, `asChild press ${linkScale}`);
  results.push({ name: "asChild press", scale: linkScale });

  // Continuous decoration is scoped to actual visibility, even in mode=on.
  const skeleton = section.locator('[data-slot="skeleton"]').last();
  await skeleton.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('#motion > [data-slot="skeleton"]')?.getAttribute('data-motion-active') === 'true');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => document.querySelector('#motion > [data-slot="skeleton"]')?.getAttribute('data-motion-active') === 'false');
  await section.scrollIntoViewIfNeeded();
  results.push({ name: "offscreen decoration pauses", passed: true });

  for (const name of ["侧边面板", "居中弹窗", "全屏面板"]) {
    const trigger = section.getByRole("button", { name, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name, exact: true });
    await dialog.waitFor();
    await page.waitForTimeout(250);
    const state = await dialog.evaluate((el) => ({ rect: el.getBoundingClientRect().toJSON(), animation: getComputedStyle(el).animationName, focused: el.contains(document.activeElement) }));
    assert.ok(state.focused, `${name}: focus must be inside`);
    assert.ok(state.rect.x >= -1 && state.rect.y >= -1 && state.rect.right <= 1281 && state.rect.bottom <= 1001, `${name}: on-screen bounds`);
    await page.screenshot({ path: `${output}/${name === "居中弹窗" ? "dialog" : name === "侧边面板" ? "sheet" : "fullscreen"}.png` });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await trigger.evaluate((el) => el === document.activeElement), true, `${name}: restore focus`);
    results.push({ name, ...state });
  }

  // Close during the entrance. Opacity must continue from its current value.
  await section.getByRole("button", { name: "居中弹窗", exact: true }).click();
  const interrupted = await page.getByRole("dialog", { name: "居中弹窗", exact: true }).evaluate(async (el) => {
    const before = Number(getComputedStyle(el).opacity);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise(requestAnimationFrame);
    const after = Number(getComputedStyle(el).opacity);
    return { before, after };
  });
  assert.ok(interrupted.after <= interrupted.before + 0.1, `exit opacity jumps: ${JSON.stringify(interrupted)}`);
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  results.push({ name: "interrupt dialog entrance", ...interrupted });

  for (const list of await section.getByRole("tablist").all()) {
    const tabs = list.getByRole("tab");
    for (const i of [1, 2, 0, 2, 1]) await tabs.nth(i).click({ delay: 5 });
    assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
  }
  await section.getByRole("button", { name: "打开菜单", exact: true }).click();
  await page.getByRole("menu").waitFor();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  results.push({ name: "rapid tabs and keyboard menu", passed: true });

  await section.getByRole("button", { name: "再次展示", exact: true }).click();
  const revealFrames = await section.locator(".grid-cols-2 > div").first().evaluate(async (el) => {
    const frames = [];
    const started = performance.now();
    for (let i = 0; i < 32; i++) {
      await new Promise(requestAnimationFrame);
      const style = getComputedStyle(el);
      const transform = style.transform === "none" ? new DOMMatrix() : new DOMMatrix(style.transform);
      frames.push({ time: Math.round(performance.now() - started), y: transform.m42, opacity: Number(style.opacity) });
    }
    return frames;
  });
  assert.ok(revealFrames.some((f) => f.y > 0.2), "decorative reveal must actually move");
  assert.ok(revealFrames.every((f) => f.opacity >= 0 && f.opacity <= 1), "effects never overshoot");
  assert.ok(Math.abs(revealFrames.at(-1).y) < 0.01, "reveal must settle");
  results.push({ name: "expressive reveal trajectory", frames: revealFrames });

  await chooseMode("减少动态效果");
  assert.equal(await page.locator("html").getAttribute("data-reduced-motion"), "");
  await section.getByRole("button", { name: "再次展示", exact: true }).click();
  await page.waitForTimeout(50);
  const reduced = await section.evaluate((el) => ({
    hidden: [...el.querySelectorAll("li,svg,path")].filter((n) => getComputedStyle(n).opacity === "0").length,
    incomplete: [...el.querySelectorAll('[data-slot="drawn-check"] path')].filter((n) => n.getAttribute("stroke-dasharray") !== "1 1").length,
    running: el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
    skeletons: [...el.querySelectorAll('[data-slot="skeleton"]')].map((n) => n.getAttribute("data-motion-active")),
  }));
  results.push({ name: "reduced diagnostics", ...reduced });
  assert.equal(reduced.hidden, 0);
  assert.equal(reduced.incomplete, 0);
  assert.equal(reduced.running, 0);
  assert.ok(reduced.skeletons.every((v) => v === "false"));
  await section.getByRole("button", { name: "更新数字", exact: true }).click();
  assert.equal(await section.locator(".sr-only").last().textContent(), "255");
  results.push({ name: "reduced final state", ...reduced });
  await chooseMode("始终开启动画");
  await page.waitForTimeout(60);
  assert.equal(await section.locator('[data-slot="drawn-check"] path').first().getAttribute("stroke-dasharray"), "1 1", "no success replay after restoring motion");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await chooseMode("跟随系统");
  assert.equal(await page.locator("html").getAttribute("data-reduced-motion"), "");
  await chooseMode("始终开启动画");
  assert.equal(await page.locator("html").getAttribute("data-reduced-motion"), null);
  results.push({ name: "OS and explicit override", passed: true });

  // Saved reduction is applied on a fresh load, not merely after interaction.
  await chooseMode("减少动态效果");
  await page.reload();
  await page.locator("#motion").waitFor();
  assert.equal(await page.locator("html").getAttribute("data-reduced-motion"), "");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#motion").scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: `${output}/mobile-reduced.png` });
  await section.getByRole("button", { name: "居中弹窗", exact: true }).click();
  const narrow = await page.getByRole("dialog", { name: "居中弹窗", exact: true }).evaluate((el) => ({ width: el.getBoundingClientRect().width, transform: getComputedStyle(el).transform }));
  assert.ok(narrow.width <= 390);
  assert.ok(narrow.transform === "none" || narrow.transform === "matrix(1, 0, 0, 1, 0, 0)");
  await page.keyboard.press("Escape");
  results.push({ name: "narrow screen and saved reduction", ...narrow });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ status: "passed", results, pageErrors: errors }, null, 2));
  console.log(`Motion browser checks passed: ${results.length} groups; evidence ${output}`);
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/results.json`, JSON.stringify({ status: "failed", error: String(error), results, pageErrors: errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
