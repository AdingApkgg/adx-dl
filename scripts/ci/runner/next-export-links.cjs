// Next 16.3.6 copies completed, immutable app prerenders into out/.
// Reuse their inodes only in the explicitly enabled managed CI build.
// Pages tar uses --hard-dereference, so published files remain ordinary files.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');

function inside(root, file) {
  const relative = path.relative(root, path.resolve(file));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function createExportCopy(appRoot, io = fs) {
  const sourceRoot = path.join(appRoot, '.next/server/app');
  const outputRoot = path.join(appRoot, 'out');
  const nativeCopy = io.copyFile.bind(io);
  const stats = { linked: 0, copied: 0 };
  async function copy(source, destination, flags) {
    if (typeof source !== 'string' || typeof destination !== 'string' || (flags !== undefined && flags !== 0)
      || !inside(sourceRoot, source) || !inside(outputRoot, destination)) {
      return nativeCopy(source, destination, flags);
    }
    const sourceInfo = await io.lstat(source);
    if (sourceInfo.isFile()) {
      try {
        await io.link(source, destination);
        stats.linked++;
        return;
      } catch {
        // Preserve native copy behavior for cross-device/unavailable links.
      }
    }
    stats.copied++;
    let targetInfo;
    try { targetInfo = await io.lstat(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (targetInfo?.isFile() && targetInfo.nlink > 1
      && (sourceInfo.dev !== targetInfo.dev || sourceInfo.ino !== targetInfo.ino)) {
      // A repeated export must not overwrite an earlier source's shared inode.
      const temporary = path.join(path.dirname(destination), `.adx-export-${randomUUID()}`);
      try {
        await nativeCopy(source, temporary, flags);
        await io.rename(temporary, destination);
      } finally {
        await io.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      }
    } else {
      await nativeCopy(source, destination, flags);
    }
  }
  copy.stats = stats;
  return copy;
}

module.exports = { createExportCopy };

if (process.env.ASTRODX_CI_EXPORT_LINKS === '1') {
  const appRoot = process.cwd();
  let version;
  try { version = createRequire(path.join(appRoot, 'package.json'))('next/package.json').version; } catch {}
  // Reassess the export's immutable-file assumption before enabling a new Next.
  if (version === '16.3.6') {
    const copy = createExportCopy(appRoot);
    fs.copyFile = copy;
    process.on('exit', () => {
      if (copy.stats.linked || copy.stats.copied) {
        console.log(`AstroDX export reuse: ${copy.stats.linked} hardlinks, ${copy.stats.copied} native copies`);
      }
    });
  } else {
    console.warn('AstroDX export reuse disabled: unsupported Next version');
  }
}
