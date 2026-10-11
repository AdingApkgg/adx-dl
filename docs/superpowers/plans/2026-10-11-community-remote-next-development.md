# Community Chart Draft Design and Remote Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立约 14–20 小时、共 14 项的分批开发队列：首先设计谱面上传与私有草稿，随后收尾头像/按需存储，再完成谱面导入、私有草稿 API、上传界面、预览和版本管理。

**2026-10-11 当前状态：** 用户已批准谱面详细设计，Task 6–14 编码及必要远程回归已完成，按一个原子功能候选整理；详见模块实施计划和 `docs/verification/community-chart-drafts-2026-10-11.md`。Task 3 的真实界面、Task 4 的完整新卷恢复仍受远程 sparse scratch sudo 安装阻塞。三个旧 sweep 已有验收，本轮没有重复运行。下方保留原队列及当时状态作为执行历史，当前状态以本段及验收报告为准；没有生产发布。

**Architecture:** 首先以现有社区总体设计和存储接口为依据，完成谱面上传与私有草稿的设计及实施切片。沿用 Hono、PostgreSQL、pg-boss、单实例 SeaweedFS；按用途扩展现有上传和 worker，业务表以外键引用私有文件。前端经 API 访问业务，预览有限封装已有 Canvas 引擎；所有构建、测试和服务运行放在独立远程目录。

**Tech Stack:** Bun 1.4.2、React Router、Hono、PostgreSQL、Redis、pg-boss、SeaweedFS 4.48、sharp 0.35.5；版本沿用锁文件及现有固定镜像。

**Spec:** [已批准的存储设计及按需容量补充](/Users/i/.codex/worktrees/community-storage-design/AstroDX/docs/superpowers/specs/2026-10-10-community-storage-design.md)；[社区总体设计 A.3](/Users/i/Code/AstroDX/docs/superpowers/specs/2026-09-28-community-foundation-design.md:755)。Task 1 产出本模块详细设计；Task 6–14 是据此排队的开发切片，其接口与数值提案随该设计定稿。

## Global Constraints

- 用户最新执行规则优先：本机仅轻量读写、Git 和远程连接；禁止本机开发、构建、预览、测试、打包运行环境及容器。远程不可用就记录阻塞，不能回退本机。
- 执行主机：`i@localhost-1.tailac9c6f.ts.net`；实测 Linux x86_64、用户 `i`、HOME `/home/i`、Docker daemon 29.8.0 可访问。实际 hostname 为 `localhost`，不能仅凭这个名字判断执行位置。
- 拟建目录 `/home/i/astrodx-community-storage-dev-20261011` 尚未创建；先检查是否存在。主机未找到现成社区源码，Bun 不在非交互 PATH；通过现有固定 Bun 镜像运行，不安装全局运行环境。
- `arch.tailac9c6f.ts.net` 就是生产 g510，本批不在那里启动测试、构建或写入。`desktop-asuna` 环境尚未确认。
- 源码工作区 `/Users/i/.codex/worktrees/community-storage-design/AstroDX`，分支 `codex/community-storage-design`，规划基线 `3b0a580`。主工作区的主站下载改动不进入本批。
- 头像输入 8 MiB、分片 4 MiB、每用户最多两个未完成上传、头像逻辑配额 32 MiB；输出 512×512 中心裁切 JPEG。头像规则保持原件私有、处理后公开、显式保存；谱面大小和配额在 Task 1 独立确定，不能把头像上限直接扩大。
- 20/2/2 GiB 是逻辑上限，不做物理预留；按当前 manifest、有效缓存缺口、完整备份 payload、两份 dump 上限计算，按文件系统汇总并保留 5 GiB 空闲底线。
- 本批不引入缓存淘汰、额外存储/协调/监控服务，也不扩大备份保留策略。临时测试数据实际写入才占用空间。
- AWMC、外站头像导入、主站下载功能保持搁置；不推送、部署、修改 Cloudflare 或公开发布。
- 使用新生成的合成账号、测试密钥和独立 `_test` 数据库；不复制旧 `.env`、登录 Cookie、密钥、数据卷或本机依赖。日志只记录脱敏错误和时间。
- Task 6–14 的实现队列在 Task 1 详细设计定稿后执行；新的界面文案同步中/日/英三语。loader 和组件通过 API 取业务数据，不能直接查库。
- 谱面首批只做私有草稿。索引、公开发布、论坛、PV 转码、成绩和游戏兼容接口另行安排；本队列不安装 Meilisearch 或新的媒体服务。

## Review Focus

1. 远程未就绪或目录/端口被占用：停止准备，绝不误启动本机或接管别人资源（Task 2）。
2. 分片 503、会话读取 500：保留旧头像，允许明确重试；不能靠放宽生产超时或关闭 PG 持久化掩盖问题（Task 3）。
3. 旧请求返回、切换文件、退出登录：旧结果不能覆盖新预览或恢复另一个用户的上传（Task 3，仅相关代码变化时运行已有定向用例）。
4. sweep 用例超时后异步继续：结束该进程及其拥有的操作后才能重置库，不能串成后续假失败（Task 4）。
5. 恢复被中断或最新删除日志不可用：保持 closed，已撤回对象不能重新公开；不能只按 PID/TTL 推断恢复安全（Task 4）。

