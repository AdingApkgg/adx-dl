# 原件备份与闭锁恢复

本目录的 TypeScript 导出器、认证日志和恢复协调器属于 Task10。常规 compose/环境变量/角色通信、实际进程启停与一次性命令入口由 Task11 接线；生产 Cloudflare 边缘验证属于 Task12。当前 `backup.sh` 入口在缺少真实 coordinator 时失败，不得用返回成功的空回调替代。沿用原有每天东八区 03:30 的 systemd timer，不创建重复任务。

## 必需配置和权限

- `STORAGE_JOURNAL_DIR` 是快照之外的持久私有目录。`STORAGE_JOURNAL_KEY_FILE` 必须是恰好 32 个随机原始字节的普通 0600 文件；保留密钥至少覆盖所有受支持快照及七个月日志。日志采用 AES256GCM、随机 12-byte nonce、认证元数据、递增记录 SHA256 链和 durable head。首次认证 genesis 必须显式初始化，缺失/篡改不能隐式变成空日志。
- `STORAGE_RESTORE_STATE_DIR` 是 PG、SeaweedFS、restic 和恢复 bundle 之外的 0700 持久目录；`state.json` 为 0600，缺失、损坏、未初始化、关闭或存在 `.restore.lock` 都阻止正常入口。首次新安装由 Task11 显式初始化，既有恢复不能当作新安装。
- 常规备份 S3 身份只读原件，不能写入或清理。恢复的一次性离线进程才具有明确临时 media/control 权限，不挂载 Docker socket，不扩大 backup 身份权限。仅恢复 manifest 列出的 verified ready 私有原件，逐个验证目标实际字节；派生输出使用原有固定 `processAvatar` 配方和严格 namespace 检查。
- 独立 Umami URL 必须指向其真实数据库，不能把社区库导出两次。PG 凭据通过 child environment 传递，不能写进 argv、日志或 stdout。`databaseCommandEnv` 将 URL 解析为 libpq 环境值；不支持的 URL 参数明确拒绝。pg_restore 必须指定不含凭据的数据库名。

## 导出顺序与边界

2026-10-11 用户明确采用按实际使用增长的容量政策：20/2/2 GiB 是原件/派生/临时对象的应用上限，不为尚未使用的额度预留物理磁盘。部署 preflight 与实际 exporter 共用当前 manifest 的需求公式：仅缺失或未验证的暂存字节、本次全部原件 payload、两份显式 dump 上限和既有 metadata overhead；不假设 restic 去重。对象 filesystem additional=0，已存在对象及缓存已反映在 statfs 可用空间中，不再收费一次。同 filesystem 合并需求并保留不变的5 GiB底线；每次实际导出仍重复容量/hash/drain/journal检查。

暂存与 bundle 同 filesystem 以硬链接冻结原件；只复用真实 SHA256/大小吻合的只读文件。历史71 GiB/340 GiB是满额度极端规划示例，不是上线最低门槛。旧g510可用空间观测没有在本轮更新，不能据此判断当前够不够。已验证stage缓存尚无淘汰，增长优化留待需要时实施；本轮不增加GC/协调机制，剩余空间不足仍拒绝本次工作。

纯同步 owner-bound coordinator handle 在任何暂停副作用之前创建。关闭新写入后，实际角色进程关闭新工作并排空完整 handler/native child/driver PUT DELETE COPY；协调器必须验证当前 web/media/control 身份与维护 owner。随后再次检查所有 durable physical claims 和 DELETE started/uncertain markers，过期 lease 和本地 active=0 均不证明远端 IO 静止。缺少角色 ACK 或不确定 IO 使本次备份失败。

日志发布用短 READ COMMITTED exclusive storage barrier 等待所有 shared tombstone writers 完成，随后另一个语句读取 committed records，避免 sequence 分配顺序被误当成提交顺序。认证 immutable segment 和 head durable 发布后才推进 DB checkpoint；回滚空洞允许，缺段/分叉/认证失败拒绝。日志保留七个日历月，以认证 anchor 保留支持六个月时间桶恢复所需的链。

每次导出调用必须由调用方分配唯一、私有的 bundleDirectory；该 run 在 restic 读取及完成清理之前独占其冻结目录。维护锁在 restic 前释放，不能防止另一个调用复用同一路径而覆盖文件。Task11 的一次性 CLI/runtime 接线必须逐次分配目录；允许共享按 hash 验证的暂存缓存，不允许共享当前冻结 bundle。

