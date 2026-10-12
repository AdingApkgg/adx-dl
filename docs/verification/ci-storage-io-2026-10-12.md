# CI storage I/O investigation — 2026-10-12

Implementation: `0a8cd407c1ba5ab3a954023b1b299faaa34a2706`. Application code, Bun lockfile and eight-worker static-generation limit are unchanged. All runtime work ran remotely on `localhost-1.tailac9c6f.ts.net`; Git/GitHub and non-mainland CI traffic used the configured proxies. No production publishing workflow was dispatched.

## Observations

- The KVM guest exposes one 2 TiB ext4 virtual disk and 128 CPUs. Its rotational flag does not prove the hypervisor's physical storage type. During cold reads, disk utilization approached 97% with approximately 20–26 MiB/s throughput while CPUs were mostly idle. Restore writes showed roughly 45–64 MiB/s and 67–114 ms write latency.
- Tar blocked in `folio_wait_bit_common` and restore writes blocked in `balance_dirty_pages`; cgroup I/O full-pressure averages frequently reached 75–89%. There was no explicit I/O quota or parent cgroup memory cap. The guest has one NUMA node. Global VM tuning was inspected but not changed.
- The 8 GiB worker's file-cache budget is part of its memory limit. It accumulated substantial reclaim/refault activity without OOM. Increasing only its limit to 16 GiB eliminated its `memory.events:max` increments but did not eliminate cold reads or improve the matched export/packing run. This temporary change was reverted to 8 GiB before real CI.
- A cache-residency sample during the 16 GiB run covered 101 files: original source pages were 62.6% resident, exported copies 19.4%. Increasing the container ceiling alone did not keep this workload's file data resident on the shared guest.
- Installed Next 16.3.6 waits for prerender writes before copying completed HTML, RSC and segment files into `out/`. This duplicates file bytes and creates additional reads/writes and cache competition. Checkout v7 subsequently runs strict `git clean -ffdx` and `git reset --hard`; the previous Dash cleanup alone took approximately 26 seconds after the full Web/archive job.

## Controlled diagnostic runs

The file set was restored remotely from the preceding successful Pages benchmark artifact. It contained 84,241 regular files and packed into a 4,725,821,440-byte tar. Source prewarming was measured separately. Node's `fs.promises.copyFile` with concurrent operations modeled the installed Next export loop; this is a filesystem experiment, not a complete Next build or a controlled hypervisor benchmark.

| Phase | 8 GiB ceiling | 16 GiB ceiling |
| --- | ---: | ---: |
| Source prewarm | 127.046 s | 415.274 s |
| Full file copy | 85.459 s | 105.026 s |
| Quiet tar packing | 81.108 s | 621.562 s |
| Export-tree cleanup | 1.571 s | 0.993 s |
| Tar cleanup | 0.464 s | 0.108 s |
| Copy memory-limit events | 9,544 | 0 |
| Packing memory-limit events | 17,433 | 0 |

Neither run OOMed. Large timing changes even for the same quiet command show that elapsed time depends strongly on cache residency and shared storage conditions; the earlier verbose 497 s and quiet 880 s runs cannot isolate a verbosity effect.

A 10,000-file / 697,760,866-byte subset copied in 2.780 s versus 1.005 s via hardlinks. Sequential deletion took 0.159 s, parallel deletion 0.138 s, so parallel cleanup was not introduced. A separate `/dev/null` tar experiment only measured traversal/log overhead (GNU tar may skip payload reads there); it is not evidence for full archive I/O performance. Full streaming verbosity comparison follows the real CI build.

All restored archives, copied trees and temporary diagnostic files were removed before real CI. Only the temporary 16 GiB resource change was made, then reverted; other workloads, VM settings and host storage configuration were preserved.

## Change and safeguards

- Only self-hosted AstroDX build steps opt into a read-only mounted `next-export-links.cjs` preloader. It is guarded to Next 16.3.6 and to regular completed `.next/server/app` files copied into `out/`. Other versions disable reuse automatically.
- Other paths, public assets, symlink sources and explicit copy flags retain native copying. Unsupported/cross-volume hardlinks fall back to ordinary copying. Repeated exports detach shared destinations before overwriting, preserving previous source bytes.
- Successful static exports remove `.next/server` while metadata is hot, preserving `out/`, `.next/cache`, trace and build provenance. Strict checkout cleanup stays enabled. Pages tar retains `--hard-dereference`, producing ordinary independent files.
- Seven Node regression cases passed remotely, including ESM activation/version gating, fallback, overwrite isolation and cleanup survival. All 43 runner regressions passed remotely. Remote actionlint passed (shellcheck/pyflakes disabled). Independent review checked the installed Next export implementation and found no actionable issue.

