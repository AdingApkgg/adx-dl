# Community platform and unified discussions: development checkpoint

2026-10-18. Source implementation is recorded on `codex/community-platform-v1` from `e0757cd` in the isolated `community-role-recovery` worktree. **Runtime verification and release are pending.** This is not a production acceptance report.

Both approved designs were implemented as one continuous source task: [platform design](../superpowers/specs/2026-10-18-community-platform-v1-design.md) and [unified discussion design](../superpowers/specs/2026-10-18-community-discussions-forum-design.md). The second design governs comments, forum, notifications and discussion moderation. Earlier development batches `aae2fb5`, `e96f3b2` and `d465a77` remain unverified/unreleased and belong to the same eventual release candidate.

## Source delivered

- Author workbench: private introduction/credits/tags and per-file-version release notes, optimistic revision/conflict comparison, lost-response reconciliation and unsaved-input protection. Explicit publication copies these fields into public snapshots; current/selected versions compare assets, size and available import summaries. Existing summaries are not reimported; absent designer data remains unknown.
- Discovery: public snapshot tags and difficulty designers join bounded server search; tag suggestions and related charts use current public visibility. Homepage search/latest8/featured6/notices, author works, canonical numeric share/OG and detail text retain public/private separation.
- Unified discussions: current-public-file-version comments, one reply depth, optional difficulty/timepoints and paused preview navigation; native numeric-ID forum with3 seeded boards, literal bounded search, separate content/control revisions, safe allowlist Markdown roots, plain replies, subscriptions and linked current-public charts.
- Personal inbox and history: private topics/replies/subscriptions/report tickets, scoped focus links, direct-reply preference, grouped unread subscriptions, durable export-gated bounded outbox, de-duplicated delivery and read controls. No polling or external notifications.
- Community administration: unified report handling and hide, whole-topic hide, lock/pin/move, board settings/read-only, public reasons separate from internal notes; private draft/publish/withdraw notices, ordered current-public featured references, recent-login checks and identity guards. Three-language help and navigation follow local web-site presentation conventions; no third-party Artalk identity/content migration.
- Additive migration0016, typed schema and manually prepared snapshot/journal metadata; new bodyless community facts, permanent forum numeric reservations, compatible journal writer/readers, restore/deletion hooks and existing worker queue integration. No new dependency for Markdown or discussions.

## Visibility and recovery decisions

Comments bind current published file version; old-version query paths remain closed. Same file version may recover lawful discussion on explicit republish. Topic root withdrawal removes root title/body, locks and removes the topic from discovery, while lawful third-party replies can remain on its direct numeric URL. Admin whole-topic hide overrides all children.

A restored body must match its newest durable content revision/hash before visibility; newer bodyless facts never reconstruct missing content. Content and control facts remain independent. Hidden/deleted facts are terminal; root_removed may only advance to hidden. Topic identities survive missing/withdrawn content and sequence recovery, preventing URL reassignment.

Automatic report evidence expires30days after creation, never extends on closure, and clears when either involved account finally purges. Private user inbox/subscriptions/history use current identity boundaries. A restore marks old pending outbox rows complete before admission because old delivery receipts can be absent; this prevents historical re-delivery and accepts missing historical inbox events within the backup RPO.

## Static review and source fixes

Independent author-domain and whole-change source reviews identified and prompted corrections for immutable legacy journal payload defaults, >8MiB export backlogs, numeric chart-reference matching, uncertain-create readback after target loss, stale restored outbox dispatch, parent-author pending-deletion races, private admin identity changes, published-version pagination, conflict/draft preservation, and whole-topic hiding of removed roots. Source fixes and prepared regression cases are recorded. The final independent bounded reread found the reported fixes present and no remaining/new concrete P1/P2 within that scope. No runtime validation was performed. Notice lost-response readback and old-backup terminal/revision handling also received a focused source reread.

The root's static message inventory found752 keys in each zh/en/ja catalog, equal key sets and no missing literal client message reference. JSON parsing/source inventory and Git whitespace checks do not prove generated messages, TypeScript, SQL or browser behavior.

## Prepared validation, not executed

Meaningful pure/service/publication/replay/DOM test sources were added or adapted for metadata, public filtering, editing, sharing, legacy journal bytes, bounded batches and notice/fact validation. [Combined acceptance matrix](community-platform-cases-2026-10-18.md) includes backend/client boundaries, concurrency, recovery and browser scenarios. These cases are **not executed**.

Per user instruction, no tests, lint, typecheck, i18n/route generation, dependency installation, build, preview/dev service, browser session, migration execution, remote operation, CI, push or deployment ran during development. No production state was inspected or changed. All product changes remain in the isolated feature branch; the main checkout retains its unrelated files.

## Concentrated release gates

1. On the configured remote build machine, inspect actual host/ref/remote workspace before synchronization. Preserve unrelated files. Validate all four development batches together, including frozen dependencies/lock edge, generated i18n/types, changed source lint/type checks, meaningful tests and real builds. Repair failures against the final candidate.
2. Check migration0015/0016 generator drift, SQL/typed-schema/snapshot parity, fresh and upgraded databases, roles and all new journal readers before writers. Hand-authored snapshot metadata is not generator verification. Migrations have not run; rehearse against copied data before production writes.
3. Exercise crash export, bounded backlog, old-backup/new-fact restore, permanent numeric reservations, deletion/evidence/no-resurrection and historical outbox suppression. Validate existing storage/upload/download/backups and authentication together.
4. Real browser acceptance in zh/en/ja, mobile/desktop/dark/keyboard: author edit→compare→publish→browse→comment/reply/timepoint→forum/reference/subscription→inbox/report→admin action, including conflict, network loss, version change and account-switch paths. Existing3 upload modes and legacy links remain regression gates.
5. Only after concentrated validation and fixes, prepare reviewed candidate/backup/rollback evidence for the user's release authorization. Community release targets `pre`; main web-site `main` is a separate release. Once community_content facts exist, rollback must retain compatible readers/restore tools. Deployment completion additionally requires deployed revision/health and public-browser acceptance.

Source completion, passing checks, browser acceptance and production release are separate statuses.
