// Remote Linux only. Production business content is never mutated by this check.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const authorCoverage={workbench:false,imports:false,review:"not-run",compare:"not-run"};
let previewCoverage = null;
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
    authorCoverage, previewCoverage, authenticated, role: hasAuth ? role : null, authTransport: bridgeUrl ? 'ssh-readonly-bridge-to-public-production' : statePath ? 'explicit-state' : null,
    productionRevision: env.PRODUCTION_EXPECT_REVISION || null, sessionRevoked, steps,
    failedStage: status === 'failed' ? phase : null, failedPath: status === 'failed' ? targetPath : null,
    staticCacheHits: cacheHits, routeFailures,
    pageErrors: pageErrors.length, blockedBusinessWrites: blockedWrites.length,
    businessWrites: false,
  }, null, 2) + '\n', { mode: 0o600 });
}
try {
  const previewChart = env.PRODUCTION_PREVIEW_CHART || '';
  const previewDifficulty = env.PRODUCTION_PREVIEW_DIFFICULTY || '';
  const previewRequired = Boolean(previewChart || previewDifficulty);
  if (previewRequired) {
    assert.match(previewChart, /^[1-9]\d{0,19}$/, 'VALID_PREVIEW_TARGET_REQUIRED');
    assert.match(previewDifficulty, /^[1-7]$/, 'VALID_PREVIEW_TARGET_REQUIRED');
    previewCoverage = { chart: previewChart, difficulty: Number(previewDifficulty) };
  }
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
        // Published preview media follows the real browser's public HTTPS path.
        // Relaying large audio through production -> Mac -> builder adds a second
        // download and can exhaust the bridge's upstream timeout. Keep private
        // pages/APIs on the authenticated bridge and reauthorize every media read.
        if (viaBridge && /^\/api\/v1\/charts\/[1-9]\d*\/versions\/[a-f0-9-]{36}\/assets\/(?:maidata|audio|cover)$/.test(url.pathname)) {
          const headers = { ...r.headers() };
          delete headers.cookie; delete headers.authorization;
          return route.continue({ headers });
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
  await step('production_public_discovery_search',async()=>{
    const result=await json('/api/v1/search?type=charts&q=1');assert.equal(result.groups.charts.status,'ready');assert.ok(result.groups.charts.items.some(h=>h.publicId==='1'));
    const suggestions=await json('/api/v1/search/suggestions?q=1');assert.ok(suggestions.some(h=>h.publicId==='1'));
    const mismatch=await json('/api/v1/search?type=charts&q=1&designer=adxc-no-such-designer');assert.equal(mismatch.groups.charts.total,0);
    for(const path of ['/discover','/search?type=charts&q=1','/authors','/tags','/en/search?q=1','/ja/search?q=1'])await visit(path);
    for(const width of [320,390]){await page.setViewportSize({width,height:844});await visit('/search?type=charts&q=1');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    await page.setViewportSize({width:1280,height:900});
    const checks=await page.evaluate(async()=>{
      const parser=new DOMParser(),docs={};
      for(const path of ['/sitemap.xml','/sitemaps/charts-0.xml','/feed.xml']){const r=await fetch(path,{cache:'no-store'}),text=await r.text(),doc=parser.parseFromString(text,'application/xml');docs[path]={status:r.status,cache:r.headers.get('cache-control'),valid:!doc.querySelector('parsererror'),links:[...doc.querySelectorAll(path==='/feed.xml'?'item > link':'loc')].map(n=>n.textContent),guids:[...doc.querySelectorAll('item > guid')].map(n=>n.textContent)};}
      let next='/api/v1/charts?sort=collected',latest=[];while(next&&latest.length<30){const r=await fetch(next,{cache:'no-store'});if(!r.ok)throw Error('FEED_REFERENCE_QUERY_FAILED');const p=await r.json();latest.push(...p.items.map(c=>location.origin+'/charts/'+c.publicId));next=p.nextCursor?'/api/v1/charts?sort=collected&cursor='+encodeURIComponent(p.nextCursor):null;}
      return {docs,latest:latest.slice(0,30)};
    });
    assert.ok(Object.values(checks.docs).every(c=>c.status===200&&c.valid&&/no-store/.test(c.cache)));
    assert.ok(checks.docs['/sitemaps/charts-0.xml'].links.includes(origin+'/charts/1'));
    assert.deepEqual(checks.docs['/feed.xml'].links,checks.latest);assert.deepEqual(checks.docs['/feed.xml'].guids,checks.latest);
  });
  if (previewRequired) await step('production_required_chart_preview', async () => {
    const difficulty = Number(previewDifficulty);
    await visit(`/charts/${previewChart}`);
    const chart = await json(`/api/v1/charts/${previewChart}`);
    assert.equal(chart.publicId, previewChart, 'PREVIEW_CHART_ID_MISMATCH');
    const slot = chart.summary.difficulties.find(row => row.difficulty === difficulty);
    assert.equal(slot?.previewSupported, true, 'REQUIRED_SLOT_PREVIEW_UNSUPPORTED');
    assert.ok(Number.isFinite(slot.durationMs) && slot.durationMs > 3000, 'PREVIEW_DURATION_REQUIRED');
    previewCoverage.apiSupported = true;
    // Global parse failures also invalidate this slot; warnings for other slots do not.
    const warnings = chart.summary.warnings.filter(warning => warning.difficulty === difficulty || warning.difficulty === undefined);
    assert.equal(warnings.length, 0, 'REQUIRED_SLOT_HAS_PARSE_WARNINGS');
    previewCoverage.slotWarnings = warnings.length;
    const preview = page.getByRole('region', { name: '公开谱面预览', exact: true });
    await preview.getByRole('combobox', { name: '难度', exact: true }).selectOption(previewDifficulty);
    const maidataPath = `/api/v1/charts/${previewChart}/versions/${chart.versionId}/assets/maidata`;
    const maidataResponse = page.waitForResponse(response => new URL(response.url()).pathname === maidataPath, { timeout: 60000 });
    const [maidata] = await Promise.all([maidataResponse, preview.getByRole('button', { name: '加载预览', exact: true }).click()]);
    assert.equal(maidata.status(), 200, 'PREVIEW_MAIDATA_LOAD_FAILED');
    // Chromium's inspector text-body transport can remove a UTF-8 BOM.
    // Hash the bytes fetch exposes to the application, not re-encoded inspector text.
    const rawSource = await page.evaluate(async path => {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 1048576) throw new Error('PREVIEW_SOURCE_LIMIT');
      return { status: response.status, bytes: Array.from(bytes) };
    }, maidataPath);
    assert.equal(rawSource.status, 200, 'PREVIEW_MAIDATA_RAW_LOAD_FAILED');
    const source = Buffer.from(rawSource.bytes);
    assert.ok(source.length > 0, 'PREVIEW_MAIDATA_EMPTY');
    previewCoverage.maidataLoaded = true;
    assert.equal(createHash('md5').update(source).digest('base64'), chart.summary.maidataMd5Base64, 'PREVIEW_MAIDATA_SUMMARY_MISMATCH');
    previewCoverage.maidataMatchesSummary = true;
    const controls = preview.getByRole('group', { name: '预览播放控制', exact: true });
    const play = controls.getByRole('button', { name: '播放', exact: true });
    await play.click({ trial: true, timeout: 60000 });
    const seek = preview.getByRole('slider', { name: '拖动预览时间轴', exact: true });
    assert.equal(await seek.isEnabled(), true, 'PREVIEW_SEEK_NOT_READY');
    assert.equal(await preview.getByRole('alert').count(), 0, 'PREVIEW_RENDER_ERROR');
    previewCoverage.ready = true;
    const position = async () => Number(await seek.inputValue());
    const beforePlay = await position();
    // A real scoped Play click supplies the audio user activation in headless Chromium.
    await play.click();
    await controls.getByRole('button', { name: '暂停', exact: true }).waitFor();
    await page.waitForFunction(start => {
      const slider = document.querySelector('#chart-preview input[aria-label="拖动预览时间轴"]');
      return slider && Number(slider.value) > start + 0.25;
    }, beforePlay, { timeout: 15000 });
    const advanced = await position();
    assert.ok(advanced > beforePlay + 0.25, 'PREVIEW_CLOCK_DID_NOT_ADVANCE');
    previewCoverage.clockAdvanced = true;
    await exerciseMotionPlayer({page,preview,playing:true});
    await controls.getByRole('button', { name: '暂停', exact: true }).click();
    await play.waitFor();
    const paused = await position();
    await page.waitForTimeout(500);
    const afterPause = await position();
    assert.ok(Math.abs(afterPause - paused) <= 0.03, 'PREVIEW_PAUSED_CLOCK_ADVANCED');
    previewCoverage.pauseStable = true;
    // Exercise the actual accessible range control with pointer input.
    const bounds = await seek.boundingBox();
    assert.ok(bounds && bounds.width > 0, 'PREVIEW_SEEK_CONTROL_MISSING');
    await seek.click({ position: { x: bounds.width * 0.45, y: bounds.height / 2 } });
    const afterSeek = await position(), duration = slot.durationMs / 1000;
    assert.ok(afterSeek > duration * 0.35 && afterSeek < duration * 0.55 && Math.abs(afterSeek - afterPause) > 0.1, 'PREVIEW_SEEK_FAILED');
    assert.equal(await controls.getByRole('button', { name: '播放', exact: true }).isEnabled(), true);
    assert.equal(await preview.getByRole('alert').count(), 0, 'PREVIEW_RENDER_ERROR');
    previewCoverage.seekSucceeded = true;
    previewCoverage.clockSeconds = { beforePlay, advanced, paused, afterPause, afterSeek };
    await controls.getByRole('button', { name: '关闭预览', exact: true }).click();
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
    for (const path of ['/api/v1/discussions/notifications', '/api/v1/dash/access','/api/v1/me/lists','/api/v1/me/charts/workbench']) await json(path, 401);
    for (const path of ['/me/notifications', '/dash','/me/workbench','/me/imports']) {
      await page.goto(origin + path); const at = new URL(page.url());
      assert.equal(at.pathname, '/login'); assert.equal(at.searchParams.get('next'), path);
    }
  });
  await step('mobile_catalog_and_forum_320_390', async () => {
    await visit('/login?reauth=1&next=%2Fcharts%2F1');await page.getByRole('navigation',{name:'登录方式导航',exact:true}).waitFor();for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'LOGIN_UI_HORIZONTAL_OVERFLOW');}
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
      await page.getByRole('heading', { level: 1, name: "站内通知", exact: true }).waitFor();
      await page.getByRole('button', { name: '本页未读标为已读', exact: true }).waitFor();
      const noticeSummary=await json('/api/v1/discussions/notifications');await page.getByText(`全部未读 ${noticeSummary.unreadCount} 条`,{exact:true}).waitFor();
      await visit('/forum');
      await page.getByRole('heading', { level: 1, name: '论坛', exact: true }).waitFor();
      for (const board of ['综合交流', '谱面创作', '问题反馈']) await page.getByRole('link', { name: new RegExp('^' + board) }).waitFor();
      await visit('/forum/new'); await page.getByRole('textbox', { name: '标题', exact: true }).waitFor();
      await page.getByRole('textbox', { name: '正文', exact: true }).waitFor();
      await visit('/charts/1'); await page.locator('#chart-discussion-composer form').waitFor();
    });
    await step('production_following_feed_and_alert_settings', async () => {
      await visit('/me/following');
      await page.getByRole('heading', {level:1,name:'我的关注',exact:true}).waitFor();
      await page.getByRole('link', {name:'关注动态',exact:true}).first().waitFor();
      const follows=await json('/api/v1/me/following');assert.ok(Array.isArray(follows.items));
      await visit('/me/feed');await page.getByRole('heading', {level:1,name:'关注动态',exact:true}).waitFor();
      const feed=await json('/api/v1/me/following/feed');assert.ok(Array.isArray(feed.items));
      await visit('/me/notifications?kind=author_update');await page.getByRole('link',{name:'管理关注与提醒',exact:true}).first().waitFor();
      const notifications=await json('/api/v1/discussions/notifications?kind=author_update');assert.equal(notifications.followingUnavailable,false);
      assert.ok(notifications.items.every(n=>n.kind==='author_update'));
      if(role==='admin') {
        const users=await json('/api/v1/dash/users');const target=users.items.find(u=>u.status==='active'&&u.publicId!==env.PRODUCTION_EXPECT_USER_ID);
        assert.ok(target,'EXISTING_OTHER_USER_REQUIRED_FOR_FOLLOW_CONTROL');
        const state=await json(`/api/v1/me/following/authors/${target.publicId}`);assert.equal(typeof state.following,'boolean');assert.equal(typeof state.notify,'boolean');
        await visit(`/u/${target.publicId}`);await page.getByRole('button',{name:state.following?'取消关注':'关注作者',exact:true}).waitFor();
        if(state.following)await page.getByRole('checkbox',{name:'接收站内更新提醒',exact:true}).waitFor();
      }
      for(const width of [320,390]){await page.setViewportSize({width,height:844});await visit('/me/following');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);}
      await page.setViewportSize({width:1280,height:900});
    });
    await step('production_library_and_public_lists', async () => {
      await visit('/me/library');await page.getByRole('heading',{level:1,name:'我的谱库',exact:true}).waitFor();
      const mine=await json('/api/v1/me/lists');assert.ok(Array.isArray(mine.items));
      await visit('/me/library?view=reports');await json('/api/v1/me/lists/reports');
      await visit('/lists');await page.getByRole('heading',{level:1,name:'公开谱单',exact:true}).waitFor();
      const lists=await json('/api/v1/lists');assert.ok(Array.isArray(lists.items));
      if(lists.items.length){await visit('/lists/'+lists.items[0].publicId);await page.getByRole('heading',{level:1,name:lists.items[0].name,exact:true}).waitFor();}
      else await json('/api/v1/lists/9223372036854775807',404);
      for(const width of [320,390]){await page.setViewportSize({width,height:844});await visit('/lists');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
      await page.setViewportSize({width:1280,height:900});
    });
    await step('production_download_center_and_list_admin', async () => {
      await visit('/downloads');await page.getByRole('heading',{level:1,name:'下载中心',exact:true}).waitFor();
      await page.getByText('还没有下载任务。',{exact:true}).waitFor();
      if(role==='admin'){await visit('/dash/lists');await page.getByRole('heading',{level:2,name:'公开谱单管理',exact:true}).waitFor();const status=await json('/api/v1/dash/lists/status');assert.equal(status.ready,true);assert.equal(status.pendingControls,0);await json('/api/v1/dash/lists');}
      else await json('/api/v1/dash/lists',403);
    });
    await step('production_author_workbench_and_imports', async () => {
      await visit('/me/workbench');await page.getByRole('heading',{level:1,name:'创作者工作台',exact:true}).waitFor();
      const mine=await json('/api/v1/me/charts/workbench');assert.ok(Array.isArray(mine.items)&&mine.items.length<=20);assert.ok(mine.counts.total<=50);authorCoverage.workbench=true;
      await visit('/me/imports');await page.getByRole('heading',{level:1,name:'批量导入',exact:true}).waitFor();await page.getByLabel('添加 ADX / ZIP（可多选）',{exact:true}).waitFor();authorCoverage.imports=true;
      for(const prefix of ['/en','/ja'])for(const path of ['/me/workbench','/me/imports'])await visit(prefix+path);
      for(const width of [320,390]){await page.setViewportSize({width,height:844});for(const path of ['/me/workbench','/me/imports']){await visit(path);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}}
      await page.setViewportSize({width:1280,height:900});
    });
    await step('production_author_review_compare_and_denials', async () => {
      const mine=await json('/api/v1/me/charts/workbench'),missing='ffffffff-ffff-4fff-afff-ffffffffffff';
      await json(`/api/v1/me/charts/${missing}`,404);
      if(mine.items.length){
        const chart=await json(`/api/v1/me/charts/${mine.items[0].id}`),version=chart.versions.find(v=>v.id===chart.currentVersionId);assert.ok(version);
        const fingerprint=await json(`/api/v1/me/charts/${chart.id}/versions/${version.id}/fingerprint`);assert.match(fingerprint.source.sha256,/^[a-f0-9]{64}$/);assert.equal(Object.hasOwn(fingerprint.source,'key'),false);
        await visit(`/me/charts/${chart.id}/review?version=${version.id}`);await page.getByRole('heading',{level:2,name:'只读 Simai 源码',exact:true}).waitFor({timeout:30000});authorCoverage.review='existing-owned-version';
        await json(`/api/v1/me/charts/${chart.id}/versions/${missing}/fingerprint`,404);
        if(chart.versions.length>=2){await visit(`/me/charts/${chart.id}/compare?left=${chart.versions[1].id}&right=${version.id}`);await page.getByRole('heading',{level:2,name:'只读 Simai 源码',exact:true}).first().waitFor({timeout:30000});authorCoverage.compare='existing-owned-pair';}
        else{const denied=await page.goto(origin+`/me/charts/${chart.id}/compare?left=${missing}&right=${version.id}`,{waitUntil:'domcontentloaded'});assert.equal(denied.status(),404);authorCoverage.compare='no-second-version-valid-missing-id-denied';}
      }else{for(const suffix of ['review','compare']){const denied=await page.goto(origin+`/me/charts/${missing}/${suffix}`,{waitUntil:'domcontentloaded'});assert.equal(denied.status(),404);}authorCoverage.review='no-owned-version-missing-id-denied';authorCoverage.compare='no-owned-pair-missing-id-denied';}
    });
    await step('production_dashboard_permissions_and_pages', async () => {
      if (role === 'user') { await json('/api/v1/dash/access', 403); return; }
      await json('/api/v1/dash/access');
      for (const path of ['/dash', '/dash/users', '/dash/charts', '/dash/discussions', '/dash/discussions?view=boards', '/dash/discussions?view=reports', '/dash/featured', '/dash/notices', '/dash/reports', '/dash/status']) {
        await visit(path);
        const childHeading = path.startsWith('/dash/discussions') ? '讨论管理' : ({ '/dash': '概览', '/dash/users': '用户列表', '/dash/charts': '公开谱面管理', '/dash/featured': '精选谱面', '/dash/notices': '站点公告', '/dash/reports': '举报处理', '/dash/status': '运行与备份状态' })[path];
        await page.getByRole('heading', { level: 2, name: childHeading, exact: true }).waitFor();
        await page.getByText(`管理员 #${env.PRODUCTION_EXPECT_USER_ID || (await json('/api/v1/dash/access')).publicId}`, { exact: true }).waitFor();
      }
      await page.getByRole('heading', { level: 3, name: '备份记录', exact: true }).waitFor();
      const status = await json('/api/v1/dash/status');
      assert.ok(status.checks.length >= 6 && status.checks.every(c => c.status === 'ok'));
      assert.equal(status.roles.length, 3); assert.ok(status.roles.every(r => r.ready));
      assert.ok(status.backup.lastSuccessAt, 'NO_SUCCESSFUL_BACKUP_RECORDED');
      assert.notEqual(status.backup.status, 'failed');
      assert.equal(status.library?.ready,true);assert.equal(status.library?.pendingControls,0);
      assert.equal(status.following?.ready,true);assert.equal(status.following.pendingControls,0);
      await page.getByRole('heading',{name:'作者更新与私有控制',exact:true}).waitFor();
    });
  }
  if (bridgeUrl) {
    await step('production_authenticated_discovery_library',async()=>{
      await visit('/search?type=charts&q=1');
      await page.getByRole('checkbox',{name:'选择谱面 #1',exact:true}).check();
      const bar=page.locator('aside').filter({has:page.getByRole('button',{name:'加入谱单',exact:true})});
      await bar.getByRole('button',{name:'加入谱单',exact:true}).click();await bar.getByLabel('谱单名称',{exact:true}).waitFor();await bar.getByRole('button',{name:'加入下载队列',exact:true}).waitFor();
      await bar.getByRole('button',{name:'清空选择',exact:true}).click();
      await visit('/me/library');await json('/api/v1/me/lists');await visit('/downloads');
      if(role==='admin'){const status=await json('/api/v1/dash/status');assert.equal(status.discovery.ready,true);assert.deepEqual(status.discovery.permissionVersions,[1,2]);}
    });
    await step('production_governance_ops',async()=>{
      await visit('/me/governance');await page.getByRole('heading',{name:'我的处理中心',exact:true}).waitFor();
      await json('/api/v1/governance/me/decisions');await json('/api/v1/governance/me/appeals');
      await visit('/me/governance?view=appeals');await page.getByRole('heading',{name:'我的处理中心',exact:true}).waitFor();
      if(role==='admin'){
        for(const [path,title] of [['/dash/governance','治理与站务'],['/dash/appeals','申诉复核'],['/dash/audit','管理操作记录']]){await visit(path);await page.getByRole('heading',{level:2,name:title,exact:true}).waitFor();}
        for(const path of ['overview','tickets','appeals','audit'])await json('/api/v1/governance/dash/'+path);
      }else{await json('/api/v1/governance/dash/overview',403);}
    });
    await step('production_ui_navigation_layout',async()=>{
      await exerciseMotion({page,origin,authenticated:true});
      await exerciseUxCompletion({page,origin,authenticated:true,onVisit:path=>{targetPath=path;}});
      for(const width of [320,390,768,1024,1280]){
        await page.setViewportSize({width,height:900});await visit('/');
        assert.equal(await page.getByRole('search').count(),1,'ONE_HOMEPAGE_SEARCH');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'UI_HORIZONTAL_OVERFLOW');
        const nav=page.locator('.community-bottom-nav');assert.equal(await nav.isVisible(),width<1024);
        if(width<1024)assert.equal(await nav.getByRole('link').count(),4);
      }
      await page.setViewportSize({width:390,height:900});await visit('/en/charts?sort=title');
      const more=page.getByRole('button',{name:'More navigation',exact:true});await more.click();
      const sheet=page.getByRole('dialog',{name:'AstroDX Community',exact:true});await sheet.waitFor();
      assert.equal(await sheet.getByRole('link',{name:'日本語',exact:true}).getAttribute('href'),'/ja/charts?sort=title');
      await sheet.getByRole('button',{name:'Open settings',exact:true}).click();
      const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.waitFor();await settings.getByRole('button',{name:'Close settings',exact:true}).click();await settings.waitFor({state:'hidden'});
      await page.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});assert.equal(await more.evaluate(e=>e===document.activeElement),true,'MORE_FOCUS_RESTORED');
      for(const path of ['/me/workbench','/me/library',...(role==='admin'?['/dash']:[])]){await visit(path);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'PRIVATE_UI_HORIZONTAL_OVERFLOW');}
      await page.setViewportSize({width:1280,height:900});await visit('/search?type=charts&q=1');await page.getByRole('checkbox',{name:'选择谱面 #1',exact:true}).check();
      const bar=page.locator('.community-selection-bar');await bar.waitFor();await page.evaluate(()=>scrollTo(0,400));
      const box=await bar.boundingBox(),header=await page.locator('.community-header').boundingBox();assert.ok(box.y>=header.y+header.height,'SELECTION_BAR_BELOW_HEADER');await bar.getByRole('button',{name:'加入下载队列',exact:true}).click({trial:true});await bar.getByRole('button',{name:'清空选择',exact:true}).click();
      // Read-only content UX acceptance stays inside the required UI group.
      await visit('/charts/1');
      assert.equal(await page.getByRole('navigation',{name:'本页导航',exact:true}).getByRole('link').count(),5);
      const summary=await json('/api/v1/charts/1'),slot=summary.summary.difficulties.find(d=>d.difficulty===6&&d.previewSupported);assert.ok(slot,'REQUIRED_DIFFICULTY_CARD');
      const card=page.locator('#chart-difficulties li').nth(summary.summary.difficulties.indexOf(slot));
      const preview=page.locator('#chart-preview');
      for(let cycle=0;cycle<2;cycle++){
        const audioPath=`/api/v1/charts/1/versions/${summary.versionId}/assets/audio`;
        const [audio]=await Promise.all([
          summary.summary.audio?page.waitForResponse(r=>new URL(r.url()).pathname===audioPath,{timeout:30000}):Promise.resolve(null),
          card.getByRole('button').click(),
        ]);
        if(audio){assert.equal(audio.status(),200,'REOPEN_AUDIO_HTTP_STATUS');assert.ok((await audio.body()).length>0,'REOPEN_AUDIO_BODY_REQUIRED');}
        await preview.locator('canvas').waitFor();assert.equal(await preview.getByRole('combobox',{name:'难度',exact:true}).inputValue(),'6');
        await preview.getByRole('button',{name:'播放',exact:true}).click({trial:true,timeout:30000});
        await preview.getByRole('button',{name:'关闭预览',exact:true}).click();await preview.locator('canvas').waitFor({state:'hidden'});
      }
      await page.setViewportSize({width:320,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'DETAIL_UI_HORIZONTAL_OVERFLOW');
      await visit('/forum?q=Browser&sort=published&unanswered=true&chart=1');const board=page.getByRole('navigation',{name:'浏览板块',exact:true}).getByRole('link').last(),href=new URL(await board.getAttribute('href'),origin);
      for(const [key,value] of [['q','Browser'],['sort','published'],['unanswered','true'],['chart','1']])assert.equal(href.searchParams.get(key),value);assert.equal(href.searchParams.has('cursor'),false);await board.click();await page.waitForURL(u=>u.searchParams.has('board'));
      await page.getByRole('link',{name:'清除筛选',exact:true}).first().click();await page.waitForURL(u=>u.pathname==='/forum'&&!u.search);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'FORUM_UI_HORIZONTAL_OVERFLOW');
      await visit('/forum/new');await page.locator('.community-topic-editor').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'EDITOR_UI_HORIZONTAL_OVERFLOW');
      await visit('/me/workbench');const workbench=await json('/api/v1/me/charts/workbench'),meter=page.getByRole('meter',{name:'存储用量',exact:true});await meter.waitFor();assert.equal(Number(await meter.getAttribute('max')),Math.max(1,workbench.usage.quotaBytes));assert.equal(await meter.evaluate(el=>el.max),Math.max(1,workbench.usage.quotaBytes));assert.equal(await page.getByRole('region',{name:'需要关注',exact:true}).getByRole('link').count(),3);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'WORKBENCH_UI_HORIZONTAL_OVERFLOW');
      // Library and downloads use the same mandatory, read-only UI gate.
      await visit('/me/library');assert.equal(await page.getByRole('navigation',{name:'谱库导航',exact:true}).locator('[aria-current="page"]').count(),1);
      await visit('/me/favorites');assert.equal(await page.getByRole('navigation',{name:'谱库导航',exact:true}).getByRole('link',{name:'我的收藏',exact:true}).getAttribute('aria-current'),'page');
      await visit('/lists?q=UI-no-match&author=1');assert.equal(await page.getByRole('searchbox',{name:'搜索谱单',exact:true}).inputValue(),'UI-no-match');assert.equal(await page.getByRole('textbox',{name:'作者编号',exact:true}).inputValue(),'1');
      await page.getByRole('link',{name:'清除筛选',exact:true}).first().click();await page.waitForURL(u=>u.pathname==='/lists'&&!u.search);
      await visit('/me/lists/new');await page.getByRole('region',{name:'基本信息',exact:true}).waitFor();await page.getByRole('complementary',{name:'保存与发布',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'保存私人草稿',exact:true}).isEnabled(),false);
      for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'LIBRARY_EDITOR_UI_HORIZONTAL_OVERFLOW');await visit('/downloads');await page.getByRole('region',{name:'当前队列',exact:true}).waitFor();await page.getByRole('region',{name:'最近下载',exact:true}).waitFor();assert.equal(await page.locator('.community-download-dock').count(),0);assert.equal(await page.locator('.community-selection-bar').count(),0,'DOWNLOAD_PAGE_NO_SELECTION_BAR');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'DOWNLOAD_UI_HORIZONTAL_OVERFLOW');await visit('/me/lists/new');}
      await visit('/downloads');await page.locator('#download-help > summary').click();await page.getByText('ZIP 集合包包含各首的原始 ZIP 和清单。请先解压外层，再逐个导入；它不是一份可直接导入的 ADX 谱包。',{exact:true}).waitFor();
      // Account/admin UI adds exact read-only routes; never authorize, unlink, revoke or delete production data.
      for(const path of ['/settings/profile','/settings/account']){await visit(path);const nav=page.getByRole('navigation',{name:'账号设置导航',exact:true});assert.equal(await nav.locator('[aria-current="page"]').count(),1);assert.equal(await nav.locator('[aria-current="page"]').getAttribute('href'),path);for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'SETTINGS_UI_HORIZONTAL_OVERFLOW');}}
      const accountLogins=await json('/api/v1/me/logins'),accountSessions=await json('/api/v1/me/sessions');assert.ok(Array.isArray(accountLogins.accounts)&&Array.isArray(accountLogins.passkeys)&&Array.isArray(accountSessions.sessions));
      assert.equal(await page.locator('#account-danger input[name="deleteContent"]').isChecked(),false);assert.equal(await page.locator('#account-danger button[type="submit"]').isEnabled(),false);
      for(const path of ['/dash','/dash/status','/dash/lists']){await visit(path);for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'ADMIN_UI_HORIZONTAL_OVERFLOW');}assert.equal(await page.locator('.community-dash-nav > div a[aria-current="page"]').getAttribute('href'),path);}
      // Profile, following and notification UX remains strictly read-only in production.
      await visit('/u/1');await page.getByRole('region',{name:'作者资料',exact:true}).waitFor();assert.equal(await page.locator('form[role="search"] [name="author"]').count(),0);assert.equal(await page.getByRole('button',{name:'分享主页',exact:true}).count(),1);
      for(const path of ['/me/feed','/me/following','/me/notifications']){await visit(path);const nav=page.getByRole('navigation',{name:'关注与通知导航',exact:true});assert.equal(await nav.locator('[aria-current="page"]').count(),1);assert.equal(await nav.locator('[aria-current="page"]').getAttribute('href'),path);}
      await visit('/me/notifications?kind=author_update&unread=true');const noticeFilters=page.getByRole('region',{name:'筛选通知',exact:true});assert.equal(await noticeFilters.getByRole('combobox',{name:'通知内容',exact:true}).inputValue(),'author_update');assert.equal(await noticeFilters.getByRole('link',{name:'全部',exact:true}).getAttribute('href'),'/me/notifications?kind=author_update');await noticeFilters.getByRole('combobox',{name:'通知内容',exact:true}).selectOption('');await noticeFilters.getByRole('button',{name:'应用',exact:true}).click();await page.waitForURL(u=>u.searchParams.get('unread')==='true'&&!u.searchParams.get('kind'));
      for(const path of ['/u/1','/me/feed','/me/following','/me/notifications?unread=true&kind=author_update']){await visit(path);for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'SOCIAL_UI_HORIZONTAL_OVERFLOW');}}

    });
    await step('production_bridge_write_denial_and_session_revocation', async () => {
      const headers = { authorization: `Bearer ${bridgeKey}` };
      assert.equal((await fetch(bridgeUrl + '/api/v1/me')).status, 401);
      assert.equal((await fetch(bridgeUrl + '/api/auth/get-session', { headers })).status, 403);
      assert.equal((await fetch(bridgeUrl + '/__manifest/blocked', { headers })).status, 403);
      for(const path of ['/privacy/blocked','/help/upload/blocked','/me/reports/blocked'])assert.equal((await fetch(bridgeUrl+path,{headers})).status,403);
      assert.equal((await fetch(bridgeUrl + '/__manifest', { method: 'POST', headers })).status, 405);
      assert.equal((await fetch(bridgeUrl + '/api/v1/me/sessions/blocked', {headers})).status,403);
      assert.equal((await fetch(bridgeUrl + '/api/v1/me/sessions/blocked', {method:'DELETE',headers})).status,405);
      assert.equal((await fetch(bridgeUrl + '/api/v1/me/profile', {method:'PATCH',headers,body:'{}'})).status,405);
      assert.equal((await fetch(bridgeUrl + '/api/v1/download-plans', { method: 'POST', headers, body: '{}' })).status, 405);
      assert.equal((await fetch(bridgeUrl + '/api/v1/me/favorites/1', {method:'PUT',headers,body:'{}'})).status,405);
      assert.equal((await fetch(bridgeUrl + '/api/v1/me/lists/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {method:'PUT',headers,body:'{}'})).status,405);
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

// 正式验收由 SSH 按摘要传送单文件，故此入口保留自包含断言，不引入相邻模块。
async function exerciseMotion({page,origin,authenticated=false}){
 const url=path=>new URL(path,origin).href;
 const visit=async path=>{const response=await page.goto(url(path));assert.equal(response.status(),200,path);await page.locator("main h1").first().waitFor();};
 await page.setViewportSize({width:1280,height:900});await visit("/en/charts");
 const stored=await page.evaluate(()=>localStorage.getItem("adx-reduce-motion"));
 const originalMode=stored==="on"?"on":stored==="off"||stored==="1"?"off":"system";
 const labels={on:/^Motion on/,off:/^Reduce motion/,system:/^Follow system/};
 async function observeEntry(){
  await page.evaluate(()=>{
   window.__motionObserver?.disconnect();window.__motionObserved=false;
   const root=document.querySelector('[data-community-motion="route"]');let frame;
   // 同时观察WAAPI与JS驱动的实际样式，不依赖style属性是否被逐帧改写。
   const sample=()=>{const style=getComputedStyle(root),matrix=new DOMMatrixReadOnly(style.transform);if(Number(style.opacity)<0.999||Math.abs(matrix.m42)>0.01)window.__motionObserved=true;else frame=requestAnimationFrame(sample);};
   window.__motionObserver={disconnect:()=>cancelAnimationFrame(frame)};frame=requestAnimationFrame(sample);
  });
 }
 async function assertSettled(label){
  await page.waitForFunction(()=>{const el=document.querySelector('[data-community-motion="route"]'),style=getComputedStyle(el);return Number(style.opacity)>0.999&&Math.abs(new DOMMatrixReadOnly(style.transform).m42)<0.01;});
  const frames=await page.locator('[data-community-motion="route"]').evaluate(async el=>{const values=[];for(let i=0;i<4;i++){await new Promise(requestAnimationFrame);const style=getComputedStyle(el);values.push({opacity:Number(style.opacity),y:new DOMMatrixReadOnly(style.transform).m42});}return values;});
  assert.ok(frames.every(frame=>frame.opacity>0.999&&Math.abs(frame.y)<0.01),label);
 }
 async function choose(mode){
  await page.getByRole("button",{name:"Open settings",exact:true}).filter({visible:true}).click();
  const settings=page.getByRole("dialog",{name:"Settings",exact:true});await settings.waitFor();
  // “Follow system”也出现在主题设置里，用动画组选项的独有说明限定。
  const button=mode==="system"?settings.getByRole("button",{name:/^Follow system Follow your device/}):settings.getByRole("button",{name:labels[mode]});
  await button.click();await page.waitForFunction(value=>document.documentElement.dataset.motion===value,mode);
  assert.equal(await button.getAttribute("aria-pressed"),"true");
  await settings.getByRole("button",{name:"Close settings",exact:true}).click();await settings.waitFor({state:"hidden"});
 }
 try{
  await page.emulateMedia({reducedMotion:"reduce"});await choose("system");
  const card=page.locator(".community-chart-card").first();await card.waitFor();await card.hover();
  assert.equal(await card.evaluate(el=>getComputedStyle(el).translate),"none","SYSTEM_REDUCED_MOTION_HOVER_STATIC");
  await choose("on");await card.hover();
  await page.waitForFunction(()=>{const card=document.querySelector(".community-chart-card");return card&&parseFloat(getComputedStyle(card).translate.split(/\s+/)[1])< -1.8;});
  await page.emulateMedia({reducedMotion:"no-preference"});await choose("system");
  await page.evaluate(()=>{window.__motionRoute=document.querySelector('[data-community-motion="route"]');});await observeEntry();
  await page.locator('.community-primary-link[href="/en/forum"]').click();await page.waitForURL(url=>url.pathname==="/en/forum");
  await page.locator(".community-forum-page").waitFor();
  await page.waitForFunction(()=>window.__motionObserved===true);await page.emulateMedia({reducedMotion:"reduce"});
  await assertSettled("SYSTEM_CHANGE_SETTLES_REAL_ROUTE_FRAMES");
  assert.equal(await page.evaluate(()=>window.__motionRoute===document.querySelector('[data-community-motion="route"]')),true,"SPA_ROUTE_CONTAINER_RETAINED");
  await page.emulateMedia({reducedMotion:"no-preference"});await choose("on");
  await page.getByRole("button",{name:"Open settings",exact:true}).filter({visible:true}).click();
  const settings=page.getByRole("dialog",{name:"Settings",exact:true}),off=settings.getByRole("button",{name:labels.off});await off.click({trial:true});
  // 浏览器后退时全局设置仍保持打开，直接用真实开关中断页面进入。
  await observeEntry();await page.goBack();await page.waitForURL(url=>url.pathname==="/en/charts");await page.waitForFunction(()=>window.__motionObserved===true);
  await off.click();await page.waitForFunction(()=>document.documentElement.dataset.motion==="off");await assertSettled("EXPLICIT_OFF_SETTLES_REAL_ROUTE_FRAMES");
  await settings.getByRole("button",{name:"Close settings",exact:true}).click();await settings.waitFor({state:"hidden"});await card.hover();
  assert.equal(await card.evaluate(el=>getComputedStyle(el).translate),"none","EXPLICIT_OFF_HOVER_STATIC");
  await page.reload();await page.locator("main h1").first().waitFor();
  assert.equal(await page.locator("html").getAttribute("data-motion"),"off","OFF_SURVIVES_RELOAD");
  if(authenticated){
   await visit("/en/settings/profile");const field=page.locator('input[name="nickname"]');await field.waitFor();const previous=await field.inputValue();
   try{
    await field.fill("Motion unsaved draft");await field.evaluate(el=>{window.__motionField=el;});
    await choose("on");await choose("off");
    assert.equal(await field.evaluate(el=>el===window.__motionField),true,"PREFERENCE_PRESERVES_INPUT_INSTANCE");
    assert.equal(await field.inputValue(),"Motion unsaved draft","PREFERENCE_PRESERVES_UNSAVED_INPUT");
    await field.focus();await page.evaluate(()=>{location.hash="motion-check";});
    await page.waitForURL(url=>url.hash==="#motion-check");
    assert.equal(await field.inputValue(),"Motion unsaved draft","HASH_PRESERVES_UNSAVED_INPUT");
    assert.equal(await field.evaluate(el=>el===document.activeElement),true,"HASH_PRESERVES_INPUT_FOCUS");
   }finally{await field.fill(previous);}
  }
 }finally{
  // 先经真实控件恢复 Provider，再恢复本地原值，避免污染后续验收步骤。
  await choose(originalMode);
  await page.evaluate(value=>{if(value===null)localStorage.removeItem("adx-reduce-motion");else localStorage.setItem("adx-reduce-motion",value);window.__motionObserver?.disconnect();delete window.__motionObserver;delete window.__motionObserved;delete window.__motionRoute;delete window.__motionField;},stored);
  await page.emulateMedia({reducedMotion:"no-preference"});
 }
}

// 在已加载的中文谱面预览上操作外观偏好；不重新加载预览或更改难度。
async function exerciseMotionPlayer({page,preview,playing=false}){
 const stored=await page.evaluate(()=>localStorage.getItem('adx-reduce-motion'));
 const original=stored==='on'?'on':stored==='off'||stored==='1'?'off':'system';
 const names={on:/^开启动画/,off:/^减少动画/,system:/^跟随系统 遵循设备/};
 const canvas=preview.locator('canvas'),seek=preview.getByRole('slider',{name:'拖动预览时间轴',exact:true}),difficulty=await preview.getByRole('combobox',{name:'难度',exact:true}).inputValue();
 await canvas.evaluate(el=>{window.__motionCanvas=el;});await seek.evaluate(el=>{window.__motionSeek=el;});
 async function choose(mode){
  await page.getByRole('button',{name:'打开设置',exact:true}).filter({visible:true}).click();const sheet=page.getByRole('dialog',{name:'设置',exact:true});await sheet.waitFor();await sheet.getByRole('button',{name:names[mode]}).click();
  await page.waitForFunction(mode=>document.documentElement.dataset.motion===mode,mode);await sheet.getByRole('button',{name:'关闭设置',exact:true}).click();await sheet.waitFor({state:'hidden'});
 }
 try{
  for(const mode of ['off','on']){
   const before=Number(await seek.inputValue());await choose(mode);
   assert.equal(await canvas.evaluate(el=>el===window.__motionCanvas),true,'MOTION_PRESERVES_PLAYER_CANVAS');assert.equal(await seek.evaluate(el=>el===window.__motionSeek),true,'MOTION_PRESERVES_PLAYER_CONTROL');assert.equal(await preview.getByRole('combobox',{name:'难度',exact:true}).inputValue(),difficulty);
   const after=Number(await seek.inputValue());
   if(playing){assert.equal(await preview.getByRole('button',{name:'暂停',exact:true}).isVisible(),true,'MOTION_PRESERVES_PLAYING');assert.ok(after>=before,'MOTION_MUST_NOT_RESET_CLOCK');}
   else{assert.ok(Math.abs(after-before)<=0.03,'MOTION_PRESERVES_PAUSED_POSITION');assert.equal(await preview.getByRole('button',{name:'播放',exact:true}).isEnabled(),true);}
   assert.equal(await preview.getByRole('alert').count(),0,'MOTION_PLAYER_RENDER_ERROR');
  }
 }finally{
  await choose(original);await page.evaluate(value=>{if(value===null)localStorage.removeItem('adx-reduce-motion');else localStorage.setItem('adx-reduce-motion',value);delete window.__motionCanvas;delete window.__motionSeek;},stored);
 }
}

// SSH正式入口只传送本文件，补缺验收与隔离入口保持同一断言。
async function exerciseUxCompletion({page,origin,authenticated=false,onVisit=()=>{}}){
 const visit=async path=>{onVisit(path);const r=await page.goto(new URL(path,origin).href,{waitUntil:"domcontentloaded"});assert.equal(r.status(),200,path);await page.locator("main h1").first().waitFor();};
 await page.setViewportSize({width:1280,height:900});await visit("/en/charts");
 const pattern="**/en/forum.data*";
 let release;const held=new Promise(resolve=>{release=resolve;});
 const hold=async route=>{await held;await route.fallback();};
 await page.route(pattern,hold);
 let clicked;
 try{
  await page.locator('[data-community-motion="route"]').evaluate(el=>{window.__uxCompletionRoute=el;});
  const requested=page.waitForRequest(r=>new URL(r.url()).pathname==="/en/forum.data",{timeout:15000});
  onVisit("/en/forum");clicked=page.locator('.community-primary-link[href="/en/forum"]').click();
  // Attach a handler immediately; a failed click still fails below after releasing the held request.
  void clicked.catch(()=>{});
  await requested;
  await page.getByRole("progressbar",{name:"Opening page…",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__uxCompletionRoute===document.querySelector('[data-community-motion="route"]')&&window.__uxCompletionRoute.isConnected),true,"LOADING_RETAINS_REAL_ROUTE");
  release();await clicked;await page.waitForURL(u=>u.pathname==="/en/forum");await page.locator(".community-forum-page").waitFor();
  await page.getByRole("progressbar",{name:"Opening page…",exact:true}).waitFor({state:"hidden"});
  await page.waitForFunction(()=>document.activeElement?.id==="main-content");
  assert.equal(await page.evaluate(()=>window.__uxCompletionRoute===document.querySelector('[data-community-motion="route"]')),true,"NAVIGATION_RETAINS_ROUTE_INSTANCE");
 }finally{
  release();if(clicked)await clicked.catch(()=>{});await page.unroute(pattern,hold);await page.evaluate(()=>{delete window.__uxCompletionRoute;}).catch(()=>{});
 }
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:900});await visit("/en/help/upload");
  const help=page.getByRole("navigation",{name:"Help topics",exact:true});assert.equal(await help.locator('[aria-current="page"]').getAttribute("href"),"/en/help/upload");
  assert.equal(await page.locator(".community-help-page").isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"HELP_PAGE_NO_OVERFLOW");
  await visit("/en/privacy");
  const valid=await page.locator(".community-policy-page nav a").evaluateAll(links=>links.length>=6&&links.every(a=>document.getElementById(a.hash.slice(1))));assert.equal(valid,true,"PRIVACY_LINKS_HAVE_SECTIONS");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"PRIVACY_PAGE_NO_OVERFLOW");
 }
 await page.setViewportSize({width:1280,height:900});onVisit("/en/charts/9223372036854775807");
 const missing=await page.goto(new URL("/en/charts/9223372036854775807",origin).href);assert.equal(missing.status(),404);await page.locator(".community-recovery h1").waitFor();
 await page.locator('.community-recovery a[href="/en/charts"]').click();await page.waitForURL(u=>u.pathname==="/en/charts");
 const field=page.locator('form[role="search"] input[name="q"]').first();await field.fill("Unsaved search input");await field.focus();await page.evaluate(()=>{location.hash="ux-focus";});
 assert.equal(await field.inputValue(),"Unsaved search input");assert.equal(await field.evaluate(el=>el===document.activeElement),true,"HASH_PRESERVES_SEARCH_FOCUS");
 await field.fill("");
 if(authenticated){
  for(const path of ["/en/me/governance","/en/me/governance?view=appeals","/en/me/reports","/en/me/discussions?kind=reports"]){
   await visit(path);await page.locator(".community-record-page").waitFor();
   const nav=page.locator("main .community-content-nav").first();assert.equal(await nav.locator('[aria-current="page"]').count(),1,"RECORD_VIEW_HAS_ONE_ACTIVE_ITEM");
   await page.setViewportSize({width:320,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"RECORD_PAGE_NO_OVERFLOW");await page.setViewportSize({width:1280,height:900});
  }
 }
 for(const prefix of ["", "/ja"]){await visit(prefix+"/help/upload");await page.locator('.community-help-topics [aria-current="page"]').waitFor();}
}
