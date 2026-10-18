# Community platform: prepared acceptance matrix (2026-10-18)

All cases are prepared and **NOT EXECUTED**. This document does not establish passing behavior. The user deferred tests and runtime validation until release preparation.

---

# Author/publication/discovery cases prepared, not run

All source work and prepared test code are unverified. No tests, lint, typecheck, install, build, dev, browser, remote, push, migration execution or deployment was run in this domain.

## Metadata and concurrency
- Unicode description lengths 0/2000/2001, credits and notes 0/1000/1001; emoji count as one code point. Reject NUL and unpaired surrogate input before PostgreSQL.
- Tags empty/8/9 unique (up to 64 bounded raw entries before deduplication), 1/20/21 code points, original full-width display label retained, NFKC + ASCII-case keys deduplicate, first label retained. Reject raw/normalized slashes, controls, format controls, URLs; literal plain text never renders markup.
- Every metadata/note update locks owner+chart, checks expected revision, increments chart revision. Notes cannot reference another chart or deleted version. Editing a note on a currently published version leaves the public release-note snapshot unchanged.
- Concurrent edit produces 409 and retains local input, shows current server differences, keeps captured base revision until explicit review. Lost response reads back all metadata + note; no blind retry. Save, upload and publish remain separate operations.
- Unsaved metadata blocks client navigation and browser close; no localStorage copy. Version note selector cannot silently discard unsaved text. Explicit discard loads current server values. Publication controls remain disabled until saved.

## Publication and legacy journal
- Publication copies description/credits/tags/selected releaseNote in same transaction and permission fact; identical republish is replay-safe. A different revision or different selected-version note conflicts. Retained anonymous works replace unpublished draft metadata and version notes with the current public snapshot.
- Legacy permission/moderation/retention facts missing additions parse empty strings/arrays; they never synthesize values from current draft.
- Current and selected comparison shows version number, size, assets, difficulties, raw levels, designer, notes/duration (unknown when absent), and both metadata/note snapshots. Identical summary is not represented as identical file content. Any revision change resets confirmation.
- Lost publish response only succeeds after current publication DTO matches every intended field and publicationPending is false; incomplete exporter remains pending. Withdraw/delete/retention must preserve existing permission semantics.
- Restore old DB + newer chart permission facts, including same-version metadata republish, withdrawn records, retained anonymous charts and moderation publication snapshots. Root integrates replay column writes, retained private metadata cleanup and numbered-restoration permission facts.

## Discovery and public rendering
- Private 20-item lists filter title/artist and draft/published; cursor binds owner/query/status, rejects different filters/account, uses time+ID ties. Filter changes reset cursor without issuing old-scope cursor requests.
- Public search includes only current snapshot tags and immutable per-difficulty designer summaries, never private metadata or release notes. Keyword/difficulty/tag/author/sort remain in URL and cursor scope; back navigation accepts tag parameter.
- Suggestions return <=20 current-visible normalized keys + public display labels/counts; query <=20 code points before and after normalization, deterministic count+key ordering. Hidden/withdrawn/deleting-account/blocked-asset/unexported charts do not contribute.
- Related list <=6 excludes self and inaccessible targets; common current-public tag count then updatedAt+ID ordering. Source authorization is included again in candidate SQL, preventing a withdrawn source from acting as a tag oracle. No tags/no matches offers author works only; API failure is distinct from empty.
- Public text renders escaped with preserved line breaks. Share/description/OG come only from current publication; copied URL uses canonical numeric chart ID and no pagination/private state.
- Cover preview/download/favorites/report flow remains intact; tag links are siblings of card primary link, avoiding nested anchors. Author works include the same search form and tag filters.
- Three locales, narrow/desktop layouts, keyboard focus, stale API 404/409/503 states remain release acceptance gates.

## Prepared test source files
- shared/chart-metadata.test.ts; shared/public-chart-search.test.ts; client/lib/public-chart-navigation.test.ts
- server/charts/service.test.ts; server/charts/publication.test.ts
- ops/backup/chart-metadata-replay.test.ts
- test/dom/chart-editor.test.tsx; test/dom/public-charts.test.tsx; test/dom/chart-community-actions.test.tsx; test/dom/share-chart-button.test.tsx

