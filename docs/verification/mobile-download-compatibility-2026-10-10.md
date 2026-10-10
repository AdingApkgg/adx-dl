# 移动端批量下载兼容性检查（2026-10-10）

检查基线：`2f9edc646307ac887df366424721968f5c7ba42d`，本地预览 `http://127.0.0.1:3012`，含本文说明的 OpenHarmony 修复。此次没有发布生产。

## 已修复：OpenHarmony 手机和平板误走电脑下载策略

原检测包含 Android、iOS、HarmonyOS，但遗漏官方 ArkWeb 的 `OpenHarmony`。官方示例 `Mozilla/5.0 (Phone; OpenHarmony 5.0) ... ArkWeb/4.1.6.1 Mobile` 会跳过手动保存、移动分批和并发限制。

现在识别系统字段中的 `Phone; OpenHarmony` 和 `Tablet; OpenHarmony`。PC 也可能带 `Mobile` 兼容后缀，因此不以该后缀判断设备。Phone 和 Tablet 两个回归用例先在原代码失败，修复后通过；PC 用例及已有 Android/iOS/iPad 桌面 UA 路径不变。

参考：[官方 ArkWeb UA 文档](https://github.com/openharmony/docs/blob/master/en/application-dev/web/web-default-userAgent.md)。此修复只处理网站的下载策略，不代表 HarmonyOS NEXT 已能运行 AstroDX 的 Android 应用；当前导入引导仍只有 iOS、Android、电脑三个选项。

## 完整流程验证

下列测试使用隔离浏览器上下文、本地真实页面和替换成小素材的网络响应，未操作用户浏览器缓存。

| 配置 | 引擎 | 结果 |
| --- | --- | --- |
| iPhone | Playwright WebKit | 通过 |
| iPad 桌面 UA、MacIntel、5 点触摸 | Playwright WebKit | 通过 |
| OpenHarmony Phone 官方 UA | Chromium，UA 模拟 | 通过 |
| 旧华为 Android UA，deviceMemory=2 | Chromium，策略模拟 | 通过 |
| 文件缓存写入抛 QuotaExceededError | Chromium，故障注入 | 通过 |

每个配置都完成：BGA 标签触摸切换；9 首分为 8+1 两批；分别点击保存；释放当前批缓存后继续；保留导入说明；刷新后仅保留一条完整 9 首的历史记录。10 个落盘包均经 ZIP CRC 和条目数校验（24+3）。页面 JavaScript 错误为 0。缓存空间不足时仍能下载保存，并提示本次不支持刷新续传。

WebKit 测试环境会拒绝 Blob 的 IndexedDB 写入，因此其小文件结果验证的是带提示的降级保存路径，不证明 iOS Safari 的 Blob 检查点可用。

## 128MiB 打包压力检查

Chromium 使用 128MiB V8 堆上限，8 个独立素材 Blob 合计 128MiB，调用真实 `buildNestedArchiveBlob` 和 `saveBlobAsFile`。保存前发送 critical 内存压力通知。每种格式含 16 个条目，8 条音频的 SHA-256 和谱面内容均经独立 Python 解包校验。

| 格式 | 打包及保存耗时 | 渲染进程采样峰值 | 保存/完整性 |
| --- | --- | --- | --- |
| adx | 1.42s | 191.4MiB | 通过 |
| zip | 0.92s | 163.1MiB | 通过 |
| tar.gz | 7.02s | 188.5MiB | 通过 |

页面计时器在打包期间继续运行，三种格式均未出现 JavaScript 错误。峰值来自该测试浏览器的渲染进程 RSS 采样，不包含所有浏览器进程，也不能换算为真实手机的安全内存预算。最初未限定进程范围的 431MiB 结果已废弃。V8 堆上限与实际 2GB 手机内存不是同一限制。

WebKit iPhone 配置也完成了 128MiB `.adx` 的打包、触摸保存和落盘，耗时约 3.31s，打包期间计时器继续运行，JavaScript 错误为 0。另用独立 Blob 验证 1、16、128MiB 均可保存。最初的大文件保存超时来自临时测试页缺少移动 viewport，导致 tap 坐标落在 body；修正测试页后问题消失，没有改动产品保存逻辑。

默认 `.adx` 仍适合移动端；`tar.gz` 在本次素材下明显更慢。现有分批按最多 8 首或已知素材合计 128MiB 控制，单首超大 BGA 和大小未知文件仍可能超过该预算：它们单独成批并显示警告，不能据此保证低内存设备不被系统终止。

## 尚未验证的边界

用户没有 iPhone/iPad、华为或低内存安卓真机，本机 ADB 枚举也没有设备。iOS 模拟运行时可启动，但当前 Xcode 布局缺少 Simulator 图形应用，无法完成原生 Safari 文件管理和后台返回操作；本次新建模拟器已清理。UA 模拟不等于 ArkWeb 引擎测试；deviceMemory=2 不等于真实 2GB RAM 压测。

后台长时间挂起、系统低内存杀进程、真实 Safari/华为下载管理器、真实磁盘不足仍未验证。超大 BGA 和未知大小单文件是下一轮最有价值的真机检查项目。

## 代码检查与证据

- `apps/web` 的 `bun run check`：TypeScript 通过，660 项测试通过，0 失败，73 个测试文件。
- 根目录 `bun run lint`：683 个文件通过；`git diff --check` 通过。
- `requesting-code-review` 独立审查：无 findings；既有 Android/iOS/HarmonyOS/SSR 路径保持不变。
- 汇总证据：[mobile-download-compatibility-2026-10-10.json](./mobile-download-compatibility-2026-10-10.json)。
- 压测统计仅为当前宿主机、测试引擎、固定素材的观察；没有将其作为真机内存上限或生产兼容性承诺。
