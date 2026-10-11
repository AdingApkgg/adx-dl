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
  await step("upload_processed_before_explicit_save", async () => {
    const response = await page.goto(new URL("/me/charts/new", origin).href);
    assert.equal(response.status(), 200);
    await page.getByLabel("选择 ZIP", { exact: true }).setInputFiles({ name: "ci-chart.zip", mimeType: "application/zip", buffer: zip });
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
}
let deadline;
try {
  if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await Promise.race([acceptance(), new Promise((_, reject) => {
    deadline = setTimeout(() => reject(new Error("ACCEPTANCE_OVERALL_TIMEOUT")), 240000);
  })]);
  const result = { status: "passed", steps, elapsedMs: Date.now() - startedAt, browser: "chromium", syntheticAccounts: true };
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
