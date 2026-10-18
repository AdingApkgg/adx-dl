# Community discovery — development checkpoint (2026-10-18)

Status: source implementation complete; **runtime verification pending**. This is not a production acceptance report.

Branch: `codex/community-discovery`; base: `93c23cc084b7e26c8b491d72475e79078d29aa3b` (`origin/pre` at development start).
User approved this order and explicitly deferred tests to the production preparation window.

## Implemented scope

1. QQ health: three-minute fresh observations, seven-day last observation, sanitized state/failure transition logging, admin state/check/change/failure display and manual login availability retry. Missing/stale evidence is unknown. Invalid OneBot online data is a provider error, not a confirmed QQ offline event. Existing shared NapCat and availability fallback policy retained.
2. Public discovery: literal substring search of published title/artist and durable visible publisher name, exact numeric chart ID, difficulty slots1–7, recently publicly updated/first-published sorting, URL conditions and scope-bound cursors. Old timestamp/id cursors remain accepted on the unfiltered default listing. No numeric level-range filter, search server or search against private draft fields.
3. Author works: bounded public works on active numeric user profiles, existing public authorization and visibility gates, explicit unavailable state, private-draft shortcut for the owner, safe list-return URLs and preserved cursor chains. Anonymous retained works cannot be retrieved through their former author's filter.
4. Preview: .5/.75/1/1.25/1.5/2 playback rates, volume/mute, supported-browser fullscreen, surface-scoped Space/arrows/Home keys. AudioContext-anchored chart time, scaled audio lead-in, generation cancellation and cleanup. Rate changes also change pitch; the UI states this. Public/private asset resolvers stay separate and lazy.

No business schema migration, dependency installation, shared-bot configuration or production change was made.

## Review and verification boundary

- Independent static review completed. It found stale playback settings during asynchronous loading and discarded previous-page cursor chains after a detail roundtrip. Both code paths were corrected and received a bounded static recheck with no remaining finding in those resolutions.
- Focused regression cases prepared for health freshness/classification, Unicode/query validation, search permissions and private edits, author anonymity, scoped pagination/return paths, audio clock/rate scheduling, loading-time settings and focus-scoped shortcuts. Existing fixtures updated for the expanded API and controls.
- **Not run:** tests, lint, typecheck, i18n generation, builds, dev/preview servers, browser acceptance, production smoke checks. No claim that these pass.

## Pending concentrated release window

- Remote checks on the final candidate; resolve failures and recheck affected areas.
- Real browser: search/filter/page → chart → author works → preview controls → download; verify previous-page continuity, mobile320/390px, three languages, no hydration/page errors, fullscreen support/fallback and rapid/pending audio interactions.
- Compatibility: .adx/.zip/separate files, explicit selected-version publication, private edits, withdrawal/moderation, pending/deleted authors, current and legacy numeric links, QQ/AWMC/account binding and backups. Actual QQ code delivery uses an explicitly authorized self-test account.
- No persistence contract was changed; expand backup/restore validation only if release fixes introduce such changes.
- Push/deployment requires release authorization. Keep successful CI, deployed source and real browser/production acceptance as distinct evidence.
