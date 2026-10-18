// Remote Linux only. Production business content is never mutated by this check.
import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const env = process.env;
const origin = 'https://adxc.saop.cc';
const output = env.PRODUCTION_EVIDENCE_DIR;
const modulePath = env.ACCEPTANCE_PLAYWRIGHT_PATH;
assert.equal(process.platform, 'linux', 'REMOTE_LINUX_REQUIRED');
assert.ok(output && isAbsolute(output), 'ABSOLUTE_EVIDENCE_DIR_REQUIRED');
assert.ok(modulePath && isAbsolute(modulePath), 'ABSOLUTE_PLAYWRIGHT_MODULE_REQUIRED');
const proxy = env.https_proxy || env.HTTPS_PROXY;
assert.ok(proxy, 'CONFIGURED_PROXY_REQUIRED');
// A new private directory prevents overwriting another run or following output symlinks.
await mkdir(output, { mode: 0o700 });
const steps = [], pageErrors = [], blockedWrites = [];
const staticCache = new Map();
let staticBytes = 0, cacheHits = 0, routeFailures = 0, targetPath = null;
let phase = 'setup', browser, page;
let authenticated = 'not-configured';
const started = Date.now();
const statePath = env.PRODUCTION_STORAGE_STATE;
const bridgeUrl = env.PRODUCTION_AUTH_BRIDGE;
const hasAuth = Boolean(statePath || bridgeUrl);
let bridgeKey, sessionRevoked = false;
const role = env.PRODUCTION_AUTH_ROLE || 'admin';
let storageState;
const secrets = [];
async function step(name, fn) {
  phase = name;
  await fn();
  steps.push(name);
  console.log(`PRODUCTION_SMOKE_OK ${name}`);
}
// No token, page text, response body, trace or raw error string is written to results.
async function result(status) {
  await writeFile(join(output, 'result.json'), JSON.stringify({
    status, origin, browser: 'chromium', headless: true,
    startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started,
    toolBaseTree: env.PRODUCTION_TOOL_BASE_TREE || null,
    smokeSha256: env.PRODUCTION_SMOKE_SHA256 || null,
    authenticated, role: hasAuth ? role : null, authTransport: bridgeUrl ? 'ssh-readonly-bridge-to-public-production' : statePath ? 'explicit-state' : null,
    productionRevision: env.PRODUCTION_EXPECT_REVISION || null, sessionRevoked, steps,
    failedStage: status === 'failed' ? phase : null, failedPath: status === 'failed' ? targetPath : null,
    staticCacheHits: cacheHits, routeFailures,
    pageErrors: pageErrors.length, blockedBusinessWrites: blockedWrites.length,
    businessWrites: false,
  }, null, 2) + '\n', { mode: 0o600 });
}
try {
  assert.ok(!(statePath && bridgeUrl), 'ONE_AUTH_TRANSPORT_REQUIRED');
  if (bridgeUrl) {
    const at = new URL(bridgeUrl);
    assert.ok(at.protocol === 'http:' && at.hostname === '127.0.0.1' && at.port && at.pathname === '/' && !at.search && !at.username && !at.password, 'LOOPBACK_BRIDGE_REQUIRED');
    const keyFile = await lstat(env.PRODUCTION_BRIDGE_KEY_FILE);
    assert.ok(keyFile.isFile() && keyFile.uid === process.getuid() && (keyFile.mode & 0o077) === 0, 'PRIVATE_BRIDGE_KEY_REQUIRED');
    bridgeKey = (await readFile(env.PRODUCTION_BRIDGE_KEY_FILE, 'utf8')).trim();
    assert.match(bridgeKey, /^[a-f0-9]{64}$/); secrets.push(bridgeKey);
    authenticated = 'pending';
  }
  if (statePath) {
    assert.ok(isAbsolute(statePath), 'ABSOLUTE_STATE_PATH_REQUIRED');
    assert.ok(['admin', 'user'].includes(role), 'INVALID_AUTH_ROLE');
    const file = await lstat(statePath);
    assert.ok(file.isFile() && file.uid === process.getuid() && (file.mode & 0o077) === 0, 'PRIVATE_OWNED_STATE_REQUIRED');
    const supplied = JSON.parse(await readFile(statePath, 'utf8'));
    // Only the explicitly supplied ADXC session is used; no Chrome profile is read.
    const cookies = supplied.cookies.filter(c => /^(?:__Secure-)?adxc\.session_token$/.test(c.name) && ['adxc.saop.cc', '.adxc.saop.cc'].includes(c.domain));
    assert.equal(cookies.length, 1, 'ADXC_SESSION_REQUIRED');
    assert.ok(cookies[0].secure && cookies[0].httpOnly, 'SECURE_SESSION_REQUIRED');
    assert.ok(cookies[0].expires === -1 || cookies[0].expires > Date.now() / 1000, 'SESSION_EXPIRED');
    secrets.push(cookies[0].value);
    storageState = { cookies, origins: [] };
    authenticated = 'pending';
  }
  const { chromium } = await import(pathToFileURL(modulePath).href);
  browser = await chromium.launch({ headless: true, proxy: { server: proxy, bypass: '127.0.0.1,localhost' } });
  async function context(state, viaBridge = false) {
    const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', ...(state ? { storageState: state } : {}) });
    ctx.setDefaultTimeout(15000); ctx.setDefaultNavigationTimeout(25000);
    await ctx.route('**/*', async route => {
      try {
        const r = route.request(), url = new URL(r.url());
        if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
        if (url.origin !== origin || url.pathname.startsWith('/_s/') || url.pathname.startsWith('/cdn-cgi/')) return route.abort('blockedbyclient');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) {
          blockedWrites.push(r.method()); return route.abort('blockedbyclient');
        }
        const fetchOptions = { maxRedirects: 0, timeout: 30000 };
        if (viaBridge) {
          const headers = { ...r.headers(), authorization: `Bearer ${bridgeKey}` };
          delete headers.cookie;
          Object.assign(fetchOptions, { url: bridgeUrl + url.pathname + url.search, headers });
        }
        // Routing disables Chromium's HTTP cache. Reuse only immutable public
        // hashed build assets within this single run; never cache HTML/API data.
        if (r.method() === 'GET' && /^\/assets\/[^/]+-[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(url.pathname)) {
          const cacheKey = url.href;
          if (staticCache.has(cacheKey)) { cacheHits++; return route.fulfill(await staticCache.get(cacheKey)); }
          const pending = (async () => {
            const response = await route.fetch(fetchOptions);
            const headers = response.headers(), body = await response.body();
            assert.equal(headers['set-cookie'], undefined, 'STATIC_ASSET_SET_COOKIE');
            delete headers['content-encoding']; delete headers['content-length'];
            const content = { status: response.status(), headers, body };
            staticBytes += body.length;
            if (content.status !== 200 || staticBytes > 64 * 1024 * 1024) staticCache.delete(cacheKey);
            return content;
          })();
          staticCache.set(cacheKey, pending);
          try { return await route.fulfill(await pending); }
          catch { staticCache.delete(cacheKey); throw new Error('STATIC_ASSET_FETCH_FAILED'); }
        }
        if (viaBridge) {
          const response = await route.fetch(fetchOptions);
          assert.equal(response.headers()['set-cookie'], undefined, 'SESSION_COOKIE_MUST_STAY_ON_PRODUCTION');
          return route.fulfill({ response });
        }
        return route.continue();
      } catch {
        routeFailures++;
        return route.abort('failed').catch(() => {});
      }
    });
    // No server connection is opened for WebSockets.
    await ctx.routeWebSocket('**/*', socket => socket.close());
    ctx.on('page', p => p.on('pageerror', () => pageErrors.push(true)));
    return ctx;
  }
  // Validate an explicitly supplied session first: invalid credentials fail fast,
  // instead of spending a minute on unrelated anonymous routes before failing.
  let signedIn;
  if (hasAuth) {
    signedIn = await context(storageState, Boolean(bridgeUrl));
    page = await signedIn.newPage();
    await step('explicit_session_and_role', async () => {
      const response = await page.goto(origin + '/api/v1/me', { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200, 'SESSION_NOT_AUTHENTICATED');
      const me = await response.json();
      assert.equal(me.isAdmin, role === 'admin', 'SESSION_ROLE_MISMATCH');
      if (env.PRODUCTION_EXPECT_USER_ID) assert.equal(me.publicId, env.PRODUCTION_EXPECT_USER_ID);
      authenticated = 'passed';
    });
    await page.close();
  }
  const anonymous = await context();
  page = await anonymous.newPage();
  async function visit(path) {
    targetPath = path;
    const r = await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
    await page.locator('main').waitFor();
    assert.equal(r.status(), 200, 'PAGE_HTTP_STATUS');
    assert.equal(new URL(page.url()).pathname, new URL(path, origin).pathname, 'UNEXPECTED_PAGE_REDIRECT');
    assert.ok((await page.locator('main').innerText()).trim().length > 0, 'EMPTY_PAGE');
  }
  // Browser fetch passes through the same read-only interception as the page.
  async function json(path, status = 200) {
    const r = await page.evaluate(async path => {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
      return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
    }, path);
    assert.equal(r.status, status, 'API_HTTP_STATUS');
    if (status === 401 || status === 403 || path.startsWith('/api/v1/dash/')) assert.match(r.cache, /private.*no-store/);
    return r.body;
  }
  await step('catalog_chart_comments_and_download_link', async () => {
    await visit('/charts');
    const chart = await json('/api/v1/charts/1');
    assert.equal(chart.publicId, '1');
    await visit('/charts/1');
    await page.getByRole('heading', { level: 1, name: chart.title, exact: true }).waitFor();
    await page.getByRole('heading', { name: /^谱面评论(?:\s*·\s*\d+)?$/ }).waitFor();
    const download = page.getByRole('link', { name: '下载原始 ZIP', exact: true });
    assert.equal(new URL(await download.getAttribute('href'), origin).origin, origin);
    await download.waitFor();
  });
  await step('legacy_chart_and_user_redirects', async () => {
    for (const [legacy, canonical] of [['/charts/01a14290-a0ba-7ba8-90fd-e167e04eb88e', '/charts/1'], ['/u/ted4rhkpt8', '/u/1']]) {
      await page.goto(origin + legacy); assert.equal(new URL(page.url()).pathname, canonical);
    }
  });
  await step('three_language_forum_notices_help', async () => {
    for (const prefix of ['', '/en', '/ja']) for (const path of ['/forum', '/notices', '/help']) await visit(prefix + path);
  });
  await step('anonymous_private_routes_denied', async () => {
    for (const path of ['/api/v1/discussions/notifications', '/api/v1/dash/access']) await json(path, 401);
    for (const path of ['/me/notifications', '/dash']) {
      await page.goto(origin + path); const at = new URL(page.url());
      assert.equal(at.pathname, '/login'); assert.equal(at.searchParams.get('next'), path);
    }
  });
  await step('mobile_catalog_and_forum_320_390', async () => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const path of ['/charts', '/forum']) {
        await visit(path); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    }
  });
  if (hasAuth) {
    page = await signedIn.newPage();
    await step('signed_in_notifications_forum_and_comment_composers', async () => {
      await visit('/me/notifications');
      await page.getByRole('heading', { level: 1, name: /^站内通知\s*·\s*\d+$/ }).waitFor();
      await page.getByRole('button', { name: '本页未读标为已读', exact: true }).waitFor();
      await json('/api/v1/discussions/notifications');
      await visit('/forum');
      await page.getByRole('heading', { level: 1, name: '论坛', exact: true }).waitFor();
      for (const board of ['综合交流', '谱面创作', '问题反馈']) await page.getByRole('link', { name: new RegExp('^' + board) }).waitFor();
      await visit('/forum/new'); await page.getByRole('textbox', { name: '标题', exact: true }).waitFor();
      await page.getByRole('textbox', { name: '正文', exact: true }).waitFor();
      await visit('/charts/1'); await page.locator('#chart-discussion-composer form').waitFor();
    });
    await step('production_dashboard_permissions_and_pages', async () => {
      if (role === 'user') { await json('/api/v1/dash/access', 403); return; }
      await json('/api/v1/dash/access');
      for (const path of ['/dash', '/dash/users', '/dash/charts', '/dash/discussions', '/dash/discussions?view=boards', '/dash/discussions?view=reports', '/dash/featured', '/dash/notices', '/dash/reports', '/dash/status']) {
        await visit(path);
        const childHeading = path.startsWith('/dash/discussions') ? '讨论管理' : ({ '/dash': '概览', '/dash/users': '用户列表', '/dash/charts': '公开谱面管理', '/dash/featured': '精选谱面', '/dash/notices': '站点公告', '/dash/reports': '举报处理', '/dash/status': '备份记录' })[path];
        await page.getByRole('heading', { level: 2, name: childHeading, exact: true }).waitFor();
        await page.getByText(`管理员 #${env.PRODUCTION_EXPECT_USER_ID || (await json('/api/v1/dash/access')).publicId}`, { exact: true }).waitFor();
      }
      const status = await json('/api/v1/dash/status');
      assert.ok(status.checks.length >= 6 && status.checks.every(c => c.status === 'ok'));
      assert.equal(status.roles.length, 3); assert.ok(status.roles.every(r => r.ready));
      assert.ok(status.backup.lastSuccessAt, 'NO_SUCCESSFUL_BACKUP_RECORDED');
      assert.notEqual(status.backup.status, 'failed');
    });
  }
  if (bridgeUrl) {
    await step('production_bridge_write_denial_and_session_revocation', async () => {
      const headers = { authorization: `Bearer ${bridgeKey}` };
      assert.equal((await fetch(bridgeUrl + '/api/v1/me')).status, 401);
      assert.equal((await fetch(bridgeUrl + '/api/auth/get-session', { headers })).status, 403);
      assert.equal((await fetch(bridgeUrl + '/api/v1/discussions/topics', { method: 'POST', headers, body: '{}' })).status, 405);
      assert.equal((await fetch(bridgeUrl + '/_smoke/revoke', { method: 'POST', headers })).status, 200);
      const response = await page.goto(origin + '/api/v1/me', { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 401, 'REVOKED_SESSION_REMAINED_USABLE');
      assert.deepEqual(await signedIn.cookies(), [], 'PRODUCTION_SESSION_EXPORTED_TO_BROWSER');
      sessionRevoked = true;
    });
  }
  assert.equal(routeFailures, 0, 'BROWSER_REQUEST_FAILURES');
  assert.equal(pageErrors.length, 0, 'BROWSER_PAGE_ERRORS');
  assert.equal(blockedWrites.length, 0, 'UNEXPECTED_BUSINESS_WRITE_ATTEMPT');
  await result('passed'); console.log(`PRODUCTION_SMOKE_PASSED authenticated=${authenticated}`);
} catch (error) {
  let detail = String(error.stack || error.name);
  for (const secret of secrets) detail = detail.replaceAll(secret, '[redacted]');
  detail = detail.replace(/(session_token|authorization|client_secret|access_token)([=:]\s*)[^\s,;"']+/gi, '$1$2[redacted]');
  await writeFile(join(output, 'failure-detail.txt'), detail.slice(0, 6000) + '\n', { mode: 0o600 });
  await writeFile(join(output, 'failure-code.txt'), `${error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.name}\n`, { mode: 0o600 });
  await result('failed');
  if (page && !page.isClosed()) {
    const file = join(output, 'failure.png');
    await page.screenshot({ path: file, fullPage: true, timeout: 5000 }).then(() => chmod(file, 0o600)).catch(() => {});
  }
  console.error(`PRODUCTION_SMOKE_FAILED stage=${phase}; inspect private result.json`);
  process.exitCode = 1;
} finally { await browser?.close(); }
