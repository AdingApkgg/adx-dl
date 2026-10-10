# 2026-10 留言区谱面来源核查

核查日期：2026-10-10。对应留言区 lawort 的请求：DS 联动四首，以及“老汉拉车”的新标准谱。

SEGA 的 [10 月 2 日更新公告](https://info-maimai.sega.jp/9609/)确认四首 DS 联动曲和《居並ぶ穀物と溜息まじりの運送屋》的新 STANDARD 谱面。

## 找到的实际谱面文件

公开仓库：<https://github.com/MerryMing/mai-chart-collection>。

已核对提交 `46019d2b8ccca45d406fc382c8d743954c2d8827` 中的 Music.xml，曲名与曲师匹配；已下载并检查各目录的四档 MA2，文件非空，含实际音符数据。

| ID | 曲目 | 类型 | 固定版本目录 |
| --- | --- | --- | --- |
| 12069 | All Over Again / Zekk | DX | [music012069](https://github.com/MerryMing/mai-chart-collection/tree/46019d2b8ccca45d406fc382c8d743954c2d8827/music/music012069) |
| 12070 | Energy / Ryo Nakamura | DX | [music012070](https://github.com/MerryMing/mai-chart-collection/tree/46019d2b8ccca45d406fc382c8d743954c2d8827/music/music012070) |
| 12071 | Crossfire / Blacklolita | DX | [music012071](https://github.com/MerryMing/mai-chart-collection/tree/46019d2b8ccca45d406fc382c8d743954c2d8827/music/music012071) |
| 12072 | RE!NCARN4T10N / xi | DX | [music012072](https://github.com/MerryMing/mai-chart-collection/tree/46019d2b8ccca45d406fc382c8d743954c2d8827/music/music012072) |
| 1154 | 居並ぶ穀物と溜息まじりの運送屋 / hanzo | STANDARD | [music001154](https://github.com/MerryMing/mai-chart-collection/tree/46019d2b8ccca45d406fc382c8d743954c2d8827/music/music001154) |

每个目录包含 Music.xml，以及 `{六位 ID}_00.ma2` 至 `_03.ma2`，分别为 BASIC、ADVANCED、EXPERT、MASTER，共 20 个谱面文件。

## 可用范围

这些文件是社区复刻谱，仓库说明来源于 HachimiDX 等社区的 video2simai 工作；未经逐音符比对，不能声称与官谱完全一致。MA2 文件标注由 MuConvert v0.4.2 生成。

使用 [MuConvert 0.4.2](https://github.com/MuNET-OSS/MuConvert/tree/0.4.2)，固定提交 `0d4e697872cc0f1b6d0561a4da93e20e8cf4e77f`，已将 20 档 MA2 转为 simai/maidata。开启严格解析后再转回 MA2，逐条比较音符类型、位置、小节与 tick、长按时值、滑条等待与持续时值，以及 BPM、拍号事件，20 档全部一致。源文件和回转文件的 `T_REC_ALL` 均与 Music.xml 的 `notesData/Notes/maxNotes` 一致：

| ID | BASIC | ADVANCED | EXPERT | MASTER |
| --- | ---: | ---: | ---: | ---: |
| 1154 | 197 | 324 | 604 | 915 |
| 12069 | 241 | 425 | 812 | 1094 |
| 12070 | 186 | 291 | 469 | 861 |
| 12071 | 265 | 383 | 583 | 741 |
| 12072 | 242 | 438 | 663 | 1108 |

本站预览解析器另行解析了全部 20 档，均有音符且没有非有限时间值。预览解析器的图形对象计数和 MA2 的判定物量口径不同（如星星头），上述表格只记录 MA2 的判定物量；往返比较不依赖这一计数差异。这些检查证明转换保持源文件内容，不能替代对社区复刻谱与官谱的逐音符人工比对。

1154 标准谱复用源站 `15/11154` 的 `track.mp3`、`bg.png`、`bg.avif`、`bg.webp`，媒体保持原字节。音频为 48 kHz 双声道，157.5 秒，前导静音约 1.436 秒；标准谱与已有 DX 谱均为 160 BPM、`first=0`，BASIC 起拍和 MASTER 第一小节与现有谱面对齐，最后判定早于音频结束。保留原试听位置 62.5 秒、试听长度 11.7 秒。未复用 PV。新目录为 `27/1154`，本站对应 `public/adxcs/1154/maidata.txt`，原 DX 条目不改动。此项校对检查了时间结构与配套媒体，未声称已在实体移动设备中完成试玩。

四首 DS 联动曲尚缺配套音频。2026-10-10 查询友链 OneCat（1936 条）、AWMC 下载站（1893 条）、SimaiHub（1723 条）、溯洌下载站（1871 条元数据、1795 个下载文件）及 Majdata Net 的公开索引或搜索，未找到四首曲目的完整素材包。Majdata Net 的 Energy 搜索结果为其他曲目，没有 Ryo Nakamura 的 Energy；AWMC BBS 域名当时无法解析。按用户“找不到就先算了”的指示暂缓这四首入库，转换后的 maidata 保存在 `data/chart-imports/2026-10-02/<ID>/`，不放入公开曲库。往返报告保存在同目录的 `roundtrip-check.json`。

本地现有目录只收录 11154 的旧 DX 谱，这次请求对应 1154 的新 STANDARD 谱，不能直接覆盖旧 DX 目录。

simai Wiki 的 [DX 索引](https://w.atwiki.jp/simai/pages/808.html)也列出四首曲目，但核查时 All Over Again、Energy、Crossfire 的页面只有资料与空难度区块；《居並ぶ穀物と溜息まじりの運送屋》[STANDARD 页面](https://w.atwiki.jp/simai/pages/1917.html)同样尚无可直接使用的谱面文本。RE!NCARN4T10N 页面未能成功读取，未判断其完整性。
