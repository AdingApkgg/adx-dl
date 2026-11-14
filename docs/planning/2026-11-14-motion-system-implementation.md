# AstroDX 动效基础与共享组件实施计划

执行依据：[已批准规范](2026-11-14-motion-system-design.md)。范围：基础策略、共享组件、远程校准；不迁移主站业务组件和导航行为。

使用 writing-plans、executing-plans、test-driven-development 与 verification-before-completion 技能，由当前会话顺序实施，结束前独立代码审阅。用户已授权实施，沿用当前 codex/dev 工作区，保留其他未提交改动；只提交本次文件需另看最终交付安排。

## 全局约束

- 保留 `adx-reduce-motion`、system/on/off、旧 1/0 解析和所有 legacy 常量原值。
- 参数来源为 AstroDX 候选，默认 expressive，密集交互 standard；effects 无回弹。
- 减少动态效果时共享预设直接落实最终状态；SSR 内容可读，切换后不补播。
- Mac 仅读改代码、轻量命令与单个测试文件；整库检查和浏览器校准走远程。
- 不升级依赖、不发布。沿用远程预览容器，不重启其他任务。

## 重点回归

1. OS、站内选择、临时兼容覆盖优先级；存储异常与水合一致性。
2. CSS、Motion 和手动动画的静态降级；切换减少动画后不重播。
3. 长分组 delay 封顶；按钮 asChild 和直接按钮无双重 transform。
4. 弹层焦点、Esc 与卸载生命周期；Tabs 实例无共享冲突。
5. SSR 内容与完整成功图标；后台/离屏骨架装饰停止。

## Task 1：令牌、语义适配与偏好策略

文件：新增 motion/tokens.ts、presets.ts、policy.ts、adapters/motion.ts 及针对性测试；拆分 provider；修改主题启动脚本；生成 CSS 变量和公共策略样式。

接口：`motionTokens`、`motionPresets`；`resolveReducedMotion(mode, osReduced, forceReducedMotion)`；`getMotionPreset(pattern, options)`；`toMotionSpring(spec)`；`getStaggerDelay(index, stepMs)`；保留原偏好 API。

- [x] 先写参数转换、无回弹效果、静态预设、长分组、DOM 偏好同步和 SSR 可读测试，观察预期失败。
- [x] 实现纯数据与适配；CSS 从 TS 生成，校验生成一致性；旧常量保留。
- [x] 单文件回归通过，记录实际命令和结果。

## Task 2：共享交互和展示

文件：Button、Tabs、DropdownMenu、Sheet、Skeleton；motion/primitives.tsx；新增共享组件策略测试。

- [x] 先写 SSR 可读、减少动态效果完整成功标记、键盘/关闭及循环暂停行为测试，观察预期失败。
- [x] 按预设迁移，保留 props 和焦点行为；避免 CSS 与 Motion 同驱动 transform。
- [x] 执行共享包全部检查，按受影响范围修复。

## Task 3：远程展示与校准

文件：主站 UI showcase 新增动效示例；读取当前 Next 文档后使用现有组件接入。新增轻量生成检查脚本；必要时加强 verify.sh 的断线持久化。

- [x] 展示按压、两组 Tabs、三种 Sheet、菜单、内容入场、数字和成功反馈。
- [x] 使用 dev.sh sync 沿用运行中预览；使用 verify.sh 远程跑 lint、UI/Web 检查，保存日志、退出状态。
- [x] 远程浏览器覆盖常规/reduced、中途切换、快速反向、窄屏、页面前后台；校准参数并保存中文验收说明。
- [x] 独立代码审阅；修复实际问题并补必要回归；更新本计划进度和参数结论。

## 执行记录

- 2026-11-14：远程主机确认为 localhost，tmux 可用；预览容器已运行约 4 小时，计划沿用。
- 决定：docs/superpowers 被忽略，实施记录与规范同存 docs/planning。当前工作区有其他任务改动，本次不改这些业务文件。

- Task 1：令牌、语义目录、Motion 适配、偏好解析与 CSS 生成完成；旧常量和存储值保持兼容。
- Task 2：共享交互与展示完成。额外将 Select/Tooltip 的有限入场接入同一 popup 样式，防止共享浮层各自维护动效；未改业务逻辑。
- Task 3：远程 Chromium 校准及独立审阅完成，详见 `docs/verification/motion-system-2026-11-14/README.md`。WebKit、静态导出导航与主站业务迁移留待后续批次，并非本次已验收内容。
- 决定：保留当前工作区进行交付，不自动提交混合改动；verify.sh 加入 tmux 持久化和退出状态记录，满足用户远程任务规则。
- 决定：ssrVisible 默认 true 并跳过入场，装饰性演示显式 false；CSS 弹层采用 transition 衔接中断，通过无视觉副作用的 animation 保留 Radix 退出生命周期。
- 校准：standard spatial fast stiffness 650→1200，阻尼比 1、mass 1；其他候选值保持。最终参数与证据同存验收目录。
- 验证：新增独立使用数字组件的回归先复现旧值不更新，再修复默认 context readiness；后台门控在模拟 DOM 中固定 viewport 输入，真实离屏行为由远程 Chromium 覆盖。
