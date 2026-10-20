# Community governance and site operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Native execution in the existing isolated worktree, one fresh whole-branch review. User selected the recommended integrated scope and authorized implementation through formal deployment; do not stop between tasks. User override: prepare tests first but run none until the release window.

**Goal:** Complete unified moderation intake, private author appeals, minimal transactional audit and site operations as one delivery.
**Architecture:** Existing reports/decisions and durable publication controls remain authoritative; use bounded read-only unions for intake and owner decision views, a new private appeal table with optimistic revision and snapshot retention, and transactional database triggers for metadata-only audit. Reuse existing outbox and shared UI.
**Tech Stack:** Bun/Hono/React Router/PostgreSQL/Drizzle/packages/ui, no new dependencies.
**Spec:** docs/superpowers/specs/2026-10-20-community-governance-design.md

## Global Constraints
- No tests/install/build/typecheck/dev/browser during development; execute central remote checks only at Task6.
- 20 rows/page +1 sentinel; filters scoped cursors <=4096 bytes. Reason1–1000 Unicode codepoints, resolution1–500, no controls. 5 open appeals/user,5 created/24h, one appeal/decision/user.
- open/upheld/review_required, expectedRevision and exact-result idempotence. Never automatically restore publication or hidden content.
- Current active identity, admin allowlist and recent login for staff writes; private no-store/noindex and three languages/mobile/keyboard.
- New private rows follow existing snapshot RPO; authoritative control journals unchanged. No private content in audit, no visitor tracking, no invented historic records.
- Preserve all17 existing production groups and add governance readonly gate, same formal exact-tree/CI/backups/migration/accepted/cleanup workflow.

## Review Focus
- Switching identity while requests are pending removes loaded private rows/drafts and ignores old responses (Task4 DOM).
- Same timestamp across all3 report sources and changed filters must not skip/duplicate or reuse cursor (Tasks1/2 tests).
- Missing/restored/foreign/undurable decisions never grant appeal eligibility; exact retry after decision deletion remains caller-owned (Task2 DB).
- Concurrent cap checks and contradictory staff retries are serialized, rollback must leave no audit/outbox (Tasks1/2 DB).
- Empty production data cannot substitute for synthetic write acceptance; recovery proves new rows use snapshot RPO without reviving controls (Tasks5/6).

### Task1: Contracts, migration and transactional audit
**Files:** shared/governance.ts; server/db/schema/governance.ts; migrations/0020_community_governance.sql; meta/_journal.json; schema/index.ts; services/social-page.ts; community/site.ts; governance/contracts.test.ts.
**Interfaces:** GovernanceSource=chart|discussion|list; GovernanceDecision/Appeal/Ticket/Audit/Overview DTOs; governanceQuerySchema, appealInputSchema, appealResolutionSchema; governancePage(input,scope) tuple date/id/source.
- [x] Prepare Unicode/control/cursor filter tests and migration audit rollback cases; defer execution.
- [x] Add private appeal/audit tables and metadata-only triggers over existing decision/report/notice/feature writes. Preserve actual actor through transaction-local setting, do not audit readonly requests.
- [x] Commit source checkpoint with tests explicitly unrun.

### Task2: Unified queries, decisions, appeals and notifications
**Files:** server/governance/{core,appeals}.ts and DB cases; discussions/notifications.ts.
**Interfaces:** governanceOverview(ctx); governanceTickets(ctx,input); governanceAudit(ctx,input); governanceDecisions(ctx,userId,input); listAppeals(ctx,input,userId?); createAppeal(ctx,userId,{decisionKey,reason}); resolveAppeal(ctx,actorId,id,{expectedRevision,status,note}).
- [x] Prepare union pagination, permission, journal-barrier, caps, concurrent duplicate/revision, deletion and result notification cases.
- [x] Implement bounded SQL projections and locking, verify decision ownership/durability, reuse outbox with decision public reason and /me/governance link.
- [x] Commit source checkpoint.

### Task3: Authenticated API and scoped client loaders
**Files:** api/governance.ts; api/v1.ts; client/queries/governance.ts; client/lib/governance.ts.
**Interfaces:** /governance/me/{decisions,appeals}; POST /governance/me/appeals; /governance/dash/{overview,tickets,appeals,audit}; POST /governance/dash/appeals/:id/resolution. Strict query/body validation, fresh active user/admin checks, recent staff login.
- [x] Prepare API anonymous/nonadmin/inactive/reauth/no-store/input failure cases.
- [x] Implement typed RPC calls, owner-scoped loaders, identity fencing and no cache of governance pages.
- [x] Commit source checkpoint.

### Task4: Complete private and administrative workflows
**Files:** client/routes/{my-governance,dash-governance,dash-appeals,dash-audit}.tsx; components/governance-ui.tsx; routes.ts; account-menu.tsx; dash.tsx; reports/help/privacy links; messages/{zh,en,ja}.json; test/dom/governance.test.tsx.
**Interfaces:** filtered GET forms, canonical pager links, private decision cards/appeal forms, staff revision-bound review form, stats/audit counts and freshness/snapshot caveat.
- [x] Prepare identity-switch, stale callbacks, unknown results, readonly view, keyboard/three-language mobile cases.
- [x] Implement accessible shared UI and all entry points; keep forms locally scoped, no localStorage, abort/ignore old requests and preserve unconfirmed text.
- [x] Commit source checkpoint.

### Task5: Integration, recovery and mandatory release gate
**Files:** test/acceptance/browser.mjs, production-smoke.mjs; scripts/remote/community-production-smoke.mjs; scripts/remote/lib/* acceptance validator; HTTP/DB/restore tests; docs/verification.
**Interfaces:** governance_ops production group requires owner+admin pages and readonly API200, absence prevents acceptance. Synthetic writes cover reports→moderation→appeal→review→notification, audit rollback and restored snapshot.
- [x] Prepare complete isolated write acceptance and snapshot restore assertions, add production readonly pages and strict receipt negative cases.
- [x] Whole-branch fresh-context review; fix material findings and record test execution pending.
- [x] Commit final candidate.

### Task6: Concentrated remote verification and formal release
**Files:** gitignored release ledger/evidence plus necessary corrections only.
- [ ] Run resource-bounded full Linux builder lint/types/unit/PG/DOM/HTTP/build/native/restore; fix failures and affected reruns. No local heavy execution.
- [ ] Migration transaction rehearsal, baseline/prebackup; push/attach PR; await fullCI and exact merged tested tree.
- [ ] Formal deploy with all required logged-in headless groups and chart1 slot6; accepted only when passed, postbackup/source-serving-accepted/oldlinks/roles/session/helper cleanup.
- [ ] Record exact results and limitations; report complete only after these gates.
