# Community Content UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. User has authorized one integrated delivery; development tests are deferred to the release window.

**Goal:** Complete a coherent chart detail, forum, and creator-workbench refinement and release it through the existing production gate.

**Architecture:** Preserve loaders, API contracts and business guards. Reorganize existing data and controls using the current shell, optional summary preview callback and URL filters. No schema or dependency changes.

**Tech Stack:** React Router, React, TanStack Query, Paraglide, @astrodx/ui.

**Spec:** docs/superpowers/specs/2026-10-20-community-content-ux-design.md

## Global Constraints

- User instruction overrides incremental TDD: no tests/build/install/preview during development; only centralized release verification afterward.
- Mac is not the build machine; remote verify and hosted CI only for heavy work.
- Keep original snapshots, slot6 preview, roles, identifiers, restore/revocation semantics and readonly authenticated production acceptance.
- One coherent delivery; no new product APIs or one-click publishing.

## Review Focus

- Stale preview events must be rejected by chart/version scope; unsupported slots remain visible without active buttons.
- Board switch must preserve filters and clear cursor without losing localized pathname.
- Locked/removed topics retain state/restore and no reply affordance masquerades as writable.
- Empty/error/stale workbench data and changed-account imports must not leak prior actor information.
- Long multilingual strings, reserved quota and 320px layouts must wrap; header/bottom nav must not cover controls.

### Task 1: Chart detail and shared visual patterns

Files: public-chart-detail.tsx, chart-summary.tsx, chart-discussion.tsx, app.css, messages/{zh,en,ja}.json.
- [x] Reorganize hero, metadata and contents anchors; preserve return state and lazy preview.
- [x] Add optional ChartSummary onPreview(difficulty) callback; use existing scoped seek event for public chart slot cards, preserve private summary default.
- [x] Prepare DOM/native assertions for scoped supported/unsupported slot actions and content order; do not run yet.

### Task 2: Forum browsing, reading and composition

Files: forum.tsx, forum-topic.tsx, forum-new.tsx, discussion-ui.tsx, discussion-topic-editor.tsx, app.css, messages.
- [x] Board links preserve existing recognized filters except cursor; provide clear filters and advanced chart control.
- [x] Compact topic rows, distinct list groups, readable topic main and composer, remove duplicate share action only.
- [x] Preserve draft/identity/conflict/reply/report/restore controls; prepare query/empty/locked regressions without running.

### Task 3: Creator workbench

Files: workbench.tsx, app.css, messages.
- [x] Four key counts plus three actionable filter links; use URL parameters and clear cursor/history on scope change.
- [x] Show quota from server with accessible bounded meter and original numeric used/reserved information.
- [x] Structure chart cards with explicit status/version comparison/edit/review/compare/publication actions; empty/error/retry retained.
- [x] Prepare DOM/native assertions for query links, quota, actor isolation and mobile geometry without running.

### Task 4: One review and centralized release

Files: UI native acceptance helper, production-smoke.mjs, docs/verification/community-content-ux-2026-10-20.md.
- [ ] One independent static branch review, address material findings; changed-file lint/diff checks only during development.
- [ ] Enter release window: designated remote centralized verification, then PR hosted CI native business/UI and fresh-volume restore; fix actual failures and confirm tested merge tree.
- [ ] Prebackup; formal community-deploy.py; all production groups including extended readonly detail/forum/workbench geometry/controls; postbackup and invariants.
- [ ] Archive private evidence, clean own bounded resources, record release/CI/backup/legacy links and exact browser-vs-device limits; final docs commit.