## Author integration notes (root wiring completed)
- Merge author-messages.json (zh/en/ja) into global locale catalogs and generate Paraglide only in the later authorized remote validation phase.
- Incorporate author-migration.sql into root-owned next migration + snapshot metadata; Drizzle chart schema carries matching checks/index.
- Root integrates parsed snapshot metadata in direct replay, retained private cleanup and numbered-restoration replacement facts. author replay test cases cover binding/default behavior; all remain unexecuted.
- Owned typed DTO fixtures and ShareChartButton props were adapted, and focused pure/service/publication/replay/DOM cases were prepared. Root also adapted the home fixture. None were executed.
- Designer is newly extracted from &des_<difficulty>, falling back to &des, for newly imported summaries. Old summaries show unknown/no designer rather than reparsing assets at request time; source-bound recipe digest changes automatically.

---

# Prepared discussion backend cases (NOT executed)

- Anonymous boards/topic/chart reads; private requests 401; pending deletion/disabled active row checks; dashboard role + recent login; strict unknown-property rejection and Unicode point boundaries.
- Create topic/reply/root with same key + same payload recovers original ID and journal barrier; same key + changed target/body yields 409, no ID/row allocated; cross-kind collision also 409.
- Parallel account create caps: all new posts share 10-second cooldown, topic 5/24h and replies/comments 50/24h, live topics 200 and messages 1000, topic lifetime replies 1000, edit 5/minute. Reporting via BOTH old chart and new discussion endpoint shares 10/24h and 20 open.
- Current-version chart writes/pages/focus only; race publication rechecked under locked chart/publication row; withdrawal/moderation/pending owner hides all discussion access. Difficulty derives current summary, timestamp integer within engine duration; reply inherits root, null difficulty/time edit clears vs omitted preserves.
- Deleted/hidden/pending/mismatched chart root returns generic placeholder only with valid visible descendants; root's legal third-party descendants persist, no old body/identity. Missing focus and foreign-context message IDs fail 404.
- Forum content and control facts independently match revisions and export barriers; withdrawn root preserves legal third-party replies on direct numeric URL, disables new replies, exits discovery/search/statistics/related; hidden topic blocks all descendants. Hash mismatch old-backup root is repairable by active owner via explicit new revision; newest hidden/deleted facts remain terminal.
- Scope-bound cursor change for board/query/sort/unanswered/chart/pin set yields reload conflict; escaped literal SQL search avoids wildcard semantics; pinned topics excluded from default ordinary pages; no pins in search/published/unanswered modes, max three per board.
- Readonly boards prevent new/edit but allow self deletion; locked topic same. Move/pin/lock needs independent control revision and audit; no stale body resurrection; overlapping pins serialized; public reasons separate private reasons.
- Subscription limit200; creator subscription atomic; reply opt-in defaultfalse; no public count/list. Cancel before delivery skips; direct reply overrides subscribed event per recipient without touching previous unread subscription group.
- Outbox exported boundary, batches100, retries/deliveries unique, current visibility, active recipients, no self events, aggregated unread event ordering; older retry doesn't replace newer or re-unread read group; trim1000. Message/title/name never persist notification snapshots.
- Report evidence created from visible data only, fixed30d read-time expiry, final deletion of either reporter/subject clears snapshots, old backup replay before user delete; same ticket returned only to reporter; comment actioned requires that exact message hidden fact exported, independent chart hiding not enough.
- Live and raw-pg deletion replay remove body/identity/private tickets/inbox/subscriptions/outbox and author evidence while preserving third-party topic replies + durable public ID reservation.
- SQL migration table/index/FK/check parity with Drizzle and schema snapshot; queue registered before worker schedule; fresh volume recovery new journal kinds recognized before startup admits reads/writes.

## Independent static review fix cases (NOT executed)

