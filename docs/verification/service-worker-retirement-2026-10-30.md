# 主站 Service Worker 有序退役

## 目标与边界

停用 `apps/web` 的离线缓存与 SW 自动刷新，保留 PWA 安装、独立窗口及现有用户数据。本次变更不修改下载持久化、主题、播放器设置、OPFS，也不涉及社区部署。

## Google 当前安装条件

2026-10-30 核对 Google 现行资料：

- [当前安装条件](https://web.dev/articles/install-criteria)，页面标注最后更新于 2024-09-19：HTTPS；manifest 包含名称、192/512 图标、`start_url`、允许的 `display`；`prefer_related_applications` 不存在或为 `false`。安装提示还受未安装状态和用户互动条件影响，清单已不要求 SW。
- [2023 年的条件调整公告](https://developer.chrome.com/blog/update-install-criteria) 曾区分菜单安装和当时的安装提示：Android Chrome 108、桌面 Chrome 112 起，菜单安装不再要求带 fetch handler 的 SW。公告当时仍提到提示条件的 SW 要求；这是历史状态，不能代替当前安装条件清单。
- [原地址替换旧 worker](https://developer.chrome.com/docs/workbox/remove-buggy-service-workers)：保留原 URL，发布没有 fetch handler 的替代版本；不要用全站存储清理处理本次退役。

现有三语言 manifest 的 `id`、`start_url`、`scope`、`display`、图标均保持原值。SW 退役意味着不再提供原先的离线缓存与自动离线回退，PWA 的在线启动和安装身份继续保留。

## 退役过程

1. 构建只运行 `next build`。`public/sw.js` 由静态导出直接发布，不再由 Serwist 生成或覆盖。
2. 新页面只枚举已有注册，匹配本站根作用域且最新 worker 脚本为原 `/sw.js` 的注册，调用 `update()`。新访客不调用 `register()`。
3. 原地址的退役 worker 安装后立即接管，没有 fetch handler，不广播更新刷新，也不导航标签页。
4. 接管后仅删除下面列出的 Cache Storage，全部成功后注销自己。
5. 网络、权限或存储异常不影响页面。清理失败时保留不拦截请求的 worker，下次访问或恢复联网时通过消息重试。

缓存白名单：

```text
next-static
rsc-payloads
catalog-manifests
cover-images
static-images
fonts
pages
astrodx-shell-state
serwist-precache-v2-<当前 registration.scope>
```

不按宽泛前缀删除其他缓存；不注销不同脚本或不同作用域的 worker；不调用 `Clear-Site-Data`、`indexedDB.deleteDatabase` 或用户存储清空 API。Serwist 小型过期索引数据库也保留，以避免本次退役触碰 IndexedDB。

## 长期保留与发布要求

- **保留 `/sw.js` 退役脚本的原地址**，不要改名或删除。长期未访问的用户和已安装 PWA 仍需要这个 URL 替换旧 worker。
- 不将旧 Serwist 构建步骤重新接回，否则会覆盖清理脚本。
- 首次上线后，旧版本正在进行的请求仍可能完成；退役过程不主动中断或重启下载。原有 chunk 错误恢复继续保留。
- 代码检查与迁移验收不代表生产已部署。PR 合并和生产发布需要分别授权。

## 验证记录

- 测试先行：新增退役行为测试先出现 5 个预期失败，实施后 9 项通过。
- 本机仅对改动文件 lint、单个测试文件验证；安装、整库检查与真实浏览器验证在 `i@alice`（hostname `localhost`）运行。
- 远程任务：`/home/i/.local/state/ai-jobs/astrodx-sw-retirement-20261030-01a188fb/`；独立 tmux 同名，`run.sh`、`run.log`、`verify.log`、`exit-code` 保存执行与恢复信息。
- `scripts/remote/verify.sh --keep` 通过：冻结锁文件安装、719 文件 lint、共享 UI 类型检查及 38 项测试、主站类型检查及 739 项测试全部通过。
- Chromium `156.0.8078.4` 最终五轮迁移全部通过，`browser-acceptance-exit-code` 为 `0`；每轮验证旧 SW 注销、白名单缓存清理、无关缓存保留、下载数据库四个对象仓库和文件 Blob、localStorage、sessionStorage、OPFS 内容一致，两个旧标签页均未刷新且请求恢复走网络。
- 新浏览器上下文既没有注册 worker，也没有请求 `/sw.js`；三语言真实 manifest 经 CDP `Page.getAppManifest` 和 `Page.getInstallabilityErrors` 检查均无错误。浏览器页面错误为零。
- 初轮测试脚本在 `about:blank` 访问 sessionStorage 被拒，已限制计数探针只在站点页面执行。后续诊断复现了验收条件的异步采样竞争：注册查询返回为空时，替代 worker 的 activate 清理仍可能在进行。仅采样 controller 状态也可能跨过新旧版本切换；最终直接等待“注册为空且缓存清理达到预期结果”，保留超时失败与数据逐项比对，没有为此修改产品实现。
- 本地证据目录：`/Users/i/.codex/visualizations/2026/10/29/01a188fb-71a8-72a3-82c4-a3960cce8de1/service-worker-retirement-20261030/`，含完整检查日志、最终浏览器脚本、五轮日志和结果 JSON；远程目录保留原始诊断失败日志。
- 浏览器测试采用独立本地 origin、模拟旧缓存 worker，执行真实退役组件与发布脚本；不访问或改写用户生产存储，不等同于 Android/iOS 的系统级安装验收。
- 此处远程验收未运行完整静态站导出；按仓库约定，`next build` 交由 PR CI 验证，结果以 PR 检查状态为准。生产发布另行授权。
