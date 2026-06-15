// Prune Next.js client-navigation RSC payloads from the static export.
//
// Next 16's static export emits, for every route, a set of `.txt` flight
// payloads used only for client-side soft navigation / incremental prefetch:
//   - `<route>.txt`                     full-route flight (one per `.html`)
//   - `<route>/__next.*.txt`            per-segment prefetch data (~8 per route)
// There is no `next.config` switch to suppress them (verified against the
// installed 16.2.9 source: `shouldGenerateStaticFlightData` is unconditional).
//
// With ~1.5k charts × 3 locales they balloon the output to ~52k files / 370MB —
// over Cloudflare Pages' hard 20,000-files-per-deployment cap. Deleting them
// makes the site a pure static MPA: the `.html` already carries the inlined
// flight for first paint, and the client router falls back to a full-page
// navigation when a `.txt` 404s. The only cost is client-side prefetch/soft-nav.
//
// Kept: any `.txt` with no sibling `.html` and not matching `__next.*`
// (llms.txt, robots.txt, indexnow-*.txt, etc.).

import { readdirSync, statSync, rmSync, existsSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";

const outDir = process.argv[2] ?? "out";

if (!existsSync(outDir)) {
  console.error(`[prune-rsc] output dir not found: ${outDir}`);
  process.exit(1);
}

let removed = 0;
let kept = 0;
const touchedDirs = new Set();

/** @param {string} dir */
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (!name.endsWith(".txt")) continue;

    const isSegment = name.startsWith("__next.");
    const hasSiblingHtml = existsSync(full.slice(0, -4) + ".html"); // route-level flight
    if (isSegment || hasSiblingHtml) {
      rmSync(full);
      removed++;
      touchedDirs.add(dir);
    } else {
      kept++; // llms.txt / robots.txt / indexnow-*.txt / etc.
    }
  }
}

walk(outDir);

// Remove directories left empty by the prune (e.g. `charts/<id>/`).
let prunedDirs = 0;
for (const dir of [...touchedDirs].sort((a, b) => b.length - a.length)) {
  let cur = dir;
  while (cur.startsWith(outDir) && cur !== outDir) {
    try {
      rmdirSync(cur); // throws if non-empty
      prunedDirs++;
      cur = dirname(cur);
    } catch {
      break;
    }
  }
}

function countFiles(dir) {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) n += countFiles(full);
    else n++;
  }
  return n;
}
const total = countFiles(outDir);

console.log(
  `[prune-rsc] removed ${removed} RSC payload(s), ${prunedDirs} empty dir(s); kept ${kept} non-RSC .txt; ${total} files remain in ${outDir}/`
);
if (total >= 20000) {
  console.warn(
    `[prune-rsc] WARNING: ${total} files >= Cloudflare Pages' 20,000-file limit`
  );
}
