# 自制谱站表现力动效开发记录

2026-10-26。分支 `codex/community-expressive-motion`，基线 `4592acf8a9faab4ea924ee0d961fe83222b489ff`。本轮为开发交付，未推送、未部署。

## 已实现

- 首页：主题色流光、双向轨道、点阵层与渐变标题；标题/操作/每日谱面有分级进入。
- 封面：鼠标位置驱动约5度倾斜、3%放大与局部高光，弹簧归位；触摸不接管滚动，键盘有静态高光。
- 全站现有 MotionSurface：内容18px、标题24px、主视觉32px、浮层20px，列表最大0.275秒级联；路径进入16px且不再叠加整页透明度变化，query/hash不重放。悬浮抬升6px，导航指示器/图标与成功回响统一。
- 保留原有列表 key 和语义；无退出快照、无业务内容延迟卸载、不改上传、表单、播放器或鉴权接口。
- 首屏服务端内容可读。首页持续动效只在可视、前台且偏好允许时运行；封面只在精细鼠标指针下响应。
- 共享包只补导出已安装 Motion 的 useInView/useSpring，并新增只读偏好 ready 状态，未改主站调用。

## 静态复核与修复

- 独立审查发现 render 读取 effect 才更新的 data-motion，会导致 off→on 的装饰动效无法即时恢复。已改为 Provider ready + 当前 React reduced 状态；待集中验证。
- 独立审查进一步确认库内 transform 策略可能保留挂载时系统偏好。首页循环只在 React active 门控为真时运行，静止分支时长0；已补 OS reduce→手动 on→system→OS恢复的真实轨道帧断言。
- 集中 types 发现 React 公开 `Transition` 类型不含底层 motion-dom 的 `reduceMotion`（4×TS2353）。改为共享包导出已导入的 `MotionConfig`，仅在 `MotionHeroBackdrop` 用局部 `<MotionConfig reducedMotion="never">` 包纯装饰节点，移除4处 transition 参数；active 门控与 duration0 不变，无依赖或主站行为修改。
- 封面滚动/窗口失焦/窗口缩放监听仅在鼠标实际交互时注册，离开/中断/卸载解绑；页面可见性订阅共用一个全局监听。
- 已补 DOM 契约：SSR、初始偏好、前台/后台与可视门控、开关恢复、系统减少动画与手动覆盖、输入实例和未提交内容。
- 已扩展现有无头动效组：实际3D倾斜、高光、归位、触摸静止、关闭时静止、首页轨道实际运动与中断。
- 审查指出轨道 transform 字符串变化可能把一次性跳变误判为循环。已改为连续两个帧窗的矩阵数值差，停止时采样4帧单位矩阵；待集中执行。
- 审查指出首页多层进入可能累计82px位移。已改为静止布局父层，标题/操作/每日卡片分别进入；详情也拆为封面和标题独立进入。路由只做位移，避免整页透明度再乘一次。实际视觉效果仍需远程浏览器验收。
- 成功回响为偏好初始化后才挂载的纯装饰节点，使用显式起始姿态，避免 `initial=false` 直接跳到透明终态；SSR仍只输出静态勾选。
- `git diff --check` 静态差异检查无错误。未运行测试、类型检查、构建、浏览器或远程命令。

独立静态审查已结束：3项 Important与2项 Minor均看到对应修正，无遗留 Critical/Important 静态发现。此结论不代表运行时或视觉验收通过。

## 集中验收前不可声称通过的项目

1. 构建机执行社区与共享包类型/DOM/业务验证；执行主站回归，确认新增 ready 状态不会产生行为变化。
2. 浏览器验证动画 on/off/system 即时切换、初始 off 不闪动、后台/离屏暂停、鼠标/触摸/键盘。
3. 320/390/768/1280 布局、搜索建议层级、快速路由切换、未提交表单、谱面1第6槽播放/暂停/拖动。
4. 原有19组正式发布门禁、版本回执、健康与备份。全部通过后才能推送部署并标记发布完成。

## 2026-10-26 动效缺陷根因与修复（阶段1）

- 根因：`packages/ui/src/motion/index.tsx` 的 `MotionProvider` 把站点偏好 `system` 直接映射为 framer-motion 的 `reducedMotion="user"`，而 framer-motion 13.4.4 的 `useReducedMotion` 用 `useState(prefersReducedMotion.current)` 只在挂载时采样一次 OS 信号。页面在 OS 已开启“减少动画”时加载，之后即使 OS 关闭，`useAnimate` 仍按旧值跳过 transform，transform 被跳过，路由没有实际位移（opacity 保持 1）。
- 修复：`motionConfigPreference(mode, systemReduced?)` 保持单参兼容（`system` 无第二参仍返回 `user`）；`MotionProvider` 复用已有 `useSyncExternalStore` OS 订阅取实时布尔值，`system` 解析为 `always`/`never`，显式 `on` 恒 `never`、`off` 恒 `always`。SSR 快照仍为 `false`，hydration 与 ready 结构不变。
- 契约：`motion-preference.test.ts` 新增实时 system 与显式覆盖两组用例。
- 真实组件浏览器夹具（非 mock，实际 `MotionProvider`/`RouteMotion`/`BrowserRouter`，同一输入框 sentinel）8 场景：初始 reduce→no-preference/system 由 0px 变为 13.61px（原红转绿）；初始 no-preference 13.61px；manual on 13.61px；system reduce 与 off 均 0px；动画途中切 reduce/off 后帧不再变化且终态 m42=0、opacity=1；全部场景输入节点与值保留。证据 `evidence/20261026-034527-wt-2630b19f/motion-route-repro-20261026-052106/repro.log` 与 `after-live-policy.log`。
- 定向回归：shared UI 类型 + 39 测试、community 类型、web 类型 + 603 测试、community DOM 285、两改动文件 Biome lint 均通过（退出码 0）。community 后台单测因该次容器缺 `TEST_REDIS_URL`/`TEST_DATABASE_URL` 与 Redis/Postgres 服务在 Redis 处超时，属环境原因，不计通过。
- 边界：以上证明的是共享 UI 策略与真实组件行为，**尚未证明**原 CI `MOTION_WAIT_TIMEOUT ROUTE_ENTRY_OBSERVED` 与本次为同一根因；需下一次 exact-head 完整 CI（含 Chromium 与 fresh-volume restore）全绿才能确认。生产发布与 19 组正式门禁仍待验收。