---

## 时间与完成口径

| 任务 | 工作预算 | 交付 |
|---|---:|---|
| 1. 下一批谱面设计和实施切片 | 45–60 分钟 | 优先交付短 spec 与可执行的首片计划 |
| 2. 远程隔离环境与现有工具迁移 | 30–40 分钟 | 可重复使用的独立运行环境，来源 SHA 明确 |
| 3. 头像实际闭环与最小修复 | 45–60 分钟 | 上传、预览、保存、删除的真实界面结果 |
| 4. 恢复与三个清理边界收尾 | 35–50 分钟 | 当前源码的结果，或有原因和停止证据的阻塞记录 |
| 5. 候选整理 | 15–20 分钟 | diff、验收边界、按需容量及发布步骤 |

以上是第一段，约 170–230 分钟。先交付 Task 1 的设计，再开始 Task 2–5；头像与存储验收不作为设计启动的前置条件。Task 2–4 若无新诊断信息，不循环等待，将阻塞记录移交 Task 5。

| 后续开发任务 | 工作预算 | 可交付成果 |
|---|---:|---|
| 6. 谱面用途和配额规则 | 45–60 分钟 | 现有上传系统具有独立的 chart-source 规则 |
| 7. 谱面包识别、校验与解析摘要 | 90–120 分钟 | 标题、艺术家、难度及具体校验错误 |
| 8. 谱面异步导入与处理状态 | 60–90 分钟 | processing → ready/rejected，可安全重试 |
| 9. Chart / ChartVersion 与私有草稿 API | 90–120 分钟 | 创建、分页列举、查看和编辑自己的草稿 |
| 10. 版本替换、删除与引用回收 API | 60–90 分钟 | 更新保留有效旧版本，删除释放逻辑引用 |
| 11. 单首谱面上传界面 | 90–120 分钟 | 选择输入、进度、结果、显式保存草稿 |
| 12. 我的草稿列表与详情 | 60–90 分钟 | 找回草稿、查看处理状态和版本信息 |
| 13. 私有 Canvas 预览 | 90–150 分钟 | 所有者切难度、播放/暂停和跳转 |
| 14. 草稿编辑、版本管理和删除界面 | 75–120 分钟 | 编辑、换版本、处理冲突、确认删除 |

完整队列约 830–1190 分钟，即约 14–20 小时，是预算而非必须耗满的时长。按下面三段执行，每段结束交付提交、结果和剩余项；无需为耗满预算重复运行。最多一个构建/测试资源重任务同时运行。

1. 设计和存储候选：Task 1–5，约 3–4 小时。
2. 谱面导入与私有 API：Task 6–10，约 6–8 小时。
3. 上传、草稿和预览界面：Task 11–14，约 5–8 小时。

依赖顺序：Task 1 → 6 → 7 → 8 → 9 → 10；Task 11 依赖 8、9，Task 12 依赖 9，Task 13 依赖 7–9、12，Task 14 依赖 10–13。所有运行都依赖 Task 2；Task 6 的纯规则及 Task 7 的解析开发可在设计定稿后推进，不必等无关头像浏览器问题结束，但未接受的存储结果仍是生产发布条件。

已有证据：16 个头像/上传 DOM 用例、当前 HTTP 全流程、immutable 资源头、Seaweed relay 生命周期与取消、按需容量政策均有记录。本批不默认重跑全套、95 个历史未执行文件、QQ/Google/通行密钥或 Turnstile。

尚未接受：真实浏览器上传曾返回 part 503，重试时会话读取 500；当前源码 full restore 一次运行超时；三个 sweep 边界未通过。不能把历史镜像成功、HTTP fixture 或本地日志记为这些项已通过。

### Task 1: 单首谱面上传与私有草稿的下一批设计

**Files（主工作区文档，设计稿状态）：**
- Read: `docs/superpowers/specs/2026-09-28-community-foundation-design.md` A.3。
- Create: `docs/superpowers/specs/2026-10-11-community-chart-draft-design.md`。
- Create: `docs/superpowers/plans/2026-10-11-community-chart-draft.md`。
- Inspect in source worktree: `apps/community/src/server/storage/{uploads,rules,contracts,references}.ts`、`packages/maimai-chart-engine/src/core/parser/{ChartParser,SimaiParser}.ts`、`apps/web/src/components/chart-preview/chart-preview.tsx`、`apps/web/src/components/chart-preview/apply-difficulty.ts`。

**Interfaces:** 交付是待审阅的短 spec + 首片计划，不生成已批准业务 API。首片计划必须写明解析器输入/结果/稳定错误码签名、文件用途和 ChartVersion 外键关系；字段和数值在 spec 中明确后才进入业务编码。

