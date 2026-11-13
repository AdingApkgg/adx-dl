# 评论与 404 排查记录

日期：2026-11-14。范围：只读核查和工作区前端修复；未发布、未改评论后端或 CORS 白名单。

## 判断与证据边界

本轮区分三个原因：静态站 404 导出缺失、开发路由限制、评论后端/前端初始化失败。生产 HTTP 状态、开发错误、评论 API 可达性和浏览器可用性分别判断。

- 主任务在线只读核查：`https://adxdls.saop.cc/definitely-missing-astrodx-20261114` 返回 HTTP 404，正文含自定义 `main-content` 与 404 内容。足以排除“生产没有导出自定义 404”，不代表本次改动已经发布或完成浏览器视觉验收。
- 开发入口 `/missing-material-page` 被 `/[locale]/page` 匹配，随后报 `output: export` 下缺少对应 `generateStaticParams`。这与生产静态托管直接返回 `404.html` 是不同路径。当前不以开发报错推断生产损坏，也不修改全站动态路由策略。
- 主任务只读核查：Artalk `/api/v2/conf` 返回 200，版本为 2.10.1；生产 Origin 获得匹配的 `Access-Control-Allow-Origin`，`http://127.0.0.1:3310` 未获得该响应头。后者说明预览浏览器仍受 CORS 限制，HTTP 200 不等于浏览器可读取配置。前端重试不会解除该限制。

## 前端已修复的确定问题

旧实现使用 `remoteConfModifier`，并在 `mounted` 手动 `reload()`；Artalk 2.10 已移除此配置，默认保留本地配置且自动请求列表。改为显式本地配置优先，删除过期 hook 和额外 reload，保留挂载后的最新主题同步。

旧实现将 `Artalk.init()` 返回等同于成功，配置与插件仍在异步加载时便撤掉骨架。改为首个 `list-loaded` 才显示评论；初次 `list-failed` 或初始化 20 秒无结果则清理实例并显示重试。脚本下载同样设置 20 秒超时，并移除失败缓存以允许重试。整次尝试共用 20 秒截止时间，避免脚本、探测和初始化超时逐层叠加。

监听仅覆盖首次加载；成功后解除监听，后续分页/刷新失败交给 Artalk 自身处理，避免销毁编辑器中的草稿。卸载会取消计时器及监听。初始化前以普通 GET 探测公开 `/api/v2/conf`（与脚本加载并行，10 秒上限、卸载可取消）；CORS/网络拒绝直接进入错误卡，不触发 Artalk 内部配置 Promise。该请求遵守浏览器原有 CORS 规则，不变更权限、不发评论。正常入口会多一次公开配置请求；预检成功后的网络竞态或第三方插件内部异常仍不能由预检完全消除。

## 验证与后续

- `bun test apps/web/src/lib/comment-loading.test.ts`：8 项通过，覆盖挂载不代表列表成功、初次失败、无事件超时、卸载取消、成功后不销毁草稿，以及配置探测正常 GET、CORS 拒绝和停滞取消。
- 仅对三个变更源文件执行 Biome check：通过。
- 主任务远程类型、UI39与主站772项检查已通过。实际浏览器核验生产未知路径自定义404、留言列表200与已有内容；受限预览显示可重试错误卡且无未捕获异常。生产证据来自现有版本，当前没有新构建静态导出或真实允许Origin运行未发布新版widget的验收证据；新版加载生命周期由单元测试及受限预览覆盖。

## 官方参考

- [Artalk 2.10 迁移指南](https://artalk.js.org/en/guide/releases/v2.10.0)：配置优先级与移除 `remoteConfModifier`。
- [Artalk 前端 API](https://artalk.js.org/en/develop/fe-api)：异步初始化、`mounted` 与 `list-loaded` 的区别。
- [Artalk 2.10.1 事件声明](https://github.com/ArtalkJS/Artalk/blob/v2.10.1/ui/artalk/src/types/event.ts)：`list-loaded`、`list-failed`。
- 当前安装的 Next 文档 `next/dist/docs/01-app/03-api-reference/04-functions/generate-static-params.md`：开发模式会在访问路由时执行静态参数生成；未生成路径由动态参数策略控制。文档阅读不替代真实导出验收。
