# Creator workbench, import queue and version review implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user authorized continuous implementation and one complete release.

**Goal:** Complete the private author journey from explicitly mapped imports through source review, version comparison and deliberate publication.
**Architecture:** Reuse the existing chart/source/version truth and format=1 derivatives; derive owner-only projections and bounded browser analysis. A root-scoped import coordinator owns upload concurrency, local metadata and identity fencing independently of downloads.
**Tech Stack:** React Router, Hono, PostgreSQL/Drizzle, Web Workers, existing Simai engine, packages/ui.
**Spec:** docs/planning/2026-10-19-community-author-workbench.md

## Global Constraints
- No install/build/test execution during development. Write regression cases first; execute all validation on the designated builder in the final release window. Never claim unexecuted tests passed.
- One delivery. Existing 50 charts/20 versions; 64 MiB archive/128 MiB expanded/128 entries/1 MiB maidata; parser 100000 notes/1 hour remain unchanged.
- Batch 10 rows/256 MiB raw/one unfinished batch/24h; one pack/hash/upload executor; explicit row mapping, save and publication.
- No raw bytes/source/credentials in local persistence; no new durable business model or public history. Owner authorization on every private resource; admin has no private override.
- One analysis worker and player/audio context; comparison 20000 units/side,1000 hunks,5 seconds,2 MiB source; source following at most50000 points and search200 results.
- Keep all existing acceptance groups; add mandatory author groups and rejection receipts before formal deployment.

## Review Focus
- Identity invalidation between hashing, lease renewal and save response must suspend old scope until fresh identity success (Task3 tests).
- BOM/CRLF/header normalization and legacy metadata reorder must map real original positions and central parser timing (Task1 tests).
- Lost create/append responses and deleted restored records must reconcile bindings without creating replacements (Task3 tests).
- Large or adversarial statement differences must terminate within the budget and identify incomplete detail honestly (Task4 tests).
- Saved metadata/publication changes while a confirmation is open must invalidate it, with no accidental notifications (Task6 tests).

### Task 1: Source positions and central statement events
**Files:** shared/charts-maidata.ts; engine core/parser/SimaiParser.ts; client/author/analysis.ts; matching .test.ts files.
**Interfaces:** Produces normalizeChartMaidataWithMap(text) with UTF16 original offsets; optional SimaiParseOptions.onStatement events with body span and lead-adjusted beat/time; analyzeMaidata(source,difficulty) bounded derived source/diagnostics/statements/BPM.
- [x] Write regression tests for BOM, CRLF, mixed header case, legacy reorder, surrogate columns, multi-difficulty, BPM/divisor changes, first/lead offsets and old-call compatibility.
- [x] Implement optional callbacks and exact body offset mapping without changing default parser/normalizer results.
- [x] At release run the source/analysis tests remotely; expect all cases pass and old summary fixtures unchanged.
- [x] Commit source checkpoint without claiming validation.

### Task 2: Owner projection, fingerprints and binding reconciliation
**Files:** shared/author-workbench.ts; server/charts/workbench.ts; server/api/charts.ts; client/queries/charts.ts; server/charts/workbench.test.ts.
**Interfaces:** workbench projection contains bounded chart summaries, counts, version slots, flags, usage and cursor; fingerprint(chartId,versionId) returns source hash/size and role hash/size/mime only; binding(fileId) returns existing owned live chart/version or explicit unavailable/unbound status.
- [x] Write owner/nonowner/inactive/deleted, combined-filter pagination, hidden/pending/metadata drift, caps and binding tests.
- [x] Implement a consistent bounded projection, per-version authorization and minimal DTOs with no storage keys or new tables.
- [x] At release run database/HTTP cases; expect no cross-owner data and no writes from reports.
- [x] Commit source checkpoint.

### Task 3: Global upload coordinator and durable local plan
**Files:** client/imports/{model,persistence,store,provider}.ts(x); components/chart-upload.tsx; components/app-providers.tsx; routes/imports.tsx; matching tests.
**Interfaces:** ImportStore scoped to fresh active me owns rows, Files in memory only, controller lease and epoch; add/confirm/start/save/reconcile/cancel/reselect transitions. Existing single upload calls run under the same exclusive executor.
- [x] Write state/persistence/DOM cases for10/256 limits, identical hash+size, duplicate append targets,409, partial save, lost response, refresh/no auto resume, expiry,IDB errors,fencing,signout and stale callbacks.
- [x] Implement explicit package/parts/folder groups, serial preparation and uploads, metadata-only persistence, WebLocks/IDB per-operation fence, guarded row transactions and safe recovery.
- [x] Integrate old single inputs with the root coordinator and global dock; preserve current-page single fallback if persistence/locks unavailable.
- [x] At release execute queue and native browser synthetic writes; expect correct row results and no automatic publication.
- [x] Commit source checkpoint.

