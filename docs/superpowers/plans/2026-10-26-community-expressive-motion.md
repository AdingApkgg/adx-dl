# 自制谱站表现力动效实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 在当前工作树实施；依用户要求，测试执行延后到上生产前集中进行。

**Goal:** 强化首页、封面、导航与内容节奏，保持操作状态和减少动画能力。

**Architecture:** 共享层补导出现有 Motion hooks 与只读偏好 ready 状态；社区 motion-ui 维护分级进入，独立 motion-artwork 与 motion-hero 管理鼠标/可视性装饰。复用组件接入，不改路由身份和业务接口。

**Tech Stack:** React 19 / React Router / framer-motion / TypeScript。

**Spec:** docs/superpowers/specs/2026-10-26-community-expressive-motion-design.md。

## Global Constraints

- 开发期间不跑测试，不安装依赖、不在 Mac 构建或预览、不推送生产。
- SSR 正文可见，位移立即可取消，偏好共享，业务树不因动画重挂载。
- 测试只补关键行为契约，远程集中执行；不以代码静态阅读代替浏览器通过。

## Review Focus

- SSR/hydration 的 boot-script off 是否阻止首帧动画。
- 关闭动画/改变系统偏好时 spring 和循环是否立即归零。
- 触屏/键盘/后台标签是否保持正确滚动、焦点与资源释放。
- 父子 transform 是否影响 fixed/dialog/player 或导致双重移动。
- 列表 key、权限卸载与表单状态是否保留原有契约。

### Task 1: 分级进入与共享导出

**Files:** packages/ui/src/motion/index.tsx; apps/community/src/client/components/motion-ui.tsx; apps/community/src/client/components/page-title.tsx。
**Interfaces:** useEnterMotion(kind)；MotionSurface tone?: content|title|feature|dock。

- [x] 补导出现有 Motion hook，并保持共享默认行为。
- [x] 加入分级进入、有限级联与成功回响，保持 complete/stop 清理。
- [x] 更新 DOM 契约断言；暂不执行。

### Task 2: 首页光场与封面交互

**Files:** 新建 motion-preference.ts, motion-artwork.tsx, motion-hero.tsx；修改 home.tsx, public-chart-card.tsx, app.css。
**Interfaces:** useMotionActivity(ref) -> enabled/active；MotionArtwork({children})；MotionHeroBackdrop。

- [x] 实现 boot 偏好、可视性、页面 visibility 与精细指针门控。
- [x] 实现 MotionValue 跟手封面，高光独立层，不逐帧 React 渲染。
- [x] 实现有界的首页轨道和流光，保持 SSR 与搜索建议层级。

### Task 3: 页面与操作的整体节奏

**Files:** library-ui.tsx, discussion-ui.tsx, download-actions.tsx, library-actions.tsx, public-chart-detail.tsx, app.css。
**Interfaces:** 现有组件接口保持不变，浮层使用 dock tone。

- [x] 首页分组编排，详情主视觉、卡片、导航图标和列表悬浮的层次统一。
- [x] 只对真实成功反馈添加回响；工具区无持续动画。
- [x] CSS off/system 覆盖清理 hover、导航和装饰运动。

### Task 4: 静态复核与集中验收准备

**Files:** test/dom/motion-ui.test.tsx; test/acceptance/motion-browser.mjs; docs/verification/community-expressive-motion-development-2026-10-26.md。

- [x] 增加关闭动画、SSR、指针、后台暂停和状态保持的关键契约。
- [x] 静态检查 diff、事件解绑和 key，不执行测试。
- [x] 最终独立代码审查，修复重要问题并记录未执行的远程集中验收。

## 当前状态

实施与最终独立静态审查已完成；审查发现的3项 Important和2项 Minor已有对应修正。所有测试、构建和浏览器验收均未执行，保留到用户授权的远程集中验证阶段，不可据此标记生产发布完成。
