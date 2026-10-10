# zip.js 与 client-zip 实测

六首真实含 BGA 谱面，共 303.97 MiB；大包通过重复同一批素材扩大到 2.672 / 4.453 GiB。固定 zip.js 2.23.0、client-zip 2.5.1，使用 STORE，不压缩音视频。所有操作在本地浏览器完成，没有服务端打包。

八组测试均完成 `.adx` 保存，保存字节数与生成字节数一致。下表是**打包耗时 / 浏览器进程总 RSS 的最大观测值**，包括基线开销，不包括下载保存耗时。

| 场景 | zip.js | client-zip | 两者保存 |
|---|---:|---:|---|
| Chromium，2.672 GiB，Blob | 37.27 秒 / 452 MiB | 39.37 秒 / 402 MiB | 成功 |
| Chromium，4.453 GiB，OPFS 写盘 | 86.06 秒 / 406 MiB | 119.60 秒 / 430 MiB | 成功 |
| WebKit，303.97 MiB，Blob | 3.52 秒 / 1439 MiB | 4.16 秒 / 1567 MiB | 成功 |
| WebKit，303.97 MiB，OPFS 写盘 | 21.92 秒 / 475 MiB | 10.74 秒 / 416 MiB | 成功 |

最明显的差异是 WebKit 输出路径：同一份约 304 MiB 的输入，Blob 路径观测到约 1.4–1.5 GiB 的总 RSS；OPFS 写盘降到约 416–475 MiB。写盘改变了耗时，两库的快慢随浏览器和输出路径变化。本轮没有统计学意义上的通用性能胜者。

两套 4.453 GiB 输出均含 ZIP64 EOCD/locator，360 个文件中有 36 个本地头偏移超过 4 GiB。这验证了本次大包的目录偏移，不覆盖单个文件超过 4 GiB 或超大文件数量。

小包里 zip.js 使用较低 ZIP 版本，超出偏移范围时才增加 ZIP64；client-zip 的所有条目都标记 ZIP 4.5。两者在本次 Unity 解压器中可读。若继续选主实现，我倾向 zip.js 的 ZIP32/ZIP64 控制及后续扩展能力；不应据此认为它在所有平台更快，或已证明它比当前 fflate 的 Blob 复用方案更省内存。

移动端的重点应是能力检测、流式写盘和保存完成后的资源释放。OPFS 有配额和磁盘成本，导出可能再占用一份包大小；没有合适写盘能力、或配额不足的浏览器，仍需保留分包降级。当前 128 MiB 手机分包限制不宜仅凭本轮放开。

测试在 16 GiB macOS 工作站上进行，使用 Chromium 151 和 Playwright WebKit 26.5 的手机触控视口。没有 iPhone、华为或低内存安卓真机；也没有执行 AstroDX 游戏内导入或 BGA 播放。[官方 Android 安装教程](https://wiki.astrodx.com/en/install/android)仍列有“小于 2 GB”的自制谱面前提（教程注明适用 v2.0.0 Beta 2 Patch 4 及以上），因此不能把解压器成功当作当前游戏支持大版本包的证明。128 MiB JS 堆限制不是手机总内存限制。RSS 不包括压缩内存、交换区和系统文件缓存；单次测试还受工作站已有负载影响。

归档校验结果见 `results/integrity.json` 和 `results/unity-integrity.jsonl`。Unity 官方 SharpZipLib 的解压证据与 APK 中的库符号，仅支持格式兼容判断，不等于完整游戏导入成功。完整方法、边界和复现步骤见 [README.md](README.md)。本次只新增实验脚本与报告，未修改生产下载逻辑、依赖或部署。
