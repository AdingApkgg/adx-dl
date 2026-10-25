# Community UX Completion Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; 用户已授权完整连续实施及集中验证后的正式部署。本会话实施全部任务，整批一次独立复核；开发期不运行测试。

**Goal:** 补齐社区站整体UI/UX遗漏，使等待/恢复、创作、个人记录与辅助页面形成一致流程。
**Architecture:** 延用既有外壳、token和状态机；增加路由反馈、状态展示、共享确认原语，迁移遗漏页面而不重写业务控制。
**Tech Stack:** 现有React/React Router、共享@astrodx/ui/radix-ui、Paraglide，无新增依赖。
**Spec:** docs/superpowers/specs/2026-10-25-community-ux-completion-design.md

## Global Constraints

- 复用当前已附加隔离worktree，从683d546b创建codex/community-ux-completion；不触碰主工作区，不跑开发期基线测试或安装。
- 不改API、数据库、服务端权限、数字链接、导入/下载/发布状态机或源码虚拟列表几何；确认组件无硬编码文字/路由。
- 全部新增文案zh/en/ja；保留system/on/off、SSR/no-JS、原组件key、身份清理和草稿保护。
- 测试先写但统一留到发布窗口执行；没有执行的步骤只记实现，不声称通过。

## Review Focus

- 快速/取消导航、query/hash、对话框中后退的焦点与进度清理。
- 账号/权限变化时清除私有内容，不在全局状态保存私密标题。
- 确认pending/失败/取消不误写、不丢草稿、焦点不逃逸。
- 320px长文本和0行源码，虚拟行上限12且行高32不变。
- 校对与比较的播放/seek/选版和动画开关保持原状态边界。

### Task 1: 交互与状态基础

**Files:** 新增packages/ui/src/components/confirmation-dialog.tsx及对应测试；新增community route-feedback.tsx、ui-states.tsx与DOM回归；修改root.tsx、error-card.tsx、app.css、三语言messages。
**Interfaces:** ConfirmationDialog({open,onOpenChange,title,description,confirmLabel,cancelLabel,pending,onConfirm,destructive?})；EmptyState({title,description?,children?})；LoadingState({label})；RouteFeedback()位于框架Data Router根部。
- [x] 编写确认、焦点与慢导航/取消导航回归，开发时不执行。
- [x] 实现上述原语与错误恢复、手机基础可用性；保留SSR可读及正文实例。
- [x] 静态核对并原子提交，ledger标记验证pending。

### Task 2: 作者编辑与校对完整流程

**Files:** chart-new/detail/review/compare.tsx；chart-upload.tsx、chart-metadata-editor.tsx、chart-publication.tsx、simai-source.tsx、author-report.tsx；新增author-navigation.tsx及必要DOM回归。
**Interfaces:** AuthorNavigation({id,view,version?})保留原版本查询和回工作台；其余组件业务props不变；使用Task1状态与确认。
- [x] 写取消/失败/重复确认、草稿与播放状态相关必要回归源，暂不执行。
- [x] 统一页面导航和任务区域，预览前置，技术明细折叠，校对选项/源码控件语义与0行计数。
- [x] 保留所有guard、key、PATCH读回对账和发布明确确认，静态核对后原子提交。

### Task 3: 其余页面与全站一致性

**Files:** my-governance/reports/discussions、help/privacy/account-deletion；governance-ui/social-ui/dash-ui/public-chart-browser/discovery-ui、library相关空态与分页；CSS/messages及DOM回归。
**Interfaces:** 使用Task1状态原语；处理中心分组导航按现有view/kind与URL表达，不改变cursor或查询语义。
- [x] 迁移遗漏阅读/记录页面、空态/不可用反馈；补明确去向、当前导航与筛选移除名称。
- [x] 手机长文本/触控、筛选和分页收尾；必要交互回归先写不执行。
- [x] 静态核对、原子提交，并更新交付记录。

### Task 4: 整批复核、集中验证与正式发布

**Files:** DOM测试、test/acceptance/ui-layout-browser.mjs及自包含production-smoke.mjs；集中验收记录。
**Interfaces:** 生产既有19组门禁不减少，新增受控慢导航、焦点、遗漏页面布局只读断言纳入原UI组；bridge保留精确/__manifest协议。
- [x] 整批一次新上下文复核；四项问题已在集中窗口复现并统一修正，实际验证状态见交付记录。
- [ ] 明确进入发布窗口后，用scripts/remote/verify.sh在构建机集中验证sharedUI/web/community；修复真实失败后完成既有隔离上传/有界备份恢复。
- [ ] 推送并等待候选CI；通过后合并pre，核对受测树与实际合并树；正式部署及全19组登录态无头验收。
- [ ] 核对serving/accepted/complete、healthz/readyz、备份和临时会话/密钥/容器清理，只有实际通过后交付发布完成。

## 计划自检

Task1覆盖导航、状态、确认、手机基础；Task2覆盖作者三种工具和源码；Task3覆盖其余记录/阅读与公共状态；Task4承接五项Review Focus的集中验收。共享原语单向依赖，无API/数据库迁移；用户要求的无测试开发与正式发布边界明确。
