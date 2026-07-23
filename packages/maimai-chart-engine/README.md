# @lxns-network/maimai-chart-engine (vendored)

Framework-agnostic maimai chart rendering engine: parses simai (`maidata.txt`)
into a `Chart`, renders it to a 2D `<canvas>`, and schedules answer SFX via the
Web Audio API. No WebGL / external graphics deps — only `ts-pattern`.

## Source & license

Vendored from **Lxns-Network/maimai-prober-frontend** (`packages/maimai-chart-engine`),
MIT licensed — see `LICENSE`. Copy taken verbatim; keep changes minimal so it can
be re-synced from upstream. If you patch it, note the change here.

**Last synced:** upstream commit `b3ec6089b2834f4074ef590a39b1b137b2904609` (2026-07-24).
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

The pre-sync `AudioManager.init()` dispose-race guard is **no longer needed**: the
manager no longer creates the `AudioContext` (the app owns it), so a mid-fetch
`context.close()` just makes `decodeAudioData` reject, caught by `init()`'s try/catch.

## Runtime assets

The renderer fetches two files (paths overridable via constructor config):

- `MainRenderer(canvas, bpm, { sensorImagePath })` → default `/assets/maimai/chart/sensor.webp`
- `AudioManager({ answerSoundPath })` → default `/assets/maimai/chart/answer.wav`

Both are shipped in `apps/web/public/assets/maimai/chart/`.

## Public API

`parseSimaiChart`, `getAvailableDifficulties`, `MainRenderer`, `AudioManager`,
plus the `Chart` / `Note` / `ChartDifficulty` types. See `src/index.ts`.