- Link a forum topic to public chart number `1` backed by a UUID. Both `/topics?chart=1` and the chart-side related list must match the stored numeric string, including pinned results; withdrawal still rejects the chart filter and removes the chart-side entry.
- Lose a chart-message create response, then withdraw/moderate the chart or publish another file version. Replay the identical account key/payload: return the same message ID in an unavailable DTO with null body/author/quote/timestamp; do not create a new row, spend rate budget, or redirect to the new version. Different body, version, chart target, or request kind under that key remains 409 before target authorization. A new key still needs current public-version authorization.
- Chart/topic author requests pending deletion concurrently with a third-party create/edit. Parent user `FOR SHARE` and deletion user-row write locks must serialize: a committed pending status rejects the write, or deletion waits for the already-admitted write to commit. Cross-account lock deadlocks should return retryable STORAGE_BUSY through the shared transaction mapper; no partial content/outbox/request survives rollback. Own-author writes retain the existing active-account lock.
- Restore an old backup with pending outbox rows and lost delivery receipts. Recovery marks the restored pending events completed before admission; historical interactions are not automatically dispatched again. This recovery policy is implemented by the parent task, not this backend fix pass.

- Lose a forum-topic create response, then hide or withdraw that topic before retrying. The identical active-account key/payload recovers the same internal UUID and numeric public ID via a sanitized unavailable/root-removed DTO: null title/body/author, no linked-chart snapshots, locked state, no recreated topic or repeated subscription side effect. Changed title/body/board/chart association under the same key remains 409 before current-target checks. Normal public GET remains 404 when no legal direct-link topic exists.

---

# Discussions client source handoff

Status: source prepared only. No tests, lint, type checks, dependency installation, builds, development/preview servers, browser sessions, remote operations, CI, commits, staging, pushes, or deployment were run by this domain implementation. Cases below are prepared and unexecuted; source inspection is not acceptance.

## Source contracts (root wiring completed)

The following route modules are wired beneath the community locale layout:

| Path | Module relative to `apps/community/src/client` |
| --- | --- |
| `/forum` | `routes/forum.tsx` |
| `/forum/new` (before dynamic topic) | `routes/forum-new.tsx` |
| `/forum/:id` | `routes/forum-topic.tsx` |
| `/me/discussions` | `routes/my-discussions.tsx` |
| `/me/notifications` | `routes/notifications.tsx` |
| `/dash/discussions` (existing dash layout child) | `routes/dash-discussions.tsx` |

Mount `ChartDiscussion` from `components/chart-discussion.tsx` on the public chart detail with `{ chartId: chart.publicId, versionId: chart.versionId, summary: chart.summary }`. Do not add a version-based React key: the component must retain unsent input when the public file changes and require explicit draft replacement. Chart-id changes isolate its lifetime internally.

The discussion message fragment is merged into the global zh/en/ja catalogs, and localized forum/personal/inbox/admin navigation is wired. Message/code generation and all runtime/type checks remain deferred under the user instruction. No dependency change is needed.

`queries/discussions.ts` uses the existing Hono client transport (including SSR cookies and in-process fetch), sending no-store requests through concrete URL segments. Backend capabilities used beyond the initial contract: explicit-null edit anchor clearing; `ForumTopic.canRestore`; `moderationState`; dash `scope` and exact `targetId`; standard `REAUTH_REQUIRED` code.

## Source behavior and limits

- Root chart comments and one reply level, publisher badge, own edit/delete, reports, per-difficulty browsing, bounded reply pages and current-version focus lookup.
- Forum boards/search/sort/unanswered/chart filters, cursor pages and separately returned pinned rows; topic editor with current-page unsaved warning, preview, up to three linked public chart numbers; flat replies, bounded anchor focus, subscribe and withdrawal.
- Topic body is parsed by a bounded native React Markdown allowlist. Raw HTML, images, embeds, script URLs and external preview fetching are not enabled. Every reply/comment renders escaped plain text.
- Personal topic/reply/subscription management and private discussion-report history share `/me/discussions?kind=topics|replies|subscriptions|reports`. Only current matching active identity renders private loader data.
- Notifications group by UTC event date while preserving server-provided aggregation; unread filtering, per-row/per-page read, safe localized target links and generic unavailable placeholders.
- Admin board/content/report tabs, scope/board/chart/state/open-report filters, exact report target links, irreversible hide, topic controls, board order/name/description/read-only updates, revision/recent-login handling and separate report resolution.
- Title 1–100 / topic body 1–10000 / comments-replies 1–2000 / report and management reason 1–500 Unicode code points. Search rejects over 120 code points before navigation. Optional timepoints are integer chart milliseconds, bounded to previewable selected difficulty. Messages surface cooldown/quota rules; authoritative limits remain server-side.
- Failed/network/409 mutation results keep input. Create retries keep the same idempotency key until the user changes the request payload/target. Topic editing captures the initial revision. Cursor conflicts offer a first-page reload retaining the filter scope.

