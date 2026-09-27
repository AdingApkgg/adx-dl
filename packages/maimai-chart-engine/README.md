# @lxns-network/maimai-chart-engine (vendored)

Framework-agnostic maimai chart rendering engine: parses simai (`maidata.txt`)
into a `Chart`, renders it to a 2D `<canvas>`, and schedules answer SFX via the
Web Audio API. No WebGL / external graphics deps — only `ts-pattern`.

## Source & license

Vendored from **Lxns-Network/maimai-prober-frontend** (`packages/maimai-chart-engine`),
MIT licensed — see `LICENSE`. Copy taken verbatim; keep changes minimal so it can
be re-synced from upstream. If you patch it, note the change here.

**Last synced:** upstream commit `6c8195b95` (2026-09-25, full sync). Pulled
everything since `8ef0d710e`: the rebuilt hit effects (new `src/effects/` —
Tap/Touch hit effects, Touch fireworks, Hold effect), the Touch rendering
rework with arcade cross-note draw order (`utils/drawGroupSort`,
`touchDrawOrder`, `touchGeometry`, `touchSourceIndices`), slide delay and
arcade-timed slide fade-in (`core/timing/slideAppearance`,
`MainRenderer.setSlideDelay`, `RendererConfig.slideDelay`), the AudioManager
rewrite with a separate hit-sound layer (`AudioConfig.judgeVolume` /
`setJudgeVolume`, ten new SFX assets), render performance work, and the
comment cleanup. The local patches below were re-applied with a three-way
merge (base `8ef0d710e`, ours, upstream HEAD); all six survived.

App-layer migration for this sync: `AudioConfig` gained the required
`judgeVolume`, so `hooks/use-audio.ts` exposes `setJudgeVolume`, the settings
store persists `judgeVolume` (default 1, like upstream), `chart-canvas.tsx`
applies it, and the audio settings group has a "hit SFX volume" slider next to
the (renamed) answer SFX volume. Upstream also dropped its answer-sound toggle;
we keep ours in the transport bar — it now mutes both layers.

Upstream's engine tests now live in `tests/` (vitest API; `bun test` runs them
unchanged, 64 tests). Run `bun test` in this package after every re-sync.

Earlier sync: upstream commit `8ef0d710e` (2026-08-21, cherry-picked by hand) —
PR #82, simai `@` slide-head modifier (`hasTapHead`) and order-free TAP
modifiers (`1$b` ≡ `1b$`).

Previous full sync: upstream commit `b3ec6089b2834f4074ef590a39b1b137b2904609` (2026-07-24).
That sync pulled the extreme-density render optimizations (time-window binary
culling in the render loop, offline mixing of dense hit SFX), simai parser fixes
and extensions (`<HS*x>` visual hi-speed markers, `&first` audio offset, inline
BPM fallback when `&bpm=` is missing), the TouchRenderer rewrite, and slide/hold
rendering fixes. No public API changes — the app layer needed no migration.

Previous sync `48d0b964` (2026-06-27) pulled the #48 single-clock playback
refactor (AudioManager no longer owns its own `AudioContext` — constructed with
`{ audioContext, outputNode }`; new `audioClock` / `TimingTimeline`; `schedule()`
takes `prepareAudioEvents(notes)` output; `MainRenderer` constructor dropped its
`bpm` arg and `setBpm`), the Simai/Ma2 parser split, and the slide/wifi
rendering rewrite.

To re-sync: sparse-clone upstream `packages/maimai-chart-engine`, `diff -r` against
`src/`, copy `src/` over, then **re-apply the local patches below** (grep for
`本地补丁`) and re-run the app-layer migration (see git history of this sync).

### Local patches (re-apply after every re-sync)

