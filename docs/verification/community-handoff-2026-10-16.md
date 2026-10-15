# 自制谱社区接力与存储角色恢复候选

核对日期：2026-10-16，Asia/Shanghai。源码基线 `origin/pre` / `c2638e5c23f8f02d7281552d5cbccc0819ebe57c`；主站 `main` 为 `5bfd20d`，两条发布线分开。主工作区的两个既有未跟踪验收文件保持原状。

## 已有功能与历史证据

- PR #5 已向 `pre` 合并头像、私有谱面 ZIP/文件夹上传、显式保存草稿、编辑、历史版本、私有 Canvas 预览和删除。真实 Chromium 与 fresh-volume restore 已在 [38157027636](https://github.com/AdingApkgg/adx-dl/actions/runs/38157027636) 通过；旧的“尚未运行 CI”文字属于历史状态。
- PR #18 已向 `pre` 合并 1 MiB 上传分片和备份工作区挂载修复。交接记录的公网上传与手动备份是当时结果；本轮没有重复这些生产写入操作。
- [38164223372](https://github.com/AdingApkgg/adx-dl/actions/runs/38164223372) 的后续社区 CI 失败在 HTTP 测试启动阶段：内部监听端口 53502，`EADDRINUSE`。不是新的全绿证据，也没有在本批顺手修改随机端口 fixture。
- 公开谱面发布、公开检索、分享和游戏兼容接口仍在后续产品范围，本批未新增这些功能。

## 本次只读生产发现

g510 实测系统标识 `arch`，源码为 `c2638e5`；运行中 web/control/media 镜像 revision 为 `6fc6959`（PR #18 的来源提交）。

- `/readyz` 返回 503：db、storage、redis、jobs 为 ok；media、runtime 为 fail。web 的 liveness 健康不能替代 readiness。
- `storage_runtime_roles` 的 web/media/control 心跳均停在 2026-10-14 18:00:28 CST 左右，三个对应 backend 和 advisory lock 均不存在；容器仍运行，media unhealthy。
- 没有 writing/deleting 上传尝试，没有维护 owner；没有据此清理、释放或修改任何生产行。
- 定时器 enabled/active。10 月 14 日 03:30 备份成功，10 月 15 日 03:30 失败。失败日志仅给出 `STORAGE_BACKUP_FAILED`；角色协调器要求三个存活角色，当前条件不满足。
- 原始连接为什么同时失效尚未确定。已确认的代码问题是：连接丢失后暂停准入，进程却不退出，现有 `restart: unless-stopped` 因而无法恢复它。没有把此机制诊断当成首次断连触发器的证明。

## 修复候选

角色模块提供失效信号，先暂停新 IO，再通知入口排空并退出。web、control、media 分别在 35/70/130 秒内结束；继续使用已有容器重启策略，不在旧进程中重连、恢复准入或强行清除不确定写入。监督在获取角色后立即安装，覆盖后续异步启动卡住的情况。

条件心跳因正常维护 owner 切换未更新时，保持暂停并重试；确认角色所有权被替换才报告失效。正常 stop 与在途心跳并发时仍用原连接完成关闭，不发出故障信号。三个入口共享已启动的关闭 Promise，避免重复关闭提前结束排空。普通 SIGTERM/SIGINT 的注册位置保留在原先启动完成之后。

## 验证与边界

所有安装、运行、类型检查和构建在 `i@localhost-1.tailac9c6f.ts.net`，实测 Linux / hostname `localhost`；使用项目 `scripts/remote/verify.sh --host-command`、固定 Bun 1.4.2 镜像和独立一次性 PostgreSQL 18 `community_role_test`。测试容器限制 CPU/内存；未连接生产数据库。Mac 仅运行改动文件 Biome 和 Git 检查。

必要检查：角色/维护/排空和进程监督共 17 项、55 断言；真实终止 PG backend 后观察子进程先暂停、排空、再 exit 1。覆盖正常关闭、心跳中关闭、维护切换的零行更新、所有权替换、启动前已失效、关闭失败/停滞和固定脱敏诊断。独立复核发现的两个角色边界用例在早期候选上实际失败，恢复修复后通过。

社区消息生成、Router 类型生成、TypeScript 和 client/server 生产构建均在远程验证。第一次依赖软链接复用导致 Vite 临时配置路径无法加载；改为同锁文件依赖的硬链接副本后构建通过，没有为工具问题修改产品配置。独立定向复核已关闭重要发现。

没有运行全仓测试、真实浏览器回归、生产镜像构建或新的生产备份；没有推送、修改生产配置、重启或部署。上线后仍需检查三个角色的新心跳和 advisory lock、`/readyz` 六项、真实备份及后续定时执行。当前生产故障不能标记已恢复。
