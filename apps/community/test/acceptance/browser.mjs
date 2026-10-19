import {exerciseDiscovery} from "./discovery-browser.mjs";
import {exerciseAuthor} from "./author-browser.mjs";
import {exerciseLibrary} from "./library-browser.mjs";
import { exerciseFollowing } from "./following-browser.mjs";
// Run only on a remote Linux runner against the isolated acceptance Compose project.
// Playwright is installed outside the repository; no product dependency is needed.
import assert from "node:assert/strict";
import {chooseFiles} from "./browser-input.mjs";
import { exercisePlatform } from "./platform-browser.mjs";
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

const steps = [], diagnostics = [], suiteFailures = [];
let phase = "launch", browser, page, owner, other, anonymous, publicVisitor;
const startedAt = Date.now();
async function step(name, work) {
  phase = name;
  await work();
  steps.push(name);
  console.log(`ACCEPTANCE_STEP_OK ${name}`);
}
// Independent synthetic journeys may collect failures together; none can turn a failed run green.
async function independentSuite(name, work) {
  try { await work(); return true; }
  catch (error) {
    suiteFailures.push({ suite: name, phase, error: sanitized(error.message) });
    console.error(`ACCEPTANCE_SUITE_FAILED ${name}: ${sanitized(error.message)}`);
    return false;
  }
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
  let draft, asset, optionalDraft;
  await step("synthetic_accounts", async () => {
    const first = await json(owner, "/api/v1/me"), second = await json(other, "/api/v1/me");
    assert.ok(first.id && second.id); assert.notEqual(first.id, second.id);
    assert.equal(first.publicId, "1"); assert.equal(first.isAdmin, true); assert.equal(second.isAdmin, false);
    assert.equal((await json(owner, "/api/v1/me/charts")).items.length, 0);
  });
  await step("numeric_user_profiles_and_legacy_redirects", async () => {
    const first = await json(owner, "/api/v1/me"), second = await json(other, "/api/v1/me");
    assert.equal(first.publicId, "1"); assert.equal(second.publicId, "2");
    const canonical = await json(anonymous, "/api/v1/users/1");
    assert.equal(canonical.id, first.id); assert.equal(canonical.publicId, "1");
    assert.deepEqual(await json(anonymous, `/api/v1/users/${first.id}`), canonical);
    for (const [prefix, suffix] of [["", ""], ["/en", "/?tab=charts"], ["/ja", "?view=all"]]) {
      const response = await anonymous.request.get(new URL(`${prefix}/u/${first.id}${suffix}`, origin).href, { maxRedirects: 0 });
      assert.equal(response.status(), 302);
      assert.equal(response.headers()["cache-control"], "private, no-store");
      assert.equal(response.headers().location, `${prefix}/u/1${suffix.includes("?") ? suffix.slice(suffix.indexOf("?")) : ""}`);
    }
    await page.goto(new URL(`/u/${first.id}`, origin).href);
    await page.waitForURL(url => url.pathname === "/u/1");
    await page.getByRole("heading", { name: first.name, exact: true }).waitFor();
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), new URL("/u/1", origin).href);
    assert.equal(await page.getByText("ID：1", { exact: true }).count(), 1);
    await page.goto(new URL("/settings/profile", origin).href);
    assert.equal(await page.getByRole("link", { name: "查看我的主页", exact: true }).getAttribute("href"), "/u/1");
    for (const id of ["0", "01", "-1", "1e3", "9223372036854775808", "9999999"])
      await json(anonymous, `/api/v1/users/${id}`, 404);
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
        await chooseFiles(page.getByLabel("选择 ADX / ZIP", { exact: true }),{ name: "browser-chart.adx", mimeType: "application/octet-stream", buffer: original });
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
      await Promise.race([
        page.getByRole("button", {name:"保存私有草稿",exact:true}).waitFor({timeout:90000}),
        page.getByRole("alert").waitFor({timeout:90000}).then(async()=>{throw Error(await page.getByRole("alert").innerText());}),
      ]);
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
      assert.equal(current.publicId, null);
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
        const entries = new Map();
        const end = source.length - 22;
        assert.equal(source.readUInt32LE(end), 0x06054b50);
        let offset = source.readUInt32LE(end + 16);
        for (let index = 0; index < source.readUInt16LE(end + 10); index++) {
          assert.equal(source.readUInt32LE(offset), 0x02014b50);
          assert.equal(source.readUInt16LE(offset + 10), 0);
          const size = source.readUInt32LE(offset + 20), names = source.readUInt16LE(offset + 28);
          const local = source.readUInt32LE(offset + 42);
          const start = local + 30 + source.readUInt16LE(local + 26) + source.readUInt16LE(local + 28);
          entries.set(source.subarray(offset + 46, offset + 46 + names).toString(), source.subarray(start, start + size));
          offset += 46 + names + source.readUInt16LE(offset + 30) + source.readUInt16LE(offset + 32);
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
    await chooseFiles(page.getByLabel("选择 ADX / ZIP", { exact: true }),{ name: "ci-chart.zip", mimeType: "application/zip", buffer: zip });
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
  const publicBase = () => `/api/v1/charts/${publicChart?.publicId ?? draft.id}`;
  const publicAssets = () => ["maidata", "audio", "cover"].map(role => `${publicBase()}/versions/${draft.currentVersionId}/assets/${role}`);
  await step("private_draft_not_public_and_explicit_version_confirmation", async () => {
    await denied(anonymous, publicBase(), 404);
    assert.equal(await page.getByRole("button", { name: "确认发布", exact: true }).isEnabled(), false);
    await page.getByRole("region", { name: "公开发布", exact: true }).getByRole("combobox", { name: /公开版本/ }).selectOption(draft.currentVersionId);
    assert.equal(await page.getByRole("button", { name: "确认发布", exact: true }).isEnabled(), false);
    await page.getByLabel("我确认此版本的原始 ZIP 及其中的全部文件适合公开分享。", { exact: true }).check();
    const [published] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/me/charts/${draft.id}/publication` && r.request().method() === "PUT", { timeout: 60000 }),
      page.getByRole("button", { name: "确认发布", exact: true }).click(),
    ]);
    assert.equal(published.status(), 200);
    assert.equal((await published.json()).publicationPending, false);
    publicChart = await json(anonymous, publicBase());
    await page.getByText("已公开", { exact: true }).waitFor();
    await page.getByText(`当前公开：版本 ${publicChart.ordinal}`, { exact: true }).waitFor();
    assert.equal(publicChart.publicId, "1");
    assert.equal(await page.locator('a[href="/charts/1"]').count(), 1);
    assert.equal(publicChart.versionId, draft.currentVersionId);
    assert.equal(publicChart.title, draft.title);
    assert.equal(JSON.stringify(publicChart).includes("sourceFileId"), false);
  });
  await step("numeric_number_one_and_authorized_legacy_uuid_redirects", async () => {
    assert.equal((await json(anonymous, "/api/v1/charts/1")).author.publicId, "1");
    assert.deepEqual(await json(anonymous, `/api/v1/charts/${draft.id}`), publicChart);
    for (const prefix of ["", "/en", "/ja"]) for (const spelling of [`charts/${draft.id}`, `charts/${draft.id}/`, `Charts/${draft.id}`]) {
      const legacy = await anonymous.request.get(new URL(`${prefix}/${spelling}?from=legacy`, origin).href, { maxRedirects: 0 });
      assert.equal(legacy.status(), 302);
      assert.equal(legacy.headers().location, `${prefix}/charts/1?from=legacy`);
      assert.equal(legacy.headers()["cache-control"], "private, no-store");
    }
    for (const bad of ["0", "01", "-1", "1e3", "9223372036854775808"]) await denied(anonymous, `/api/v1/charts/${bad}`, 404);
    const oldZip = await anonymous.request.get(new URL(`/api/v1/charts/${draft.id}/download`, origin).href);
    assert.equal(oldZip.status(), 200); assert.deepEqual(await oldZip.body(), zip);
  });
  await step("newer_private_version_and_metadata_do_not_replace_snapshot", async () => {
    const newer = storedZip([["maidata.txt", Buffer.from("&title=New private version\n&inote_4=(120){4}1,2,E\n")]]);
    await chooseFiles(page.getByLabel("选择 ADX / ZIP", { exact: true }),{ name: "private-newer.zip", mimeType: "application/zip", buffer: newer });
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
      page.getByRole("button", { name: "保存作品资料", exact: true }).click(),
    ]);
    assert.equal(edited.status(), 200);
    assert.deepEqual(await json(anonymous, publicBase()), publicChart);
    await page.getByText("私有草稿与公开内容不同；编辑不会自动发布。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "确认更新公开内容", exact: true }).isEnabled(), false);
  });
  await step("anonymous_home_catalog_detail_lazy_native_preview_exact_zip", async () => {
    const visitor = await anonymous.newPage(), requested = [];
    visitor.on("request", r => requested.push(new URL(r.url()).pathname));
    visitor.on("console", message => { if (message.type() === "error") diagnostics.push({ type: "error", message: sanitized(message.text()) }); });
    visitor.on("pageerror", e => diagnostics.push({ type: "pageerror", message: sanitized(e.message) }));
    publicVisitor = visitor;
    await visitor.setViewportSize({ width: 1440, height: 900 });
    const home = await visitor.goto(origin.href);
    assert.equal(home.headers()["cache-control"], "private, no-store");
    const latest = visitor.locator("section").filter({ has: visitor.getByRole("heading", { name: "最近公开更新", exact: true }) }).getByRole("region", { name: "公开谱面", exact: true });
    await latest.getByRole("link", { name: /CI private draft/ }).waitFor();
    assert.ok(await latest.locator("ul").first().evaluate(el => el.getBoundingClientRect().width > 1000));
    if (evidenceDirectory) await visitor.screenshot({ path: join(evidenceDirectory, "public-home-desktop.png"), fullPage: true });
    for (const width of [320, 390]) {
      await visitor.setViewportSize({ width, height: 844 });
      assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    }
    if (evidenceDirectory) await visitor.screenshot({ path: join(evidenceDirectory, "public-home-mobile.png"), fullPage: true });
    await visitor.setViewportSize({ width: 1440, height: 900 });
    await latest.locator('a[href="/charts"]').click();
    await visitor.waitForURL(u => u.pathname === "/charts");
    await visitor.getByRole("heading", { level: 1, name: "公开谱面", exact: true }).waitFor();
    await visitor.getByRole("link", { name: /CI private draft/ }).click();
    await visitor.getByRole("heading", { level: 1, name: "CI private draft", exact: true }).waitFor();
    assert.equal(new URL(visitor.url()).pathname, `/charts/${publicChart.publicId}`);
    assert.equal(requested.some(p => p.endsWith("/assets/audio") || p.endsWith("/assets/maidata")), false);
    assert.equal(requested.some(p => p.includes("/api/v1/me/charts")), false);
    await visitor.getByRole("link", { name: "预览谱面", exact: true }).click();
    assert.equal(await visitor.evaluate(() => document.activeElement?.id), "chart-preview");
    assert.equal(requested.some(p => p.endsWith("/assets/audio") || p.endsWith("/assets/maidata")), false);
    await anonymous.grantPermissions(["clipboard-read", "clipboard-write"], { origin: origin.origin });
    await visitor.evaluate(() => Object.defineProperty(navigator, "share", { value: undefined, configurable: true }));
    await visitor.getByRole("button", { name: "分享谱面", exact: true }).click();
    await visitor.getByText("公开链接已复制。", { exact: true }).waitFor();
    assert.equal(await visitor.evaluate(() => navigator.clipboard.readText()), new URL(`/charts/${publicChart.publicId}`, origin).href);
    await visitor.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }));
    await visitor.getByRole("button", { name: "分享谱面", exact: true }).click();
    const manual = visitor.getByRole("textbox", { name: "公开谱面链接", exact: true });
    await manual.waitFor();
    assert.equal(await manual.inputValue(), new URL(`/charts/${publicChart.publicId}`, origin).href);
    assert.equal(await visitor.evaluate(() => document.activeElement?.getAttribute("aria-label")), "公开谱面链接");
    assert.equal(await visitor.getByText("公开链接已复制。", { exact: true }).count(), 0);
    await visitor.getByRole("button", { name: "关闭链接", exact: true }).click();
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
  });
  await step("locale_ssr_and_router_data_errors_cache_noindex", async () => {
    for (const prefix of ["", "/en", "/ja"]) {
      for (const suffix of ["", ".data"]) {
        const response = await anonymous.request.get(new URL(`${prefix}/charts/${publicChart.publicId}${suffix}`, origin).href);
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
  await independentSuite("platform", () => exercisePlatform({ owner, other, anonymous, page, origin, chart: { ...publicChart, id: draft.id }, evidenceDirectory, step }));
  await step("withdrawal_reauthorizes_all_old_asset_and_download_requests", async () => {
    await page.getByRole("button", { name: "撤回公开", exact: true }).click();
    const [withdrawn] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/publication") && r.request().method() === "DELETE", { timeout: 60000 }),
      page.getByRole("button", { name: "确认撤回", exact: true }).click(),
    ]);
    assert.equal(withdrawn.status(), 200); assert.equal((await withdrawn.json()).publicationPending, false);
    for (const path of [publicBase(), `${publicBase()}/download`, ...publicAssets(), `/api/v1/charts/${draft.id}`, `/api/v1/charts/${draft.id}/download`, ...["maidata", "audio", "cover"].map(role => `/api/v1/charts/${draft.id}/versions/${draft.currentVersionId}/assets/${role}`), `/charts/${draft.id}`, `/charts/${publicChart.publicId}`]) {
      for (const options of [{ method: "GET" }, { method: "HEAD" }, { method: "GET", headers: { Range: "bytes=0-1" } }, { method: "GET", headers: { "If-None-Match": "*" } }, { method: "GET", headers: { Range: "bytes=0-1", "If-Range": '"old"' } }]) {
        const result = await anonymous.request.fetch(new URL(path, origin).href, options);
        assert.equal(result.status(), 404); assert.equal(result.headers()["cache-control"], "private, no-store");
      }
    }
    assert.equal((await json(anonymous, "/api/v1/charts")).items.some(c => c.id === draft.id), false);
    await publicVisitor.getByRole("banner").getByRole("link", { name: "AstroDX 自制谱社区", exact: true }).click();
    await publicVisitor.waitForURL(url => url.pathname === "/");
    await publicVisitor.getByRole("heading", { level: 1, name: "发现好谱", exact: true }).waitFor();
    const updated = publicVisitor.locator("section").filter({ has: publicVisitor.getByRole("heading", { name: "最近公开更新", exact: true }) }).getByRole("region", { name: "公开谱面", exact: true });
    await updated.getByText("没有符合条件的公开内容。", { exact: true }).waitFor();
    assert.equal(await publicVisitor.getByRole("link", { name: /CI private draft/ }).count(), 0);
    await publicVisitor.close();
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
    await chooseFiles(page.getByLabel("选择 ADX / ZIP", { exact: true }),{ name: "optional.zip", mimeType: "application/zip", buffer: optionalZip });
    await page.getByRole("button", { name: "保存私有草稿", exact: true }).waitFor({ timeout: 90000 });
    const [saved] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === "/api/v1/me/charts" && r.request().method() === "POST"),
      page.getByRole("button", { name: "保存私有草稿", exact: true }).click(),
    ]);
    assert.equal(saved.status(), 201); const optional = await saved.json(); optionalDraft = optional;
    await page.waitForURL(url => url.pathname === `/me/charts/${optional.id}`);
    await page.getByRole("region", { name: "公开发布", exact: true }).getByRole("combobox", { name: /公开版本/ }).selectOption(optional.currentVersionId);
    await page.getByLabel("我确认此版本的原始 ZIP 及其中的全部文件适合公开分享。", { exact: true }).check();
    const [published] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/publication") && r.request().method() === "PUT", { timeout: 60000 }),
      page.getByRole("button", { name: "确认发布", exact: true }).click(),
    ]);
    assert.equal(published.status(), 200);
    const optionalPublic = await published.json(); assert.equal(optionalPublic.publicId, "2");
    const visitor = await anonymous.newPage(), requests = [];
    visitor.on("request", r => requests.push(new URL(r.url()).pathname));
    visitor.on("pageerror", e => diagnostics.push({ type: "pageerror", message: sanitized(e.message) }));
    visitor.on("console", message => { if (message.type() === "error") diagnostics.push({ type: "error", message: sanitized(message.text()) }); });
    await visitor.setViewportSize({ width: 390, height: 844 });
    await visitor.goto(new URL(`/charts/${optional.id}`, origin).href);
    assert.equal(new URL(visitor.url()).pathname, "/charts/2");
    await visitor.getByRole("heading", { name: "Optional media absent", exact: true }).waitFor();
    assert.equal(await visitor.getByRole("button", { name: "加载预览", exact: true }).isEnabled(), false);
    assert.equal(await visitor.getByRole("link", { name: "预览谱面", exact: true }).count(), 0);
    await visitor.getByText("此版本暂不支持在线预览，仍可下载原始 ZIP。", { exact: true }).waitFor();
    assert.equal(requests.some(path => path.startsWith(`/api/v1/charts/${optionalPublic.publicId}/versions/`) && path.includes("/assets/")), false);
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
  await step("dashboard_real_browser_permissions_navigation_and_unknown_backup", async () => {
    assert.ok(optionalDraft?.id, "the optional-media chart must remain available for dashboard moderation");
    const first = await json(owner, "/api/v1/me"), second = await json(other, "/api/v1/me");
    assert.equal(first.publicId, "1"); assert.equal(first.isAdmin, true); assert.equal(second.isAdmin, false);
    await page.getByRole("button", { name: `账号菜单：${first.name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "社区管理后台", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/dash");
    await page.getByRole("heading", { level: 1, name: "社区管理后台", exact: true }).waitFor();
    await page.getByText("管理员 #1", { exact: true }).waitFor();
    assert.match(await page.locator('meta[name="robots"]').getAttribute("content"), /noindex/);
    const navigation = page.getByRole("navigation", { name: "社区管理后台", exact: true });
    assert.deepEqual(await navigation.getByRole("link").evaluateAll(links=>links.map(link=>link.getAttribute("href"))), ["/dash/lists","/dash/discussions","/dash/featured","/dash/notices","/dash","/dash/users","/dash/charts","/dash/status","/dash/reports"]);
    if (evidenceDirectory) await page.screenshot({ path: join(evidenceDirectory, "dash-desktop.png"), fullPage: true });
    await navigation.getByRole("link", { name: "用户列表", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/dash/users");
    await page.getByRole("link", { name: `${first.name} · #1`, exact: true }).waitFor();
    await page.getByRole("link", { name: `${second.name} · #2`, exact: true }).waitFor();
    const users = await json(owner, "/api/v1/dash/users");
    for (const user of users.items) for (const field of ["email", "qq", "ipAddress", "token", "sessions"])
      assert.equal(Object.hasOwn(user, field), false, `admin user DTO must omit ${field}`);
    await navigation.getByRole("link", { name: "运行与备份状态", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/dash/status");
    await page.getByRole("heading", { name: "备份记录", exact: true }).waitFor();
    const status = await json(owner, "/api/v1/dash/status");
    assert.equal(status.backup.status, "unknown", "no backup coordinator has run in this isolated browser fixture");
    const backupState = page.getByText("最近一次已记录备份", { exact: true }).locator("..");
    await backupState.getByText("暂无记录或状态未知", { exact: true }).waitFor();
    await page.getByText("显示备份协调器实际记录的状态。升级前的历史记录可能为空；备份成功不等于已完成恢复验收。", { exact: true }).waitFor();
    const regular = await other.newPage();
    assert.equal((await regular.goto(new URL("/dash", origin).href)).status(), 403);
    await regular.getByRole("heading", { name: "无后台访问权限", exact: true }).waitFor();
    await regular.getByRole("button", { name: `账号菜单：${second.name}`, exact: true }).click();
    assert.equal(await regular.getByRole("menuitem", { name: "社区管理后台", exact: true }).count(), 0);
    await regular.close();
    for (const path of ["/dash", "/dash/users.data", "/api/v1/dash/access"]) {
      const response = await other.request.get(new URL(path, origin).href, { maxRedirects: 0 });
      assert.equal(response.status(), 403);
      assert.equal(response.headers()["cache-control"], "private, no-store");
      assert.equal(response.headers()["x-robots-tag"], "noindex, nofollow");
    }
    const redirected = await anonymous.request.get(new URL("/dash", origin).href, { maxRedirects: 0 });
    assert.equal(redirected.status(), 302);
    assert.equal(redirected.headers().location, "/login?next=%2Fdash");
    assert.equal(redirected.headers()["cache-control"], "private, no-store");
    assert.equal(redirected.headers()["x-robots-tag"], "noindex, nofollow");
    const visitor = await anonymous.newPage();
    await visitor.goto(new URL("/dash", origin).href);
    assert.equal(new URL(visitor.url()).pathname, "/login");
    assert.equal(new URL(visitor.url()).searchParams.get("next"), "/dash");
    await visitor.close();
  });
  await step("dashboard_explicit_takedown_immutable_audit_and_public_revocation", async () => {
    const listing = await json(owner, "/api/v1/dash/charts");
    const before = listing.items.find(chart => chart.id === optionalDraft.id);
    assert.ok(before); assert.equal(before.publicId, "2"); assert.equal(before.status, "public");
    await page.getByRole("navigation", { name: "社区管理后台", exact: true }).getByRole("link", { name: "公开谱面管理", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/dash/charts");
    const row = page.getByRole("article").filter({ has: page.getByRole("heading", { name: /Optional media absent/ }) });
    await row.getByRole("button", { name: "下架谱面", exact: true }).click();
    const confirm = row.getByRole("button", { name: "确认下架", exact: true });
    assert.equal(await confirm.isEnabled(), false);
    const reason = "Isolated browser acceptance moderation";
    await row.getByRole("textbox", { name: "下架原因（必填，最多 500 字）", exact: true }).fill(reason);
    assert.equal(await confirm.isEnabled(), false, "a reason alone is not explicit confirmation");
    await row.getByRole("checkbox", { name: "我确认下架谱面 #2，并记录上述原因。", exact: true }).check();
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1/dash/charts/${optionalDraft.id}/moderation` && r.request().method() === "POST", { timeout: 60000 }),
      confirm.click(),
    ]);
    assert.equal(response.status(), 200);
    assert.deepEqual(response.request().postDataJSON(), { expectedRevision: before.revision, reason });
    const moderated = await response.json();
    assert.equal(moderated.status, "moderated"); assert.equal(moderated.pending, false);
    assert.equal(moderated.moderation.reason, reason); assert.equal(moderated.moderation.actorPublicId, "1");
    await row.getByText("已下架", { exact: true }).waitFor();
    await row.getByText(reason, { exact: true }).waitFor();
    assert.equal(await row.getByRole("button", { name: "下架谱面", exact: true }).count(), 0);
    assert.equal(await row.getByRole("link", { name: "Optional media absent", exact: true }).count(), 0);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `dashboard fits ${width}px`);
    }
    if (evidenceDirectory) await page.screenshot({ path: join(evidenceDirectory, "dash-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const spelling of [optionalDraft.id, "2"]) {
      const base = `/api/v1/charts/${spelling}`;
      for (const path of [base, `${base}/download`, `${base}/versions/${optionalDraft.currentVersionId}/assets/maidata`, `/charts/${spelling}`]) {
        for (const options of [{ method: "GET" }, { method: "HEAD" }, { method: "GET", headers: { Range: "bytes=0-1" } }, { method: "GET", headers: { "If-None-Match": "*" } }]) {
          const result = await anonymous.request.fetch(new URL(path, origin).href, options);
          assert.equal(result.status(), 404, `${path}: moderated public access`);
          assert.equal(result.headers()["cache-control"], "private, no-store");
        }
      }
    }
    assert.equal((await json(anonymous, "/api/v1/charts")).items.some(chart => chart.id === optionalDraft.id), false);
    const privateChart = await json(owner, `/api/v1/me/charts/${optionalDraft.id}`);
    assert.ok(privateChart.versions.length > 0, "moderation preserves the author's private draft");
    const edited = await owner.request.patch(new URL(`/api/v1/me/charts/${optionalDraft.id}`, origin).href, {
      headers: { origin: origin.origin }, data: { expectedRevision: privateChart.revision, title: "Private edit after moderation", artist: "Private post-moderation artist" },
    });
    assert.equal(edited.status(), 200); const editedChart = await edited.json();
    const retry = await owner.request.post(new URL(`/api/v1/dash/charts/${optionalDraft.id}/moderation`, origin).href, {
      headers: { origin: origin.origin }, data: { expectedRevision: editedChart.revision, reason: "A retry must not replace the original reason" }, timeout: 60000,
    });
    assert.equal(retry.status(), 200);
    assert.deepEqual((await retry.json()).moderation, moderated.moderation, "the first moderation audit is immutable");
    const refreshed = (await json(owner, "/api/v1/dash/charts")).items.find(chart => chart.id === optionalDraft.id);
    assert.equal(refreshed.title, before.title); assert.equal(refreshed.artist, before.artist);
    assert.deepEqual(refreshed.moderation, moderated.moderation);
    await page.reload();
    await page.getByRole("heading", { name: /Optional media absent/ }).waitFor();
    assert.equal(await page.getByText("Private edit after moderation", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Private post-moderation artist", { exact: true }).count(), 0);
    const republished = await owner.request.put(new URL(`/api/v1/me/charts/${optionalDraft.id}/publication`, origin).href, {
      headers: { origin: origin.origin }, data: { expectedRevision: editedChart.revision, versionId: editedChart.currentVersionId, confirmOriginalArchive: true },
    });
    assert.equal(republished.status(), 409); assert.equal((await republished.json()).error.code, "CHART_MODERATED");
    await denied(anonymous, "/api/v1/charts/2", 404);
  });
  await independentSuite("library", () => exerciseLibrary({owner,other,anonymous,origin,step,evidenceDirectory,zip:label=>storedZip([["maidata.txt",Buffer.from(`&title=${label}\n&artist=Library browser\n&inote_4=(120){4}1,2,E\n`)]])}));
  await independentSuite("following", () => exerciseFollowing({owner,other,anonymous,origin,step,evidenceDirectory,zip:label=>storedZip([["maidata.txt",Buffer.from(`&title=${label}\n&artist=Following browser\n&inote_4=(120){4}1,2,E\n`)]])}));
  const authorPassed = await independentSuite("author", () => exerciseAuthor({owner,other,anonymous,origin,step,evidenceDirectory,zip:(label,next=false)=>storedZip([["maidata.txt",Buffer.from(`&title=${label}\n&artist=Creator browser\n&inote_4=(120){4}${next?"1,(240)3,4":"1,2"},E\n`)]])}));
  if (authorPassed) await independentSuite("discovery", () => exerciseDiscovery({owner,other,anonymous,origin,step,evidenceDirectory,independentSuite}));
  assert.deepEqual(suiteFailures, [], "all independent synthetic journeys must pass");
  assert.equal(diagnostics.filter(row => row.type === "pageerror").length, 0, "uncaught browser errors");
  assert.equal(diagnostics.filter(row => row.type === "error" && /hydration|hydrating|minified react error/i.test(row.message)).length, 0, "hydration errors");
}
let deadline;
try {
  if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await Promise.race([acceptance(), new Promise((_, reject) => {
    deadline = setTimeout(() => reject(new Error("ACCEPTANCE_OVERALL_TIMEOUT")), 540000);
  })]);
  const result = { status: "passed", steps, elapsedMs: Date.now() - startedAt, browser: "chromium", syntheticAccounts: true, pageErrors: diagnostics.filter(row => row.type === "pageerror").length, hydrationErrors: diagnostics.filter(row => row.type === "error" && /hydration|hydrating|minified react error/i.test(row.message)).length };
  if (evidenceDirectory) await writeFile(join(evidenceDirectory, "browser-result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  console.log("ACCEPTANCE_BROWSER_PASSED");
} catch (error) {
  const result = { status: "failed", phase, steps, elapsedMs: Date.now() - startedAt, error: sanitized(error.message), suiteFailures, diagnostics: diagnostics.slice(-40) };
  if (evidenceDirectory) {
    await writeFile(join(evidenceDirectory, "browser-result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    const failedPage = phase === "anonymous_home_catalog_detail_lazy_native_preview_exact_zip" ? publicVisitor : page;
    if (failedPage && !failedPage.isClosed()) await failedPage.screenshot({ path: join(evidenceDirectory, "browser-failure.png"), fullPage: true, timeout: 5000 }).catch(() => {});
  }
  console.error(`ACCEPTANCE_BROWSER_FAILED ${phase}: ${sanitized(error.message)}`);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await Promise.allSettled([owner?.close(), other?.close(), anonymous?.close()]);
  await browser?.close();
}