## Real CI verification

Web: [38231383566](https://github.com/AdingApkgg/adx-dl/actions/runs/38231383566), successful at the original 32-CPU/8-GiB ceilings. All application checks passed. There were 11,750 pages and eight static-generation workers, taking 78.181 seconds (previous round: 79 seconds). The hook reported 82,105 hardlinks and zero fallback copies in its eligible scope. Other file copies are intentionally outside those counters.

| Real CI phase | Previous round | This round |
| --- | ---: | ---: |
| Web job (GitHub job timestamps) | 11m16s | 6m15s |
| Build-site step | 394 s | 110 s |
| Next build trace | Not retained from preceding check | 105.888 s |
| Full static-export trace | 255.914 s in earlier scheduled baseline | 17.726 s |
| Intermediate server cleanup | Deferred until next checkout | 1 s |
| Next cache restore | 21 s | 106 s |

The build-site step was 72% shorter and the Web job 45% shorter in this round. This is one CI comparison; shared storage/network variability still applies. Cache restore spent approximately 90 seconds reporting zero bytes received, so its regression was largely download waiting, not export work. Dependency installation took 1.216 seconds for 788 packages. Cgroup memory events rose from zero to 14,611 during the build, without OOM/kill. Archive/initial upload subsequently raised the counter to 25,446, so memory-limit reclaim still occurred late in that phase; substantial disk I/O waiting occurred well before those increments.

The combined `du` output reported `.next/server` first, then only 84 MiB for `out/`, because GNU du counts each shared inode once across both arguments. It does not mean the logical Pages output shrank to 84 MiB; archive file sizes/content are validated independently after packing.

Archive benchmark: [38232385381](https://github.com/AdingApkgg/adx-dl/actions/runs/38232385381), successful. Full tar creation took 626 seconds (10m26s), versus 880 seconds (14m40s) in the preceding quiet round: 29% shorter. The tar remained 4,725,821,440 bytes and the uploaded ZIP was 572,842,061 bytes. Upload took approximately 77 seconds versus 56 seconds previously. Tar still waited predominantly on I/O: during one late sample, 3.05 GB had been physically read for approximately 3.79 GB of input data, disk utilization was 96.6%, and CPUs were 98.1% idle. This optimization does not eliminate cold reads or improve the underlying virtual disk.

Runner job cleanup removed the temporary tar after upload. The uploaded ZIP was therefore downloaded again and extracted remotely to validate the actual stored artifact against the preserved build output: all 84,241 file names and sizes matched, no link entries were present, and 108 SHA-256 content samples matched (including home, detail/preview and localized pages). Temporary ZIP/tar/verifier files were removed afterward.

A real-data streaming comparison used the same 10,000 files, explicit prewarming and a pipe consumer that drained all 705,044,480 archive bytes. Quiet/verbose/verbose/quiet creation times were 0.258/0.191/0.212/0.288 seconds. Verbose output added 306,007 bytes of log data. This small warm-stream test shows no minutes-scale tar/log computation cost; it is not a full disk-sink A/B and does not benchmark GitHub's logging pipeline. Full-run variation cannot be attributed solely to removing `-v`.

Following Dash [38235109437](https://github.com/AdingApkgg/adx-dl/actions/runs/38235109437) also passed at the same implementation commit. The full checkout took 6 seconds versus 30 seconds in the preceding post-Web/archive Dash run. Log timestamps show strict `git clean -ffdx` at 3.22 seconds versus 26.22 seconds. This round also paid the earlier 1-second intermediate cleanup, so it did not simply move the whole deletion cost elsewhere. Extra artifact validation warmed some metadata before this checkout; these numbers are observed single-run timings, not an isolated cleanup A/B. The complete Dash job took 38 seconds versus 60 seconds in that preceding warm-cache round, and Bun installation took 0.686 seconds.

All three real CI/benchmark runs succeeded. Runner limits remain 32 CPU equivalents / 8 GiB, with the existing private daemon at 16 CPU equivalents / 4 GiB. Restored files and diagnostic archives were cleaned up. No production publisher was dispatched and `pages-live` was not moved.

Remaining bottlenecks are cold small-file reads on the shared virtual work volume, network waiting while restoring the Next cache, and the unchanged chart-detail enrichment/static-generation phases. Better work-volume random-read performance and a carefully scoped persistent local Next cache are separate follow-ups; neither is claimed as implemented here. Hypervisor-side storage type, contention or I/O limits could not be established from guest metrics alone.
