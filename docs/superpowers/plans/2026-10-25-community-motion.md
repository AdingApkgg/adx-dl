# Community Motion Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 用户已授权直接完整实施，执行细节由实现者确定；不重复请求设计或执行方式确认。

**Goal:** 让自制谱站主要页面和交互复用web主站的统一动效。
**Architecture:** 复用现有共享MotionProvider和动画偏好；社区增加保持DOM与组件生命周期的进入动画原语，业务组件只接展示层。私密内容立即卸载，路由内容不重新挂载。
**Tech Stack:** React19.3、React Router8.4、framer-motion13.4、现有Tailwind与共享UI。
**Spec:** docs/superpowers/specs/2026-10-25-community-motion-design.md

## Global Constraints

- 开发期间不运行测试；集中验证前只进行源码检查和一次整批静态复核，测试状态明确记为pending。
- 不增加依赖，不改API/数据库/权限/队列控制，不在Mac安装、构建、预览或跑浏览器。
- 沿用主站EASE_OUT/springSoft与system/on/off；SSR始终可读，动画不持有退出页面或私密内容。

## Review Focus

- 路由pathname改变时组件实例保留；search/hash与刷新不会抹掉未保存输入或播放器状态。
- Motion开关/系统偏好在动画中改变应立即恢复静态；引导脚本已关闭时首次hydration也不闪动。
- 网格和表格语义、键盘焦点、sticky位置、原React key、超长列表性能保持。
- 账号切换与权限撤回立即清理旧内容，不被退出动画或旧闭包延迟。
- 成功反馈只消费实际成功状态；进度/数量可访问文本始终为真实最终值。

### Task 1: 统一基础与导航

**Files:** packages/ui/src/motion/index.tsx；新增apps/community/src/client/components/motion-ui.tsx；site-shell.tsx、page-title.tsx、site-header.tsx、app.css。
**Interfaces:** RouteMotion({children})消费pathname与偏好；MotionSurface({as,hover,children,...HTMLProps})保留语义；MotionGroup({as,children,...HTMLProps})提供最多0.21s级联；NavigationIndicator({group})为纯装饰；MotionSuccess()为偏好安全的成功图形。
- [x] 实现共享控制hook导出与上述原语，客户端控制进入且SSR不隐藏，清理在途动画。
- [x] 接SiteShell内容区域与标题，顶栏/移动导航活动背景；不对Outlet加key。
- [x] 为后续集中阶段补SSR、偏好中断、路由状态/焦点保持的DOM回归；本阶段不执行。
- [x] 按功能提交并记录尚未验证。

### Task 2: 内容、列表与创作界面

**Files:** public-chart-card.tsx、library-ui.tsx、discovery-ui.tsx、discussion-ui.tsx、social-ui.tsx、dash-ui.tsx；发现/目录/谱单/详情/动态/通知/工作台/导入/登录/设置等对应路由。
**Interfaces:** 消费Task1的MotionSurface/MotionGroup，保留原标签、React key和业务children；数字只使用现有RollingNumber。
- [x] 统一共享卡片、论坛/评论、社会动态、后台标题/面板进入；列表有界级联，主要页面分区保持原结构。
- [x] 工作台、导入、下载与账号界面只改展示层，输入/表单/文件对象/队列/播放组件不移动到随状态重建的容器。
- [x] 补未来集中阶段覆盖原语状态与集成行为的用例，不运行；按功能提交。

### Task 3: 操作反馈与交付

**Files:** download-actions.tsx、library-actions.tsx、downloads.tsx、app.css、相关DOM与acceptance脚本、开发交付记录。
**Interfaces:** MotionSurface/MotionSuccess及原状态机；不新增发信/发布/下载写入副作用。
- [x] 选择条/下载浮层/确认面板进入、真实完成图形与有界数量变化，保留native progress和立即卸载。
- [x] 将动效偏好与状态保持场景加入现有浏览器验收范围，保持正式19组业务/权限门禁。
- [x] 完成一次整批新上下文静态复核，修复重要问题；记录未运行测试与待集中验收清单。
- [x] 按功能提交，交付开发结果；本轮不推送、部署或声称动态验收通过。

整批静态复核发现的四项Important已作一轮代码修正：下载阶段类型、系统偏好订阅、成功反馈当前偏好、身份计数隔离（下载scope与工作台actor）。补写回归但未执行。真实动画中断与连续帧终态的浏览器证明范围仍是待集中验证项，见交付记录。