- [x] 定义最小用户闭环：一个谱面上传为私有草稿、查看解析结果；不含公开发布、搜索、论坛、转码、成绩、游戏登录或分享服务。
- [x] 确定 zip/文件夹输入、case-insensitive 文件识别、重复文件名处理、路径越界/条目数/解压总量上限、maidata 原始字节及非法难度的行为。草稿必须标明具体提案数值，不能把头像 8 MiB 直接套给谱面包。
- [x] 通过代码阅读评估现有解析器能否纯服务端复用、解析耗时/失败退出边界。确需运行确认的问题写入设计假设和后续 Task 2 的远程验证清单，不因运行环境准备延后本项设计；不先抽整个共享预览包。
- [x] 明确 Chart / ChartVersion 分工、原始 maidata 的 MD5→Base64 互通标识与存储 SHA-256 去重分别使用的位置；业务表以 FK 引用文件，用途规则只在后续批准实现中开放。
- [x] 将 Task 6–14 写入该模块的详细实施计划：用途/配额、包检验、异步导入、草稿 API、版本/引用、上传 UI、列表详情、私有预览和编辑。明确每项输入、返回值及稳定错误码；本队列中的接口是提案，不冒充已经批准。
- [x] 明确谱面与头像配额如何共存、私有音频/图片如何按需读取、旧版本保留和删除规则、失败导入的占用回收。历史版本必须计入逻辑容量；不另设物理预留或无界缓存。
- [x] 本地文档自检：范围与总体设计一致、每个新增接口有定义、测试能验证规定行为，避免为了未来 20 万用户提前添加服务。标记「待设计审阅」并交付；Task 6–14 在设计定稿后进入实现。

2026-10-11：Task 1 文档与一次独立 builder check 已完成；关键确定性问题已修正。产物为 [详细设计](/Users/i/Code/AstroDX/docs/superpowers/specs/2026-10-11-community-chart-draft-design.md) 和 [Task 6–14 实施切片](/Users/i/Code/AstroDX/docs/superpowers/plans/2026-10-11-community-chart-draft.md)。设计状态仍待用户审阅，没有运行构建/测试或开放谱面用途。

### Task 2: 迁移到独立远程环境

**Files（相对源码工作区）：**
- Read: `apps/community/Dockerfile`、`apps/community/ops/backup/Dockerfile`、`apps/community/compose.dev.yaml`。
- Adapt, private tooling only: `.superpowers/sdd/2026-10-10-community-storage/storage-check`、`infra/closeout-runtime.ts`、`infra/task12-fresh-compose.yaml`。
- Create, private tooling only: `.superpowers/sdd/2026-10-10-community-storage/infra/remote-compose.yaml`、`infra/remote-run.sh`。
- Reuse: `apps/community/test/storage/create-fixture.ts`、`fixture.ts`、`src/server/testing/test-db.ts`。

**Interfaces:**
- `remote-run.sh prepare|ui|sweep|restore|stop` 只在已确认的远程目录运行。输入 `STORAGE_ACCEPTANCE_ROOT`（上述绝对目录）、`STORAGE_ACCEPTANCE_PROJECT=adxc-storage-dev-20261011`、`STORAGE_ACCEPTANCE_SOURCE_SHA`（完整 commit SHA）；非法/缺少输入退出 2。
- 输出：独立 Compose project、只绑定远程 loopback 的端口、0600 测试配置，以及记录 source SHA、镜像 ID、运行命令/退出码的脱敏证据目录。只封装已有工具，不创建通用测试平台。
- `assertTestDatabaseUrl(url)` 仍必须拒绝不以 `_test` 结尾的数据库。新配置保留 real-role 和 fresh-restore 的 opt-in 开关。

- [x] 再做一次轻量 SSH 主机/目录/端口预检，确认没有其他工作占用拟用目录和 55432、56379、58333、58432、58433、41909、44111。端口冲突只修改本批配置。

```sh
ssh -o ConnectTimeout=10 i@localhost-1.tailac9c6f.ts.net 'uname -srm; id -un; pwd; docker info --format "{{.OSType}} {{.Architecture}} {{.ServerVersion}}"; ss -ltn'
```

预期 Linux x86_64、用户 i、Docker 可读。所有下述运行命令均经这个 SSH 目标执行；文档里的 `127.0.0.1` 指远程容器/宿主，不能当作 Mac。

- [x] 从独立源码工作区的选定 commit 同步 tracked 文件到远程新目录，写入完整 SHA。仅同步源码和锁文件；旧私有工具按上方白名单单独迁移，排除 `node_modules`、build、`.env`、身份信息和卷数据。
- [x] 去掉旧工具的 Mac 绝对路径、`host.docker.internal` 和只在本机存在的镜像 tag；统一 Compose 内部服务名及远程路径。restore Seaweed 必须使用当前认证 relay entrypoint，不能继续用旧 mini command 绕过已修复路径。
- [x] 远程生成测试 fixture；用现有固定 Dockerfile 和锁文件准备应用、backup 与 test 运行镜像。测试镜像可复用 builder 依赖并挂载 test 源码；不能依赖旧 Mac 镜像。正常情况下构建一次，各任务共用。
- [x] `remote-run.sh prepare` 启动本批 PG/Redis/S3，检查 readiness 和测试库名。每个运行服务设置资源限制、最多一个重任务；不启动搜索或生产实例。
- [x] 在分配的远程 fixture 上检查三个拒绝条件：缺少 SHA 退出 2、非 `_test` DB 拒绝且不执行 reset、已有非本批资源不删除。最后执行 `stop` 再准备一次，确认只操作该 project，保留卷。

