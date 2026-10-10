# 舞萌DX 2026 段位数据

`maimai-dan-cn-2026.json` is a checked-in snapshot of the 22 fixed courses used by CN 2026 (PRiSM PLUS). It is independent of the catalog's song release-version filter and does not include random courses.

## Provenance

- Adapted from [ChiffonMai RankTableService.dart](https://github.com/ChiffonOwO/ChiffonMai/blob/114ea64cfae3c6b4de0c593a6e3b87c0f9580db2/lib/service/RankTable/RankTableService.dart), MIT licensed, retrieved 2026-10-10. Its README explicitly targets CN 2026.
- Cross-reference: [PRiSM PLUS courses](https://gamerch.com/maimai/941773#PRiSM%20PLUS%20段位認定). This is the historical PRiSM PLUS section, not the current Japanese MAGiCAL table.
- [Official mode rules](https://maimai.sega.jp/play/other1/): ordinary courses use four prescribed charts; random courses are a separate mode.
- [AWMC's CN 2026 update notes](https://wiki.awmc.team/guide/update) (2026-07-26) independently identify PRiSM PLUS course support.

`id` follows course order: 1–10 ordinary, 11–20 true, 21 true kaiden, 22 ura kaiden. `songId` retains SD/DX identity (DX IDs include 10000). `slot` is the simai difficulty slot (upstream `levelIndexes` + 2). Array order is official track order. Names retain the upstream Chinese labels and are localized at display time.

All 88 positions resolve to both an exact chart ID/type and the prescribed difficulty in `data/catalog/index.json` at introduction. Missing positions on a scoped catalog page remain visible as unavailable; they are never replaced by another difficulty or the other chart type. Downloads use the existing complete song packages, including all difficulties, and do not generate an arcade course file.

## Updating

Confirm the region and cabinet course version before updating. Pin a new source commit, retain the four track positions and SD/DX IDs, convert the difficulty index to simai slots, and update this provenance note. Do not automatically import the newest Japanese course table into the CN snapshot.

Run `bun test src/lib/maimai-dan.test.ts src/components/site/dan-course-summary.test.tsx` from `apps/web`, then the full web check. Review missing matches against the cabinet version rather than silently omitting them.

## Upstream license

```text
MIT License

Copyright (c) 2026 ChiffonOwO

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
