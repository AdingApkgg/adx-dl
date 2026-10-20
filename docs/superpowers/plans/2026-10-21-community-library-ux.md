# 谱库、公开谱单与下载中心 UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Steps use checkbox syntax for tracking. 用户明确要求开发期间不跑测试，所有执行检查统一放发布窗口。

**Goal:** 统一发现谱单、私人整理、明确发布与下载保存的阅读层级和操作。

**Architecture:** 保留 React Router loaders、公开快照、revision 和 DownloadStore。页面组合复用 community 样式与 packages/ui；纯下载呈现派生函数独立成模块，便于固定状态语义。三语文案集中维护，无新依赖和数据库变更。

**Tech Stack:** React 19、React Router、Bun、Vitest、Playwright、共享 UI 与 Paraglide。

**Spec:** docs/superpowers/specs/2026-10-21-community-library-ux-design.md

## Global Constraints

- 开发期间不跑测试；构建、类型检查、全套测试及浏览器只在构建机/正式 CI。
- 200 首谱单、20 项分页、60/500 Unicode 字符；下载 50 首、128 MiB、8 待办与历史、24 小时 TTL。
- 保留私有保存和明确发布、revision、账号隔离、重新鉴权、撤回/换版保护与所有旧链接。
- 深浅色、三语、减少动态、键盘及 320/390/768/1280 无横向溢出。

## Review Focus

- URL 回显及新搜索清 cursor，分页保留过滤；不把当前页计数误作总数。
- 私有编辑、公开快照、下架和编号不可互相替代；存在 publicId 不等于仍公开。
- 删空末页/筛选后排序与位置输入；无效重复编号和未保存保护。
- 混合下载状态、超预算或无持久化后备、身份切换及浏览器保存语义。
- 小屏、长标题、数字 ID、空数据、键盘与实际动态任务的高度变化。

### Task 1: 谱库与公开谱单浏览

**Files:** library.tsx、favorites.tsx、public-lists.tsx、public-list-detail.tsx、components/library-ui.tsx。
**Interfaces:** 复用 LibraryPage/LibrarySummary/PublicListSummary/PublicList，不改 API；导出 LibraryNavigation({view:'lists'|'favorites'|'reports'})，卡片保持独立作者链接。

- [x] 统一导航、卡片、空态及详情区域；保留全部鉴权和操作。
- [x] 添加 q/author 回显、清空及搜索分页语义；集中 DOM/Chromium 检查覆盖 URL 和无结果。

### Task 2: 私有谱单编辑

**Files:** routes/list-edit.tsx、共享 app.css、三语 messages。
**Interfaces:** 原 libraryApi.save/change 与未保存保护不变；有效页码由 shown.length 夹紧。

- [x] 分区主区/侧栏，字符及容量计数，保存发布/管理区分层。
- [x] 添加编号错误反馈，夹紧页码；静态确认拖拽、键盘替代、冲突处理不变。
- [x] 准备集中 DOM/原生验收：私有保存不公开、明确确认发布、末页删除及重复反馈。

### Task 3: 下载中心与跨页浮层

**Files:** routes/downloads.tsx、components/download-actions.tsx、components/site-shell.tsx、downloads/presentation.ts、共享 app.css 与 messages。
**Interfaces:** DownloadStore/persistence/shared contracts 保持；presentation 提供格式化字节、任务派生数量/状态和操作条件，无副作用。

- [x] 统计、分区、任务按阶段操作、保存语义、清空确认与帮助说明。
- [x] 计划取消与跨页浮层进度，下载页抑制重复浮层。
- [x] 准备混合状态 DOM、原包/集合包/身份与撤回 Chromium 检查，保留原生后备。

### Task 4: 集中验证与正式交付

**Files:** test/dom/library-ux.test.tsx、test/acceptance/library-browser.mjs、production-smoke.mjs、docs/verification/community-library-ux-2026-10-21.md。
**Interfaces:** 不降低原生或生产门禁；扩展既有 production_ui_navigation_layout，保持 19 组要求。

- [x] 完整分支新审阅，修复实质问题，结束开发阶段。
- [x] 构建机集中运行类型/lint/单元/DOM/build/HTTP；修复并按影响复核；PR CI 全量含原生浏览器和 512 MiB 恢复通过。
- [x] 核对生产基线并备份，合并精确候选，确认实际合并 tree 与 CI tree 相同。
- [x] 通过正式 coordinator 部署；19 组登录态只读验收、清理与 RELEASE_COMPLETE。
- [x] 备份、旧链接、chart1/slot6、角色/日志/配置等不变量验收，记录真实证据并提交文档。

## 最终验收

2026-10-21 完成；源码6dc93b1f82f56cb3fb34814996e45772f1ab74a2，最终CI39470252568：49组真实Chromium及512MiB新卷恢复通过。正式19组登录态门禁、备份、不变量与主题截图均通过。详见 docs/verification/community-library-ux-2026-10-21.md；随后仅提交验收文档，不另行重建或重启。
