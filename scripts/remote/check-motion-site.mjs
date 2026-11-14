// Linux-only preview acceptance. External requests are fulfilled with tiny
// fixtures or blocked; it never writes to any production service.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

assert.equal(process.platform, "linux");
const { chromium } = await import(process.env.ASTRODX_PLAYWRIGHT_PATH || "playwright");
const output = process.env.ASTRODX_MOTION_EVIDENCE;
assert.ok(output);
await mkdir(output, { recursive: true });
const origin = process.env.ASTRODX_PREVIEW_ORIGIN || "http://127.0.0.1:3310";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const browser = await chromium.launch({ headless: true, ...(process.env.ASTRODX_CHROMIUM ? { executablePath: process.env.ASTRODX_CHROMIUM } : {}) });
const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, reducedMotion: "no-preference", acceptDownloads: true, locale: "zh-CN" });
// The dev-only Next badge occupies the player's bottom-left hit target.
// Hide that portal in this isolated context; runtime errors remain collected.
await context.addInitScript(() => {
  const install = () => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal { display: none !important; }";
    document.head.append(style);
  };
  if (document.head) install(); else addEventListener("DOMContentLoaded", install, { once: true });
});
let page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
let sameDocumentEvents = [];
const wav = Buffer.alloc(44 + 8000 * 2 * 30);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
const maidata = "&title=Motion fixture\n&artist=Acceptance\n&wholebpm=120\n&lv_1=1\n&inote_1=(120){4}1,2,3,4,E\n";
const fixtureBytes = Buffer.alloc(8192, 42);
let releaseFile;
const fileGate = new Promise((resolve) => { releaseFile = resolve; });
let fixtureRequests = 0;
await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const headers = { "access-control-allow-origin": "*", "cache-control": "no-store" };
  if (request.resourceType() === "media") {
    const range = request.headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: "audio/wav", headers: { ...headers, "accept-ranges": "bytes", ...(range ? { "content-range": `bytes ${start}-${end}/${wav.length}` } : {}) }, body: wav.subarray(start, end + 1) });
  }
  if (url.origin === origin) return route.continue();
  if (request.method() === "HEAD") return route.fulfill({ status: 200, headers: { ...headers, "content-length": "8192" } });
  if (url.pathname.includes("/motion-acceptance/")) {
    fixtureRequests++;
    if (url.pathname.endsWith("maidata.txt")) return route.fulfill({ status: 200, headers, contentType: "text/plain", body: maidata });
    await fileGate;
    return route.fulfill({ status: 200, headers, contentType: "application/octet-stream", body: fixtureBytes });
  }

  return route.abort();
});
await context.addInitScript(() => {
  localStorage.setItem("adx-reduce-motion", "system");
  window.__motionDocument = crypto.randomUUID();
  window.__motionTransitions = [];
  window.__motionReveals = [];
  window.__motionNativeFrames = [];
  setInterval(() => {
    if (!document.documentElement?.matches(":active-view-transition-type(adx-document)")) return;
    const frames = document.getAnimations().map((a) => ({ name: a.animationName, pseudo: a.effect?.pseudoElement, duration: a.effect?.getTiming().duration })).filter((a) => a.name?.startsWith("adx-page-"));
    if (frames.length) window.__motionNativeFrames.push(...frames);
  }, 16);
  const capture = (kind, transition) => {
    if (!transition) return;
    const record = { kind, ready: false, finished: false, animations: [] };
    window.__motionTransitions.push(record);
    transition.ready.then(() => {
      record.ready = true;
      record.animations = document.getAnimations().map((a) => ({ name: a.animationName, pseudo: a.effect?.pseudoElement, duration: a.effect?.getTiming().duration })).filter((a) => a.name?.startsWith("adx-page-"));
    }).catch(() => {});
    transition.finished.then(() => { record.finished = true; }, () => { record.finished = true; });
  };
  if (document.startViewTransition) {
    const native = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      const transition = native(...args);
      capture("same-document", transition);
      return transition;
    };
  }
  addEventListener("pageswap", (event) => sessionStorage.setItem("motion-swap", JSON.stringify({ active: !!event.viewTransition, types: event.viewTransition ? [...event.viewTransition.types] : [] })));
  addEventListener("pagereveal", (event) => { window.__motionReveals.push({ active: !!event.viewTransition, time: performance.now() }); capture("cross-document", event.viewTransition); });
});
async function save(name) {
  await page.screenshot({ path: `${output}/${name}.png` });
}
async function step(name, run) {
  const detail = await run();
  results.push({ name, ...detail });
  console.log(`PASS ${name}`);
  await writeFile(`${output}/results.json`, JSON.stringify({ status: "running", results, pageErrors: errors }, null, 2));
}
try {
  await step("hero suggestions, keyboard and IME", async () => {
    assert.equal((await page.goto(origin)).status(), 200);
    const index = await page.evaluate(async () => (await fetch("/charts/search-index.json")).json());
    const first = index.find((entry) => entry.title?.length > 2);
    assert.ok(first);
    const input = page.locator('form[role="search"] input[role="combobox"]').first();
    await input.fill(first.title);
    await page.getByRole("listbox").waitFor();
    await input.press("ArrowDown");
    assert.ok(await input.getAttribute("aria-activedescendant"));
    await input.press("Escape");
    await page.getByRole("listbox").waitFor({ state: "hidden" });
    await input.fill("");
    await page.waitForTimeout(220);
    await input.dispatchEvent("compositionstart");
    await input.fill("组合输入");
    const before = page.url();
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
    assert.equal(page.url(), before);
    await input.dispatchEvent("compositionend");
    await input.fill(first.title);
    await page.getByRole("listbox").waitFor();
    await input.press("Escape");
    await input.press("Enter");
    await page.waitForURL((url) => url.searchParams.get("q") === first.title);
    await page.locator('[data-layout="card-grid"]').waitFor();
    return { suggestions: "real local index", submitted: true };
  });
  await step("catalog batches replace immediately and disclosure cancels", async () => {
    await page.waitForFunction(() => window.__motionTransitions.every((t) => t.finished));
    const navigationCount = await page.evaluate(() => window.__motionTransitions.length);
    const search = page.locator('main [role="search"] input').first();
    await search.fill("");
    await page.waitForFunction(() => document.querySelectorAll('[data-layout="card-grid"] > li:not([role="presentation"])').length > 1);
    const grid = page.locator('[data-layout="card-grid"]');
    const count = await grid.locator(':scope > li:not([role="presentation"])').count();
    assert.ok(count > 1);
    const animations = await grid.evaluate((el) => [...el.children].flatMap((child) => child.getAnimations()).length);
    assert.equal(animations, 0, "result cards must not wait on per-card animation");
    await page.waitForFunction(() => window.__motionTransitions.every((t) => t.finished));
    const localPageAnimations = await page.evaluate((start) => window.__motionTransitions.slice(start).flatMap((t) => t.animations), navigationCount);
    assert.deepEqual(localPageAnimations, [], "local catalog edits must not trigger whole-page enter/exit");
    const filter = page.getByRole("button", { name: /高级筛选/ }).first();
    await filter.click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(35);
    const panel = page.locator(`[id="${await filter.getAttribute("aria-controls")}"]`);
    const state = await panel.evaluate((el) => ({ opacity: getComputedStyle(el).opacity, height: el.style.height }));
    assert.equal(state.opacity, "1");
    assert.equal(state.height, "auto");
    await save("catalog-reduced");
    await filter.click();
    await panel.waitFor({ state: "hidden" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    return { cards: count, perCardAnimations: animations, disclosure: state };
  });
  await step("player audio survives collapse, expansion and route navigation", async () => {
    await page.getByRole("button", { name: "展开播放器", exact: true }).click();
    const region = page.getByRole("region", { name: "音乐播放器", exact: true });
    await region.getByRole("button", { name: "播放", exact: true }).click();
    await page.waitForFunction(() => {
      const audio = document.getElementById("astrodx-global-music-player-audio");
      return audio && !audio.paused && audio.currentTime > 0.1;
    });
    const token = await page.evaluate(() => {
      const audio = document.getElementById("astrodx-global-music-player-audio");
      audio.dataset.motionIdentity = "persistent";
      return { time: audio.currentTime, document: window.__motionDocument };
    });
    await region.getByRole("button", { name: "收起播放器", exact: true }).click();
    await page.waitForTimeout(220);
    const disc = page.locator('[data-motion-loop="disc"]');
    assert.equal(await disc.evaluate((el) => getComputedStyle(el).animationPlayState), "running");
    assert.equal(await disc.evaluate((el) => getComputedStyle(el).animationName), "adx-ambient-disc");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(40);
    assert.equal(await disc.evaluate((el) => getComputedStyle(el).animationPlayState), "paused");
    await page.getByRole("button", { name: "展开播放器", exact: true }).click();
    await page.waitForTimeout(50);
    await page.getByRole("button", { name: "打开版本歌单", exact: true }).click();
    await page.getByRole("dialog", { name: "版本歌单", exact: true }).waitFor();
    await save("player-reduced");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator('header').getByRole("link", { name: "首页", exact: true }).first().click();
    await page.waitForURL(origin + "/");
    const after = await page.evaluate(() => {
      const audio = document.getElementById("astrodx-global-music-player-audio");
      return { time: audio.currentTime, identity: audio.dataset.motionIdentity, paused: audio.paused, document: window.__motionDocument };
    });
    assert.equal(after.document, token.document, "Link navigation must be same-document in dev");
    assert.equal(after.identity, "persistent");
    assert.equal(after.paused, false);
    assert.ok(after.time >= token.time);
    await page.getByRole("region", { name: "音乐播放器", exact: true }).getByRole("button", { name: "暂停", exact: true }).click();
    await page.waitForFunction(() => window.__motionTransitions.every((t) => t.finished));
    sameDocumentEvents = await page.evaluate(() => window.__motionTransitions);
    return { sameAudioNode: true, timeAdvanced: after.time >= token.time, externalAudio: "30s silent WAV fixture" };
  });
  await step("dock restores a checkpoint and remains live while collapsing", async () => {
    await page.evaluate(async ({ maidata, bytes }) => {
      const request = indexedDB.open("astrodx-downloads", 3);
      const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const source = "https://astrodx-charts.saop.cc";
      const id = "motion-acceptance";
      const file = new Blob([maidata], { type: "text/plain" });
      const tx = db.transaction(["jobs", "files"], "readwrite");
      tx.objectStore("jobs").put({ id, kind: "single", title: "Motion acceptance fixture", format: "zip", createdAt: Date.now(), sourceId: "r2", files: [{ name: "maidata.txt", url: `${source}/motion-acceptance/maidata.txt`, bytes: file.size }, { name: "track.mp3", url: `${source}/motion-acceptance/track.mp3`, bytes }] });
      tx.objectStore("files").put({ key: `${id}::maidata.txt`, jobId: id, name: "maidata.txt", url: `${source}/motion-acceptance/maidata.txt`, sourceBaseUrl: source, complete: true, size: file.size, blob: file });
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      db.close();
    }, { maidata, bytes: fixtureBytes.length });
    await page.reload();
    const dock = page.locator('[data-slot="download-dock"]');
    await dock.getByText("Motion acceptance fixture", { exact: true }).waitFor();
    await dock.getByRole("button", { name: "继续", exact: true }).click();
    await dock.getByRole("button", { name: "暂停", exact: true }).waitFor();
    await dock.getByRole("button", { name: "收起下载列表", exact: true }).click();
    await dock.getByRole("button", { name: "展开下载列表", exact: true }).click();
    await dock.getByRole("progressbar").waitFor();
    const percent = Number(await dock.getByRole("progressbar").getAttribute("aria-valuenow"));
    assert.ok(percent >= 0 && percent < 100);
    await page.waitForTimeout(180);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("astrodx:download-started", { detail: { x: 50, y: 50 } })));
    await page.locator('[data-motion-feedback="download-flight"]').waitFor();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator('[data-motion-feedback="download-flight"]').waitFor({ state: "hidden" });
    await page.waitForTimeout(35);
    assert.equal(await dock.locator('[data-motion-loop="download-sweep"]').evaluate((el) => getComputedStyle(el).animationPlayState), "paused");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(400);
    assert.equal(await page.locator('[data-motion-feedback="download-flight"]').count(), 0);
    await dock.getByRole("button", { name: "取消", exact: true }).click();
    const armed = dock.getByRole("button", { name: "再点一次将放弃已下载的数据", exact: true });
    await armed.waitFor();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(40);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(40);
    assert.equal(await armed.locator("span.flex").evaluate((el) => getComputedStyle(el).transform), "none", "restoring motion must not replay attention");
    await dock.getByRole("button", { name: "取消", exact: true }).waitFor();
    await save("dock-packing");
    return { checkpoint: true, percentBeforeCompletion: percent, ghostCancelled: true };
  });
  await step("real archive completion and no replay after reopening", async () => {
    const downloadPromise = page.waitForEvent("download");
    releaseFile();
    const download = await downloadPromise;
    const path = `${output}/fixture.zip`;
    await download.saveAs(path);
    const archive = await readFile(path);
    assert.equal(archive.subarray(0, 2).toString(), "PK");
    const integrity = JSON.parse(execFileSync("python3", ["-c", "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({'bad':z.testzip(),'entries':len(z.namelist())}))", path], { encoding: "utf8" }));
    assert.equal(integrity.bad, null);
    assert.ok(integrity.entries >= 2);
    const dock = page.locator('[data-slot="download-dock"]');
    await dock.locator('[data-slot="drawn-check"]').waitFor();
    await page.waitForTimeout(400);
    await dock.getByRole("button", { name: "收起下载列表", exact: true }).click();
    await dock.getByRole("button", { name: "展开下载列表", exact: true }).click();
    await page.waitForTimeout(40);
    assert.equal(await dock.locator('[data-slot="drawn-check"] path').getAttribute("stroke-dasharray"), "1 1");
    await page.waitForTimeout(650);
    await save("dock-success");
    return { archiveIntegrity: integrity, fixtureGETs: fixtureRequests, successNotReplayed: true };
  });
  await step("same-document navigation tokens and reduced initial load", async () => {
    const same = sameDocumentEvents;
    assert.ok(same.some((t) => t.kind === "same-document" && t.animations.some((a) => a.name === "adx-page-enter" && a.duration === 320)));
    assert.ok(same.some((t) => t.animations.some((a) => a.name === "adx-page-exit" && a.duration === 180)));
    assert.deepEqual(errors, []);
    // Native cross-document lifecycle and history traversal have a separate
    // check-motion-native.mjs suite. Use a fresh reduced page for mobile.
    await page.close();
    page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(20000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal((await page.goto(`${origin}/charts`)).status(), 200);
    await page.locator('[data-layout="card-grid"]').waitFor();
    const disabled = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.pseudoElement && a.playState === "running").map((a) => a.animationName));
    assert.deepEqual(disabled, []);
    return { sameDocumentEvents: same, reducedRunning: disabled, nativeNavigation: "covered by check-motion-native.mjs" };
  });
  await step("390px reduced catalog and player", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.equal(await page.locator("html").getAttribute("data-reduced-motion"), "");
    await save("mobile-catalog-reduced");
    const region = page.getByRole("region", { name: "音乐播放器", exact: true });
    const collapse = region.getByRole("button", { name: "收起播放器", exact: true });
    if (await collapse.count()) await collapse.click();
    await page.getByRole("button", { name: "展开播放器", exact: true }).click();
    await page.waitForTimeout(50);
    const bounds = await page.locator('[data-music-player-surface="expanded"]').evaluate((el) => ({ x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right }));
    assert.ok(bounds.x >= 0 && bounds.right <= 391);
    await save("mobile-player-reduced");
    return bounds;
  });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/results.json`, JSON.stringify({ status: "passed", results, pageErrors: errors }, null, 2));
  console.log(`Site motion acceptance passed: ${results.length} groups`);
} catch (error) {
  await save("failure").catch(() => {});
  await writeFile(`${output}/results.json`, JSON.stringify({ status: "failed", error: String(error), diagnostics: await page.evaluate(() => ({ url: location.href, reveals: window.__motionReveals, transitions: window.__motionTransitions, pageNavigation: document.documentElement.dataset.pageNavigation, readyState: document.readyState, inputs: [...document.querySelectorAll('main input')].map((el) => ({ label: el.getAttribute('aria-label'), value: el.value })), cards: document.querySelectorAll('[data-layout="card-grid"] > li').length })).catch(() => null), results, pageErrors: errors }, null, 2));
  throw error;
} finally {
  releaseFile();
  await browser.close();
}
