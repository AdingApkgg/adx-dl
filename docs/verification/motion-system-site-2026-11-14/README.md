# 主站统一动效验收

## 实施范围

基于已批准的 M3 Expressive 分类与 AstroDX Web 参数，迁移搜索、目录、批量下载条、下载托盘、播放器及页面转场。沿用 standard / expressive、spatial / effects、fast / default / slow、popup / disclosure / layout / page 等语义命名。

- 搜索建议与筛选展开使用可取消的 MotionSurface。目录结果直接替换，不再逐卡 stagger 或退出等待；实例高亮 ID 隔离。
- 进度使用 120ms 有界 tween，减少动态效果立即呈现真实值。托盘飞入可取消，已有成功状态再次展开时静态显示；三秒业务确认超时保留。
- 播放器形变与弹层使用共享参数，折叠/展开保留同一音频节点。唱片、均衡器、长标题与扫描装饰接入可见性、前台和动态效果偏好门控。
- 页面入场 320ms / 退出 180ms、共享移动 450ms 保留。页面边界仅在 pathname 变化时进出；目录 deferred 更新不触发整页动效。原生整页导航通过 CSS @view-transition types: adx-document 与 :active-view-transition-type() 作用域启用 root 动画，不依赖脚本生命周期标记。
- 修复 Motion 在目标值不变时仅修改 transition 无法中止动画的问题：共享 Surface 显式 stop/set，并释放正在退出的 presence。增加中途切换回归。

## 验证方法

完整检查在 Linux 构建机运行：`scripts/remote/verify.sh --keep`，退出码 0。lint 738 个文件通过，UI 类型检查及 58 测试通过，Web 类型检查及 742 测试通过。任务目录：`/home/i/astrodx-verify/jobs/20261114-055137-wt-88b54539-6458/`，保留 run.sh、output.log、exit-code。

独立审阅指出中途减少动态效果未取消既有动画、历史成功反馈重播两项问题，已修复并做先失败后通过的回归测试。浏览器另复现了清空目录时根页面与内容同时转场的问题，增加负例断言并修复。

浏览器使用真实应用、Linux Chromium、1280×960 与 390×844。搜索读取本地真实目录索引；站点流程的播放器外部媒体由 30 秒静音 WAV 替代，原生专项完全阻断外部媒体；下载以隔离浏览器 IndexedDB 暂停检查点和小型文件夹具运行真实恢复/归档链路，校验 ZIP 完整性。外网请求替代或阻断，没有生产写入。Next 开发徽标覆盖播放器点击位置，因此仅在验收浏览器隐藏其 portal，页面运行错误仍收集。

## 预览隔离

共用 3310 目录在同步后出现其他版本覆盖，因此增加可选 `ASTRODX_DEV_SLOT`，默认脚本行为保持不变。本次使用独立目录、容器与端口，前后比较产品源码 SHA256：

- 预览：[http://localhost:3311](http://localhost:3311)
- 远程目录：`/home/i/astrodx-verify/dev-motion-site-20261114`
- 同步：`ASTRODX_DEV_SLOT=motion-site-20261114 ASTRODX_DEV_PORT=3311 scripts/remote/dev.sh sync`
- 关闭：`ASTRODX_DEV_SLOT=motion-site-20261114 ASTRODX_DEV_PORT=3311 scripts/remote/dev.sh stop`

## 浏览器结果（原生补验后的最终回归）

- 站点 7 组主要流程通过，远程记录 `/home/i/astrodx-verify/jobs/motion-site-20261114-native-final/`，结果为 results.json；搜索/IME、目录中断、音频连续性、真实归档、成功反馈不重播、同文档路径切换，以及 390px 减少动态效果布局均通过，页面运行错误为 0。
- 共享组件 13 组回归通过，见 foundation-results.json；远程记录 `/home/i/astrodx-verify/jobs/motion-foundation-20261114-native-final/`。
- 21 个产品文件与 3 个验收脚本在验收前后 SHA256 一致，见 source-manifest.json。
- 原生专项 9 组通过，见 native/results.json；使用 Playwright 1.58.2 配套 Chromium 145.0.7632.6。远程记录 `/home/i/astrodx-verify/jobs/motion-native-20261114-accepted/`。真实链接、进入目录、历史前进后退、OS/站内偏好覆盖、兼容模式、中途取消、390px 及转场后交互均通过，页面运行错误为 0。
- 截图中的外部封面被阻断或显示占位，不代表外部图片服务验收。原生专项中的歌曲载入失败提示来自外部媒体阻断，不代表媒体可用性结论。fixture.zip 仅为本次小型下载夹具。

## 原生整页导航补验

已定位并修复以下三个问题：

1. 旧脚本把 Playwright 1.58.2 强制配到系统 Chromium 152。同一独立静态页面在该组合中不触发进入页 pagereveal；恢复驱动配套 Chromium 145 后，无拦截、请求拦截、初始化脚本三种对照都触发并完成原生动画。脚本改为默认使用 Playwright 配套浏览器，保留显式 ASTRODX_CHROMIUM 供版本对照。这证明本次组合问题，不泛化为所有 Chromium 152 用户有问题。
2. 原生启用规则与减少动态效果、兼容及主题规则把转场伪元素写成 html 的后代。它们实际直接属于根元素；修正选择器后，真实页面捕获到 320ms 进入和 180ms 退出。修复前专项明确失败，仅有浏览器默认 group 动画。
3. Next 流式 HTML 在早期原生 opt-in 判定及首屏快照时，可能尚未完成样式/DOM 解析。把很小的 @view-transition 启用规则内联到 head，并用 rel="expect" 等待 #main-content 的结束标签解析；避免目录进入无动画，以及历史后退捕获到无页头的空壳。不等待图片、下载或客户端水合。

这些修复经过真实页面的失败/通过对照，证据保存在 native/。原生专项不包装 document.startViewTransition，不吞掉 Transition was skipped；页面错误必须为 0。中途切换测试先确认动画仍在运行，再切换 OS 偏好。

根伪元素写法依据 [W3C View Transitions](https://www.w3.org/TR/css-view-transitions-1/)，提前等待目标 DOM 的策略依据 [Chrome 跨文档转场文档](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document)。Playwright 的[相似上游报告](https://github.com/microsoft/playwright/issues/41562)提供了驱动/浏览器组合的排查方向；它不是本次系统 Chromium 152 问题的直接证明，本次结论以独立静态实验为准。

## 覆盖边界

验收不等于生产发布。未执行生产静态构建、部署、WebKit、真实手机或后台/社区业务回归。音频夹具验证播放状态与节点连续性，不证明外部媒体可用；下载夹具验证状态、进度与 ZIP 真实链路，不代表大文件吞吐验收。历史前进后退以新文档路径验证；请求拦截禁用 BFCache，因此没有宣称 BFCache 恢复验收。系统后台门控由共享策略单测覆盖，真实离屏行为由首批浏览器回归覆盖。