## Preview bridge

`PrivateChartPreview` accepts discussion events only for the public asset resolver. `community-preview-seek` detail `{id,versionId,difficulty,ms}` must match the current public instance, preview support, safe integer and duration. It pauses, clears practice looping, explicitly opens/loads the selected preview and seeks after ready; it never calls play. Exporting previews ignore seeks. Existing private preview asset paths do not respond.

`community-preview-position-request` additionally carries an editor `requestId`. A ready matching preview emits `community-preview-position` with the same requestId and current chart milliseconds. Only the requesting editor applies it; there is no cross-editor or cross-version position forwarding.

## Prepared acceptance cases (NOT RUN)

1. Anonymous SSR and navigation: all forum/visible chart reads; sign-in prompts on creation/reply; protected personal/admin redirects; private/no-store/noindex response policy; active identity guard clears private state on logout/account switch.
2. Forum list: three boards, read-only board browsing, topic/reply counts, Unicode120 search boundary, title/body literal matching only, default activity pins versus published/unanswered/search behavior; 20-item next/previous preserving every filter; pin-set cursor conflict reload.
3. Topic creation: 1/100/101 title, 1/10000/10001 body with astral Unicode, 0/3/4 linked charts, duplicates/non-public/oversized numeric IDs, board read-only races, unsaved navigation/back/reload prompt; successful save navigates without a draft warning; lost response retries one request key; changing body/board/links issues a new key.
4. Markdown: headings, consecutive list/quote/code blocks, inline code, normal HTTP(S) links and rel attributes; escaped `<script>`, raw HTML, event handlers, `javascript:`/`data:` links, images/iframe/media, image syntax nested in links, unclosed fences and 10000-character worst cases. Replies show the identical input as plain text.
5. Topic replies: flat quote target, generic missing quote, pagination, stable #message anchors to off-page replies with bounded lookup, unavailable target and hidden topic cannot expose old body/identity; selected reply scrolls to composer; explicitly opt-in subscribe remains unchecked initially.
6. Own operations: canonical identity only, revision conflict and network failure retain editor values; read-only/locked creation/edit disabled but own deletion remains; withdrawal with/without other users replies; temporary damaged-root owner restore only from `canRestore`; terminal removed/hidden root cannot restore/unlock.
7. Chart comments: roots and one-level descendants, initial3 + further20, reply-to-reply keeps root and visible target label, publisher badge, difficulty filter excludes unclassified root; no recursive UI; roots/replies edit/delete/report.
8. Chart anchors: all seven difficulties, unsupported/unknown-duration classification without timestamp, root-null difficulty forbids reply time; valid0/end milliseconds, negative/fraction/out-of-range rejected; root edit explicit null clears; reply inherits root difficulty; use-current-position updates exactly one requesting editor.
9. Preview: unopened selected difficulty loads and seeks paused; already playing pauses before seek; practice loop disabled; wrong chart/version/difficulty, negative/fraction/out-of-duration events ignored; export ignores seek; private preview never responds; explicit playback remains user-controlled after seek.
10. Version race: keep chart discussion component mounted while public version changes; old roots/focus/body disappear, user's draft stays, writes to changed version are blocked; explicit new-version action confirms discarding draft. A stale-version 409 load offers parent revalidation.
11. Personal discussion tabs: own topics/replies/subscriptions/report tickets, body unavailable placeholders without prior title/identity, direct links only when server allows, edit/delete active own messages, owner topic edit, unsubscribe removed-root subscription; cursors remain tab-bound.
12. Notifications: all/unread, UTC grouping, per-row/per-page reads (max20 IDs), direct-vs-subscription server aggregation, newer event timestamp handling after read, no body/old author/unsafe href for inaccessible targets, public moderation reason distinct from internal notes, private account change protection.
13. Reports: all categories; 500-codepoint limits; same-target duplicate return; daily/open quota; private report history including resolution. Evidence-expiry/user-deletion placeholders cannot show a previous evidence body.
14. Admin filters: topic/message and explicit scope, board, public chart ID, visible/hidden/deleted/all, open-report status; exact UUID report target reaches one bounded row and does not require scanning all pages.
15. Admin actions: hide exact topic/message with confirmation and captured revision; locked/unlocked; pin positions1–3 including occupied-slot conflict; unpin/move; content-vs-control revisions; inaccessible-but-existing message can hide without exposing body. No unhide/delete-board/create-board affordance.
16. Board controls: name100/description500/reason500 and order0–100 bounds, read-only toggle, revision races, after-save board list refresh; reason/audit present.
17. Report closure: target review→hide fact exported→actioned resolution; chart withdrawal alone must fail actioned; dismissal without hide; note retained on conflict/expired login; old and fresh admin session produce correct reauth link; no successful resolution claim for mismatching returned status/note.
18. Desktop/mobile (320/390/768/1440), dark/light, keyboard labels/focus and long Unicode wrapping in zh/en/ja. Validate generated message keys and route types only in the later explicitly authorized remote verification phase.


