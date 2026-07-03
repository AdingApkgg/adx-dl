# @lxns-network/maimai-chart-engine (vendored)

Framework-agnostic maimai chart rendering engine: parses simai (`maidata.txt`)
into a `Chart`, renders it to a 2D `<canvas>`, and schedules answer SFX via the
Web Audio API. No WebGL / external graphics deps — only `ts-pattern`.

## Source & license

Vendored from **Lxns-Network/maimai-prober-frontend** (`packages/maimai-chart-engine`),
MIT licensed — see `LICENSE`. Copy taken verbatim; keep changes minimal so it can
be re-synced from upstream. If you patch it, note the change here.

**Last synced:** upstream commit `48d0b9640fc3ecc3fce270166424adf1f7a7ae4b` (2026-06-27).
That sync pulled the #48 single-clock playback refactor (AudioManager no longer
owns its own `AudioContext` — constructed with `{ audioContext, outputNode }`;
new `audioClock` / `TimingTimeline`; `schedule()` takes `prepareAudioEvents(notes)`
output; `MainRenderer` constructor dropped its `bpm` arg and `setBpm`), the
Simai/Ma2 parser split, and the slide/wifi rendering rewrite.

To re-sync: sparse-clone upstream `packages/maimai-chart-engine`, `diff -r` against
`src/`, copy `src/` over, then **re-apply the local patches below** (grep for
`本地补丁`) and re-run the app-layer migration (see git history of this sync).

### Local patches (re-apply after every re-sync)

- **Difficulty 7 = 宴 (UTAGE).** Upstream only supports difficulties 1–6, so UTAGE
  charts (`&inote_7=` only) get misdetected as single-difficulty and fail. Added `7`
  to `ChartDifficulty` / `DIFFICULTY_NAMES` / `DIFFICULTY_COLORS` / `ChartLevels` /
  `ChartDesigners` / `AvailableDifficulties` (`types/index.ts`) and to `INOTE_MARKERS`
  + the `des_7` / `lv_7` metadata cases (`core/parser/SimaiParser.ts`).
- **Lenient BPM.** Upstream `SimaiParser` throws `"Simai 文件缺少 bpm 元数据声明"` when
  a chart has no top-level `&bpm=`. Many AstroDX charts inline the BPM in the body
  (`&inote_7=(135){1}…`), so we default `metadata.bpm` to `120` instead of throwing —
  an inline `(bpm)` still overrides via `parseNotes` `firstBpm`.

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
