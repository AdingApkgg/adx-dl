# Same-volume Bun cache and quiet Pages packaging — 2026-10-12

Implementation: `553dba1db22c4505f19dac73334777aa4b63b8f3`. Application code and the eight-worker Next build limit are unchanged.

## Changes and validation

- Runner-host Bun uses `/opt/actions-runner/_work/.bun-install-cache`, on the work mount and outside the nested repository checkout. The old warm package cache was migrated once before recreating the idle runner. No new runner image was built.
- The original overlay-to-work-volume hardlink failed with `EXDEV`. After migration, a real cross-directory link succeeded; the installed Next package also shared its package-cache inode (`st_nlink=2`).
- Pages uses the official `upload-pages-artifact@v5` Linux tar flags and hidden-file exclusions, omitting only verbose output. The standard `upload-artifact@v7` uploader retains the original name, default compression and one-day retention.
- A remote fixture verified regular file contents, dereferenced symbolic/hard links, hidden exclusions, and zero per-file stdout. Its temporary files were cleaned up.
- All 43 runner policy/manager/proxy tests passed remotely. Remote actionlint accepted all workflows; shellcheck/pyflakes were disabled.
- All runtime checks and CI work run on `localhost-1.tailac9c6f.ts.net`. The local Mac only performed file editing, Git, API requests and remote connections. Non-mainland requests continue through the configured proxies.

## Measurement method

Web CI runs once, writes its successful build SHA, then the archive-only mode of `runner-smoke.yml` validates both the checkout SHA and build marker before packaging that exact output. This mode uploads an artifact but has no deployment step or Pages write permissions. Dash and Community checks follow the archive benchmark so their checkout cannot remove its output.

Compare step execution time independently of queueing. This is one warm-cache CI round, not a multi-run controlled hardware benchmark. The previous successful self-hosted baseline is `6e214544868f721cc02fcc250716f3f541873381`; the previous Pages tar timing is from the next scheduled run at `9ff78bf` (building `pages-live`, `4f9306c7`).

| Metric | Previous self-hosted baseline | This round |
| --- | --- | --- |
| Web dependency install | 26.46 seconds | 0.253 seconds (788 packages) |
| Dash dependency install | 44.41 seconds | 0.859 seconds (788 packages) |
| Community dependency install | 21.60 seconds | 0.106 seconds (788 packages) |
| Full Pages tar packing | Approximately 497 seconds | 880 seconds |
| Pages artifact upload after tar | Approximately 68 seconds | 56 seconds |

Web run: [38207752500](https://github.com/AdingApkgg/adx-dl/actions/runs/38207752500).

Web checks and full build passed: 11,750 pages were generated with eight workers in 79 seconds. No OOM or OOM kill occurred. The full Web job took 11m16s versus the previous 8m54s; phase timings must be compared separately because the preceding workspace cleanup and unchanged enrichment/export phases varied. Dependency installation itself was approximately 104.6 times faster (99.0% less time).

Archive benchmark run: [38208950469](https://github.com/AdingApkgg/adx-dl/actions/runs/38208950469).

The archive benchmark passed, including the matching source/build SHA and actual cache hardlink probe. Its tar was 4,725,821,440 bytes; the uploaded artifact was 572,860,542 bytes (previous scheduled artifact: 572,953,821 bytes). Quiet packaging removes approximately 98,000 per-file log lines, but this round's packing was 77% slower, so there is no demonstrated packing speedup. During packing, tar was blocked in `folio_wait_bit_common` with roughly 0.5% CPU use and cgroup I/O full-pressure averages around 75–85%. No explicit cgroup I/O limit was present. This supports a storage-wait bottleneck; the guest's rotational flag does not establish the host's physical disk type.

Dash [38209513154](https://github.com/AdingApkgg/adx-dl/actions/runs/38209513154) and Community [38209521392](https://github.com/AdingApkgg/adx-dl/actions/runs/38209521392) also passed. Their dependency installation was approximately 51.7 and 203.8 times faster, respectively. GitHub job start/completion timestamps show Dash at 60 seconds versus 106 seconds previously and Community at 85 seconds versus 271 seconds. Community's Docker build took 18 seconds versus 143 seconds previously; this is a warm-layer result and cannot be attributed to the Bun cache change alone. GitHub job timestamps can differ from individual setup/teardown step timestamps.

All four requested CI/benchmark runs succeeded. The reliable measured gain is warm Bun installation; full-job and archive timings remain sensitive to workspace cleanup, Docker cache warmth and shared storage load. Further optimization should measure storage/export/checkout I/O before changing worker counts or CPU allocation.

The production publishing workflow was updated for future runs; this verification does not dispatch it or move `pages-live`.