## Final static-review follow-up (source only; cases NOT RUN)

- Chart navigation now binds cursor/history to the public file version and derives the first-page request synchronously before effects run. A version change resets paging and focus; valid difficulty selection may remain, but a removed difficulty resets to all. Reload explicitly clears cursor/history/focus, so it cannot repeat an invalid cursor forever. The main composer remains mounted and retains its body while old-version submission stays blocked.
- Same-scope chart refresh keeps mounted rows during loading; revision-based editor keys were removed from chart roots/replies, forum replies and personal discussion rows. Refreshed extra reply pages are invalidated instead of retaining outdated server bodies. Unsent message-editor values, initial revision and idempotency key are retained in account-isolated page memory and restored when their target remounts. This memory is cleared on account changes and has no browser persistence; inaccessible bodies do not render from it. Unsaved navigation warnings also cover retained off-list drafts.
- Message editing captures its initial revision. Topic and message editors expose explicit server-content comparison and a user-confirmed revision adoption action which keeps the entered body. Reading a newer revision alone never changes the expected revision. A failed save no longer requires closing/discarding the draft to retry against a newer revision.
- Admin hide now includes root-removed topics that still retain others' public replies, as well as unavailable-but-existing targets. Lock/unlock/pin/move stay restricted to currently visible topics.

Additional prepared cases:

19. Open chart discussion page2 under difficulty4 and an off-page focus anchor; type an unsent reply. Change the public version while keeping the component mounted. Confirm the first new request has no old cursor, history is empty, old focus is not reloaded, valid difficulty4 may remain, and removed difficulty4 changes to all. The exact entered body remains and old-version writes are blocked. Repeat Reload after a cursor409: it requests page1 without the invalid cursor.
20. Edit a root, one of its initial replies and a reply loaded from a later bounded page in separate runs. Refresh/revalidate and update the server content revision. No draft body is silently replaced; current rows keep stable editor identity, and remounted/off-list targets reopen the account-scoped draft. Removed/hidden targets show no cached public body or old identity. Switching users clears retained drafts.
21. Two sessions edit a topic or message. Save the other session first, then save the original draft and receive409. Explicitly read the latest content, compare the displayed revision and body, confirm adoption of the newer revision while keeping the exact input, and save successfully. Merely reading/refreshing does not advance the expected revision. Verify network failure, unchanged revision, locked target and unavailable target do not silently adopt a revision or claim success.
22. Withdraw a topic with another user's valid reply. In admin exact-target view, the root_removed placeholder exposes Hide with reasons/revision confirmation, while lock/pin/move controls remain absent. Hide it, verify the public direct link no longer exposes retained replies, then resolve its report according to the exported hidden fact.

23. Administrator draft revalidation: enter moderation reasons/action, board name/description/order/read-only/reason, and a report-resolution note in separate runs. Revalidate after another admin changes the relevant content/control/board revision or closes the report. Stable user/entity keys and account-isolated page memory retain each input, including rows leaving an open/visible filter. Dirty configuration/reasons keep their captured revision until explicit current-server comparison and reconfirmation; a closed report shows the unsent note for copying and cannot overwrite the completed resolution. Reopen the report in all/resolved view to recover a retained off-list note. Verify role removal or account switching hides admin content and clears page memory. No case executed.