2026-10-11：远程prepare与拒绝/owned复用检查通过，测试镜像复用既有app/backup，不再Vite。三个指定sweep已通过；UI/full restore因独立disk scratch需用户sudo认证仍待运行。工具仅为本批，owned服务最终已停止、卷保留。细节见最新验收报告和remote-tooling-handoff.md。

停止条件：准备超预算且没有明确下一步，输出阻塞证据，标记 Task 3–4 运行部分受阻并进入 Task 5 的交接整理；不改用本机、不反复重建镜像。

### Task 3: 收尾真实头像界面，修复可复现问题

**Files:**
- Inspect: `src/server/auth/mount.ts`、`src/server/auth/auth.ts`、`src/server/db/client.ts`、`src/server/storage/uploads.ts`（均位于 `apps/community/`）。认证实际调用路径先由错误堆栈确认，不凭猜测改文件。
- Conditional modify: `apps/community/src/client/lib/file-upload.ts`、`storage-errors.ts`、`src/client/components/avatar-upload.tsx`，仅真实缺陷涉及这些文件时。
- Existing tests: `apps/community/test/dom/avatar-upload.test.tsx`、`file-upload.test.tsx`；真实 UI 使用 Task 2 的 private runtime。

**Interfaces（保持不变）：**
- `createUploadController({ api: StorageApi, userId: string, storage: RecoveryStorage, onState: (state: UploadSnapshot) => void }): UploadController`。
- `UploadController.start(file: File): Promise<void>`、`resume(file: File, record: UploadRecord): Promise<void>`、`cancel(): Promise<void>`、`dispose(): void`。
- `storageErrorMessage(error: unknown): string`；API 的状态码、限额、轮询频率、expectedRevision 与显式保存行为沿用已批准设计。

- [ ] 用 `remote-run.sh ui` 准备合成账号和当前构建；必要时用本机轻量 SSH 转发到远程 loopback。应用内浏览器仅用于操作远程页面，不启动本机开发服务。
- [ ] 一次真实浏览器选择小 PNG：出现本地预览、hash/传输进度、ready 私有预览；点击保存后头像更新；刷新保留；点击删除恢复默认头像。保存状态/截图和对应脱敏请求结果。
- [ ] 若仍有 503/500，按 request 时间对照 web、Redis、PG、S3、media 日志，定位失败步骤。先确认服务 readiness、容器网络、会话读取与实际错误，再修改拥有该错误的最小代码。不能先断言是低性能主机。
- [ ] 真实产品缺陷先增加一个对应回归用例并在远程确认失败；fixture/网络错误只修 fixture，不增加镜像无关产品测试。
- [ ] 修复后只重跑失败步骤及受影响用例。修改需要重新构建的源码后，更新 source SHA 并在远程重建对应镜像一次，不能用旧构建冒充新代码。客户端改变时运行下列已有相关用例，不改生产超时；单次受控分片失败应保留旧头像，重选/恢复后成功。

```sh
# 仅在远程 test 容器内，cwd=/repo/apps/community：
bun x vitest run test/dom/avatar-upload.test.tsx test/dom/file-upload.test.tsx --testTimeout 15000
```

预期上传失败不修改已发布头像；取消终止 hash worker；旧 save/discard 不覆盖新候选；退出登录清除本用户恢复元数据。未改客户端时复用已有 16 用例结果。

- [ ] 真实界面通过后结束 owned runtime；若失败，记录具体请求/阶段、错误码和已排除的原因，不将 HTTP 全流程结果替代 UI 结果。真实代码修复单独 commit，工具调整与产品改动分开。

停止条件：同一失败没有新证据不重试；只有在定位和修改后再跑一次。超预算保留明确未通过项；Task 4 仅在 fixture 独立且就绪时继续，否则进入 Task 5 的交接整理。

### Task 4: 当前源码恢复与清理边界

**Files:**
- Test: `apps/community/ops/backup/fresh-restore.test.ts`。
- Test: `apps/community/src/worker/storage-sweep.test.ts`。
- Conditional modify: `apps/community/src/worker/storage-sweep.ts`、`apps/community/ops/backup/{export,restore}.ts`，仅断言或操作日志证明产品缺陷时。
- Reuse: Task 2 的私有运行工具与两个独立 `_test` fixture。

**Interfaces:**
- `remote-run.sh sweep`：三个名称逐个独立进程执行、记录每个结果。一个进程退出并确认 owned DB/S3 操作已结束后，才能启动下一个。
- `remote-run.sh restore`：fresh PG/S3 volumes、当前源码/镜像、`STORAGE_TEST_FRESH_RESTORE=1`、`STORAGE_TEST_REAL_ROLES=1`；完成既有 full snapshot、post-snapshot deletion、closed restore 与 native rebuild 断言。
- 不修改恢复锁、drain/journal 协议或生产 durability 来让测试通过；不在 live DB 上运行 reset。

