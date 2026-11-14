# WebKit 动效补验

修复结论：页面内动效与交互通过；跨页面导航在原生快照丢失时，会恢复一次 320ms 内容入场。Chromium 保持原生路径，WebKit 的本轮完整页面场景走恢复路径。没有将“WebKit 原生快照不再取消”作为修复结论。

## 修复与最终回归

- `navigation-motion.ts` 在水合前监听原生页面生命周期，为站内 push/replace 导航写入短期、一次性的目的地记录。进入页只有收到空快照或原生 ready 拒绝，且目的地、时限和动效偏好均符合时才恢复动画；成功的原生转场不补播。
- 内容入场只作用于最终的 `main`，加载占位和固定导航/播放器/下载托盘不重复移动。减少动态效果和简化兼容模式优先；直接访问、刷新、历史遍历、外链、锚点、过期目标不补播。生命周期计数隔离旧的 ready 拒绝，避免历史恢复时重播。
- 首次快照的 expect 目标移到外壳末尾的稳定标记，覆盖固定播放器/下载托盘的解析，不再依赖会被流式加载替换的 main。它不是线上原生快照取消的根因修复。
- 远程完整检查退出 0：UI 59 项、主站 793 项测试，类型检查、lint、CSS 令牌生成检查通过。记录：`/home/i/astrodx-verify/jobs/20261114-213812-wt-f84bbf96-49288/`。lint 的两个 warning 和一个 info 来自未改动文件，本轮未扩展清理范围。
- 新增行为测试先出现两个恢复缺失失败；实现后转绿。追加旧 ready 拒绝在历史恢复后补播的用例，先失败，再加入生命周期隔离，最终 7 项通过。
- `check-navigation-motion.mjs` 的 WebKit / Chromium 共 12 组实际浏览器验收通过，见 `recovery-results.json`。各内核分别验证应用正常导航的桌面/手机、主动取消快照后的桌面/手机、减少动态效果，以及真实原生成功的独立对照。原生对照使用从真实应用读取的启动脚本和 CSS，验证真实原生 ready/finished 与 320ms 入场，不替换浏览器转场 API。
- Chromium 应用场景保持原生动画；WebKit 应用场景捕获到最终 main 上的实际 CSSAnimation（320ms），不是只检查 DOM 能打开。主动取消用 pageswap 上的原生 skipTransition 注入取消条件，确保恢复路径有真实失败输入；减少动态效果不补播，刷新不重播，最终内容不透明且无横向溢出，页面错误为零。
- 浏览器任务目录：`/home/i/astrodx-verify/jobs/motion-webkit-fix-20261114/acceptance/`；截图取回 `/tmp/astrodx-webkit-fix-20261114/evidence/`。最终源码使用独立 3315 预览，Next16.4.6；未覆盖旧预览。生产是否发布以 PR / 发布工作流为准。

以下保留修复前调查，不能将其中的首次部分通过状态当作最终验收。

## 环境与方法

在构建机 `localhost-1.tailac9c6f.ts.net`（hostname 为 `localhost`）使用已有的 `mcr.microsoft.com/playwright:v1.64.1-noble` 容器及匹配驱动运行 WebKit 27.2。宿主机缺 GTK / ICU 等依赖，未安装或修改宿主机依赖。任务持久化在独立 tmux，目录为 `/home/i/astrodx-verify/jobs/motion-webkit-20261114/`。

- 线上交互：`https://adxdls.saop.cc`，1440×1000、390×844，以及 390×844 + OS 减少动态效果三个隔离浏览器上下文。手机配置使用 mobile/touch 模式，仍然是 Linux Playwright WebKit，不能等同于真实 iPhone Safari。
- 音频替换为一秒 WAV，避免外部媒体加载影响动画验收；不证明真实音频源可用。首轮未隔离音频时发生了外部音频访问控制报错，原始失败记录留在远程任务目录。
- 下载测试只创建隔离浏览器内的任务并打开管理器，检查布局与交互，不证明归档、持久化或真实下载完整性。截图中的存储降级提示也不能据此泛化到所有 Safari。
- 共享组件：使用已有 3313 预览和 `check-motion.mjs`，不修改其产品源码；此次为脚本增加 `ASTRODX_BROWSER_ENGINE=webkit` 选择，默认仍为 Chromium。

