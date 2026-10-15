# Community Public Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作者明确公开一个版本，访客浏览、预览、下载，撤回和恢复均保护私有内容。

**Architecture:** 独立 publication 表保存版本与文字快照，沿用 Chart revision 和存储锁。公开读取每次核验发布许可；复用现有资产切片和原件流，不复制文件。扩展独立加密日志和注销处理，防止旧备份复活公开许可。

**Tech Stack:** Existing React Router, Hono, Drizzle/PostgreSQL, Bun, pg-boss, S3 driver, shared UI, Paraglide; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-16-community-public-charts-design.md`

## Global Constraints

- Mac only read/edit/git/light changed-file lint. All execution/build/typecheck/browser tests on guarded `localhost-1` through `scripts/remote/verify.sh`; preserve configured proxy.
- Isolated managed worktree, `codex/community-public-charts` from `pre`; no main edits, production operations, push, merge or deployment in this feature task.
- Default page 24, max 50; one published version per chart; private no-store on every public API and page response, including errors.
- CAS expectedRevision; explicit `confirmOriginalArchive: true`; unchanged publish and already-withdrawn operations idempotent; no automatic private edits published.
- Match web main's responsive square-cover grid and difficulty pills using community components. Three languages; on-demand preview; safe original ZIP filename.
- Ownership remains required for all mutations; retained publications anonymous after final deletion, private versions purged. Old snapshots cannot revive superseded/withdrawn permissions.

## Review Focus

- Replayed withdrawal or replacement from an older database snapshot must not restore prior version access (Task 1 recovery tests).
- Pending-deletion owner and anonymously retained owner-null are distinct; only the latter stays public (Task 1 lifecycle tests).
- Conditional HEAD/304 and Range requests after withdrawal must still return 404 (Task 1 HTTP tests).
- Ambiguous successful publication response must cause read-back rather than write replay; concurrent edit keeps unsaved intent (Task 2 DOM tests).
- Empty catalog, missing cover/audio, unsupported difficulty and narrow viewport must remain usable (Task 2 DOM and Task 3 browser tests).

---

### Task 1: Publication backend, recovery and account lifecycle

**Files:**
- Create `src/server/charts/publication.ts`, `src/server/api/public-charts.ts`, `src/server/charts/publication.test.ts` under `apps/community`.
- Modify shared/charts.ts, server/db/schema/charts.ts, storage.ts and migration metadata; server/api/charts.ts, app.ts, charts/service.ts, assets.ts, deletion.ts; storage/deletion.ts, references.ts; ops/backup/journal.ts, restore.ts and focused tests.

**Interfaces:**
- Produces `ChartPublicationDto = { versionId,title,artist,publishedAt,updatedAt }`; `ChartDto.publication: ChartPublicationDto | null` (optional transitional typing permitted only for test fixtures).
- Produces `PublicChartDto = { id,title,artist,versionId,ordinal,summary,sourceSize,publishedAt,updatedAt,author: {id,name,image}|null }` and `PublicChartsPageDto = {items,nextCursor}`; no storage keys/sourceFileId.
- Produces publish/withdraw routes exactly as spec; PUT body `{expectedRevision,versionId,confirmOriginalArchive:true}`, DELETE `{expectedRevision}`. GET catalog/detail and GET/HEAD asset/download paths as spec.
- Existing service signatures stay compatible; published versions return `CHART_PUBLISHED_VERSION` on deletion, whole-chart deletion withdraws atomically.
- Journal extension must be version/shape validated and backwards compatible with existing encrypted segments and dump migrations. Successful revocations must cross independent durable exporter barrier; failures close access safely and allow same operation retry.

- [ ] **Step 1:** Add failing integration tests for private default; selected-version publication; metadata snapshot; CAS/idempotency; original confirmation; foreign/blocked/unready files; publication deletion guard; cursor bounds; anonymous DTO privacy; download HEAD/Range/conditional and withdraw 404; finite anonymous stream concurrency and cancel release.
- [ ] **Step 2:** Run new focused tests remotely against isolated `_test` PostgreSQL and Redis. Expected failure before publication implementation. Capture RED command/output.
- [ ] **Step 3:** Implement schema and additive migration (owner nullable SET NULL; publication composite FK), public services, bounded streams/IP limits, API mounts and DTO. Reuse current storage representation where safe; no copying/caching.
- [ ] **Step 4:** Add and observe failing tests for account pending/cancel; purge with retain/delete; retained File references through sweep; old backup replay after withdrawal/replacement/anonymous retention; missing current permitted version closes access; failed exporter never returns successful withdrawal.
- [ ] **Step 5:** Implement durable journal extension, targeted replay and chart/storage deletion changes. Preserve independent hash-chain validation, 90-day journal retention and prior media semantics. Avoid late journal export races by persisting exact facts under existing transactions then verifying/exporting through existing barrier with retry-safe state.
- [ ] **Step 6:** Run focused backend, existing private chart and backup/journal tests; community typecheck remotely. Expected all pass; meaningful assertions for all Review Focus backend cases. Generate migration with remote Drizzle rather than hand-edit snapshot inconsistently.
- [ ] **Step 7:** Self-review and commit `feat(community): add public chart publication and recovery safety`.

### Task 2: Public browsing and author publishing UI

**Files:**
- Create client/routes/public-charts.tsx, public-chart-detail.tsx; client/queries/public-charts.ts; client/components/chart-publication.tsx; focused DOM tests.
- Modify client/routes.ts, components/site-header.tsx, routes/home.tsx, chart-detail.tsx, private-chart-preview.tsx, queries/charts.ts, lib/chart-errors.ts, messages/{zh-CN,en,ja}.json (use actual existing locale filename).

**Interfaces:**
- Consumes Task 1 DTOs and endpoints. `publicChartAssetUrl(id,versionId,role)` mirrors private helper using `/api/v1/charts`.
- Preview accepts optional `assetUrl` resolver with private default, stable callback, public errors never redirect to login.
- SSR loaders use apiContext/QueryClient/API only, return no-store headers, fresh data per navigation. Detail metadata derives only publication snapshot; invalid/missing pages 404 noindex. No new sitemap unless existing one needs integration.

- [ ] **Step 1:** Read web chart-card/grid and detail/preview UI as reference, existing community loaders/DOM fixtures. Add failing DOM tests: explicit selected version and ZIP warning/confirmation; lost response reads publication; conflict refresh; published version cannot delete; withdrawal; catalog card links/fallbacks/pagination; public preview uses public URLs with no private fallback.
- [ ] **Step 2:** Run DOM tests remotely; expected failure for missing UI.
- [ ] **Step 3:** Implement translated author controls and public pages. Square cover, responsive 2/3/4/6 columns, clear title/artist/author/difficulty; accessible labels and keyboard links. Current public snapshot survives private edits; no misleading success on 409. Download original ZIP via safe server route. Add discoverable home/header links; retain private CRUD flows.
- [ ] **Step 4:** Run focused DOM tests plus existing chart editor/preview/header tests; remote i18n/typegen/typecheck and build. Expected all pass.
- [ ] **Step 5:** Self-review and commit `feat(community): add public chart catalog and publishing controls`.

### Task 3: End-to-end verification and independent review

**Files:**
- Extend existing `test/ops`/`test/http`/browser smoke harness with real public flow; add public-safe `docs/verification/community-public-charts-2026-10-16.md`.

**Interfaces:**
- Consumes complete Task 1/2 routes and existing synthetic ZIP/upload/fresh-volume restore harness. Must exercise built app with real object driver and browser on builder, not Mac.

- [ ] **Step 1:** Add browser assertions for author publish, anonymous catalog→detail→preview→ZIP, private nonpublished version denial, metadata edit snapshot stability, withdrawal and old-URL HEAD/Range/304 denial. Include mobile viewport and missing optional media.
- [ ] **Step 2:** Run complete appropriate community checks/build/HTTP/DOM and fresh-volume recovery with isolated services on builder. Expected all green; retain precise command/output, distinguish any device/browser limits.
- [ ] **Step 3:** Commit tests and verification report, generate whole-branch review package against `9bff56b`, dispatch fresh review. Fix material findings with reproducing tests and rerun affected suite.
- [ ] **Step 4:** Confirm clean worktree and report completed local branch/tests/limitations; no production deployment.

## Execution authorization

User explicitly approved complete design and said “按你的建议做，参考 web 主站”; choose task-by-task subagent execution here with scoped reviews. No additional plan permission round. No production credentials or real-user data in tests.
