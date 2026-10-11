# 私有谱面上传与草稿验收记录

日期：2026-10-11。用户已批准详细设计及编码；所有运行工作在远程执行，只跑必要用例。此候选未推送或部署。

## 来源与实现

- 分支：`codex/community-storage-design`，源码工作区 `/Users/i/.codex/worktrees/community-storage-design/AstroDX`。
- 产品提交：`b0023902ab2d4bd16b45de2b791629e569f6106d`，基线 `75aa584`。主工作区无关的下载验收文件未纳入。
- 单首 ZIP/文件夹 → 分片上传 → 有限校验及解析摘要 → 显式保存私有草稿。`/me/charts` 提供本人列表、详情、标题/艺术家编辑、新版本、切换及删除。
- 私有 maidata/audio/cover 经所有者鉴权读取，支持 HEAD/Range、取消及撤回；原 ZIP 和预览 artifact 均不公开。Canvas 引擎、解析和音频仅按需载入。
- Chart / ChartVersion 以专属逻辑 File 和 recipe 外键关联；additive migration `0009_lazy_chat.sql`。历史版本计逻辑容量，删除序号保留，删除后的 File 可 GC；注销冷静期保留引用且停止读取。
- 头像 32 MiB、谱面 256 MiB 都是逻辑限额，不预分配用户磁盘；沿用既有 PG/pg-boss/SeaweedFS，没有增加生产服务或桶。全局容量和备份保留策略不扩大。
- ZIP 最大 64 MiB、128 entries/128 MiB 实际展开；maidata 最大 1 MiB。子进程有限解析、最多 100000 notes/3600 秒/64 diagnostics，30 秒硬退出，两用途共用原生容量门。

## 远程环境

执行目标 `i@localhost-1.tailac9c6f.ts.net`，实测 Linux hostname `localhost`，Docker daemon 29.8.0。本机仅读写、Git 和连接，不安装依赖或运行应用/测试。

独占目录 `/home/i/astrodx-community-storage-dev-20261011`，project `adxc-storage-dev-20261011`，`.owner` 校验；合成账号、新测试密钥和 `_test` 数据库，未搬旧 `.env`、身份或数据卷。使用固定 Bun 1.4.2 镜像。重任务串行；类型/DOM工具通过 CPU affinity 限制为一个实际 CPU，1.5 GiB 工具内存。产品 worker 仍为既有 512 MiB/1 CPU。

源码定向用例运行于 `chart-src` 开发 overlay，不能等同旧基线镜像验收。构建使用另一个 `chart-release-src`，从上述产品提交的 tracked 文件导出，并以 OCI revision 标识。旧 `src`/`source-sha`/镜像身份与待安装的临时盘说明保持原样。

## 必要验证

以下日志位于远程 `evidence/`，只列与本批变化有关的证据。失败的初次尝试保留，后续仅重跑具体失败或新改动。

| 内容 | 最终证据 | 结果 |
|---|---|---|
| ZIP 路径/碰撞/格式/长度/CRC 和实际解压取消 | `chart-parser-green.log` 的首批通过项；`chart-package-final-targeted.log` 的三个修复用例；修正的 STORED/DEFLATE 单例工具输出；`chart-focused-final.log` 中 disk-start 拒绝 | 定向通过；未宣称首个日志全绿 |
| artifact 完整性及原文件 hash | `chart-package-focused.log` 中 artifact/兼容 fixture，通过项与旧 ZIP 失败分开记录 | 通过项确认 |
| maidata 原始 BOM/CRLF hash、旧单难度归一化、非法/未知语法、限额与 V[] 诊断 | `chart-review-regressions.log` | 18 用例通过，33 ms；旧二参调用结果保留 |
| 用途额度与预约、草稿所有权/revision/幂等/版本/注销/删除日志 | `chart-api-pipeline.log`；两个 Bun matcher 修正后的 `chart-focused-final.log` | 相关用例最终通过 |
| 私有资产整包校验、HEAD/Range/304/416、匿名及跨用户访问、取消 | `chart-api-pipeline.log` | 4 用例通过 |
| 真 PG/S3 的导入/重复 finalize/精确 build 重建/格式拒绝/死信 | `chart-review-regressions.log` | 相关四用例通过，1.14 秒进程 |
| 真实运行中的 child 取消、kill/reap、共享槽复用、取消后 claim=null、计算 lease 的 generation fence | `chart-final-types.log` | 2 个受影响用例通过，780 ms 进程；物理写入的未知 lease 不释放 |
| 真 Navigator 执行谱面 ingest/import/finalize | `chart-focused-final.log` | 1 用例通过，10.52 秒 |
| 上传 controller 和文件夹输入 | `chart-focused-final.log`；`chart-folder-worker-final.log` | 16 控制/输入用例；真实 Worker STORED ZIP 单例 11 断言通过 |
| 列表/显式保存/编辑冲突/版本删除等 DOM | `chart-focused-final.log` | 4 文件、17 用例通过 |
| 按需预览、私有资源撤回、旧谱面、真实 parser 四拍前奏及 first 音频对齐 | `chart-review-regressions.log` | 预览文件 7 用例通过，272 ms 用例时间；为 DOM/API 模拟，非真实浏览器听音验收 |
| 已删除版本实际进入 sweep、File hard GC、历史 source=NULL、当前版本可私有读取 | `chart-review-regressions.log` | 真实隔离 S3/control sweep 单例通过，240 ms；不重跑三个已接受旧 sweep |
| 公共上传/引用及头像受影响路径 | `chart-focused-final.log`；`chart-review-regressions.log` | 三个公共路径定向用例、头像去重结算及实际 Navigator 通过；最后头像单例 2.15 秒进程 |
| TypeScript | `chart-final-types.log` | `bun x --bun tsc --noEmit` exit 0；没有扩大成全仓 check |
| 冻结锁文件 | `chart-lock-final.log` + 最终 Git diff | 远程从基线与完整 workspace 清单生成，1051 packages；锁只增加 12 行，不删除主站/Dash依赖 |