## 已通过

三个线上场景均通过搜索建议的键盘操作、播放器完整视口边界、背景 inert、队列菜单层级、曲库/歌单切换、连续 20 次 Tab 焦点约束、关闭后焦点恢复、下载管理器视口边界。两个常规模式还通过运行期间切换 OS 减少动态效果。隔离媒体后的页面错误为零，见 `functional-results.json`。

桌面滚动锁定由真实 wheel 输入验证；手机由 PageDown 与 `overflow:hidden` 验证，未做原生触摸滑动或 Safari 地址栏伸缩验收。焦点恢复使用实际状态等待；最初固定等待 150ms 出现过失败，条件等待后通过，未据此修改产品代码。

共享动效 13 组通过，见 `foundation-results.json`：常规与 asChild 按压、按压中减少动态效果、离屏暂停、三类弹层边界和焦点恢复、弹窗入场中关闭、快速 Tabs/键盘菜单、实际 Reveal 轨迹、静态最终状态、OS/站内覆盖、保存偏好和窄屏。截图已检查播放器与下载管理器，保存在远程任务目录及本机 `/tmp/astrodx-webkit-20261114/evidence/`。

## 原生跨页转场缺口

真实点击普通同源链接从首页进入 `/charts/12061`，离开页的 `pageswap.viewTransition` 有效，type 为 `adx-document`，进入页的 `pagereveal.viewTransition` 为空；三个场景都能正常进入并继续交互，但不能视为动画通过。`functional-results.json` 保留首次功能脚本的原始 `status: passed`，该状态只表示功能断言通过；后续脚本已将存在普通切页降级的整体状态明确记为 `partial`。

区分实验：

1. 同一 WebKit 的最小静态页面能实际执行 320ms 入场和 180ms 退出，不能将缺失简单归因于内核不支持 API。
2. 仅预取目标 HTML 仍未接续转场，见 `native-warm-results.json`。该诊断保留了外部请求错误，不属于零错误验收。
3. 缓存真实 HTML 与三份 CSS 后，保留页面脚本仍未接续；移除页面脚本后入场/退出恢复并完成，见 `native-cached-results.json`。移除 expect 的附加场景同时移除了脚本，不能单独证明 expect 有问题。
4. 进一步区分主题脚本与外部运行时的实验遇到绘制事件尚未到达、探针链接被初始化移除等时序问题，未形成可用归因。现有证据只把调查范围缩到脚本参与/初始化时序，不能断言某个具体脚本、Next 或 WebKit 是根因，也不能直接推断真实 Safari 必然复现。

在这个调查阶段尚未进行产品修复。后续单变量实验已排除主题脚本、expect 目标、外部注入脚本或隐藏 iframe 的单独影响，没有发现站点主动调用新的 startViewTransition。未定位到 WebKit 取消原生快照的具体底层原因，因此采用上述有边界的恢复路径，不改 Next/React 内部，不禁用页面脚本、交互或安全设置。真实 Safari 与完整原生共享元素效果仍不在本轮验收结论内。

## 复用

线上专项：设置 `ASTRODX_PLAYWRIGHT_PATH`、`ASTRODX_MOTION_EVIDENCE`，在远程匹配容器内运行 `scripts/remote/check-motion-webkit.mjs`；可通过 `ASTRODX_PREVIEW_ORIGIN` 指定候选环境。

共享组件：设置上述变量、`ASTRODX_BROWSER_ENGINE=webkit` 和本机回环的 `ASTRODX_PREVIEW_ORIGIN`，运行 `scripts/remote/check-motion.mjs`。所有安装、浏览器与预览仍须在专用构建机执行。