### Task 4: Bounded worker analysis and comparison
**Files:** client/author/{analysis-worker,worker-client,compare}.ts; client/components/{simai-source,author-analysis}.tsx; matching tests.
**Interfaces:** worker messages carry scope/chart/version/difficulty/fingerprint/algorithm identity; compareStatements(left,right,budget) returns full hunks or explicit summary fallback; source view virtualizes original lines and capped search, accessible seek/follow.
- [x] Write budget, worker cancellation, source mapping, diff/format/asset identity and noaudio/unsupported tests.
- [x] Implement one abortable worker, sequential parsing, bounded diff and virtual source pane; no second grammar scanner or clock.
- [x] At release run unit/DOM/browser resource scenarios; expect only one worker/player/audio context and stale results ignored.
- [x] Commit source checkpoint.

### Task 5: Workbench and private review/compare pages
**Files:** client/routes/{workbench,chart-review,chart-compare}.tsx; client/routes.ts; components/private-chart-preview.tsx; lib/chart-preview-player.ts; navigation and route tests.
**Interfaces:** /me/workbench, /me/imports, /me/charts/:id/review and /compare; selected review versions do not mutate currentVersionId. Player position/seek uses TimingTimeline and existing audio offsets.
- [x] Write owner loaders, empty/error/filter/page, keyboard follow/seek, version change/navigation disposal and same-chart selection tests.
- [x] Implement bounded server projection UI, quota and local import counts; report distinctions, source pane and one switchable comparison player.
- [x] At release validate320/390/desktop and public/private denial; expect no private analysis in public responses.
- [x] Commit source checkpoint.

### Task 6: Publication review and editable release-note draft
**Files:** components/chart-publication.tsx; routes/chart-detail.tsx; client/author/release-note.ts; matching tests.
**Interfaces:** existing publish mutation remains authoritative; confirmation key includes revision/version/savedmetadata/publication; generated note stays local until explicit save and never overwrites an existing note.
- [x] Write tests for changed confirmation, ambiguous response reconciliation, warnings advisory, generated-note persistence and no automatic publishing/notifications.
- [x] Integrate review/compare links, chosen source fingerprints/diagnostics and saved note with explicit canonical result link.
- [x] At release run publication regression/native workflow; expect original revision/control/durability semantics.
- [x] Commit source checkpoint.

### Task 7: Localization, help, formal readonly gate and end-to-end coverage
**Files:** messages/{zh-CN,en,ja}.json; route/help/privacy copy; test/acceptance; test/http; scripts/remote community deployment gate/receipt modules and tests.
**Interfaces:** new author mandatory receipt groups join existing12; production bridge provides owner-only existing IDs; no production writes. Synthetic acceptance covers complete writes and native restore.
- [x] Add three-language strings, help/privacy statements and complete browser scenario assertions including all Review Focus cases.
- [x] Extend readonly gate, required groups and missing-group negative receipt tests; preserve session revocation/helper cleanup requirements.
- [x] Review whole branch once with a fresh reviewer; resolve Important/Critical issues with reproductions in the release validation window.
- [x] Commit final candidate.

### Task 8: Concentrated verification and one formal release
**Files:** own gitignored ledger/evidence and necessary fixes; deployment runbook updates.
**Interfaces:** exact tested tree → PR/CI → merged pre → full community-deploy.py → mandatory readonly gate → accepted marker → post-backup.
- [x] On designated builder run lint,types,unit,PG,DOM,HTTP,build,isolated native Chromium,bounded-disk restore and role/WAL checks; inspect every outcome and fix failures. No local heavy execution.
- [ ] Push candidate/attach PR; wait full CI and verify merged tree matches tested tree. Readonly production baseline and migration rehearsal (none expected), full pre-backup.
- [ ] Execute formal deployment and new/old mandatory auth gates, revoke temporary sessions, clean helpers,verify source/serving/accepted and old numeric/UUID redirects,post-backup.
- [ ] Record exact evidence, cleanup and any honest unavailable production second-version comparison; mark delivery complete only after all required gates pass.