- **Difficulty 7 = 宴 (UTAGE).** Upstream only supports difficulties 1–6, so UTAGE
  charts (`&inote_7=` only) get misdetected as single-difficulty and fail. Added `7`
  to `ChartDifficulty` / `DIFFICULTY_NAMES` / `DIFFICULTY_COLORS` / `ChartLevels` /
  `ChartDesigners` / `AvailableDifficulties` (`types/index.ts`) and to `INOTE_MARKERS`
  + the `des_7` / `lv_7` metadata cases (`core/parser/SimaiParser.ts`).
- **Lenient BPM (reduced since the 2026-07-24 sync).** Upstream now falls back to
  the first inline `(bpm)` when `&bpm=` is missing, but still throws when a chart
  has no BPM anywhere. We add a final `metadata.bpm = 120` default before
  `parseNotes` so such charts render instead of white-screening the page.
- **Cover-image background.** Upstream only supports a PV `<video>` as the disc
  background; charts without a PV use their cover art instead. Adds a
  `backgroundImage` field + `setBackgroundImage()` to `MainRenderer`, extracts
  the inlined video draw into a shared `drawBackgroundSource()`, and falls back
  video → image → black in `clear()`. (Was undocumented before this sync and
  nearly lost — keep this list complete.)
- **Localizable HUD labels.** Upstream passes the literals 「连击」 and 「无保护」
  straight to `fillText`, so en/ja visitors get Chinese burned into the canvas —
  and into exported PNG/GIF frames, where it cannot be undone. Adds the
  `HudLabels` interface (`types/index.ts`), a `hudLabels` field defaulting to the
  upstream Chinese, and `MainRenderer.setHudLabels(Partial<HudLabels>)` which
  merges so an unset key keeps its default. The two `fillText` call sites in
  `drawHud` read `this.hudLabels` instead of literals.
- **HUD counter visibility setters.** `showNoteTotal` / `showBreakCount` exist in
  `RendererConfig` upstream but default to `true` with no setter, so the counters
  could not be turned off. Adds `setShowNoteTotal()` / `setShowBreakCount()` to
  `MainRenderer`.
- **Playback speed ceiling 1.0 → 2.0.** Upstream clamps `setPlaybackSpeed()` to
  0.1–1.0 (slow-down practice only); we also allow playing above 1× to follow
  along. The `alwaysKeepHiSpeed` compensation `(base / (hi / speed))` holds just
  as well above 1, so only the bound changed. The `RendererConfig.playbackSpeed`
  doc comment carries the widened range.

App-layer code that depends on the last three: `chart-canvas.tsx` (applies all of
them per render), `chart-settings.tsx` (the two toggles), `chart-speed-card.tsx`
(the speed slider) and `lib/export-chart-gif.ts` (so exported frames match what
is on screen).

Dropping one of the *method* patches during a re-sync breaks the typecheck at
those call sites, so it cannot go unnoticed. The speed patch is different — it
only widens a runtime bound, and reverting it leaves everything compiling while
speeds above 1× quietly stop applying. `apps/web/src/components/chart-preview/
engine-patches.test.ts` covers that case (verified by reverting the bound and
watching it go red); keep it passing rather than adjusting it to whatever
upstream does.

The pre-sync `AudioManager.init()` dispose-race guard is **no longer needed**: the
manager no longer creates the `AudioContext` (the app owns it), so a mid-fetch
`context.close()` just makes `decodeAudioData` reject, caught by `init()`'s try/catch.

## Runtime assets

The renderer and audio manager fetch these files from
`apps/web/public/assets/maimai/chart/` (paths overridable via constructor config
for the sensor image):

- `MainRenderer(canvas, { sensorImagePath })` → default `/assets/maimai/chart/sensor.webp`
- `AudioManager` answer layer → `answer.wav`
- `AudioManager` hit-sound layer → `tap.wav`, `touch.wav`, `break.wav`, `slide.wav`,
  `cheer.wav`, `ex.wav`, `firework.wav`, `break_slide.wav`, `break_slide_cheer.wav`,
  `touch_hold.wav`

Copy them from upstream `public/assets/maimai/chart/` on every re-sync — the
2026-09 sync also replaced `answer.wav`.
