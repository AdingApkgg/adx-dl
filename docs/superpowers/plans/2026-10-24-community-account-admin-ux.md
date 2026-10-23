# 登录、账号设置与后台管理 UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有安全协议上完整整理登录、资料/账号设置及自制谱后台日常管理。
**Architecture:** 登录保留认证生命周期，设置共用导航与身份边界，后台共用页标题、处理面板与运行分组。界面读取沿用既有API，正式门禁仅精确扩充所需只读路径。
**Tech Stack:** React Router、TanStack Query、@astrodx/ui、Tailwind、Bun/Vitest/Playwright。
**Spec:** docs/superpowers/specs/2026-10-24-community-account-admin-ux-design.md

## Global Constraints

- 开发期间不运行测试，上线前在构建机集中验证修复；不在Mac安装、构建、预览或跑浏览器回归。
- 不新增依赖、数据库迁移、API契约、渠道或角色；保留Google/QQ/AWMC/通行密钥、安全回跳和conditional mediation。
- 保留最后登录方式、重新认证、注销数字ID确认/默认保留内容、头像幂等/恢复、治理revision和审计。
- zh/en/ja同步，320/390/768/1280，主要操作44px，明暗与减少动画、长文本适配。
- 生产只读验收，19组正式门禁，RELEASE_COMPLETE后核对备份、旧链接、谱面1第6槽、配置、心跳和临时资源。

## Review Focus

- settings loader身份与新me不一致时隐藏旧内容，表单不跨账号保留。
- callback next/error/reauth、本地取消/网络拒绝时不陷入永久pending，不引发意外授权或通行密钥重挂循环。
- 管理列表的URL回显、筛选清cursor、分页保留工单/状态，未知备份与服务状态不显示为健康。
- 展示重排不改变治理确认、原因、revision、草稿比较或发布快照。
- 只读桥的设置与会话读取不扩大为auth会话能力或写入通道，主题截图需确认加载与过渡完成。

### Task 1: 登录与资料设置
**Files:** routes/login.tsx、routes/settings-profile.tsx、components/settings-navigation.tsx、app.css、messages/{zh,en,ja}.json。
**Interfaces:** SettingsNavigation({view:profile|account})、设置loader返回userId；ProfileContent({userId})只渲染对应me；登录方法和auth参数保持。
- [ ] 合并外部授权卡、整理说明/方式导航/QQ可用/通行密钥，保持表单挂载与自动填充；异常拒绝恢复busy。
- [ ] 资料页分区和当前导航，绑定身份、公开主页入口、独立保存和头像结果。
- [ ] 准备安全回跳/错误恢复/导航/身份测试，不执行。

### Task 2: 账号设置
**Files:** routes/settings-account.tsx、test/dom/account-admin-ux.test.tsx、现有awmc/avatar测试夹具。
**Interfaces:** 继承任务1导航；loader.userId固定当前me，登录方式/设备数据不换契约。
- [ ] 摘要、绑定和通行密钥、设备/退出、注销分区，真实数量和明确当前设备；保留解绑/下线/注销校验。
- [ ] 准备失败不误报退出、精确会话动作、账号变化和44px/默认确认测试，不执行。

### Task 3: 后台管理
**Files:** components/{dash-ui,dashboard-navigation}.tsx、routes/dash*.tsx、app.css。
**Interfaces:** DashViewHeading({title,description?,count?,id?})、DashEmpty，DashSection({title,id?,children})；现有loaders和API不变，根Dash绑定当前管理员编号。
- [ ] 统一全局/子页层级、移动当前页、概览常用入口、运行分区和真实状态。
- [ ] 各管理页标题/计数/筛选/空态与处理面板；谱单搜索回显并保留独立status/publicId/ticket，提供显式清除；分页保留范围。
- [ ] 准备导航、未知状态、筛选上下文、分页及保留确认机制测试，不执行。

### Task 4: 集中验收和正式发布
**Files:** test/acceptance/account-admin-ux-browser.mjs、browser.mjs、production-smoke.mjs、ops/acceptance/auth-bridge.ts、docs/verification/community-account-admin-ux-2026-10-24.md。
- [ ] 唯一一次新鲜整分支静态审查；集中构建机检查并修复，最终PR CI完整类型/lint/单元/DOM/HTTP/镜像/真实浏览器/512MiB新卷恢复。
- [ ] 隔离原生浏览器验证资料保存、账号设备读取及后台真实确认；生产门禁只增加精确读取与布局，业务写入405、auth/get-session403不变。
- [ ] 核对被测与合并tree，备份，正式部署与19组登录态门禁，稳定主题截图、后备份和不变量，完整记录归档并清理本轮临时资源。
