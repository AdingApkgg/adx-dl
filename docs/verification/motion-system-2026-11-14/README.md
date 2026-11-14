# AstroDX 动效基础与共享组件验收

日期：2026-11-14。已按批准的 Motion System 规范完成首批实现、独立代码审阅和远程参数校准。当前代码保留在工作区，未提交、推送或发布。

## 实际交付

- `@astrodx/ui/motion` 保留兼容入口，拆分纯数据令牌、语义目录、策略、Motion 适配、Provider 与基础组件；旧 `EASE_OUT/revealTransition/springSoft` 和弹层 variants 保持原值。
- 用户偏好继续使用 `adx-reduce-motion` 和 system/on/off，兼容旧 1/0；OS、站内选择和临时兼容覆盖由同一解析函数决定，首屏启动脚本复用该函数。
- Motion、CSS 与手动基础组件统一静态降级：最终状态直接可见，去掉延迟与循环；已展示的 Reveal 和成功反馈不会因为恢复动画而补播。
- Button/asChild、Tabs、Dropdown、Select、Tooltip、三种 Sheet、Skeleton、Reveal 系列、RollingNumber 和 DrawnCheck 已接入。菜单移除逐行入场队列，保留键盘及 Radix 焦点行为。
- `ssrVisible` 默认 true 时保持可读并跳过入场；装饰性内容显式 false 才动画。数字真实值、完整成功图标可供 SSR 与辅助技术读取。
- CSS 变量从 TS 生成，UI 的 `check` 及远程默认验证检查生成一致性；Web CI 监听生成脚本变更。
- `/ui#motion` 使用真实组件展示交互；三语文案独立于已有业务文案改动。沿用已运行的远程预览容器与 SSH 隧道。
- `verify.sh` 增加每次独立的 tmux runner、日志、主机、PID、开始/结束时间及退出码。断线后按打印目录恢复读取；没有重启原有预览服务。

## 参数与视觉结论

基于 M3 分类进行 AstroDX Web 适配，本次数值不称为 M3 官方参数。

- Standard fast spatial：stiffness 从 650 调到 **1200**，dampingRatio=1、mass=1。按钮 scale 1→0.97，实际采样约 100ms 已接近目标、约 183ms 到达目标；原候选约 230ms。
- Expressive default spatial：保留 stiffness=380、dampingRatio=0.82、mass=1。装饰性 Reveal 从 y=16 归位，本次采样最小 y 约 -0.146px，末帧回到 0；透明度全程在 0–1。
- CSS 有限弹层采用固定时间近似：popup 120ms，dialog/sheet/backdrop 入场 200ms，退出 120ms。使用 transition 保持中断连续性，无视觉副作用的 presence animation 仅服务于 Radix 关闭卸载。
- 这些时间是样例观测或 CSS 配置，不是所有弹簧/设备固定结束时间。更大业务布局的手感仍需对应迁移批次校准。

已查看桌面、窄屏和居中弹窗截图：内容可读、弹层位于可视范围、无横向溢出。外部图片请求在本次校准中被阻断，个别页面外壳装饰可能显示占位；未据此验收外部媒体。

## 验证证据

| 检查 | 结果与范围 |
| --- | --- |
| 完整远程默认验证 | `scripts/remote/verify.sh --keep`：lint 检查 734 个文件通过；UI 类型检查与 50 个测试通过；Web 类型检查与 742 个测试通过 |
| 最后语义引用补验 | Button/Tabs 改为从语义目录读取 scheme/tempo 后，共享包类型检查、生成一致性与 50 个测试再次通过；两文件 lint 通过。参数值未变 |
| 独立审阅 | 原有 SSR 可见性、中断跳变、CI 漂移三项问题修复后，复核无新 P1/P2 问题 |
| Linux Chromium | `check-motion.mjs`，13 组检查通过，详见 `results.json` |
| 远程浏览器覆盖 | 常规/asChild 按压、按压中开启减少动态效果、三种弹层边界/焦点恢复、入场中关闭、两组 Tabs 快速切换、键盘菜单、真实离屏暂停、Expressive 轨迹、静态最终状态、OS 与站内覆盖、恢复后不补播、保存偏好后刷新、390px 窄屏 |
| 后台门控 | 单元测试固定 viewport 输入，验证 document visibility 订阅与减少动态效果优先级；真实离屏行为另由 Chromium 验证 |
| 轻量检查 | `git diff --check`、`bash -n scripts/remote/verify.sh`、CSS 生成一致性通过 |

完整检查记录：`localhost` 的 `/home/i/astrodx-verify/jobs/20261114-031031-wt-88b54539-57121/`；最后共享包补验：`/home/i/astrodx-verify/jobs/20261114-031245-wt-88b54539-57537/`。各目录有 output.log、exit-code、run.sh 等可恢复记录。

校准记录：`/home/i/astrodx-verify/jobs/motion-calibration-20261114-final/`，证据取回至本目录。浏览器最初受代理回环规则影响无法访问预览；隔离实验确认直连回环可用，因此本次校准只访问 127.0.0.1，所有外网请求均阻断。没有绕过外部服务权限或访问控制。

## 尚未覆盖

- 本次未迁移搜索/目录、下载托盘、播放器业务编排、页面导航或共享元素转场；它们仍有 legacy/局部参数。
- 未做 WebKit、真实手机、生产静态导出及跨文档导航验收，也未部署生产。不能把本次 Chromium dev 预览结果视为这些场景通过。
- 社区和后台共享组件会继承本次基础行为，但它们的业务流程没有做运行验收。

预览：[本地隧道的动效展示](http://localhost:3310/ui#motion)。工作区其他任务的业务改动保持原样；本报告只说明本次动效范围。
