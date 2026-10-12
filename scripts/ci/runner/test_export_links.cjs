const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { createExportCopy } = require('./next-export-links.cjs');

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adx-export-links-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, '.next/server/app');
  const out = path.join(root, 'out');
  await fs.mkdir(app, { recursive: true });
  await fs.mkdir(out);
  const source = path.join(app, 'chart.html');
  const target = path.join(out, 'chart.html');
  await fs.writeFile(source, 'generated chart');
  const copy = createExportCopy(root, { ...fs, ...overrides });
  return { root, app, out, source, target, copy };
}

test('static exports share data and survive intermediate cleanup', async (t) => {
  const f = await fixture(t);
  await f.copy(f.source, f.target);
  assert.equal((await fs.stat(f.source)).ino, (await fs.stat(f.target)).ino);
  await fs.rm(path.join(f.root, '.next'), { recursive: true });
  assert.equal(await fs.readFile(f.target, 'utf8'), 'generated chart');
});

test('overwriting an earlier export does not mutate its generated source', async (t) => {
  const f = await fixture(t);
  await f.copy(f.source, f.target);
  const other = path.join(f.app, 'other.rsc');
  await fs.writeFile(other, 'new payload');
  await f.copy(other, f.target);
  assert.equal(await fs.readFile(f.target, 'utf8'), 'new payload');
  assert.equal(await fs.readFile(f.source, 'utf8'), 'generated chart');
  await f.copy(other, f.target);
  assert.equal(await fs.readFile(other, 'utf8'), 'new payload');
});

test('cross-device or unsupported links fall back to regular copies', async (t) => {
  for (const code of ['EXDEV', 'EPERM', 'EOPNOTSUPP']) {
    const f = await fixture(t, { link: async () => { throw Object.assign(new Error(code), { code }); } });
    await f.copy(f.source, f.target);
    assert.equal(await fs.readFile(f.target, 'utf8'), 'generated chart');
    assert.notEqual((await fs.stat(f.source)).ino, (await fs.stat(f.target)).ino);
  }
});

test('public assets and paths outside the generated app tree use normal copies', async (t) => {
  const f = await fixture(t);
  const publicFile = path.join(f.root, 'public.txt');
  await fs.writeFile(publicFile, 'asset');
  await f.copy(publicFile, f.target);
  assert.notEqual((await fs.stat(publicFile)).ino, (await fs.stat(f.target)).ino);
  const escaped = path.join(f.app, '../../outside.txt');
  await fs.writeFile(escaped, 'outside');
  const target = path.join(f.out, 'outside.txt');
  await f.copy(escaped, target);
  assert.notEqual((await fs.stat(escaped)).ino, (await fs.stat(target)).ino);
});

test('symlink sources retain native dereferencing behavior', async (t) => {
  const f = await fixture(t);
  const link = path.join(f.app, 'linked.html');
  await fs.symlink(f.source, link);
  await f.copy(link, f.target);
  assert.equal((await fs.lstat(f.target)).isSymbolicLink(), false);
  assert.equal(await fs.readFile(f.target, 'utf8'), 'generated chart');
  assert.notEqual((await fs.stat(f.source)).ino, (await fs.stat(f.target)).ino);
});

test('copy flags and native errors retain their behavior', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(f.target, 'existing');
  await assert.rejects(f.copy(f.source, f.target, fs.constants.COPYFILE_EXCL), { code: 'EEXIST' });
  assert.equal(await fs.readFile(f.target, 'utf8'), 'existing');
  await assert.rejects(f.copy(f.source, path.join(f.out, 'missing/file')), { code: 'ENOENT' });
  await assert.rejects(f.copy(path.join(f.app, 'missing'), f.target), { code: 'ENOENT' });
});

test('the ESM preload is opt-in and disables reuse for other Next versions', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, 'node_modules/next'), { recursive: true });
  await fs.writeFile(path.join(f.root, 'package.json'), '{}');
  for (const [enabled, version, linked] of [['1', '16.3.6', true], ['', '16.3.6', false], ['1', '16.4.0', false]]) {
    await fs.writeFile(path.join(f.root, 'node_modules/next/package.json'), JSON.stringify({ version }));
    await fs.rm(f.target, { force: true });
    const result = spawnSync(process.execPath, ['--require', path.join(__dirname, 'next-export-links.cjs'), '--input-type=module', '-e', `import fs from 'node:fs/promises'; await fs.copyFile(${JSON.stringify(f.source)}, ${JSON.stringify(f.target)});`], {
      cwd: f.root, env: { ...process.env, ASTRODX_CI_EXPORT_LINKS: enabled }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await fs.stat(f.source)).ino === (await fs.stat(f.target)).ino, linked);
    assert.equal(await fs.readFile(f.target, 'utf8'), 'generated chart');
  }
});
