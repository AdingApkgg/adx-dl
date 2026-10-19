# Majdata Hold compatibility correction

Status: concentrated release validation in progress. Production changes require the formal release gate below.

## Reference and scope

MajdataPlay main commit `f2427c2e6e2a3ef3adec1408e44b136836b3985f` bundles MajSimai 2.0.6, whose NuGet manifest records commit `12293c3e559d052c9eb3af455b2088ac21d51cd7`.

Reference: [MajSimai note parser](https://github.com/TeamMajdata/MajSimai/blob/12293c3e559d052c9eb3af455b2088ac21d51cd7/Runtime/SimaiNoteParser.cs), `TryGetSingleNote`, `NoteHelper.TryGetHoldTimeFromBeats`.

The shared TypeScript parser now interprets omitted Hold duration as zero, while retaining head and tail records, Hold identity, Break/EX modifiers, simultaneous groups and delayed notes. Touch Holds without a duration retain their Hold identity too. Ratio durations, explicit seconds and note-local BPM durations share the same conversion to chart beats; a local timing BPM never changes the chart's BPM events.

Malformed timing syntax remains unsupported rather than silently becoming a zero-duration Hold. Unknown syntax on a valid button is diagnosed as UNKNOWN_TOKEN, while actual button/sensor range violations remain NOTE_OUT_OF_RANGE. Existing resource limits still count both head and tail records.

This is a targeted Hold compatibility correction, not a claim of complete MajSimai grammar parity. Existing slide limitations remain unchanged.

## Production symptom

The public API for chart 1, version `01a14290-a0bc-7103-a82b-b9bb32dcd7e7`, reports difficulty 6 as unsupported with seven NOTE_OUT_OF_RANGE warnings. The matching source contains seven untimed Break Holds: `8bh`, `2bh`, `4bh` and four `5bh` tokens. The old button Hold expression required brackets and therefore discarded these legal notes. The admission summary disables a whole difficulty whenever any diagnostic occurs.

## Concentrated release verification

Run on the configured Linux builder, not the Mac:

- Shared-engine Hold cases: zero duration, modifier order, Touch Hold, own-BPM timing, explicit seconds, group/delay, note allocation limits, invalid positions and malformed tokens.
- Community admission summary and author-analysis cases, followed by the existing engine/community checks required by the release gate.
- Reparse the exact publicly published original bytes for chart 1 and compare all slots and warnings; confirm difficulty 6 is fully previewable and the unchanged source hash matches.
- Browser verification: open and switch difficulty 6, play through the formerly rejected notes, check pause/seek and audio sync; confirm invalid fixture slots stay disabled.

## Existing data must be handled at release

Historical chart_versions.summary and preview artifact manifests retain their recorded parser build and do not refresh just because this code changes. The recipe build already fingerprints parser source, so new imports get a new recipe automatically. No production rows or objects have been changed in this task.

For historical records, inventory affected versions and compare old/new summaries before mutation. Use a source-bound replacement preview derivative under the current recipe, preserve original ZIP/ADX bytes and published version identity, and update the version's derived summary/pointer through the project's storage transaction/journal protocol. Recheck publication/moderation/deletion state before switching. Preserve rollback evidence. Do not only flip previewSupported or rewrite old immutable manifests in place: restoration must recover the corrected source-bound derivative and summary consistently.

The operator entry point is `bun ./ops/charts/refresh-preview.ts plan <version-uuid> <absolute-plan.json>` inside the media image. This verifies the original SHA and computes the proposed immutable artifact without database or object-store mutation. Keep the plan private (0600), inspect slot support, warnings and source/output hashes, then copy that private plan to the web container and run `bun ./ops/charts/refresh-preview.ts apply <absolute-plan.json>` there. Plan uses the media read/native context; apply uses the web upload-admission context and its registered storage policy. Neither role receives the other role's credentials.

Apply reuses the original via the existing owner-qualified instant-upload protocol, lets normal media workers produce the new build, then compares the reviewed snapshot under storage/account/chart/version/file/blob/recipe/output locks. The transaction changes only the derived summary/pointer and concurrency revision, records the unchanged publication fact, returns the temporary logical file quota through normal deletion, and waits for durable journal export. Original source bytes, file identity, version identity, ordinal and publication timestamps remain unchanged. Old recipes/outputs are kept for rollback. Inactive authors, deleted/moderated charts, blocked hashes and changed snapshots are refused. Cancelled/cleaned attempts use bounded deterministic retry keys; active attempts are reused.

Missing shared outputs prefer a recipe matching the current chart/avatar build. A pending historical rebuild intent can be replaced only before any physical lease is acquired. The recorded output hash and manifest must still reproduce exactly. A historical artifact whose bytes differ remains closed under the new image; keep its old image/source for rollback. Restoration acceptance must verify every current live version binding, without claiming the new image can reproduce arbitrary retired parser builds.

For this release, set `PRODUCTION_PREVIEW_CHART=1 PRODUCTION_PREVIEW_DIFFICULTY=6` and invoke `python3 scripts/remote/community-deploy.py --before-acceptance /absolute/refresh-hook.py`. The explicit local Python hook runs after the serving revision switches, before browser acceptance; it must apply the rehearsed refresh and retain remote evidence. A hook failure or timeout prevents release completion. The required-preview target is bound into the deployment readiness record and checked against the authenticated headless receipt. The check exercises source-hash agreement, loading, Play, clock advance, Pause and timeline seeking. Run the normal pre/post full backups and keep the old image and reviewed plan for rollback.