没有重新运行 QQ/Google/通行密钥、Turnstile、主站下载或全仓测试。引擎其他文件只将类型导入改为 `import type`，解决新 community `verbatimModuleSyntax` 检查发现的 TS1484，没有渲染逻辑变更。

## 一次最终独立复核

六处实际问题已关闭：音频扣除四拍前奏；客户端与服务端共用旧谱面归一化；chart-import 死信终结；运行中取消 child 及 File 终结；soft-deleted 版本不挡 File GC；独立 V timing 未实现时禁止宣称可预览。

同次复核又核对计算 lease 释放的条件：只在本进程 native 和本地 IO 已结束、无物理 output claim 时，按 source/recipe/generation/原 lease 精确清空。取消时 claim 明确返回 null 可释放；异常或结果不明仍保留。复核最终无剩余 Critical/Important 阻断。没有重新发起泛审查。

## 构建与尚未验收

应用和备份镜像均已在远程构建成功，`chart-app-build.result`/`chart-backup-build.result` 的 source SHA 为产品提交，exit 0。应用中的生产 import 检查 1 用例/2 断言通过；两个实际镜像都加载 sharp 0.35.5/vips 8.18.7 和相同 chart recipe。

| 镜像 tag | 已检查的 image ID / revision |
|---|---|
| `adxc-storage-dev-20261011-chart-app:b002390` | `sha256:02bf01d83a5a5500ab8122143a1cfbac839049acca4f15d6767a372d9d06947d` / `b0023902ab2d4bd16b45de2b791629e569f6106d` |
| `adxc-storage-dev-20261011-chart-backup:b002390` | `sha256:354f845c54618a3c1c3e64ea0089c8828eca7c43fef680003056f3fad0e51ed8` / 同上 |

共同 recipe：`chart-preview-v1.zip-v1.parser-6348a7142bb8cfabd674aaa8048dd703.sharp-0.35.5.vips-8.18.7.jpeg85`。日志 `chart-image-check.log`/`chart-backup-check.log`。构建工具使用独占一个 CPU/2 GiB、串行的临时 BuildKit；其资源设置依据 [Docker container driver 官方参数](https://docs.docker.com/build/builders/drivers/docker-container/)。它是开发工具，结束后停止，不增加生产常驻服务。

构建镜像内的实际 Web 启动及路由检查通过（`chart-built-http.log`）：`/healthz` 200、匿名 `/api/v1/me/charts` 401/private no-store、`/me/charts` 302、`/login` 200。只使用一次性合成启动 fixture，没有启 media worker；不把 liveness 当作完整 `/readyz` 或真实浏览器验收。首次 smoke 缺初始 0600 restore state 被 `STORAGE_RESTORE_CLOSED` 正常拒绝，补的是新 throwaway fixture 初始 state，未开启任何处于恢复中的系统。

首次在读取 Docker Hub manifest 时超时；已保存 `chart-app-build-direct-timeout.log`。核对远程既有代理后，registry 探测返回 401、NPM 返回 200。BuildKit daemon 和 Dockerfile RUN 包管理器须分别配置代理；前者用 host network/driver env，后者用 build 的 host network 和标准 HTTP_PROXY/HTTPS_PROXY build args。仅本批工具使用，未改 Docker 全局代理或生产配置；代理值/凭据不写入此记录。未配置 RUN 的安装停滞已停止并保留 `chart-app-build-npm-stalled.log`，没有因它重跑已通过的功能测试。

真实浏览器上传/保存/听音，以及 fresh-volume full restore **未验收**。远程 `scratch` 当前仍是约 2 TiB 根文件系统的普通目录，不能代替规定的有界临时盘。待用户在远程完成 `/Users/i/Code/AstroDX/.superpowers/claude-continuation/community-remote-scratch-install.md` 中的 sudo 步骤：512 MiB sparse ext4，实际写入才占用；工具不使用 `fallocate`，不削弱 mount 检查。

必要自动验证及编码可独立完成；以上两项继续保留为生产前条件。生产 g510、Cloudflare、AWMC、公开入口与主站下载均未变更。

## 收尾

`chart-cleanup.log`：本批 Compose 服务全部停止；专用 BuildKit builder 及其 state/cache 已删除，`chart-src` 中临时 `node_modules`/`.bun-cache` 已清理（约 1.1 GiB 依赖及构建缓存无需常驻）。保留当前/基线源码、镜像、448 KiB 证据和独立测试卷；没有执行全局 Docker prune，也未停止其他项目。当前 release tracked 源码 5.5 MiB。
