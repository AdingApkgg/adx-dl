# Initial zip.js migration verification — 2026-10-11

This report records the first migration stage. The subsequent capability policy and mobile large-package release are documented in [CAPABILITY-REPORT.md](CAPABILITY-REPORT.md).

ZIP/ADX now use @zip.js/zip.js 2.23.0, STORE mode, streaming OPFS output when available. The existing archive module remains dynamically imported. TAR/gzip retains fflate; cancellation now propagates to both writers.

OPFS is temporary browser-owned disk storage; the existing save button exports the resulting disk-backed file. Missing APIs, access denial, insufficient estimated quota, and write/close/read failures fall back to a Blob for the same already-bounded part. Input/codec errors surface normally. Cancelled output is deleted; confirmed mobile saves release the temporary file before the next part starts. Dismissal after a save click preserves the 60-second download handoff.

Limits are unchanged: mobile batches stay at 128 MiB / eight charts with one active batch. Existing desktop partition thresholds and ZIP32 checks remain. This migration does not enable ZIP64 or claim the game imports multi-GiB archives. Source downloads still use the existing persistent asset cache; OPFS bounds archive-output buffering rather than promising zero memory for the entire workflow.

## Results

- `bun test`: **688 passed**, zero failures, 77 files.
- `bun x tsc --noEmit`: passed.
- Biome lint on eight affected source/test files: passed.
- `git diff --check`: passed.
- Chromium and WebKit, ordinary persistent profiles, mobile viewport: **six save cases passed** (OPFS, missing API, simulated quota failure on each engine).
- Input: real ZEUS chart with maidata.txt, track.mp3, bg.png and pv.mp4 from the preceding benchmark fixture. Each exported ADX is 76,031,087 bytes.
- All six downloads retained the Unicode `.adx` filename, matched output size, left zero OPFS files after explicit release, and passed Python ZIP CRC and per-entry SHA-256 against original assets.
- Regression tests exercise pre-cancel, cancellation mid-write and while acquiring the final File, idempotent release, insufficient quota, output failure fallback, bounded codec steps/UI yielding, Unicode paths, mobile 8+1 batching and release-before-next-fetch.

These are desktop browser engines with mobile emulation, not native iOS/Huawei/low-memory device certification. Actual AstroDX import/playback was not rerun. No production deployment or commit/push was performed.

The first restricted full test run could not bind the local IndexNow test server. A rerun with local-network access passed. WebKit private storage was unavailable; it correctly took the buffered path. Missing-API/write-failure injection in WebKit must replace `navigator.storage` with a stable facade because assigning a method to one returned StorageManager object does not persist across subsequent property accesses.

## Reproduction

Run `run.mjs` from the repository root using Node with Playwright available. It bundles the actual production archive module with esbuild, not a copied writer. `BENCH_ROOT` selects the preceding benchmark's downloaded fixture/assets, and `MIGRATION_ROOT` selects scratch outputs. `PLAYWRIGHT_MODULE` and `WEBKIT_EXECUTABLE` can select installed runtimes. Large assets/ADX output and browser profiles remain in `/private/tmp`; only scripts and results are checked into the workspace.
