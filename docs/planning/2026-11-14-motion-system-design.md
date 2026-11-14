# AstroDX Motion System v1：统一动效规范与命名方案

日期：2026-11-14。状态：用户已批准；基础策略和共享组件已实施并进行远程校准，主站业务组件与导航迁移留待后续批次。验收见 `docs/verification/motion-system-2026-11-14/README.md`。

独立可实施性复核：已检查现有偏好解析、启动脚本、共享 CSS、页面转场与新旧接口边界，未发现阻碍后续实施规划的重大未决问题。用户随后批准按此实施；参数与行为的首批校准结果见验收记录。文档存放于可入库的 `docs/planning/`，避免使用被仓库忽略的 `docs/superpowers/`。

## 1. 目标与设计选择

以 M3 Expressive 的物理动效体系为主，建立适合 AstroDX 的统一语言：空间运动有连续性与适度弹性，透明度和颜色变化稳定，高频操作迅速，重点反馈有表现力。规范覆盖共享 UI，以及主站的内容入场、搜索筛选、弹层、下载、播放器外壳与页面导航；社区和后台后续复用共享能力，业务组件另行迁移。

用户已确定以 M3 Expressive 为主。以下具体命名、参数候选、场景分配与迁移顺序是本稿提出的方案，尚不代表用户逐项确认。

方案比较：

| 路线 | 收益 | 代价与结论 |
| --- | --- | --- |
| 直接替换为完整 Material 组件体系 | 可直接继承对应平台的组件行为 | 当前是 Radix、Tailwind、Motion 和 View Transition 的组合，替换范围超过统一动效的需要 |
| 保留所有局部动画，只统一几个常量 | 改动较小 | 不能统一场景选择、减少动态效果与多引擎行为 |
| 在现有实现上建立 M3 风格令牌、语义预设和策略层 | 保留组件与交互，逐步统一行为 | 需要 Web 适配与视觉校准；本稿推荐此路线 |

本规范不替换视觉主题、组件库或依赖；实施采用分批迁移，不添加风格切换设置。谱面演出、音频同步、游戏时间轴和 Live2D 引擎内部动作不使用通用 UI 弹簧；它们的 UI 外壳及装饰仍遵循本文的偏好与资源规则。

## 2. 当前实现与缺口

核查的是当前工作区源码，并非生产运行状态。

| 当前入口 | 已有能力 | 待统一部分 |
| --- | --- | --- |
| `packages/ui/src/motion/index.tsx` | `EASE_OUT`、`revealTransition`、`springSoft`；Reveal 系列、弹层 variants、数字与成功反馈 | 场景共用同一弹簧；时长、位移与编排规则没有完整分层 |
| `packages/ui/src/motion/constants.ts`、主题启动脚本 | `system/on/off`、旧存储值兼容、首屏偏好标记 | 保持设置契约；避免引入第二套存储或偏好解析 |
| `packages/ui/src/styles/theme.css` | CSS 减少动态效果、骨架屏共享扫描动画 | 全局样式、Motion 与手动动画的降级覆盖不同 |
| Button、Tabs、Dropdown、Sheet | 按压、选中指示器、菜单错峰、Radix 弹层 | CSS 和 Motion 并存；同一属性可能有多处动画来源 |
| 主站 `page-transition.tsx`、`globals.css` | 页面进出、常驻外壳固定、吉祥物跨页位置衔接 | 页面时间和缓动独立维护，需要接入语义令牌 |
| 搜索、目录、下载托盘、音乐播放器 | 局部入场、布局形变、持续装饰和状态反馈 | 内联参数较多，需要按职责迁移 |

