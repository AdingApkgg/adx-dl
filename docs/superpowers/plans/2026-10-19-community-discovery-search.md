# Content discovery and public search implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Native execution in existing isolated worktree, one fresh whole-branch review. User authorized continuous implementation through formal release; no intermediate confirmation.

**Goal:** Deliver the approved discovery → public search → difficulty preview → library/download journey as one complete release.
**Architecture:** Reuse current public authorization with DB-equivalent integrity guards before pagination/counts. Extend explicit publication metadata with backward-readable v2 aliases. PostgreSQL performs bounded live queries; browser uses URL state and existing library/download providers.
**Tech Stack:** Existing Bun/React Router/Hono/Drizzle/PostgreSQL/packages/ui/Playwright.
**Spec:** docs/superpowers/specs/2026-10-19-community-discovery-search-design.md (approved 2026-10-19).

## Global Constraints
- User override: no install/build/test/dev execution during development. Write coverage first; execute on designated builder in one final release window. All intermediate checkboxes concern source only, not passing validation.
- Query120 codepoints/6 terms; aliases8×60; tags5 AND; levels8 exact; time0–3600; one difficulty row must satisfy all slot filters.
- Page20, all4 per type, suggestions6/150ms/IME safe, facets20, random candidate200, discover8/home4, popular tags12, related6.
- Public no-store; no new behavior tracking/private search cache; active durable current public visibility before counts/LIMIT; exact manifest/MD5 and canonical hash checks.
- Strict v1/v2 journal read, v2 write; no old hash rewrite or source/version/preview/ID changes. Old readers reject v2. No notification for same-version alias update.
- One final review and concentrated builder validation including perf5000/1000/1000/2000, native synthetic writes/restore, then PR/CI/exact tree/formal mandatory production readonly headless gate/backups/cleanup.

## Review Focus
- Stored corrupt manifest/body/hash cannot leak through counts/suggestions or skip pages (Task2 parity fixtures).
- Draft aliases cannot appear before explicit publication, including uncertain confirmation and restored retention (Task1 tests).
- Numeric identifiers >MAX_SAFE_INTEGER and ASCII/NFKC normalization must round trip without query widening (Task3 tests).
- Withdrawals between listing/navigation/asset load, bfcache return and delayed suggestions must not reuse stale metadata (Tasks3–5).
- Readonly aggregate savepoint failures, unknown schema and total deadlines must preserve honest partial/error responses (Tasks2–3).

### Task 1: Contracts, aliases and durable v2 publication
**Files:** shared/{discovery-search,public-chart-search,chart-metadata,charts,chart-journal}.ts; db/schema/charts.ts; migrations/0019; charts/{service,publication,publication-journal,workbench}.ts; deletion; backup/chart-replay.ts.
**Interfaces:** normalizeSearchText/query, parseSearchInput; ChartMetadata.aliases?:string[] compatibility; normalizeChartAliases(unknown):string[]; permissionFact v1|v2, retentionFact v1|v2, writers version2.
- [x] Author boundary tests for literal/Unicode/slot/share/cursor and v1/v2 aliases/strict retention before implementation; defer execution.
- [x] Implement aliases columns/default/patch/DTO/compare/publication/retention/deletion/backup replay; leave v1 payload hashes intact and old native parser artifacts unchanged.
- [x] Commit source checkpoint; validation pending.

### Task 2: Shared pre-pagination public integrity
**Files:** migration0019 DB canonical/UTF16/summary/manifest validators; charts/publication.ts; discussions/core.ts; library/core.ts; server/discovery/visibility.ts; parity tests.
**Interfaces:** shared public chart query+predicate+DTO; SQL adxc_manifest_valid(manifest,size,md5), adxc_canonical_jsonb(value), adxc_topic_valid; visible public list hash integrity and durable authors. No new truth projections.
- [x] Write parity fixtures from existing TS validators/canonical hash including corrupt shape/NFC/layout/supplementary Unicode; defer execution.
- [x] Add immutable guarded DB functions and reuse complete predicates in existing public paths and new queries.
- [x] Commit source checkpoint.

