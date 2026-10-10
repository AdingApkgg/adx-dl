# Capability-based batch archives — 2026-10-11

The phone-only 128 MiB / eight-song restriction no longer applies when the browser can actually write OPFS files and the requested version has enough storage headroom. Default version grouping is retained; explicit genre grouping still works. Capability planning is asynchronous, so the download button is disabled while a plan is prepared and duplicate calls for the same selection share one plan.

A probe creates, writes, closes and deletes a temporary file. Space estimates reserve approximately three times the version's declared asset size for persistent input checkpoints, archive output and export/temporary copies. The probe is repeated when a queued version is about to fetch. Unknown size metadata and unsupported/denied/unwritable storage retain conservative grouping. Buffered mobile fallback remains 128 MiB / eight charts, keeping an oversized single chart intact and warning about it. TAR/gzip retains its existing buffered path.

Streaming ZIP/ADX keeps the entire group instead of the old 2 GiB split and enables zip.js automatic ZIP64 selection as required. A streaming job requires disk output; it never silently rebuilds a failed whole version as an unbounded Blob. Disk failure creates smaller child jobs using cached loose files, preserves the original selection's history, and keeps fallback children visible in the original inline bar. Buffered fallback explicitly avoids retrying the failed disk path. Its existing ZIP32/importer boundaries remain.

Completed network buffers are replaced with Blob objects read back from the persistent checkpoint store. A missing durable checkpoint causes the large job to switch to the bounded policy. Valid cached Blobs are not rewritten into their own IndexedDB records: that operation produced unreadable backing files in the tested WebKit runtime. Fallback children are persisted before waiting for the first part's lifecycle, keeping queued specs available for reload recovery. Saved-file confirmation still releases the mobile output and checkpoints before proceeding; large mobile jobs remain sequential and require explicit save gestures.

## Verification

- Current local catalog: 1,933 charts across 28 version groups; every downloadable asset has a known byte size. No version is forced to conservative grouping merely because size metadata is missing.
- Final `bun test`: **697 passed**, zero failures, 77 files.
- TypeScript no-emit check: passed.
- Biome lint: fourteen changed source/test files, no warnings.
- `git diff --check`: passed.
- Real queue tests on Chromium and WebKit, ordinary profiles with iPhone user agent and mobile viewport: **six cases passed across verification runs** (streaming, missing API, runtime disk failure). The final WebKit failure case was rerun after the cache rewrite fix.
- Each case used six real charts, 24 assets including BGA, totaling 318,736,980 input bytes. Streaming saved one 318,741,892-byte version ADX. Unsupported/write-failure cases saved three ADX files: 130,368,544 / 101,310,282 / 87,063,110 bytes. All remained below the fallback mobile budget.
- Every queue case requested exactly the original 24 assets, retained one complete-selection history entry, exported every archive successfully and left no prepared OPFS files after confirmation.
- Queue downloads passed ZIP CRC and media SHA-256 against original assets.
- The actual production archive module separately generated and saved **4,781,125,838 bytes (4.45 GiB), 360 entries** with streaming OPFS and ZIP64. Python verified every entry's CRC and SHA-256, including entries whose local-header offsets exceeded 4 GiB. Its temporary file was released.
- Regression tests cover lifting count/byte limits on capable mobile browsers, quota fallback before fetch, loss of headroom while queued, disk-required failure instead of a large Blob, cached-input replacement, cache write avoidance, small-part retry/history, cancellation, Unicode paths and missing/denied storage APIs. Existing reload/checkpoint tests also pass.

The earlier full run overlapped large-file hashing and hit an existing two-second queue-test deadline while archiving. Running the complete suite after that I/O finished passed; the timeout was not increased. An earlier WebKit failure remains documented in the investigation above rather than being counted as a passing run.

These are desktop browser engines with mobile emulation. Native iOS, Huawei/low-memory Android and actual AstroDX import/playback are not certified by these results. ZIP64 output correctness does not prove every game version accepts a multi-GiB archive. These checks were performed before release; deployment status must be checked separately.

## Artifacts

- `capability-queue-results.json`: six real queue save cases.
- `capability-large-results.json`: actual writer's 4.45 GiB save case.
- `capability-integrity.json`: CRC and hash checks.
- `run-queue.mjs` + `queue-browser-entry.ts`: bundles the production queue and uses real IndexedDB. Set ENGINE and MODE to rerun a specific case.
- `run-large.mjs` + `browser-entry.ts`: production writer ZIP64 test.

Scripts run from the repository root. BENCH_ROOT points to the preceding benchmark fixture and downloaded assets; MIGRATION_ROOT selects scratch files. PLAYWRIGHT_MODULE and WEBKIT_EXECUTABLE can select installed browser runtimes. Large assets, exported archives and profiles stay under `/private/tmp`, outside the repository.

## Individual chart downloads

The batch menu now offers one importable archive per chart, retaining the selected format, BGA toggle and version/genre directory layout. This overrides group merging even when streaming is supported. Mobile saves remain sequential and all charts form one complete-selection history record. History re-download preserves this choice. The option is explicit for the current batch bar; default version packaging is unchanged.

A Chromium mobile-viewport run saved six actual BGA-containing charts separately (24 source requests, six successful saves, one history entry, no retained OPFS files). All archives passed CRC and original media SHA-256 comparisons. The selected option and help copy were checked in the actual 390 x 844 catalog UI. This remains browser emulation, not native-phone evidence; wireless ADB connection to the supplied address timed out.

Chinese, English and Japanese help explain disk capability, available space, automatic splitting, individual-download fallback and the importer's ZIP64 requirement for files larger than 4 GiB.