当前 `springSoft` 为 stiffness 320、damping 30、mass 0.7，接近临界阻尼，主要表现为平稳归位；不能仅凭名称把它认作 Expressive 弹簧。`MotionConfig` 的 reduced-motion 也不等于停止所有动画：opacity 等仍可能继续，手动 MotionValue、循环及其他引擎需要单独处理。[Motion 配置说明](https://motion.dev/docs/react-motion-config)

## 3. 核心概念与分层

采用 M3 的 `expressive/standard` 风格、`spatial/effects` 属性分类及 `fast/default/slow` 速度档位。风格与用户动效偏好是不同概念，不能共用一个 `mode` 字段。[M3 动效体系](https://m3.material.io/styles/motion)

```text
策略 Policy：是否播放、是否可循环、减少动态效果、离屏/后台
    ↓ 约束所有层
基础 Tokens：风格 × 属性类型 × 速度；位移、缩放、编排参数
    ↓
语义 Presets：press、selection、reveal、dialog、sheet、page…
    ↓
适配 Adapters：Motion / CSS / View Transition / 必要的 WAAPI
    ↓
共享组件与业务交互
```

### 风格 Scheme

- `expressive`：产品默认风格。用于主要容器、布局衔接、下载托盘和重要反馈；通过小幅形变体现弹性。
- `standard`：明确的局部覆盖。用于搜索建议、目录筛选、密集列表、菜单和频繁按压反馈，减少回弹与视觉干扰。
- 局部覆盖由共享预设定义，业务页面不随意切换整棵树的风格。首版不为此增加 Provider 或用户设置。

### 属性类型 Channel

- `spatial`：位置、缩放、旋转和布局尺寸等空间变化。圆角可归入此类，但应评估绘制成本。
- `effects`：透明度、颜色等视觉变化，禁止回弹或越界。空间和透明度同时变化时分属性指定 transition。
- 进度数值也必须遵循边界与真实状态，不能因为使用弹簧就越过 0–100% 或提前显示成功。

### 速度 Tempo

- `fast`：按钮、开关、选中指示器和小型浮层。
- `default`：普通容器、弹窗、托盘、内容状态切换。
- `slow`：大范围形变或低频重点展示；不用于高频菜单与搜索响应。

弹簧档位代表相对响应特征，不承诺固定结束时间；CSS 时长是固定时间，两者不可混同。实际收敛受初始速度、位移及结束阈值影响。

## 4. 命名方案

整体名称：**AstroDX Motion System**。代码保留 `@astrodx/ui/motion` 入口，不新增含义相同的缩写包。

| 对象 | 命名规则 | 示例 |
| --- | --- | --- |
| 设计令牌 ID | `motion.spring.{tempo}.{channel}`；风格作为独立解析上下文 | `motion.spring.fast.spatial` + scheme=`expressive` |
| TS 基础令牌 | `motionTokens.schemes.{scheme}.{channel}.{tempo}` | `motionTokens.schemes.expressive.spatial.fast` |
| 时间令牌 | `motionTokens.duration.{tempo}`；值统一为 ms | `motionTokens.duration.fast` |
| 空间令牌 | `motionTokens.distance.{size}`；值为 px | `motionTokens.distance.sm` |
| 缩放令牌 | 按语义命名，值为比例 | `motionTokens.scale.press`、`motionTokens.scale.dialogStart` |
| 语义预设 ID | `motion.{pattern}.{action}` | `motion.dialog.enter`、`motion.selection.move` |
| TS 语义目录 | `motionPresets.{pattern}.{action}`，由 adapter 解析 | `motionPresets.dialog.enter` |
| CSS 自定义属性 | `--adx-motion-{pattern}-{action}-{field}` | `--adx-motion-dialog-enter-duration` |
| CSS keyframes | `adx-{pattern}-{action}` | `adx-page-enter` |
| 共享组件 | 沿用 PascalCase，按功能命名 | `Reveal`、`RevealGroup`、`RevealItem`、`RollingNumber`、`DrawnCheck` |

`enter/exit` 表示出现/离开，`move` 表示位置衔接，`change` 表示值变化，`start/end` 表示交互开始/结束。避免新增 `springSoft2`、`smooth`、`fancy` 等无法表达用途的名称。

以下三个字段保持区分：`MotionMode = system | on | off` 是已有用户偏好；`MotionScheme = expressive | standard` 是设计风格；`MotionTempo = fast | default | slow` 是响应档位。`off` 的产品文案继续沿用“减少动态效果”，实现上采用第 8 节的静态降级。

设计 ID 是稳定语义；TS 对象路径是工程表示，两者不要求逐字一致。文档中可带 `motion.` 前缀，代码里不重复写 `motionTokens.motion`。

## 5. 基础参数：先保留兼容值，再校准新体系

首版不把尚未核实的网络参数表当作 M3 官方数值。本文采用 M3 的结构；下列数值是 **AstroDX Web 的校准起点**，不是官方映射或已验收结果。正式实施先做按钮、弹窗、托盘三种尺度的远程预览，再冻结 v1 数值。

### 弹簧候选

基础记录使用 `stiffness`、`dampingRatio`、`mass`，首版新令牌 mass 统一为 1。Motion adapter 使用 `damping = 2 × dampingRatio × sqrt(stiffness × mass)` 转换为阻尼系数；不能把阻尼比直接传给 Motion 的 `damping`。这是线性弹簧模型的转换，不保证不同平台的视觉效果逐帧相同。

| Scheme | Channel | Fast：stiffness / ratio | Default | Slow |
| --- | --- | --- | --- | --- |
| expressive | spatial | 500 / 0.78 | 380 / 0.82 | 240 / 0.86 |
| standard | spatial | 1200 / 1.00 | 420 / 1.00 | 280 / 1.00 |
| 两种风格共享 | effects | 1800 / 1.00 | 1000 / 1.00 | 600 / 1.00 |

2026-11-14 首批校准把 standard fast 的 stiffness 从 650 调整为 1200，按钮采样从约 230ms 缩短到约 183ms 到达目标；其他弹簧保留起点值。此处时间是本次样例观测，不是弹簧的固定时长承诺。

Standard 在 AstroDX 首版采用无回弹候选，属于产品适配。正式实现如改用经过核实的官方参数，应记录来源版本及视觉差异。旧 `springSoft` 单独保留，不通过改 mass 或套新公式悄悄改变其行为。

### 固定时长与空间候选

| 类别 | 候选值 | 使用边界 |
| --- | --- | --- |
| `duration.fast/default/slow` | 120 / 200 / 320 ms | CSS、淡入淡出、非交互关键帧；Motion adapter 显式换算为秒 |
| `distance.xs/sm/md/lg` | 4 / 8 / 16 / 24 px | 局部位移；尺寸衔接不硬套此档位 |
| `scale.press` | 0.97 | 普通按钮；大面积卡片避免整块缩小 |
| `scale.dialogStart` | 0.96 | 普通居中弹窗入场 |
| `stagger.tight/default` | 30 / 50 ms | 仅入场编排；不是 hover/tap transition 的一部分 |
| `stagger.maxDelay/maxItems` | 200 ms / 6 项 | 分组最多前 6 项错峰，剩余项延迟 0；前 6 项延迟也须封顶 |

固定时长路径首版保留现有 `[0.22, 1, 0.36, 1]`，命名为 `motionTokens.easing.enter`；补充 `standard=[0.4,0,0.2,1]`、`exit=[0.4,0,1,1]`，均为 AstroDX 候选，不声称精确模拟弹簧。纯淡出使用无回弹曲线即可。

不在同一个 Motion spring transition 中混用 `stiffness/damping/mass` 和 `duration/bounce/visualDuration` 来控制结束时间；按属性拆开，避免误解参数优先级。[Motion transition 文档](https://motion.dev/docs/react-transitions)

## 6. 语义预设目录

下表是 v1 的完整最小目录。每个预设必须定义最终状态、常规 transition、减少动态效果状态和可打断方式。表中的时间与幅度都是待视觉校准的 AstroDX 候选。

| Pattern / Action | 场景与风格 | 常规行为 | 减少动态效果 |
| --- | --- | --- | --- |
| `press.start/end` | 按钮；standard fast spatial | 1 → 0.97 → 1；立即响应，无排队 | 保持 scale=1，颜色等状态立即变化 |
| `hover.start/end` | 有精细指针的卡片/控件；standard fast | 优先颜色；允许小图标或卡片抬升 4px，不对普通按钮普遍加位移 | 不抬升，状态立即变化 |
| `selection.move` | Tabs、搜索高亮；standard fast spatial | 同组指示器衔接，保持尺寸连续 | 直接到达目标位置 |
| `reveal.enter` | 次要内容与标题；expressive default spatial + fast effects | y=16 → 0，opacity=0 → 1；每次挂载最多一次 | 从首屏起可见，无延迟 |
| `popup.enter/exit` | 菜单、搜索建议；standard fast spatial + fast effects | y=4 → 0、透明度入场；退出仅淡出 120ms | 立即显示/移除 |
| `backdrop.enter/exit` | 弹层遮罩；default/fast effects | 透明度入场/退出，无缩放 | 立即显示/移除 |
| `dialog.enter/exit` | 居中弹窗；expressive default spatial + fast effects | y=12、scale=0.96 → 归位；退出仅淡出 120ms | 最终布局立即显示/移除 |
| `sheet.enter/exit` | 侧栏、全屏面板；expressive default spatial + fast effects | 按边缘方向做 24px 局部位移；退出固定时长 120ms，可中断 | 立即显示/移除 |
| `layout.move` | 下载托盘展开、受控容器重排；expressive default spatial | 从当前尺寸/位置向新布局衔接；密集目录局部覆盖 standard | 直接使用新布局 |
| `page.enter/exit` | 页面导航；CSS/View Transition | 首版保持现有入场 320ms、退出 180ms 和既有 keyframes | 禁用快照运动，直接呈现新页面 |
| `shared.move` | 吉祥物等有明确连续关系的跨页元素 | 首版保持现有 450ms 位置/尺寸衔接；禁止旧新副本双显 | 直接放入目标布局 |
| `number.change` | 浏览数等非关键读数；effects default | 插值至真实值；普通变化目标 200ms，不修改业务原值 | 直接显示真实值 |
| `progress.change` | 下载进度；standard fast | 用单调、有限的 120ms 插值接近已收到进度，不回弹；同一任务不倒退，重试/新阶段可明确重置 | 直接显示已收到进度 |
| `feedback.success` | 下载真正完成后；expressive fast spatial + effects | 完成图标或一次小幅形变；SVG 描边目标 320ms | 直接显示完整成功图标 |
| `ambient.loop` | 唱片旋转、骨架扫描、装饰呼吸 | 周期按对象定义，不套 fast/default/slow；仅可见且页面前台时运行 | 停止装饰，保留静态状态与文字 |

Sheet 的 `side/centered/fullscreen` 是现有组件布局接口，不重命名。`centered` 映射 dialog 语义；`side/fullscreen` 映射 sheet 语义，方向由布局提供。业务表单提交、关闭、焦点恢复不得等待弹簧自然收敛。

`feedback.success` 与 `ambient.loop` 可以有对象专属关键帧，但必须引用基础时间/曲线并集中定义。下载、打包、写入完成分别以真实业务信号驱动；动画结束不能触发或冒充业务成功。

## 7. 编排和交互规则

1. 一次交互只有一个主要运动焦点。弹窗和遮罩同步开始，不先等遮罩结束再显示内容。
2. 不串联页面入场、整页 Reveal 和所有卡片入场。导航负责页面过渡，首屏主内容可立即阅读，Reveal 只修饰次要内容。
3. 搜索、筛选、列表更新不做“先逐个退场、再逐个入场”。保留稳定 key 和当前滚动位置，更新立即发生；大目录不逐卡开启 layout 测量。
4. Stagger 只属于初次展示或新增的一小组内容。排序、每次输入、hover/tap 和退出不继承入场 delay。React Children 的分组索引以显式组项为单位，不假设能给任意深层后代生成独立序号。
5. 快速反向操作从当前状态接续，取消旧动画；不排队。页面跳转和业务提交不等待退出动画。浮层可保留受控视觉退场，但交互与焦点策略必须立即、正确响应关闭。
6. 每个元素的同一属性只有一个动画所有者。CSS `transform`、Motion `layout/scale`、WAAPI 和 View Transition 不同时驱动同一个运动；必要时用外层布局、内层装饰拆分。
7. `layoutId` 在组件实例或组内有作用域；无关 Tabs、多个播放器/列表不得意外共享。View Transition 的元素名保持稳定，避免重复快照名。
8. 页头、播放器、下载托盘、底栏等常驻外壳维持固定策略；`shared.move` 只用于明确要跨页衔接的元素，不能给整站常驻元素统一加形变。
9. 拖动、指针跟随保持输入连续；弹簧用于归位或受控缓冲。磁吸、视差仅用于支持 hover 的精细指针，不能影响键盘焦点或点击目标。

## 8. 偏好、可访问性和资源策略

### 偏好解析

保留现有 `adx-reduce-motion` 存储键、`system/on/off` 与旧 `1/0` 兼容。策略层单点解析，提供给 Motion、CSS、View Transition 及手动动画：

```text
effectiveReduced = forceReducedMotion
                OR mode == off
                OR (mode == system AND osPrefersReduced)
```

`forceReducedMotion` 是兼容模式的临时覆盖，优先于 `on`，不改已保存偏好。`on` 只覆盖 OS 的 reduced-motion 选择，不覆盖离屏、后台和资源限制。

### v1 目标行为

- effectiveReduced 为真时，所有本文覆盖的 UI 预设立即到达最终状态，去掉位移、缩放、插值、stagger、扫描和循环；不统一保留淡入。焦点、颜色状态、进度文字、错误/成功信息仍正常显示。
- CSS 的极短时长兼容手段可以保留，但不能依赖 `animationend/transitionend` 才完成业务逻辑；MotionConfig 仅作额外保护，不代替完整策略。
- 中途打开减少动态效果时，取消在途动画并落实当前业务状态；关闭后不重播已有入场或历史成功反馈，只影响后续交互。处于可见、前台且业务条件满足的持续状态装饰可恢复。
- SSR/水合前的主内容和关键反馈必须可读，不能因 opacity=0 永久隐藏。保留 `ssrVisible`，默认 true 时跳过入场、保持内容可见；装饰性内容显式 false 才播放 Reveal，迁移时检查内容入口默认值；服务端和客户端首棵树一致。首屏 reduced-motion 标记沿用现有主题启动机制；如需有效 OS 状态属性，复用同一解析规则。
- 隐藏页面、离屏持续装饰应暂停；重新可见时按当前状态继续，禁止补播积压动画。真正表示“正在进行”的加载状态保留静态图标与可访问文字。
- 数字动画的辅助技术文本始终是真实最终值；动画帧不逐帧播报。弹层保留 Radix 的焦点陷阱、Esc、滚动锁与焦点恢复，不以动画包装替代这些能力。

这是目标契约。现有 Provider、CSS 和手动动画尚未完整满足，实施时应先统一策略，再宣称 reduced-motion 合规。

## 9. 工程组织与适配边界

建议文件结构（仅规划，当前不创建这些代码文件）：

```text
packages/ui/src/motion/
  constants.ts        # 保留用户偏好常量，无 use client
  tokens.ts           # 纯数据：spring、durationMs、distance、scale、stagger
  presets.ts          # 纯数据：语义状态、令牌引用、reduced 最终状态
  policy.ts           # 纯函数：偏好与环境规则
  adapters/motion.ts  # dampingRatio 转换、ms→s、分属性 transition
  provider.tsx        # 偏好订阅与 DOM 标记
  primitives.tsx      # Reveal 系列、数字和反馈组件
  index.tsx           # 保留兼容入口与导出
packages/ui/src/styles/
  motion.css          # CSS 语义变量及公共规则，接入 theme.css
apps/web/src/app/
  globals.css         # 仅保留主站 keyframes 与 View Transition 绑定
```

`presets.ts` 保存平台中立的数据描述，不直接当作 `<motion.div {...preset}>` 使用。Motion adapter 提供 `getMotionPreset(pattern, { reduced, ...layoutOptions })`，返回明确的 `initial/animate/exit/transition` 等 props；具体类型在实施时按已安装版本定义。CSS 与 View Transition 使用相同语义目录，首版允许无手势、不可中断快照路径采用固定时间近似；不声称与物理弹簧等价。

TS 令牌是数值唯一来源；实施时提供轻量同步脚本生成 CSS 变量片段，并标明禁止手改，CI 检查生成结果一致。常规构建不额外动态生成或运行物理拟合。Motion、CSS 各自的减少动态效果入口必须覆盖同一 effectiveReduced 规则。

共享组件从 `@astrodx/ui/motion` 取 motion、预设、偏好 hook；`useScroll/useSpring/useMotionValue` 等底层 hook 可继续直接从现有 `framer-motion` 导入，站内偏好判断必须使用共享 `useReducedMotion`。首版不迁移包名至 `motion/react`，不因整理规范升级依赖。

对特殊磁吸、飞入下载托盘等组合动画，允许组件私有编排；必须引用令牌、说明用途及 reduced/离屏行为，不把每个业务组件都塞进全局预设目录。

## 10. 兼容和迁移对应

先增加新能力，旧导出保持原值和原行为；标记 legacy 后逐处迁移。不能直接把旧名重新指向新参数，让全站未经检查地一起变化。

| 现有实现 | 目标归属 | 迁移注意 |
| --- | --- | --- |
| `EASE_OUT` | 新 easing.enter；旧导出作为等值兼容入口 | 保持原曲线，新场景按语义选取 |
| `revealTransition` | `reveal.enter` | 旧 500ms 不直接全局改成新弹簧 |
| `springSoft` | 按用途拆到 press、selection、layout 等 | 逐场景选择风格与速度，旧对象原样保留 |
| Reveal、RevealGroup、RevealItem | 同名组件消费 reveal 与 stagger 令牌 | 保留旧 props；延迟封顶与 reduced 行为是显式迁移项 |
| backdrop/dialog/sheetVariants | backdrop/dialog/sheet 语义目录 | 保留旧 hidden/visible 状态；新 adapter 使用独立目标状态，不直接替换旧 variants |
| RollingNumber、DrawnCheck | number.change、feedback.success | 保留最终值可访问文本；成功图标在 reduced 下完整可见 |
| Button、Tabs、Dropdown | press、selection、popup | 处理 CSS active transform 与 Motion scale 的所有权；asChild 路径同步检查 |
| Radix Sheet | dialog/sheet/backdrop 的 CSS 适配 | 保留焦点管理；验证关闭动画与卸载生命周期 |
| 主站 PageTransition 与 CSS | page、shared | 首阶段保持原时间与 keyframes，只集中命名/来源 |
| 搜索、目录 | popup、selection、layout；局部 standard | 输入无等待、大结果列表不做整批错峰/测量 |
| 下载托盘、播放器 | layout、progress、feedback、ambient | 保留真实进度与完成信号；持续装饰受策略控制 |

分四批推进，每批可独立回退：

1. **基础与偏好**：令牌、目录、adapter、CSS 同步和策略测试；保留 legacy。新增 UI showcase 场景用于远程校准，不先铺满业务页。
2. **共享交互**：Button、Tabs、菜单、Sheet、Reveal、数字及成功标记；冻结候选手感后再迁移业务。通过组件参数或明确 legacy 路径保留回退能力。
3. **主站核心流程**：搜索/筛选、下载托盘、播放器外壳；逐组件替换内联参数，保持业务逻辑。
4. **导航与收尾**：统一页面/共享元素命名与变量，评估是否需要改页面手感；扫描旧引用。仅在所有调用者迁移并通过回归后，单独安排旧导出移除。

社区、后台业务页作为后续独立批次，不把共享 UI 改完等同于全部应用验收。

## 11. 验收与完成标准

下列为整个规范的验收目标；首批实际完成与未覆盖项以配套验收记录为准：

- **参数与策略**：单位转换、阻尼比转换、令牌引用、CSS 同步、偏好优先级和旧存储值兼容有针对性测试。
- **状态行为**：快速连续打开/关闭、连续选择 Tabs、搜索输入、下载列表增删均可打断，无积压延迟、残留变换或意外共享元素。
- **减少动态效果**：覆盖 system 的两种 OS 状态、on/off、forceReducedMotion、中途切换、存储不可用与水合；验证静态完整内容、循环停止和关闭后不重播入场。
- **业务与可访问性**：SSR/无 JS 内容可读；键盘焦点、Esc、弹层关闭正常；进度不越界，未完成任务不因动效显示成功，真实完成后能正确呈现。
- **浏览器与性能**：桌面 Chromium/WebKit、手机窄屏；现有真实目录规模下无整批 layout 测量或按卡片常驻循环；前后台、离屏和低兼容模式正确停用装饰。静态构建不依赖客户端动画才能展示内容。
- **导航**：客户端切页、完整文档导航、前进后退及不支持转场时均可用；页头/播放器/托盘无双影或闪动，跨页吉祥物只在预期场景移动。

使用仓库 `scripts/remote/verify.sh` 做必要检查，`scripts/remote/dev.sh` 做远程预览与校准；构建、整库类型检查和浏览器回归不在 Mac 上运行。跨文档 View Transition 和最终静态导出行为在远程静态产物上补验，不能只用 dev 结果代替。

v1 完成需要已迁移范围的代码检查、真实浏览器证据及 reduced-motion 验证共同通过。弹簧候选只有在视觉校准后才成为稳定令牌；文档完成不等于行为已交付。

## 12. 依据与待实施决定

2026-11-14 核对：

- [M3 Motion physics system](https://m3.material.io/styles/motion)：采用其风格、空间/效果与速度分类。本文局部预算、候选参数、命名和策略是 AstroDX 的设计提案。
- [M3 specs](https://m3.material.io/styles/motion/overview/specs)：官方数值及 Web 换算的后续核对入口；本次正文页面仅返回 JavaScript 提示，未据此认定任何数值已核实。
- [Android MotionScheme](https://developer.android.com/reference/kotlin/androidx/compose/material3/MotionScheme)：核对六类 spec 及风格概念，不作为当前 Web 组件 API。
- [Motion transitions](https://motion.dev/docs/react-transitions)、[MotionConfig](https://motion.dev/docs/react-motion-config)、[Accessibility](https://motion.dev/docs/react-accessibility)：适配与策略依据；当前声明为 `framer-motion ^13.4.4`，`bun.lock` 与已安装包均为 13.4.4。在线文档可能包含更新版本能力，本文不依赖未经安装版本核实的新 API。
- 现有源码：`packages/ui/src/motion/`、`packages/ui/src/styles/theme.css`、共享交互组件、主站 `page-transition.tsx/globals.css`、搜索、目录、下载托盘和播放器。

实施者可以决定内部 TypeScript 类型、生成脚本位置和测试组织；不得自行改动本文的用户偏好契约、语义目录或业务成功边界。需要视觉校准才能确定的项目是弹簧数值、空间幅度及固定时长近似效果；通过远程对比预览后记录最终值与理由。涉及范围扩大或新的产品取舍时另行确认。