### Task 3: Live public search, facets, discovery and XML
**Files:** server/discovery/{query,search,catalog,xml}.ts; api/discovery.ts; api/v1.ts; app.ts; shared/discovery-search.ts; queries/discovery.ts; integration tests.
**Interfaces:** searchPublic(ctx,input):SearchResult grouped statuses; suggest(ctx,q); catalog(ctx,filters) reused old list; authors/tags/random/containingLists/discover; sitemap/feed builders. Scoped cursor algorithm1, integer rank/stable keys; bounded repeatable-read/savepoints/timeouts.
- [x] Write visibility/AND terms/same-slot/pagination/counts/partial failure and stable numeric RSS cases, without execution.
- [x] Implement parameterized queries and public-only DTOs, input limits/facets/rate limit60/min; canonical XML with escaped text and no-store responses.
- [x] Commit source checkpoint.

### Task 4: Complete discovery/search/catalog/directories UI
**Files:** routes search/discover/authors/tags/tag-detail; components discovery-search/advanced-browser; home/public-charts/site-header; routes.ts; three language messages; DOM cases.
**Interfaces:** URL-driven GET fallback, IME-aware suggestions, PublicChartBrowser advanced filters/grid/list, SearchHit reasons/highlight; reuse existing selection/download/follow components.
- [x] Write race/keyboard/mobile/URL/back/noJS/error/partial fixtures; defer execution.
- [x] Implement complete routes, navigation, home sections, directory pagination, independent failure state and provider integrations.
- [x] Commit source checkpoint.

### Task 5: Public alias review, share landing and operations
**Files:** chart-metadata-editor/publication/private-chart-preview/public-chart-detail/user-profile/list/topic views; shared share parser; seo.ts; dash-status; help/privacy; messages.
**Interfaces:** explicit alias draft/public snapshot with confirmation identity; difficulty+t parser, current-version load then clamp+seek without autoplay; canonical copy link; discovered status DTO.
- [x] Write publication-confirmation drift/share invalid slot/async version change and no autoplay cases; defer execution.
- [x] Complete author metadata/review, public related links and sharing, noindex/hreflang, XML/robots, status/perf receipt/help.
- [x] Commit source checkpoint.

### Task 6: Integrated browser/restore/performance and release gate
**Files:** test/acceptance/{browser,production-smoke}.mjs; auth-bridge.ts; release/await-acceptance.py; receipt tests; fresh restore; new perf fixture/runner; docs/verification.
**Interfaces:** preserve all existing mandatory groups and chart1/slot6; add public_discovery_search + authenticated_discovery_library groups. Production readonly; all writes on synthetic fixtures.
- [x] Implement complete alias publish/search/filter/preview/library/download/author/list/forum/share/withdraw/recovery synthetic journey and strict missing-group receipts.
- [x] Prepare bounded performance and v1/v2 native restore assertions without execution.
- [x] One fresh whole-branch static review and necessary fixes, then final candidate checkpoint.

### Task 7: One concentrated verification and formal release
**Files:** release evidence/ledger plus identified fixes only.
- [x] Open release window; configured Linux builder lint/types/unit/PG/DOM/HTTP/build/native/perf/bounded restore and failure correction. Preserve actual evidence; no local heavy work.
- [x] Migration rehearsal and source-data invariants; prebackup; push/attach PR; full CI and exact merged tree.
- [x] Formal community-deploy.py with mandatory logged-in headless receipt + chart1 slot6; accepted marker only on all pass; postbackup and source/serving/accepted/old IDs/roles/session/helper cleanup.
- [x] Final evidence and honest limitations, one complete delivery.

Final release evidence: docs/verification/community-discovery-search-2026-10-19.md. Application106f4f9; external acceptance-label correction e0734eb; formal17groups and postbackup passed.