专用 PG session 先取得 exclusive advisory lock，再建立 REPEATABLE READ 快照；社区 pg_dump 复用 exported snapshot，Umami 独立导出。所有原件流式验证后原子冻结，生成 versioned manifest。exclusive 与匹配 gate 释放后立即 owner-scoped resume，再执行 restic `community-full` backup。维护/角色暂停总上限五分钟，整次工作三十分钟，含有限清理预留。失败不执行 forget/prune 或完成标记；成功仅对 `community-full` 采用 7 daily / 4 weekly / 6 monthly，旧 `community-db` 快照仍有引用而保留。

## 恢复顺序与失败处理

1. `.restore.lock` 用 wx0600 获取，含唯一 owner nonce/restore UUID，整个恢复持有 FD。已有锁拒绝并行恢复，不根据 PID/TTL/lease 自动接管。每次状态写入和删除锁都重新验证自己的 inode/nonce；不能删除替换锁。
2. durable 写 closed，确认正常 web/media/control 与其 owned IO 实际停止。校验 bundle 的双 dump 和所有原件。最新 head 必须来自 live 外部日志或可信强制源 flush；旧签名快照 head 仅是认证链起点。
3. 在停止状态恢复两库与私有原件，重放最新 user/file/block/media_revoked 事实，取消所有暂存会话/分片并重算配额；旧头像撤回只失效旧 generation 的公开关联/投影，保留私有文件和确实较新的合法共享引用，blocked 状态继续 blocked。
4. 缺失派生头像由 sessionless durable intent 驱动，实际调用同一个原生配方；已有不确定 PUT/DELETE、旧代次或 namespace 不一致不能覆盖。相同输出不再计费；输出变化创建新 hash/key 并按现有引用/撤回协议更新当前投影。
5. 同一应用镜像独立启动 recovery-web，只公开 canonical 404/no-store、health 和真实认证 drain，不导入正常 auth/SSR/API/private bootstrap，不领普通任务。重建后重新收集当代撤回（含 drift 新建与快照已有 outbox），直接调用既有严格 revokeMedia 完成：60-second attempt、每请求 10-second、两次 purge 与两次 anonymous canonical 404/non-HIT probes 分别间隔至少五秒、最终锁内代次与引用检查。恢复协调器随后内建核对当代 outbox done、publication private/blocked、完整证据及无合法公开引用；不把 verifyInvariants 的空成功当作完成。
6. 停止并确认 recovery-web，检查删除账号不可访问、原件 SHA/ACL、暂存/配额、头像可重建与撤回证据，再确认 live latest head 未变化，只有全部成功才原子 open。失败路径永不在 finally 中打开。

正常成功释放自己的锁。停止正常进程成功之后的纯本地 manifest/latest 验证失败，可在明确未启动恢复 IO 时释放自己的锁并保持 closed。停止进程失败或任何 DB/S3/rebuild/recovery 回调开始后的任何失败，连同 generic backend error，均保留 closed + `.restore.lock`；即使错误已返回也不能证明远端 PUT/DELETE 已结束。崩溃保留锁。Task11 操作员清锁步骤必须先取得旧进程与所有 owned child/remote IO 已结束的明确证据；只查 PID、HEAD missing、重复 DELETE204 或等待 TTL 不够。确认之前不能开始下一次恢复。

离线迁移到新 namespace 只能在 closed、正常进程已停、latest journal 已验证时使用 `restoreVerifiedOriginals`：验证每个 manifest policy 的完整旧 endpoint/region/buckets，所有目标原件实际 SHA/size 成功后，CAS 只更新这些 policy IDs 到明确目标 tuple。不能把 host/127.0.0.1 别名自动视为同一 endpoint，不能放宽普通 driver guard 或跳过原件形成空快照。

## 演练证据与上线门槛

Task10 opt-in `fresh-restore.test.ts` 在新 PG/SeaweedFS volumes 上实际执行双库 pg_dump/pg_restore、restic backup/restore、Linux amd64 Bun1.4.2 sharp0.35.5/libvips8.18.7 native rebuild，测量 RTO，并记录 daily backup RPO=24h。本机 HTTP Cloudflare API fixture 只证明协议与源站证据，不能替代 Task12 的真实生产 purge/cache/edge 验收。完整额度、runtime consumer/role ACK、持久 mounts/首次初始化及 crash pause reconciliation 仍是 Task11 强制交接。

`media_revoked` version 1 has two authenticated variants. Null `userId` and `fileId` record a global publication generation. Paired identities record the exact former account/file/output association with the new avatar revision. Replay clears only a matching older association; individual revisions never become purge generations. Shared references and later saves survive. Half-null identities or invalid generation/identifier ranges fail closed.

Task11 实际入口现由 `runtime.ts` 分配每次独占0700目录并调用真实三角色数据库协调器。`community-full` 的 forget 使用 `--group-by host,tags`，避免不同目录各自形成永久保留组。部署接线和显式首次初始化见 [运行手册](../seaweed/README.md)；本地集成不等于生产容量/Cloudflare验收。
