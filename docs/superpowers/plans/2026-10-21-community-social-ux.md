# 社交页面 UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 完整改善用户主页、关注动态、通知中心的连续浏览流程。
**Architecture:** 展示组件共用社交导航、日期分组和当前页计数；路由维持现有 loader/API/权限。通知两个独立 URL 筛选维度保留现有 API 范围。
**Tech Stack:** React Router、TanStack Query、Tailwind、@astrodx/ui、Bun/Vitest/Playwright。
**Spec:** docs/superpowers/specs/2026-10-21-community-social-ux-design.md

## Global Constraints

- 开发期间不运行测试；准备生产时集中在构建机验证修复。
- 不新增依赖、数据库迁移或 API 契约；不在 Mac 运行构建、预览或浏览器回归。
- 保留身份隔离、no-store、注销隐藏、旧链接、revision、安全链接、逐页已读规则。
- 320/390/768/1280 无溢出，操作区 44px，zh/en/ja 同步。

## Review Focus

- 组合筛选切换保留另一维、清 cursor，分页保留两维；不可假过滤新通知类型。
- 通知失败/partial followingUnavailable 不误报已清空；批量只读本页未读。
- 帐号变化不保留私人内容、通知动作/查询身份隔离。
- 长昵称/正文、分享手动链接、全窄屏通知操作可换行。
- 主页作者不可通过表单越界；已过滤数量不可当作者总量。

### Task 1: 共用导航与作者主页
**Files:** components/social-ui.tsx、routes/user-profile.tsx、components/public-chart-browser.tsx、app.css、messages/{zh,en,ja}.json。
**Interfaces:** SocialNavigation({view:feed|following|notifications})、groupSocialDays<T>(items,date)、PublicChartSearchForm lockedAuthor?:boolean。
- [x] 添加 current 导航、日期分组与文案；整理资料和公开作品，分享移至资料操作区，锁定作者筛选。
- [x] 准备 DOM/SSR 作者锁定、可用/不可用状态与自身操作测试，暂不运行。

### Task 2: 关注动态与管理
**Files:** routes/following-feed.tsx、routes/following.tsx、test/dom/social-ux.test.tsx、test/acceptance/following-browser.mjs。
**Interfaces:** 使用任务 1 导航/分组，API 类型不变。
- [x] 按 UTC 日期分组响应式动态网格，主页作者入口、本页数量；管理卡片和提醒状态，revalidate 保留当前 URL。
- [x] 准备空页/过滤页、账号隔离、分页/current 和真实关注提醒浏览器断言，暂不运行。

### Task 3: 通知中心
**Files:** routes/notifications.tsx、components/social-ui.tsx、test/dom/social-ux.test.tsx。
**Interfaces:** notificationFilterHref(search,patch) 仅保留 unread=true/kind=author_update，改变任一清 cursor。复用 discussionApi.read 的导航徽标失效机制。
- [x] 稳定标题、全局未读/本页未读区分，组合筛选、分组卡片、成功/失败反馈、安全链接与不可用内容处理。
- [x] 准备精确 ID/错误/组合筛选/cursor/徽标和身份测试，暂不运行。

### Task 4: 集中验收与正式交付
**Files:** test/acceptance/{following-browser,production-smoke}.mjs、ops/acceptance/auth-bridge.ts（仅必要）、docs/verification/community-social-ux-2026-10-21.md。
- [x] 新鲜整分支静态审查，重要问题一次修复；集中构建机类型、lint、Bun/DOM/HTTP/原生 Chromium 与完整恢复演练，检查可视截图。
- [x] PR 最终 CI 通过且 merge tree 匹配才合并；备份、正式部署、19 组生产登录态门禁，RELEASE_COMPLETE 后核对配置、旧链接、谱面 1 第 6 槽及临时会话清理。
- [x] 保存中文验收记录并清理本轮受控临时资源。

## 完成记录

2026-10-21 已完成。最终CI39478752335，49组真实浏览器及512MiB新卷恢复通过；正式19组生产门禁通过并RELEASE_COMPLETE，源码/运行/已验收均cbf4337bff21c281de7f0586ef37d657ab086aea。补充登录态四页稳定主题截图通过，后备份与旧链接、谱面、配置、心跳、会话清理均核对。详见 docs/verification/community-social-ux-2026-10-21.md。