---

# Site content, integration and recovery cases (NOT EXECUTED)

1. Notice input: Unicode80 title/2000 body; empty required Chinese vs optional translations; invalid controls/surrogates rejected; internal CTA and label pair only; schedule exact boundaries, null bounds and normalized milliseconds. Public translations fall back to Chinese with an explicit indicator.
2. Save draft, publish saved revision, edit draft privately, verify public old snapshot remains unchanged, publish new saved version and withdraw terminally. Two tabs must preserve input on409 and offer server comparison/reconfirm. Publish/withdraw lost response retries recover the original committed revision and journal barrier, never add an unintended revision. A later conflicting edit must409.
3. Public notices show only current visible hash-matching and exported snapshots in active time range. Important before normal, then configured order and deterministic ID; traverse >20 ties across cursor pages. Admin cursor cannot serve public pages. A newer permission fact with older body/hash must hide rather than render stale text. Old-backup withdrawal must never return body.
4. Featured IDs are distinct signed-bigint numeric chart IDs, max6, in configured order. UUID-backed numeric mappings resolve correctly. Reject0/leading-zero/overflow/non-public references. A failed reference after selection disappears immediately without copied title/cover/author or fallback. Same-list lost-response retry is idempotent; concurrent replacement requires explicit reload/review.
5. New admin notice/featured pages must render only to loader's same active admin identity, including logout/account-switch/refocus and actor pending deletion before save. Private drafts never remain in another identity's mounted editor; GET/write/API errors no-store, noindex. Recent login required for mutating calls and reauth links request fresh login.
6. Home latest8/featured6/current notices/search/help/upload, optional component outages distinct from empty, desktop/mobile/dark/three-language. Global unread badge loads only for active identity, refreshes on focus/read, no interval polling. Resolution notifications open the discussion report history instead of the legacy chart-report list.
7. Schema: generate/check Drizzle drift for0015 and0016 against both fresh DB and an upgraded pre0015 DB; compare SQL, typed definitions and snapshot metadata; index/FK/check/identity defaults, role grants and journal kind constraints. No migration has been executed during development. Validate frozen install and prior manual gifenc workspace lock edge on remote.
8. Journal compatibility: legacy publication/moderation/retained payload defaults must not change immutable exported bytes. Simulate checkpoint-CAS crash and orphan promotion across upgrade; export >8MiB metadata backlog in bounded nonempty segments; reject a single over-limit record. Confirm encrypted envelope limits and recovery-head comparison. Generic facts must contain hashes/controls/identity only, no content body/title/evidence.
9. Restore old database plus newer facts before opening: latest topic/message/notice hash mismatch, terminal hidden/deleted, root_removed with lawful replies, independent topic/board controls, featured references, permanent forum numeric allocation/sequence. Parent pending/final deletion races and raw-pg cleanup must never revive body or evidence. Restore must complete old pending outbox rows before reopening to suppress duplicate historic notifications; missed historical notifications are accepted within backup RPO, content is not reconstructed.
10. Live deletion/replay: reporter OR subject author clears evidence and identifiers; read-time30day expiry cannot be extended by closure; held private report details follow existing ticket rules. Preserve lawful third-party replies on root withdrawal/purge and allow admin whole-topic hide afterwards. No unhide UI or replay revival.
11. Full candidate combines prior discovery/collections/practice changes and this task. Remote lint/type checks/generated i18n and route types, meaningful pure/service/DB/DOM/recovery suites, builds and real browser acceptance are required. Also regress QQ/AWMC login+binding, all3 upload modes, download, backups, old numeric/UUID/user routes, private favorites/reports and existing admin. No passing result is implied by this matrix.

Additional recovery case: restore a notice row whose body/revision/withdrawn state predates the durable fact. Admin reads must show the durable revision and terminal withdrawal; save/publish cannot revive it, and withdraw retry drains its original barrier. A nonterminal missing-latest-body notice may advance only through an explicit new saved draft/publication; a durable ID with no row cannot be allocated again.
