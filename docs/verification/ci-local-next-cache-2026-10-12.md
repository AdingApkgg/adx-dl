# Persistent local Next build cache — 2026-10-12

Implementation: `edeb94ba5ccc22fcc20937288f0c55447adb1fed`. All builds and tests ran on `localhost-1.tailac9c6f.ts.net`; the Mac only handled editing, Git, API access and remote connections. Application code, Bun lockfile, 32-CPU/8-GiB runner ceiling and eight static-generation workers remained unchanged. No production publishing workflow was dispatched.

## Implementation

Managed self-hosted builds now move `.next/cache` into `_work/.next-build-cache/<key>` on their persistent work volume between jobs. The helper is mounted read-only outside checkout, so old scheduled `pages-live` sources can also use it. Both Web CI and the Pages build workflow use this path. Hosted builds, including public PR jobs, retain GitHub Actions cache.

The key includes workspace path, dependency lockfile, Node/Bun versions, platform and architecture. Next handles source-input invalidation. Restore/save use same-volume directory rename, preserving inodes without archive creation, compression or network transfer. Strict checkout cleanup remains enabled. Cold misses build without downloading a GitHub cache. Cache paths reject symlink traversal and occupied destinations. A cancelled run that does not save may require a cold rebuild; compiler cache is never proof of a successful export. Old dependency/runtime slots remain available for rollback and are not automatically pruned.

Six new cache lifecycle/path-safety regression cases and all 49 runner regressions passed remotely. Remote actionlint passed for both changed workflows (shellcheck/pyflakes disabled). Independent review found no actionable issue. The live runner mount and original 8-GiB ceiling were verified before CI.

## Real CI comparison

The previous successful Web run was [38231383566](https://github.com/AdingApkgg/adx-dl/actions/runs/38231383566). The existing workspace cache had been removed by a subsequent strict checkout, so two runs at the same new implementation commit were necessary: [cold initialization 38268483012](https://github.com/AdingApkgg/adx-dl/actions/runs/38268483012), then [warm reuse 38269175245](https://github.com/AdingApkgg/adx-dl/actions/runs/38269175245). Both passed all lint, typechecks, tests and build steps.

| Phase | Previous GitHub cache | Local cold initialization | Local warm reuse |
| --- | ---: | ---: | ---: |
| Complete job, GitHub job timestamps | 375 s (6m15s) | 277 s (4m37s) | 225 s (3m45s) |
| Cache restore step | 106 s | <1 s, miss | <1 s, hit |
| Cache save step | 17 s | 5 s | 1 s |
| Build-site step | 110 s | 114 s | 99 s |
| Next build trace | 105.888 s | 107.404 s | 90.673 s |
| Static-generation trace | 78.181 s | 83.986 s | 75.763 s |
| Full static-export trace | 17.726 s | 13.233 s | 5.527 s |
| Chart-detail enrichment | 72 s | 83 s | 60 s |

Job durations consistently use API job `started_at`/`completed_at`, including final runner teardown. Step timestamps have one-second resolution. The helper's filesystem-move timer printed `0.000 seconds` for both successful saves and the warm restore; this excludes runtime startup/key calculation and is not the full step duration. Cold save's full step took five seconds; warm save took one second.

Warm CI was 150 seconds / 40% shorter than the preceding baseline. Removing cache download/upload directly eliminated approximately 123 seconds of previous network-cache steps, replaced by roughly one second of local cache handling. The remaining difference includes enrichment, export/storage residency, tool setup and teardown variation; this is a single matched-application comparison, not an isolated hardware or compiler benchmark.

Cold and warm logs recorded the same key, `71a89c2f90cf6e417f00b52af050a17b1bb302f2f837540b514d0f300a848bbc`. GitHub cache was skipped in both, with no cache post-upload action. The persistent root contained 97 MiB after initialization and 102 MiB after warm reuse. Its survival across the second checkout and the logged warm hit verify real reuse rather than a simulated cache fixture.

Both builds generated 11,750 pages with eight workers and reported 82,105 eligible export hardlinks with zero native fallback copies. After warm completion, `out/index.html` existed and build provenance matched the implementation SHA. Cgroup OOM and OOM-kill counters stayed zero; memory-limit reclaim continued (cumulative `max` 26,899), so the change does not claim to remove storage or memory pressure.

Remaining major phases are approximately 60 seconds of chart-detail enrichment and 76 seconds of full static generation in the warm run. The earlier cold archive I/O bottleneck is unchanged; no archive benchmark or production publish was run for this cache change.