- [ ] 准备结束后先运行当前源码 full restore 一次，保留阶段日志和退出码。沿用既有用例完整断言；确认新卷、两份 DB dump、原件 hash、latest journal、已删除对象不会恢复公开、native 派生重建和最终开门条件。

```sh
# 远程 backup/test 容器内，cwd=/repo/apps/community；fixture env 由 Task 2 提供：
STORAGE_TEST_FRESH_RESTORE=1 STORAGE_TEST_REAL_ROLES=1 bun test ops/backup/fresh-restore.test.ts --timeout 180000
```

外层受控运行上限 240 秒，超时不能启动另一个 restore。须保留 closed 和日志，证明 owned 子进程/远端 IO 结束；只有明确定位并修复后才允许一次重跑。不得把限时退出记为通过。

- [x] 串行运行下列三个名字，每次 Bun 单用例观察上限 120 秒、外层 150 秒。先修工具的清理/结束问题，避免前一个超时继续污染后一个。

```sh
# 各命令在独立远程 test 容器内执行；STORAGE_TEST_REAL_ROLES=1 及 fixture env 由工具提供：
bun test src/worker/storage-sweep.test.ts --timeout 120000 -t 'physical scans rotate beyond batch100 and failed resume batches cannot starve later generations'
bun test src/worker/storage-sweep.test.ts --timeout 120000 -t 'unknown physical temporary prefix waits48h and accounts once before deletion'
bun test src/worker/storage-sweep.test.ts --timeout 120000 -t '51 deferred avatars rotate past still-revoking first50 with a nonadvancing clock'
```

预期分别证明：扫描越过 batch100/失败批次不饥饿；未知临时前缀 48h 前不删除且只计费一次；首 50 个仍撤回时后面的头像也可继续被扫描。超时收集 `pg_stat_activity`、等待事件、S3 操作阶段，不调整生产参数。

- [ ] 仅修改实际失败原因；新增行为先定向红灯，修改后跑受影响名字。若容量计算未改，不重跑 capacity-policy/dump-bounds；若改了，才在远程运行这两个文件并验证空 manifest 不预留上限、同 FS 汇总和 5 GiB 边界。
- [ ] 清掉临时时间打印，保留复现与结果。使用 SHA、镜像 ID 和独立 fixture 标识区分当前成功/历史成功/未通过；提交真实修复及报告，不提交配置密钥或卷。

### Task 5: 整理候选与发布边界

**Files:**
- Update: `docs/superpowers/reports/2026-10-11-community-storage-acceptance.md`（源码工作区）。
- Update only if behavior changed: `apps/community/ops/seaweed/ROLLOUT.md`、`ops/backup/README.md`。
- Record handoff: `/Users/i/Code/AstroDX/.superpowers/claude-continuation/storage-closeout-20261011.md`。

- [ ] 检查范围限定的 `git diff --check`、变更文件和报告；不得包含主站/AWMC 改动。记录现有 `3b0a580` 与本批新增提交。
- [ ] 列出源代码完成、远程构建/定向测试、真实 UI、生产四种状态；失败项保留，不用总测试数掩盖。
- [ ] 将发布前需要的 live 磁盘/容量 preflight、服务器密钥存在性、首次生产备份和真实 Cloudflare edge purge 写入短 checklist。它们留给单独的生产发布步骤，本批不读取或改写生产密钥。
- [ ] 记录 additive migration/已写入数据的回退边界，继续保留原件、journal、closed restore 的既有方案。停止本批 owned 服务，保留必要证据及测试卷；不做全局 Docker prune。

交付判定：Task 3–4 都通过才写「远程收尾通过，可进入生产发布审阅」；否则明确写阻塞项。两种状态都不等于已经生产上线。

## 后续谱面开发队列

以下路径以源码工作区为根；新增接口、文件和路由是设计提案，Task 1 会把契约及大小/配额数值写进详细 spec。远程定向命令均在隔离容器的 `/repo/apps/community` 执行；每项只跑本项用例，改到公共上传逻辑时再追加受影响的现有用例。

谱面阶段重点检查五类输入：越界/重复路径和解压超限（Task 7）；导入取消及重复任务（Task 8）；匿名和非所有者读取（Task 9、13）；替换失败与旧 revision（Task 10、14）；删除共享对象、重复扣费和恢复记录（Task 10）。这是功能所需的验收范围，不建立额外测试平台。

### Task 6: 谱面文件用途和配额规则

**依赖：** Task 1 定稿，运行依赖 Task 2。**成果：** 现有上传系统具备独立的谱面规则，不另造一套分片传输。

**Files:**
- Modify: `apps/community/src/server/storage/rules.ts`、`uploads.ts`、`src/shared/storage.ts`。
- Create/Test: `apps/community/src/server/charts/upload-rules.ts`、`upload-rules.test.ts`。

**Interfaces:** 保留 `initUpload(ctx, userId, input: InitUploadInput, idempotencyKey): Promise<UploadDto>` 和现有 `StoragePurpose = "avatar" | "chart-source"`；按用途选择大小、逻辑配额及处理规则。谱面规则的具体数值来自 Task 1。

