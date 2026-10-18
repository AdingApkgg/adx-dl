# Community collections and reports — development checkpoint (2026-10-18)

Source implementation complete; runtime verification pending. This is **not** a production acceptance report.
Branch `codex/community-collections` is based on the preceding untested/unreleased development commit `aae2fb5`. Both batches need one concentrated remote release-preparation window.

## Implemented

- Private favorites: authenticated numeric-chart state/add/remove and timestamp/UUID cursor list; max1,000/account, idempotent writes serialized on active account. A single bounded batch query applies the existing public authorization to current representations. Withdrawn/moderated/deleted/unavailable charts show only their number and remain removable. Favorites and private query state are scoped to the account.
- Details and navigation: login-aware bookmark/report controls; private `/me/favorites` and `/me/reports`; account-menu links; safe return links preserve the favorites cursor chain.
- Reports: explicit published-version binding, category and1–500 codepoint plain-text details; one immutable submission/reporter/chart/version, max10 per24h and20 open. Duplicate retries recover the first private ticket even after withdrawal. Creating a report never takes down a chart or sends external notifications.
- Admin `/dash/reports`: open/resolved/all filters, admin-only snapshot of previously public title/artist/version, submitted details and current target state. Existing explicit takedown card is reused with unique field IDs per ticket. Final resolution requires a recent login and confirmation; `actioned` requires an independently committed, journal-exported takedown. First final decision and note are immutable; conflicting concurrent decisions refresh rather than claim the new note was saved.
- Private documents, data responses, API reads/writes and denials retain `private, no-store` and `noindex` behavior. Reporter identity is only included as a durable numeric identifier in admin DTOs.

## Persistence and privacy

Additive migration `0015_community_collections.sql` adds `chart_favorites` and `chart_reports`. Drizzle schema, migration journal and matching snapshot are included; metadata was written without running the generator and still needs generator/drift verification.

Both tables are ordinary full-database backup data. Final reporter/account deletion cascades its private favorites/tickets. No chart FK removes the unavailable favorite reference, and no new permission-journal fact is introduced. Durable moderation remains independently retained by the existing moderation table/journal.

A database restore returns favorites and ticket states to that snapshot; a later removed bookmark or closed ticket can reappear privately. This never restores public access: every chart representation is reauthorized against the existing publication/revocation journal. Restored tickets do not enforce any automatic action. Fresh-volume restore coverage for these cases is mandatory before release and has not run.

## Static review and prepared cases

Independent static review found missing JSON CSRF headers on bodyless favorite writes and incompatible cursor formats during favorites/detail return navigation. Both were corrected and received a bounded static recheck. Migration/schema/snapshot and existing full-dump/account-deletion integration were inspected statically.

Prepared cases cover scoped cursors, Unicode/report validation, favorites isolation and unavailable removals, concurrent favorite caps, report duplicate/version/daily/open caps, independent durable moderation, immutable resolution, account-deletion cascades, anonymous private-route headers, JSON write headers and detail-return pagination. Relevant old fixtures were adapted. No test result is claimed.

**Not executed:** tests, lint, typecheck, i18n generation, migration/schema generation or execution, builds, dev servers, real browser checks, backup/restore jobs, CI, push or deployment. Only source/static review, copy-reference inventory and Git whitespace checks were performed locally.

## Pending release gates

Concentrated remote verification of both development batches; migration0015 and generator metadata drift; real browser favorites/report/admin/reauth/error and mobile/three-language flows; full fresh-volume restore with private rows, account deletion and revoked/anonymous publications; existing uploads/publication/legacy links/login/baseline storage compatibility. Fix failures against the final source and separately obtain/observe release authorization before pushing or deploying.
