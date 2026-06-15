# @lxns-network/maimai-chart-engine (vendored)

Framework-agnostic maimai chart rendering engine: parses simai (`maidata.txt`)
into a `Chart`, renders it to a 2D `<canvas>`, and schedules answer SFX via the
Web Audio API. No WebGL / external graphics deps — only `ts-pattern`.

## Source & license

Vendored from **Lxns-Network/maimai-prober-frontend** (`packages/maimai-chart-engine`),
MIT licensed — see `LICENSE`. Copy taken verbatim; keep changes minimal so it can
be re-synced from upstream. If you patch it, note the change here.

## Runtime assets

The renderer fetches two files (paths overridable via constructor config):

- `MainRenderer(canvas, bpm, { sensorImagePath })` → default `/assets/maimai/chart/sensor.webp`
- `AudioManager({ answerSoundPath })` → default `/assets/maimai/chart/answer.wav`

Both are shipped in `apps/web/public/assets/maimai/chart/`.

## Public API

`parseSimaiChart`, `getAvailableDifficulties`, `MainRenderer`, `AudioManager`,
plus the `Chart` / `Note` / `ChartDifficulty` types. See `src/index.ts`.