- [ ] 为合法谱面、超过谱面限额、头像仍限制 8 MiB 写定向断言；确认失败发生在任何对象写入前。
- [ ] 拆开 `uploads.ts` 当前固定使用 `AVATAR_RULE.quota/maxSize` 的位置，沿用现有 usage/budget 事务与共享并发上限；明确按设计选择的配额模型记账。
- [ ] 在隔离 fixture 接入 `chart-source`；未完成 Task 8 前不向产品开放未校验的用途。
- [ ] 远程运行 `bun test src/server/charts/upload-rules.test.ts`，预期三类规则断言通过；提交本项。

### Task 7: 单首谱面包识别、检验与解析摘要

**依赖：** Task 1 包结构/输入形式定稿、Task 6 的规则。**成果：** 用户获得解析后的标题、艺术家、各难度和稳定错误原因。

**Files:**
- Reuse: `packages/maimai-chart-engine/src/core/parser/ChartParser.ts`、`SimaiParser.ts`。
- Create/Test: `apps/community/src/server/charts/package-validation.ts`、`maidata-summary.ts` 及同名 `.test.ts`。
- Conditional modify: `apps/community/package.json`、根 `bun.lock`，仅在确认需要 ZIP 读取依赖时；现有锁文件含 fflate 0.8.3，不能把浏览器解压实现直接当作服务端资源边界。

**Interfaces:** 产出设计定义的 `ChartPackageInspection`，包括原始 maidata MD5→Base64、解析摘要、规范化资产清单及检验错误。复用 `getAvailableDifficulties(simaiText: string)`、`parseSimaiChart(simaiText: string, difficulty?)`，业务字段封装留在 community，暂不抽整个预览包。

- [ ] 统一 ZIP/文件夹的规范化清单，识别不区分大小写的文件名；包条目数、单项/解压总量、时间与 scratch 均受 Task 1 上限控制。拒绝绝对/越界路径、规范化重名和不支持的结构。
- [ ] 完整保留 maidata 原始字节计算互通哈希；文本解码或换行处理仅服务解析，不能改变版本标识输入。MD5 不参与去重或权限判断。
- [ ] 写正常包（含大小写差异）、缺失 maidata/无有效难度、路径越界/重名/超限，以及 CRLF/BOM 字节变化不被哈希归一化的必要用例。
- [ ] 远程运行 `bun test src/server/charts/package-validation.test.ts src/server/charts/maidata-summary.test.ts`，预期返回稳定摘要或具体拒绝码；提交本项。

### Task 8: 谱面异步导入、私有资产与状态完成

**依赖：** Task 6–7。**成果：** 上传后 processing → ready/rejected，用户能查看检验结果和重试失败上传。

**Files:**
- Modify: `apps/community/src/server/storage/flow.ts`、`deletion.ts`、`src/server/jobs/queues.ts`、`src/media-worker/ingest.ts`、`finalize.ts`、`main.ts`。
- Create/Test: `apps/community/src/media-worker/chart-source.ts`、`chart-source.test.ts`。
- Inspect: `apps/community/src/server/storage/files.ts`、`contracts.ts`，仅按设计需要扩展结果/私有读取契约。

**Interfaces:** 输入沿用 `StorageJobData` 的 uploadId/generation 和角色受限 storage context；结果挂到本次上传/逻辑文件，继续使用 `UploadDto.state`、`fileId`、`errorCode`。私有预览所需 maidata/音频按 Task 1 方案读取或按需提取，不能生成公开媒体引用。

- [ ] 将固定 `ingest → avatar → finalize` 按用途分流，谱面走 Task 7 检验；现有头像链路保持原处理规则。让取消操作按实际队列映射取消 flow，不能沿用固定头像队列下标。
- [ ] 保留 generation 和事务幂等规则，重复导入不重复计费或保存结果；损坏包进入 rejected 并释放逻辑预留，物理不确定写入仍交现有清理机制。
- [ ] 对成功、损坏、重复执行和取消后迟到的任务各验证一次；检查不遗留孤立任务、私有资产和未计入预算的 scratch。
- [ ] 远程运行 `bun test src/media-worker/chart-source.test.ts`，预期终态、记账和取消断言通过；提交本项。

### Task 9: Chart / ChartVersion 模型与私有草稿 API

**依赖：** Task 8。**成果：** 从本人 ready 文件创建私有草稿，读取列表/详情及保存草稿元数据。

**Files:**
- Create: `apps/community/src/server/db/schema/charts.ts`、下一编号迁移（当前接在 `0008_storage_runtime_roles.sql` 后）、`src/shared/charts.ts`、`src/server/charts/drafts.ts`、`src/server/api/chart-drafts.ts`。
- Modify: `apps/community/src/server/db/schema/index.ts`、`src/server/api/v1.ts`、`src/server/app-env.ts`、`src/server/services/api-services.ts`。
- Test: `apps/community/test/http/chart-drafts.test.ts`。

