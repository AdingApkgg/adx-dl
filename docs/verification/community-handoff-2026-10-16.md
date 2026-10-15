# 自制谱社区接力与存储角色恢复

## 最新验收结果

2026-10-16 01:41 CST 复核：修复已通过 [PR #21](https://github.com/AdingApkgg/adx-dl/pull/21) 合并至 `pre`，合并提交 `9bff56b369ae2bd4eba42d0d111d2918a7ff7e1e`，来源提交 `cfbbc813a4db4ff4080a853decbadf1fdf447df5`。用户已明确授权推送部署及定向预约回收；部署、回收和真实验收均已完成。下面各节保留部署前发现与测试边界，属于历史记录。

- [CI 38773234912](https://github.com/AdingApkgg/adx-dl/actions/runs/38773234912) 全部通过，包含真实 Chromium 上传/私有草稿与 fresh-volume 备份恢复。
- 生产仅更换应用的三个角色，未执行迁移。配置校验、受保护服务身份核对通过。六项 readiness 均为 ok，三个角色均持有新鲜心跳和 advisory lock；上线后约 11 分钟复核均未重启，无 OOM。
- 唯一获准定向处理的已取消会话：旧写入者退出后，再次确认临时对象不存在、实际写入 0 字节，通过原有回收协议释放 1 MiB 预约。最终没有 writing/deleting 尝试。
- 使用自有合成账号，经公网 Cloudflare 上传 16558 字节的有效谱面 ZIP，PUT 204（约 1.4 秒），处理 ready；保存后重新读取私有 Chart 成功，maidata 200、音频 Range 206，匿名访问私有接口 401。测试使用真实 HTTP，没有把它描述为真实 OAuth/Passkey 登录或生产浏览器验收。
- 手动完整备份约 5.2 秒、退出码 0。从加密快照回读并验证清单、两个数据库 dump 和刚上传的原始 ZIP，大小与 SHA-256 匹配；维护前后三个角色进程相同，维护锁正常释放。
- 备份后通过正常 API 清理合成谱面和文件，已用/预约/活跃上传全部为 0，注销测试会话并安排清理空测试身份。
- 后续父任务已核验 2026-10-16 03:30:01–03:30:06 CST 定时备份成功，退出码 0；从加密快照回读清单、两个数据库 dump 和一个原件，大小与 SHA-256 一致。清单含 5 个原件，六项 readiness 均为 ok，定时器 active，下一次为 10 月 17 日 03:30。本条替代此前“下一次定时执行尚未观察”的状态；未执行生产数据库恢复。

详细生产回执保存在私有运维目录，未将账号、内部主机、容器或快照标识加入本报告。旧镜像回滚点保留。公开发布与谱面浏览后续实现和隔离验收见 [独立验证记录](community-public-charts-2026-10-16.md)；本次恢复修复的上线授权不延伸为新功能上线授权。

## 部署前记录

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
