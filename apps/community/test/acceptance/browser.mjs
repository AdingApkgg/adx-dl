// Run only on a remote Linux runner against the isolated acceptance Compose project.
// Playwright is installed outside the repository; no product dependency is needed.
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

if (process.platform !== "linux") throw new Error("ACCEPTANCE_REQUIRES_REMOTE_LINUX");
const modulePath = process.env.ACCEPTANCE_PLAYWRIGHT_PATH;
const fixtureDirectory = process.env.ACCEPTANCE_FIXTURE_DIR;
const evidenceDirectory = process.env.ACCEPTANCE_EVIDENCE_DIR;
if (!modulePath || !isAbsolute(modulePath) || !fixtureDirectory || !isAbsolute(fixtureDirectory)) {
  throw new Error("ACCEPTANCE_ABSOLUTE_MODULE_AND_FIXTURE_PATH_REQUIRED");
}
if (evidenceDirectory && !isAbsolute(evidenceDirectory)) throw new Error("ACCEPTANCE_ABSOLUTE_ARTIFACT_PATH_REQUIRED");
const origin = new URL(process.env.ACCEPTANCE_ORIGIN ?? "http://127.0.0.1:41909");
if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.port !== "41909" ||
    origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) {
  throw new Error("ACCEPTANCE_ISOLATED_LOOPBACK_ORIGIN_REQUIRED");
}
const { chromium } = await import(pathToFileURL(modulePath).href);
const cookieSecrets = [];
async function fixtureCookie(name) {
  const path = join(fixtureDirectory, name);
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error("ACCEPTANCE_COOKIE_PERMISSIONS_INVALID");
  const text = (await readFile(path, "utf8")).trim();
  const match = /^adxc\.session_token=([^;\s]+)$/.exec(text);
  if (!match) throw new Error("ACCEPTANCE_COOKIE_INVALID");
  cookieSecrets.push(text, match[1], decodeURIComponent(match[1]));
  return { name: "adxc.session_token", value: match[1], url: origin.href, httpOnly: true, secure: false, sameSite: "Lax" };
}
function sanitized(value) {
  let text = String(value);
  for (const secret of cookieSecrets) text = text.replaceAll(secret, "[redacted]");
  return text.replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
    .replace(/(session_token|authorization|client_secret|access_token)([=:]\s*)[^\s,;"']+/gi, "$1$2[redacted]")
    .slice(0, 1200);
}

// Tiny valid STORED ZIP/PNG fixtures: generated in memory, with no fixture generator packages.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function storedZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name);
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(bytes.length, 20);
    directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(filename.length, 28);
    directory.writeUInt32LE(offset, 42); central.push(directory, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function png() {
  const chunk = (type, data) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(32 * (1 + 32 * 3), 160);
  for (let row = 0; row < 32; row++) pixels[row * (1 + 32 * 3)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
function wav() {
  const samples = 8000, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let sample = 0; sample < samples; sample++) bytes.writeInt16LE(Math.round(Math.sin(sample * Math.PI * 2 * 440 / 8000) * 1000), 44 + sample * 2);
  return bytes;
}

const steps = [], diagnostics = [];
let phase = "launch", browser, page, owner, other, anonymous;
const startedAt = Date.now();
async function step(name, work) {
  phase = name;
  await work();
  steps.push(name);
  console.log(`ACCEPTANCE_STEP_OK ${name}`);
}
async function json(context, path, status = 200) {
  const response = await context.request.get(new URL(path, origin).href, { timeout: 10000 });
  assert.equal(response.status(), status, `${path}: expected HTTP ${status}`);
  return response.json();
}
async function denied(context, path, status) {
  const response = await context.request.get(new URL(path, origin).href, { timeout: 10000 });
  assert.equal(response.status(), status, `${path}: private access denial`);
  assert.equal(response.headers()["cache-control"], "private, no-store");
}
async function acceptance() {
  const ownerCookie = await fixtureCookie("session-cookie"), otherCookie = await fixtureCookie("other-session-cookie");
  assert.notEqual(ownerCookie.value, otherCookie.value, "fixture sessions must be different");
  browser = await chromium.launch({ headless: true });
  owner = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 900 } });
  other = await browser.newContext({ locale: "zh-CN" });
  anonymous = await browser.newContext();
  await owner.addCookies([ownerCookie]); await other.addCookies([otherCookie]);
  owner.setDefaultTimeout(15000); owner.setDefaultNavigationTimeout(20000);
  page = await owner.newPage();
  page.on("pageerror", error => diagnostics.push({ type: "pageerror", message: sanitized(error.message) }));
  page.on("console", message => {
    if (["warning", "error"].includes(message.type())) diagnostics.push({ type: message.type(), message: sanitized(message.text()) });
  });
  page.on("requestfailed", request => diagnostics.push({ type: "requestfailed", path: new URL(request.url()).pathname, failure: sanitized(request.failure()?.errorText) }));
  page.on("response", response => {
    if (response.status() >= 400) diagnostics.push({ type: "http", status: response.status(), path: new URL(response.url()).pathname });
  });
  const image = png(), audio = wav();
  const maidata = Buffer.from("&title=CI private draft\n&artist=Synthetic fixture\n&inote_4=(120){4}1,2,3,E\n");
  const zip = storedZip([["maidata.txt", maidata], ["track.wav", audio], ["bg.png", image]]);
  let draft, asset;
  await step("synthetic_accounts", async () => {
    const first = await json(owner, "/api/v1/me"), second = await json(other, "/api/v1/me");
    assert.ok(first.id && second.id); assert.notEqual(first.id, second.id);
    assert.equal((await json(owner, "/api/v1/me/charts")).items.length, 0);
  });
  for (const mode of ["adx", "parts"]) await step(`real_browser_${mode}_upload_save_reload`, async () => {
    const title = `Browser ${mode} upload`;
    const score = Buffer.from(`&title=${title}\n&artist=Synthetic fixture\n&inote_4=(120){4}1,2,3,E\n`);
    const original = storedZip([["maidata.txt", score], ["track.wav", audio], ["bg.png", image]]);
    let uploadStarts = 0, workers = 0;
    const observe = request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/uploads") uploadStarts++; };
    const observeWorker = () => { workers++; };
    page.on("request", observe); page.on("worker", observeWorker);
    try {
      await page.goto(new URL("/me/charts/new", origin).href);
      if (mode === "adx") {
        await page.getByLabel("选择 ADX / ZIP", { exact: true }).setInputFiles({ name: "browser-chart.adx", mimeType: "application/octet-stream", buffer: original });
      } else {
        for (const [label, name, mimeType, buffer] of [
          ["谱面文件（必选）", "my-score.txt", "text/plain", score],
          ["音乐（可选）", "my-song.wav", "audio/wav", audio],
          ["曲绘（可选）", "my-cover.png", "image/png", image],
          ["背景视频（可选，仅保留原件）", "my-video.mp4", "video/mp4", Buffer.from("synthetic original-only video")],
        ]) await page.getByLabel(label, { exact: true }).setInputFiles({ name, mimeType, buffer });
        await page.getByRole("button", { name: "移除 背景视频（可选，仅保留原件）", exact: true }).click();
        assert.equal(await page.getByText("my-score.txt", { exact: true }).count(), 1);
        await page.getByLabel("背景视频（可选，仅保留原件）", { exact: true }).setInputFiles({ name: "my-video.mp4", mimeType: "video/mp4", buffer: Buffer.from("synthetic original-only video") });
        assert.equal(uploadStarts, 0, "selection must remain local before assembly");
        await page.getByRole("button", { name: "组装并上传", exact: true }).click();
      }
      await page.getByRole("button", { name: "保存私有草稿", exact: true }).waitFor({ timeout: 90000 });
      assert.equal(uploadStarts, 1); if (mode === "parts") assert.ok(workers > 0, "real browser packaging Worker must run");
      assert.equal((await json(owner, "/api/v1/me/charts")).items.length, 0);
      const [saved] = await Promise.all([
        page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/me/charts" && r.request().method() === "POST"),
        page.getByRole("button", { name: "保存私有草稿", exact: true }).click(),
      ]);
      assert.equal(saved.status(), 201); const chart = await saved.json();
      await page.waitForURL(url => url.pathname === `/me/charts/${chart.id}`);
      assert.equal((await page.reload()).status(), 200);
      await page.getByRole("heading", { level: 1, name: title, exact: true }).waitFor();
      const current = await json(owner, `/api/v1/me/charts/${chart.id}`);
      assert.equal(current.currentVersionId, chart.currentVersionId);
      const base = `/api/v1/me/charts/${chart.id}/versions/${chart.currentVersionId}/assets`;
      for (const [role, expected] of [["maidata", score], ["audio", audio]]) {
        const assetResponse = await owner.request.get(new URL(`${base}/${role}`, origin).href);
        assert.equal(assetResponse.status(), 200); assert.deepEqual(await assetResponse.body(), expected);
      }
      const sourceResponse = await owner.request.get(new URL(`/api/v1/files/${chart.versions[0].sourceFileId}/content`, origin).href);
      assert.equal(sourceResponse.status(), 200); const source = await sourceResponse.body();
      if (mode === "adx") assert.deepEqual(source, original);
      else {
        // Browser Worker writes STORED entries; verify every canonical path and untouched source byte.
        const entries = new Map(); let offset = 0;
        while (source.readUInt32LE(offset) === 0x04034b50) {
          assert.equal(source.readUInt16LE(offset + 8), 0);
          const size = source.readUInt32LE(offset + 18), names = source.readUInt16LE(offset + 26), extra = source.readUInt16LE(offset + 28);
          const start = offset + 30 + names + extra;
          entries.set(source.subarray(offset + 30, offset + 30 + names).toString(), source.subarray(start, start + size));
          offset = start + size;
        }
        assert.deepEqual([...entries.keys()].sort(), ["bg.png", "maidata.txt", "pv.mp4", "track.wav"]);
        for (const [name, expected] of [["maidata.txt", score], ["track.wav", audio], ["bg.png", image], ["pv.mp4", Buffer.from("synthetic original-only video")]]) assert.deepEqual(entries.get(name), expected);
      }
      await page.getByRole("button", { name: "加载预览", exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent === "播放" && !b.disabled));
      assert.equal(await page.locator("canvas").count(), 1);
      assert.equal(await page.getByRole("alert").count(), 0);
      if (evidenceDirectory) await page.screenshot({ path: join(evidenceDirectory, `upload-${mode}.png`), fullPage: true });
      await page.getByRole("button", { name: "关闭预览", exact: true }).click();
      await page.getByRole("button", { name: "删除草稿", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "删除草稿", exact: true }).click();
      await page.waitForURL(url => url.pathname === "/me/charts");
      assert.equal((await json(owner, "/api/v1/me/charts")).items.length, 0);
    } finally { page.off("request", observe); page.off("worker", observeWorker); }
  });
  await step("upload_processed_before_explicit_save", async () => {
    const response = await page.goto(new URL("/me/charts/new", origin).href);
    assert.equal(response.status(), 200);
    await page.getByLabel("选择 ADX / ZIP", { exact: true }).setInputFiles({ name: "ci-chart.zip", mimeType: "application/zip", buffer: zip });
    await page.getByRole("button", { name: "保存私有草稿", exact: true }).waitFor({ state: "visible", timeout: 90000 });
    assert.equal((await json(owner, "/api/v1/me/charts")).items.length, 0, "processing alone must not create a draft");
    assert.equal(await page.getByRole("alert").count(), 0);
  });
  await step("save_and_reload_private_draft", async () => {
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/me/charts" && response.request().method() === "POST"),
      page.getByRole("button", { name: "保存私有草稿", exact: true }).click(),
    ]);
    assert.equal(response.status(), 201); draft = await response.json();
    assert.match(draft.id, /^[a-f0-9-]{36}$/); assert.equal(draft.title, "CI private draft");
    await page.waitForURL(url => url.pathname === `/me/charts/${draft.id}`);
    const reloaded = await page.reload(); assert.equal(reloaded.status(), 200);
    await page.getByRole("heading", { level: 1, name: "CI private draft", exact: true }).waitFor();
    const current = await json(owner, `/api/v1/me/charts/${draft.id}`);
    assert.equal(current.currentVersionId, draft.currentVersionId); assert.equal(current.versions.length, 1);
    assert.equal(current.versions[0].summary.audio.mime, "audio/wav");
    asset = `/api/v1/me/charts/${draft.id}/versions/${draft.currentVersionId}/assets/audio`;
    await page.getByRole("button", { name: "加载预览", exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(button => button.textContent === "播放" && !button.disabled));
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.equal(await page.getByRole("slider", { name: "拖动预览时间轴", exact: true }).isEnabled(), true);
    const canvas = page.locator("canvas"); assert.equal(await canvas.count(), 1);
    assert.equal(await canvas.evaluate(element => element.width > 0 && element.height > 0), true);
    await page.getByRole("button", { name: "关闭预览", exact: true }).click();
  });
  await step("private_audio_range_and_owner_isolation", async () => {
    const range = await owner.request.get(new URL(asset, origin).href, { headers: { Range: "bytes=44-75" }, timeout: 10000 });
    assert.equal(range.status(), 206); assert.equal(range.headers()["content-range"], `bytes 44-75/${audio.length}`);
    assert.equal(range.headers()["content-length"], "32"); assert.equal(range.headers()["cache-control"], "private, no-store");
    assert.equal(range.headers()["content-type"], "audio/wav"); assert.deepEqual(await range.body(), audio.subarray(44, 76));
    await denied(anonymous, asset, 401); await denied(other, asset, 404);
    await denied(other, `/api/v1/me/charts/${draft.id}`, 404);
    const source = `/api/v1/files/${draft.versions[0].sourceFileId}/content`;
    await denied(anonymous, source, 401); await denied(other, source, 404);
  });
  let publicChart;
  const publicBase = () => `/api/v1/charts/${draft.id}`;
  const publicAssets = () => ["maidata", "audio", "cover"].map(role => `${publicBase()}/versions/${draft.currentVersionId}/assets/${role}`);
  await step("private_draft_not_public_and_explicit_version_confirmation", async () => {
    await denied(anonymous, publicBase(), 404);
    assert.equal(await page.getByRole("button", { name: "确认发布", exact: true }).isEnabled(), false);
    await page.getByRole("combobox", { name: /公开版本/ }).selectOption(draft.currentVersionId);
    assert.equal(await page.getByRole("button", { name: "确认发布", exact: true }).isEnabled(), false);
    await page.getByLabel("我确认此版本的原始 ZIP 及其中的全部文件适合公开分享。", { exact: true }).check();
    const [published] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === `${publicBase().replace('/charts/', '/me/charts/')}/publication` && r.request().method() === "PUT", { timeout: 60000 }),
      page.getByRole("button", { name: "确认发布", exact: true }).click(),
    ]);
    assert.equal(published.status(), 200);
    assert.equal((await published.json()).publicationPending, false);
    publicChart = await json(anonymous, publicBase());
    assert.equal(publicChart.versionId, draft.currentVersionId);
    assert.equal(publicChart.title, draft.title);
    assert.equal(JSON.stringify(publicChart).includes("sourceFileId"), false);
  });
  await step("newer_private_version_and_metadata_do_not_replace_snapshot", async () => {
    const newer = storedZip([["maidata.txt", Buffer.from("&title=New private version\n&inote_4=(120){4}1,2,E\n")]]);
    await page.getByLabel("选择 ADX / ZIP", { exact: true }).setInputFiles({ name: "private-newer.zip", mimeType: "application/zip", buffer: newer });
    await page.getByRole("button", { name: "保存私有草稿", exact: true }).waitFor({ timeout: 90000 });
    const [saved] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/me/charts/${draft.id}/versions` && r.request().method() === "POST"),
      page.getByRole("button", { name: "保存私有草稿", exact: true }).click(),
    ]);
    assert.equal(saved.status(), 201);
    const latest = await saved.json();
    assert.notEqual(latest.currentVersionId, draft.currentVersionId);
    await denied(anonymous, `${publicBase()}/versions/${latest.currentVersionId}/assets/maidata`, 404);
    await page.getByLabel("标题", { exact: true }).fill("Private metadata edited");
    const [edited] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/me/charts/${draft.id}` && r.request().method() === "PATCH"),
      page.getByRole("button", { name: "保存标题和曲师", exact: true }).click(),
    ]);
    assert.equal(edited.status(), 200);
    assert.deepEqual(await json(anonymous, publicBase()), publicChart);
  });
  await step("anonymous_home_catalog_detail_lazy_native_preview_exact_zip", async () => {
    const visitor = await anonymous.newPage(), requested = [];
    visitor.on("request", r => requested.push(new URL(r.url()).pathname));
    visitor.on("console", message => { if (message.type() === "error") diagnostics.push({ type: "error", message: sanitized(message.text()) }); });
    visitor.on("pageerror", e => diagnostics.push({ type: "pageerror", message: sanitized(e.message) }));
    await visitor.goto(origin.href);
    await visitor.getByRole("link", { name: "浏览公开谱面", exact: true }).click();
    await visitor.getByRole("link", { name: /CI private draft/ }).click();
    await visitor.getByRole("heading", { level: 1, name: "CI private draft", exact: true }).waitFor();
    assert.equal(requested.some(p => p.endsWith("/assets/audio") || p.endsWith("/assets/maidata")), false);
    assert.equal(requested.some(p => p.includes("/api/v1/me/charts")), false);
    await visitor.getByRole("button", { name: "加载预览", exact: true }).click();
    await visitor.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent === "播放" && !b.disabled));
    assert.ok(requested.includes(publicAssets()[0])); assert.ok(requested.includes(publicAssets()[1]));
    assert.equal(await visitor.locator("canvas").count(), 1);
    await visitor.getByRole("button", { name: "播放", exact: true }).click();
    await visitor.getByRole("button", { name: "暂停", exact: true }).waitFor();
    await visitor.getByRole("button", { name: "暂停", exact: true }).click();
    if (evidenceDirectory) await visitor.screenshot({ path: join(evidenceDirectory, "public-desktop.png"), fullPage: true });
    const [download] = await Promise.all([visitor.waitForEvent("download"), visitor.getByRole("link", { name: "下载原始 ZIP", exact: true }).click()]);
    assert.deepEqual(await readFile(await download.path()), zip);
    await visitor.setViewportSize({ width: 390, height: 844 });
    assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (evidenceDirectory) await visitor.screenshot({ path: join(evidenceDirectory, "public-mobile.png"), fullPage: true });
    for (const [path, bytes] of [[publicAssets()[0], maidata], [publicAssets()[1], audio]]) {
      const result = await anonymous.request.get(new URL(path, origin).href);
      assert.equal(result.status(), 200); assert.deepEqual(await result.body(), bytes);
    }
    const cover = await anonymous.request.get(new URL(publicAssets()[2], origin).href);
    assert.equal(cover.status(), 200); assert.match(cover.headers()["content-type"], /^image\//);
    assert.ok((await cover.body()).length > 0);
    const zipHead = await anonymous.request.head(new URL(`${publicBase()}/download`, origin).href);
    assert.equal(zipHead.status(), 200); assert.equal(zipHead.headers()["content-length"], String(zip.length));
    const cached = await anonymous.request.get(new URL(`${publicBase()}/download`, origin).href, { headers: { "If-None-Match": zipHead.headers().etag } });
    assert.equal(cached.status(), 304); assert.equal(cached.headers()["cache-control"], "private, no-store");
    const range = await anonymous.request.get(new URL(publicAssets()[1], origin).href, { headers: { Range: "bytes=44-75" } });
    assert.equal(range.status(), 206); assert.deepEqual(await range.body(), audio.subarray(44,76));
    await visitor.close();
  });
  await step("locale_ssr_and_router_data_errors_cache_noindex", async () => {
    for (const prefix of ["", "/en", "/ja"]) {
      for (const suffix of ["", ".data"]) {
        const response = await anonymous.request.get(new URL(`${prefix}/charts/${draft.id}${suffix}`, origin).href);
        assert.equal(response.status(), 200); assert.equal(response.headers()["cache-control"], "private, no-store");
        assert.ok((await response.text()).includes("CI private draft"));
        for (const id of ["invalid", "12345678-1234-4234-8234-123456789012"]) {
          const missing = await anonymous.request.get(new URL(`${prefix}/charts/${id}${suffix}`, origin).href);
          assert.equal(missing.status(), 404); assert.equal(missing.headers()["cache-control"], "private, no-store");
          if (!suffix) assert.match(await missing.text(), /name="robots" content="noindex"/);
        }
      }
    }
  });
  await step("withdrawal_reauthorizes_all_old_asset_and_download_requests", async () => {
    await page.getByRole("button", { name: "撤回公开", exact: true }).click();
    const [withdrawn] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/publication") && r.request().method() === "DELETE", { timeout: 60000 }),
      page.getByRole("button", { name: "确认撤回", exact: true }).click(),
    ]);
    assert.equal(withdrawn.status(), 200); assert.equal((await withdrawn.json()).publicationPending, false);
    for (const path of [publicBase(), `${publicBase()}/download`, ...publicAssets()]) {
      for (const options of [{ method: "GET" }, { method: "HEAD" }, { method: "GET", headers: { Range: "bytes=0-1" } }, { method: "GET", headers: { "If-None-Match": "*" } }, { method: "GET", headers: { Range: "bytes=0-1", "If-Range": '"old"' } }]) {
        const result = await anonymous.request.fetch(new URL(path, origin).href, options);
        assert.equal(result.status(), 404); assert.equal(result.headers()["cache-control"], "private, no-store");
      }
    }
    assert.equal((await json(anonymous, "/api/v1/charts")).items.some(c => c.id === draft.id), false);
    assert.equal((await json(owner, `/api/v1/me/charts/${draft.id}`)).versions.length, 2);
  });
  await step("explicit_delete_releases_private_draft", async () => {
    await page.getByRole("button", { name: "删除草稿", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "删除草稿", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/me/charts");
    const reloaded = await page.reload(); assert.equal(reloaded.status(), 200);
    await page.getByText("还没有私有草稿。", { exact: true }).waitFor();
    const list = await json(owner, "/api/v1/me/charts");
    assert.equal(list.items.length, 0); assert.equal(list.usage.usedBytes, 0); assert.equal(list.usage.reservedBytes, 0);
    await denied(owner, asset, 404); await denied(owner, `/api/v1/me/charts/${draft.id}`, 404);
  });
  await step("missing_optional_media_and_unsupported_difficulty", async () => {
    const optionalZip = storedZip([["maidata.txt", Buffer.from("&title=Optional media absent\n&inote_4=(120){4}1,9,nonsense,E\n")]]);
    await page.goto(new URL("/me/charts/new", origin).href);
    await page.getByLabel("选择 ADX / ZIP", { exact: true }).setInputFiles({ name: "optional.zip", mimeType: "application/zip", buffer: optionalZip });
    await page.getByRole("button", { name: "保存私有草稿", exact: true }).waitFor({ timeout: 90000 });
    const [saved] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/me/charts" && r.request().method() === "POST"),
      page.getByRole("button", { name: "保存私有草稿", exact: true }).click(),
    ]);
    assert.equal(saved.status(), 201); const optional = await saved.json();
    await page.waitForURL(url => url.pathname === `/me/charts/${optional.id}`);
    await page.getByRole("combobox", { name: /公开版本/ }).selectOption(optional.currentVersionId);
    await page.getByLabel("我确认此版本的原始 ZIP 及其中的全部文件适合公开分享。", { exact: true }).check();
    const [published] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/publication") && r.request().method() === "PUT", { timeout: 60000 }),
      page.getByRole("button", { name: "确认发布", exact: true }).click(),
    ]);
    assert.equal(published.status(), 200);
    const visitor = await anonymous.newPage(), requests = [];
    visitor.on("request", r => requests.push(new URL(r.url()).pathname));
    visitor.on("pageerror", e => diagnostics.push({ type: "pageerror", message: sanitized(e.message) }));
    visitor.on("console", message => { if (message.type() === "error") diagnostics.push({ type: "error", message: sanitized(message.text()) }); });
    await visitor.setViewportSize({ width: 390, height: 844 });
    await visitor.goto(new URL(`/charts/${optional.id}`, origin).href);
    await visitor.getByRole("heading", { name: "Optional media absent", exact: true }).waitFor();
    assert.equal(await visitor.getByRole("button", { name: "加载预览", exact: true }).isEnabled(), false);
    assert.equal(requests.some(path => path.startsWith(`/api/v1/charts/${optional.id}/versions/`) && path.includes("/assets/")), false);
    if (evidenceDirectory) await visitor.screenshot({ path: join(evidenceDirectory, "public-optional-media.png"), fullPage: true });
    for (const role of ["audio", "cover"]) await denied(anonymous, `/api/v1/charts/${optional.id}/versions/${optional.currentVersionId}/assets/${role}`, 404);
    const download = await anonymous.request.get(new URL(`/api/v1/charts/${optional.id}/download`, origin).href);
    assert.equal(download.status(), 200); assert.deepEqual(await download.body(), optionalZip);
    await visitor.close();
  });
  await step("avatar_upload_save_and_public_jpeg", async () => {
    assert.equal((await page.goto(new URL("/settings/profile", origin).href)).status(), 200);
    await page.getByLabel("选择头像", { exact: true }).setInputFiles({ name: "ci-avatar.png", mimeType: "image/png", buffer: image });
    await page.getByRole("button", { name: "保存头像", exact: true }).waitFor({ state: "visible", timeout: 90000 });
    const [saved] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/me/avatar" && response.request().method() === "PUT"),
      page.getByRole("button", { name: "保存头像", exact: true }).click(),
    ]);
    assert.equal(saved.status(), 200); const avatar = await saved.json();
    assert.match(avatar.image, /^\/media\/[a-f0-9]{64}\.jpg$/);
    await page.reload(); assert.equal((await json(owner, "/api/v1/me")).image, avatar.image);
    const jpeg = await anonymous.request.get(new URL(avatar.image, origin).href, { timeout: 10000 });
    assert.equal(jpeg.status(), 200); assert.equal(jpeg.headers()["content-type"], "image/jpeg");
    const bytes = await jpeg.body(); assert.equal(bytes.readUInt16BE(0), 0xffd8); assert.ok(bytes.length <= 524288);
  });
  assert.equal(diagnostics.filter(row => row.type === "pageerror").length, 0, "uncaught browser errors");
  assert.equal(diagnostics.filter(row => row.type === "error" && /hydration|hydrating|minified react error/i.test(row.message)).length, 0, "hydration errors");
}
let deadline;
try {
  if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await Promise.race([acceptance(), new Promise((_, reject) => {
    deadline = setTimeout(() => reject(new Error("ACCEPTANCE_OVERALL_TIMEOUT")), 240000);
  })]);
  const result = { status: "passed", steps, elapsedMs: Date.now() - startedAt, browser: "chromium", syntheticAccounts: true, pageErrors: diagnostics.filter(row => row.type === "pageerror").length, hydrationErrors: diagnostics.filter(row => row.type === "error" && /hydration|hydrating|minified react error/i.test(row.message)).length };
  if (evidenceDirectory) await writeFile(join(evidenceDirectory, "browser-result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log("ACCEPTANCE_BROWSER_PASSED");
} catch (error) {
  const result = { status: "failed", phase, steps, elapsedMs: Date.now() - startedAt, error: sanitized(error.message), diagnostics: diagnostics.slice(-40) };
  if (evidenceDirectory) {
    await writeFile(join(evidenceDirectory, "browser-result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    if (page && !page.isClosed()) await page.screenshot({ path: join(evidenceDirectory, "browser-failure.png"), fullPage: true, timeout: 5000 }).catch(() => {});
  }
  console.error(`ACCEPTANCE_BROWSER_FAILED ${phase}: ${sanitized(error.message)}`);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await Promise.allSettled([owner?.close(), other?.close(), anonymous?.close()]);
  await browser?.close();
}
