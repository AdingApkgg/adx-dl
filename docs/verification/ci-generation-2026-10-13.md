# Chart enrichment and static generation — 2026-10-13

Implementation: `73447d7042930615d95f6f4141d59094268c7986`. Runtime validation used the project's `scripts/remote/verify.sh` and the managed CI worker on `localhost-1.tailac9c6f.ts.net`, whose hostname was checked as `localhost`. No local build, preview, dependency installation or full test suite was run. Non-mainland access used the configured proxies. No production publisher was dispatched.

## Findings and change

The enrichment script previously completed all maidata downloads/analyses before starting its media HEAD pass. In the baseline, the chart pass took approximately 58 seconds and the subsequent size pass approximately 39 seconds. Both use the current upstream assets; the HEAD work does not depend on chart analysis. Each entry now overlaps these operations in its existing bounded entry pool. At concurrency 24, maidata GETs remain bounded to 24 and each of the three media kinds to 24 HEADs; total concurrent requests may reach 96 across the different asset kinds, versus sequential peaks of 24 GETs or 72 HEADs previously. No request is skipped and no persistent enrichment cache was added.

Metadata application, parser identity, real decompressed maidata byte measurement, HEAD size handling, retry behavior and best-effort error handling remain the same. Skip flags continue to work independently. The CLI is guarded with `import.meta.main`, allowing its enrichment function to be tested without running the production command on import.

The approximately 7.4 MB catalog was read and parsed behind React `cache`, which deduplicates a single render pass rather than all pages in a build worker. This scope is documented in the installed Next 16.3.6 guide and [React's cache reference](https://react.dev/reference/react/cache). Static exports now retain one catalog-loading promise per production module/worker and reuse the route-slug index through a WeakMap keyed by catalog identity. Rejected loads are not retained. Builds run in fresh processes with their freshly enriched catalog; the snapshot is not a disk cache and does not survive builds. Development does not retain the process snapshot, preserving fresh catalog reads. Source inspection found no catalog-entry mutations in rendering consumers; consumers sorting arrays copy them first.

The runner limits, Next version, static generation worker count, page coverage and locale coverage are unchanged. The earlier local Next compiler cache and export hardlink optimization remain enabled.

## Validation

New tests were run remotely before implementation and failed because the snapshot helper/export did not yet exist. After implementation, eight targeted cases passed: concurrent/successive snapshot reuse, fresh development reads, failed-load retry, real GET/HEAD overlap with accurate chart metadata and sizes, asset failure behavior, independent skip flags, and request bounds.

The full remote verification passed lint (724 files), typechecks, shared UI tests (38) and Web tests (747 at that point). Two additional flag/concurrency cases subsequently passed in the final targeted suite and in real CI; real CI reported 749 passing Web tests, zero failures. Independent read-only review found no actionable issue.

## Real CI comparison

Baseline: [38353613807](https://github.com/AdingApkgg/adx-dl/actions/runs/38353613807), successful main commit `8e9cb0c27ef07b8c83b40faec969336f6c675e98` earlier on October 13. Optimized: [38419655687](https://github.com/AdingApkgg/adx-dl/actions/runs/38419655687), successful implementation commit above. This baseline includes the current music-player/mascot pages; the preceding day's 11,750-page build is not the application-matched baseline.

| Phase | Baseline | Optimized | Observed reduction |
| --- | ---: | ---: | ---: |
| Enrich chart details step | 98 s | 52 s | 47% |
| Static-generation trace | 82.228 s | 71.277 s | 13% |
| Next build trace | 116.810 s | 92.991 s | 20% |
| Build-site step | 124 s | 99 s | 20% |
| Complete job, GitHub job timestamps | 342 s (5m42s) | 255 s (4m15s) | 25% |

The new network/analysis timer recorded 51.157 seconds. Both runs processed 1,933 entries, analysed 1,933 charts, measured sizes for 1,933 entries and transliterated 964 titles. Both generated 11,753 pages using eight workers. Next's optimized progress line rounded generation to 70 seconds; the table consistently uses the trace duration, which includes additional generation work.

The optimized export reported 82,126 eligible hardlinks and zero native fallback copies. Its full static-export trace took 8.388 seconds versus 18.748 seconds in the baseline. Local compiler cache restore/save hit the same existing key. After completion, build provenance matched the implementation commit; sampled chart-detail and preview HTML for ID 11805 existed and was nonempty in all three languages. This is output-presence verification, not browser behavior verification or byte-for-byte equality of every exported page.

The runner remained at 8 GiB and online/idle after the job. OOM/OOM-kill counters stayed zero. Cgroup memory-limit events increased by 129 during the build, from 166,651 to 166,780; the change does not claim to eliminate storage pressure. Existing compiler cache occupied 177 MiB afterward.

These are observed single-run timings. Network responses, compiler warmth, export I/O, checkout cleanup and runner teardown also vary. The structural overlap and avoided catalog reloads are covered by tests; all 87 seconds of job improvement cannot be attributed exclusively to either one. Static generation remains roughly 71 seconds, and fresh upstream enrichment roughly 51 seconds. Further work should profile page serialization/output writes before increasing workers or adding freshness-sensitive caches.