**Interfaces（供 Task 1 定稿）：** `/api/v1/me/charts` 下 POST 创建、GET 分页列表，`/:id` GET 详情、PATCH 元数据；创建输入 `fileId`，编辑输入 `expectedRevision` 和设计规定的可编辑字段。`src/shared/charts.ts` 统一定义 `ChartDraftDto`、`ChartVersionDto` 及 zod 规则，不能让页面另造 DTO。

- [ ] 用 Chart 稳定 ID、ChartVersion 的版本/source file 外键建立私有模型；owner、当前版本、互通哈希和 revision 均有约束。创建与引用绑定在事务中完成。
- [ ] 拒绝别人的 fileId、未 ready/被拒绝文件；同一次创建重试只产生一份草稿。分页有有界 limit 和稳定顺序，不扫描所有用户的数据。
- [ ] 将鉴权放 API：匿名拒绝，非所有者不能读取，详情/资产响应强制 `private, no-store`；列表不出现在公开用户主页。
- [ ] 远程运行 `bun test test/http/chart-drafts.test.ts`：本人创建/列表/详情成功；他人访问、非法 fileId 和创建重放结果符合契约。提交模型、迁移与 API。

### Task 10: 版本替换、草稿删除与引用回收 API

**依赖：** Task 9。**成果：** 换源码产生新 ChartVersion，失败保留旧版本；删除草稿后按既有宽限期回收占用。

**Files:**
- Create/Test: `apps/community/src/server/charts/references.ts`、`deletion.ts`、`references.test.ts`。
- Modify: `apps/community/src/server/charts/drafts.ts`、`src/server/api/chart-drafts.ts`、`src/server/storage/references.ts`、`src/server/services/user-deletion.ts`。
- Reuse: `apps/community/src/server/storage/deletion.ts`、`src/worker/storage-delete.ts`、`storage-sweep.ts`。

**Interfaces（供 Task 1 定稿）：** `POST /api/v1/me/charts/:id/versions` 接收新 ready fileId 和 expectedRevision；`DELETE /:id` 删除草稿。引用登记实现既有 `FileReference.references/publicRepresentations/retention`，私有草稿的公开表示为 false，并成对注册账号注销处理器。

- [ ] 在同一事务验证所有者和 revision，绑定新版本后再更新当前版本；历史版本按设计计入配额且可按规则删除，不静默吞掉原件。
- [ ] 绑定中的文件禁止被裸文件删除接口绕过。删除草稿或注销只解除其拥有的引用，再交现有逻辑文件/物理对象清理流程；共享物理对象保留其他有效引用。
- [ ] 定向验证旧 revision 冲突不覆盖、替换失败保留有效旧版本、共享引用保留、重复删除/注销不重复扣容量。新增业务表纳入正常 DB dump；涉及存储布局时补一例草稿恢复，不重跑无关 suite。
- [ ] 远程运行 `bun test src/server/charts/references.test.ts` 及 Task 9 中受本项影响的名称；提交本项。

### Task 11: 单首谱面上传界面

**依赖：** Task 8–9。**成果：** 选择设计支持的输入 → 进度 → 解析结果 → 显式保存为私有草稿。

**Files:**
- Create: `apps/community/src/client/routes/chart-upload.tsx`、`components/chart-upload.tsx`、`queries/charts.ts`。
- Modify: `apps/community/src/client/routes.ts`、`src/client/lib/file-upload.ts`、`storage-errors.ts`、`messages/{zh,en,ja}.json`。
- Test: `apps/community/test/dom/chart-upload.test.tsx`；必要时追加现有 `file-upload.test.tsx` 的受影响用例。

**Interfaces:** 使用现有 `StorageApi` 传输和 Task 9 的草稿创建接口。当前 upload controller 的 purpose 和 8 MiB 均写死为 avatar，须通过显式用途/上限参数扩展；头像调用保留默认行为。恢复元数据按用户与用途隔离，历史无用途记录只能视作头像，不能当谱面续传。

- [ ] 实现选择输入、上传/处理进度、解析错误、重新选择/取消和明确保存按钮；三语文案只呈现用户需要处理的信息。
- [ ] 对上传 controller 做最小扩展；设计若需要浏览器打包，放入 Worker 并遵守包上限，不能把所有资产无限读入主线程内存。
- [ ] 定向验收一次成功保存、一次失败重试、取消不生成草稿、头像与谱面恢复记录不串用。只有 controller 改变时追加对应旧用例。
- [ ] 远程运行 `bun x vitest run test/dom/chart-upload.test.tsx`；一次远程页面实际上传链路的结果留给本段统一验收，不每一步重复浏览器操作。提交本项。

### Task 12: 我的草稿列表与详情

**依赖：** Task 9。**成果：** 用户可找回草稿，查看处理状态、版本摘要和错误，继续编辑或进入预览。

**Files:**
- Create: `apps/community/src/client/routes/my-charts.tsx`、`chart-draft.tsx`、`components/chart-draft-card.tsx`、`test/dom/chart-draft-pages.test.tsx`。
- Modify: `apps/community/src/client/routes.ts`、`queries/charts.ts`、`messages/{zh,en,ja}.json`。
- Reuse: `apps/community/src/client/lib/require-user.ts`、`routes/settings-profile.tsx` 的 API 预取/hydration 模式。

