# Community platform and unified discussions implementation plan

> Use subagent-driven-development with explicit file ownership for independent domains and a final static whole-change review. User prohibits development test execution.

Goal: Both approved full designs, continuously, with real persistence/API/UI/recovery and no production operations.
Specs: ../specs/2026-10-18-community-platform-v1-design.md and ../specs/2026-10-18-community-discussions-forum-design.md (discussion override).
Base e0757cd; existing isolated worktree; branch codex/community-platform-v1.
Architecture: existing Postgres/Drizzle/Hono/React Router and UI; per-domain services, bounded authenticated RPC/REST; one generic no-body content-fact projection for public community content; existing encrypted journal/export barrier; outbox runs on existing worker.

## Global constraints
No tests/lint/typecheck/install/build/preview/browser/remote/CI/push/deploy. Prepare meaningful cases but do not run. Three earlier local batches remain unverified. No main-site changes. Private endpoints/documents no-store/noindex. New readers/export/restore must support new journal before new writes. Migrations after0015, legacy empty publication metadata, additive schema. Source completion never implies acceptance.

## Tasks and ownership
- [x] Foundation (root): shared/community-content-journal.ts; db/schema/community-content.ts; server/community/content-journal.ts; ops/backup journal and replay integration. Generic recordCommunityFact/readCommunityFact/awaitCommunityJournal/communityHash/allocateForumId interfaces are binding. Replay IDs and all facts before public opening; deletion hooks.
- [x] Author/publication/discovery (platform_author): private metadata/release note, schema columns, explicit public snapshot with legacy defaults, comparison UI/reconcile, private list filters, public tags/designer/related. Translation/SQL fragments; root merges migrations and messages.
- [x] Discussion backend (platform_discussion_backend): shared/discussions.ts and HTTP contract first; schema/discussions.ts, server/discussions/** and api/discussions.ts; all current-version comments/timepoints, forum, numeric identity, controls, moderation/reports/evidence, notifications/outbox/deletion. Root mounts/wires. Translation/SQL fragments.
- [x] Discussion client (next implementer): use stable backend contract; query helpers, forum/comment/personal/admin React routes and components, pure limited-Markdown render, preview anchor integration. Root owns global navigation/router/messages.
- [x] Site content/ops (root): notices/featured service/schema/API, home/discovery integration, dash pages, three-language help, global navigation, migrations/journal metadata and worker/deletion/replay wiring.
- [x] Static review and fixes: per-domain source review when ready, then fresh broad review; no runtime commands. Development receipt, local checkpoints, ledger and pending release checks.

## Review focus
Authorization closure across every list/count/search/context/notification; missing latest content on old backup; root-placeholder vs whole-topic hidden; direct-over-subscribe and out-of-order outbox; bodyless control facts cannot revive hidden content. Capacity/Unicode/cursor bounds; current version changed while writing; lost mutation responses. Prepared source cases and release checklist pin these, runtime remains pending.

## Source completion record
All boxes mark source work and static review only; no runtime acceptance. Author/backend/client domains completed, root infrastructure/notice/discovery/route/locale/recovery integrations completed, independent findings fixed and bounded reread found no remaining concrete P1/P2. See docs/verification/community-platform-development-2026-10-18.md and the combined prepared-case matrix. Tests/build/migrations/browser/remote/CI/push/deploy remain deferred. Expanded scope is one coherent release candidate together with the prior three unverified batches.
