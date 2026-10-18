# Community practice tools — development checkpoint (2026-10-18)

Source implementation is recorded; runtime verification is pending. This is **not** a production acceptance report.
Branch `codex/community-practice` starts at `e96f3b2`, following the two untested/unreleased local development batches `aae2fb5` and `e96f3b2`. All three require a concentrated remote release-preparation window.

## Source changes

1. Density timeline: width-bounded aggregation (at most600 buckets), note-start classification, type legend, chart-time playhead and native keyboard/touch seek slider. Buckets and SVG bars are memoized instead of traversing notes during playback. No difficulty-rating claim is attached to density.
2. Shared A/B range: default8seconds, minimum0.5seconds, or the whole shorter chart. Explicit set-A/set-B controls plus separate native endpoint sliders avoid competing seek/range pointer gestures. Loop enable/disable/clear and start/end labels share the same range with export. Seeking outside disables repeat while retaining selection; paused edits stay paused. Chart/version changes, difficulty changes and closure dispose instance-owned work and clear selection.
3. Mirror: engine-native original/horizontal/vertical/180degree modes, including paused repaint and latest values during async setup. No CSS inversion of labels or original-file mutation. New chart/version or preview close resets mirroring; changing difficulty within the same session retains it.
4. GIF: lazy-loaded browser-local gifenc, fresh same-resolver read of the exact version at export start, original-speed TimingTimeline conversion and current mirror. Silent480px/20FPS, max15seconds/300frames, default8second selection, no cover/PV/music. Single encoder globally, single export per player, progress, cancellation, retry and download fallback link. Encoded output is checked in small frame batches and capped at32MiB; this is **not a hard browser-memory cap**. Canvas and object URLs are released. Private filenames omit UUID/title/artist; public filenames include the numeric chart ID. Export pauses playback and does not resume automatically.

The player was extracted into a per-instance controller so async import/fetch/decode/resume, chart clock, audio sources, mirror, range and disposal have one owner. Preview assets still load only on request; exporter code loads only on explicit export. Public/private resources never fall back to another resolver.

## Static review and fixes

One independent whole-change source review identified two P2 issues: first Play was not cancellable while decode/resume was pending, and loop audio stopped at B but restarted only through animation frames. Both were corrected and received a bounded static recheck:

- Playback intent reaches the UI before awaits; pause clears intent and invalidates late continuations.
- In-buffer audio intervals use AudioBufferSource native looping; visual modulo wraps retain the source. Looping previews explicitly pause when the document becomes hidden and do not resume automatically. The listener is removed on disposal; all three translations describe this behavior.
- Ranges containing lead-in/trailing silence use scheduled-stop/chart-clock fallback. Long foreground main-thread stalls can still interrupt these silent-boundary loops; actual boundary timing and target-device behavior remain release checks.

No remaining important finding was reported in that bounded recheck. This is source-review evidence only.

## Prepared cases, not executed

Pure helper cases cover one-hour bounded density, start/end classification, finite/short/edge ranges, loop overshoot and GIF allocation limits. DOM cases cover engine mirror/reset, paused edits and outside seek, native looping at changed speed, pending decode cancellation, hidden pause/no auto-resume, public reauthorization denial, and cancelling the authorization request while retaining range. Separate GIF cases use the real encoder with a canvas/renderer boundary fixture for variable-BPM frames/header, cancellation cleanup and retry. Existing renderer fixtures were adapted.

Only static source inspection, message-reference inventory and Git whitespace checks ran. **Not executed:** tests, lint, typecheck, i18n generation, dependency install or lock regeneration, build, dev/preview servers, browser checks, remote operations, CI, push or deployment.

## Persistence and dependencies

No new schema migration, server endpoint, backend job, permission-journal fact or persistent user setting. Prior batch migration0015 remains unexecuted. Added gifenc as an explicit community dependency using the same version range and existing locked resolution as web; only the workspace dependency edge was edited manually. Frozen-install/lock consistency still needs remote verification.

## Concentrated release gates

- Validate all three batches together on the configured remote build machine, with generated i18n/types, frozen dependency resolution, lint/typecheck/tests and build. Repair failures against the final candidate; do not report prepared tests as passing.
- Check prior migration0015 generator drift and execution, private favorites/report/admin ownership, account deletion and fresh-volume backup restore, revoked/anonymous publications, existing storage/logins/legacy links and all three upload modes.
- Real browser: density pointer/keyboard positioning at variable BPM/first offset, paused and playing A/B edits, altered rates and very short/end ranges, lead-in/tail silence, pending decode/resume cancellation, foreground stalls/background pause, mirror parity, GIF appearance/duration/header, repeated cancel/retry, close/change/unmount, permission failure, memory on target mobile devices, desktop/mobile layouts and three languages. Existing speed controls change pitch; pitch preservation is not introduced here.
- Source implementation, checks passed, browser acceptance and production deployment remain separate statuses. Push/deployment require the user's release authorization.