**Interfaces（供 Task 1 定稿）：** 本地化 `/my/charts` 与 `/my/charts/:id`；query key 按登录用户隔离。`ChartDraftDto`/版本数据只来自 Task 9 的 API；私有页面设 noindex。

- [ ] 做有界分页列表、空列表、载入错误和详情；未登录保留返回地址跳登录。退出/切账号清除前用户的私有查询缓存。
- [ ] 接入上传入口和 ready/processing/rejected 呈现；复用 API 的所有者限制，不另做一套前端授权逻辑。
- [ ] 远程运行 `bun x vitest run test/dom/chart-draft-pages.test.tsx`，验证空/有数据/错误三态及账号切换不会显示前用户数据；提交本项。

### Task 13: 所有者私有 Canvas 预览

**依赖：** Task 7–9、12 的详情契约。**成果：** 草稿所有者选择难度、播放/暂停和跳转，不发布文件。

**Files:**
- Reuse: `packages/maimai-chart-engine/src/core/parser/SimaiParser.ts`、`src/renderers/MainRenderer.ts`。
- Reference: `apps/web/src/components/chart-preview/chart-canvas.tsx`、`apply-difficulty.ts`、`lib/time-conversion.ts`。
- Create: `apps/community/src/client/components/chart-preview.tsx`、`lib/chart-preview.ts`、`lib/chart-preview.test.ts`。
- Modify as required: `apps/community/src/server/api/chart-drafts.ts` 的私有内容读取、`package.json` 中已有 engine workspace 依赖、三语文案。

**Interfaces:** 复用已有 `@lxns-network/maimai-chart-engine`；Task 1 定义当前版本的私有 maidata/音频读取契约。仓库尚无 `packages/chart-preview`，不能把主站完整 SWR/镜像下载/字典耦合组件直接搬过来；先做社区有限封装。

- [ ] 服务端按 chart/version/asset 的业务归属鉴权；私有内容不可通过猜测 hash/路径或公开 `/media/` 读取，响应保持 no-store。
- [ ] 封装 renderer/audio 生命周期及难度切换、播放/暂停、跳转；离开页面或换版本取消请求并释放音频、renderer、rAF 和临时 URL。
- [ ] 远程运行 `bun test src/client/lib/chart-preview.test.ts`，验证一个多难度 fixture 和销毁逻辑；用同一次远程浏览器走查确认实际绘制/播放。匿名及他人内容读取复用 Task 9 的 API fixture 补一个内容端点断言。
- [ ] 提交本项；暂不提供签名分享链接、PV、GIF 或主站下载能力。

### Task 14: 草稿编辑、版本管理和删除界面

**依赖：** Task 10–13。**成果：** 修改元数据、上传替换版本、查看版本、处理冲突及确认删除。

**Files:**
- Create: `apps/community/src/client/components/chart-draft-form.tsx`、`chart-version-list.tsx`、`delete-chart-draft.tsx`、`test/dom/chart-draft-edit.test.tsx`。
- Modify: `apps/community/src/client/routes/chart-draft.tsx`、`queries/charts.ts`、`messages/{zh,en,ja}.json`。
- Reuse: `apps/community/src/client/routes/settings-profile.tsx` 的显式提交/缓存失效模式。

**Interfaces:** 所有修改调用 Task 9–10 的 DTO 和 expectedRevision 契约；UI 不能自己覆盖旧版本或调用裸文件删除代替业务删除。

- [ ] 实现明确保存、替换上传、版本列表及删除确认；冲突提示刷新当前状态，失败不清空仍有效的草稿。
- [ ] 远程运行 `bun x vitest run test/dom/chart-draft-edit.test.tsx`，验证保存成功、一个 revision 冲突和取消删除；共享引用/容量回收复用 Task 10 的后端证据。
- [ ] 最后统一做一次远程真实流程：上传 → 保存 → 列表/详情 → 预览 → 替换 → 删除。构建最终候选一次；改动导致产物失效时才重建，不重跑登录、主站下载或整套历史测试。
- [ ] 提交本段界面和简短验收报告，注明 source SHA、必要结果及失败项。整理发布候选，本队列不自动推送或生产部署。

## 执行方式与自检

先由主代理完成 Task 1 设计，一名代理可并行核对解析器与存储接口；设计交付后，主代理按 Task 2–5 处理存储收尾，随后按依赖推进 Task 6–14。不同文件的纯逻辑/界面任务可以交给代理并行，但 DB/S3 的运行和最终构建保持一个任务拥有。每个工作批次完成后做一次针对实际 diff 的独立复核，不进行每个小步的重复整分支审查。

本计划已按当前 spec 和现有证据自检：头像及物理容量预留政策没有扩大；存储和谱面的重点风险均分配了责任任务；历史成功不替代当前未通过项；新谱面任务是待详细设计定稿的开发队列；所有运行命令都受远程主机约束。执行时先核对 live SHA/环境，文档中的时间预算不作为跳过失败或延长重复验证的理由。
