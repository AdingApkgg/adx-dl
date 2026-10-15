# 自制谱公开发布与浏览：隔离验收

日期：2026-10-16（Asia/Shanghai）。状态：第 1 轮修复已补齐完整有界原生生命周期证据，待独立复核；仅作为本地功能开发验收。功能与实际恢复断言通过；历史日志记录过主动清理前的三角色自主退出，直接触发为客户端心跳查询读超时，底层延迟原因仍未定位，属于公开功能生产发布前必须另行复核的风险。功能仅在本地分支实现与隔离构建机验证，未推送、合并或部署生产。

## 源码与环境

最终原生镜像源码：`91affcf914301ab4e08047b14cb3c168b3fa8e93`。app、backup、Seaweed 与 acceptance/test 镜像的 OCI revision 均与该提交一致，逐一核对镜像 ID；文档提交不改变已测产品代码。

| 镜像 | 镜像 ID |
| --- | --- |
| app | `sha256:12289cd4697f104bb8d1b4d9200b098cd4585bc89722f517742ce301f4f4fc81` |
| backup | `sha256:496c63df05eed4d704a5a1c717f738ed440ba600b81d8c61c9b7c24fa58e290f` |
| Seaweed | `sha256:f83252b7ebe8224744f589b73e5bdf6f82c2bca74833d89f25ef684915c5f66d` |
| acceptance/test | `sha256:2731916d899d2a4bedcb6a873560b31066f5a6b7d07b1f5ab883f107f5e79972` |

所有依赖安装、类型检查、构建、测试、Chromium 与容器均在经 hostname 检查的 Linux 构建机运行；Mac 仅读改代码、Git、传输和查看截图。源码通过 `scripts/remote/verify.sh --ref <commit> --keep --host-command` 发送，保留构建机代理与资源限制。

原生测试复用 acceptance Compose/prepare/bootstrap，包含实际 web、media、control 三个角色、PG18、Redis8 与认证 SeaweedFS。发布使用实际 control worker 导出的独立加密 journal，不注入模拟 exporter。合成凭据只存在私有夹具目录；`.dockerignore` 排除验收状态目录。私有 hostname 保护 launcher 不伪造 GitHub 环境，仓库 `run.sh` 的 GitHub-hosted 守卫保持生效。

媒体与恢复使用真正的 512 MiB ext4 镜像（可用文件系统总字节 510873600），`nodev,nosuid,noexec`；挂载/卸载由授权的磁盘管理者完成，测试 launcher 无 sudo/FUSE 或权限绕过。

## 自动检查

产品代码最终变更已纳入 `3725518` 的一体检查；该提交到最终源码的差异仅为 acceptance 浏览器/恢复夹具与说明、launcher readiness 校验，`apps/community/src`、共享包、应用 Dockerfile、backup/Seaweed 产品代码差异为空。

| 检查 | 结果 |
| --- | --- |
| 社区 lint | 441 文件，退出 0；6 warnings、27 infos，未称无警告 |
| 文案生成、Router typegen、TypeScript | 通过 |
| 全部 Bun | 922 pass / 0 fail，7019 断言，140 文件 |
| 全部 DOM | 80 pass / 0 fail，13 文件 |
| client/server 生产构建 | 通过 |
| 全部 built HTTP | 53 pass / 0 fail，282 断言，7 文件 |
| 最终 `91affcf` 夹具 TypeScript/typegen | 通过 |
| 下载并发池定向回归 | 4 pass / 0 fail，131 断言；包含两种池及 HEAD 取消失败 |

本轮 HTTP 测试通过真实 built server、PG 与 S3 driver 的 HTTP 端点，注入对象元数据错误和 503，验证原始 ZIP/maidata、hash block、两条下载并发上限、429/Retry-After、断连取消与恢复准入。错误注入使用受控对象 HTTP 服务；真实 Seaweed 上的健康上传/读取另由原生浏览器与恢复演练证明。临时改名隔离库的 publication 表产生真实查询错误，列表/详情 SSR 与 React Router `.data` 均返回 503、`private, no-store`，HTML 有 noindex。

## 本轮实际修复

- built HTTP 复现：两次失败 ZIP `HEAD` 响应占住并发槽，随后正常 GET 返回 429。原因是 HEAD 的错误 body 被 HTTP 适配器抑制，限流器等不到消费结束。修复主动取消 HEAD body 并释放槽位，取消失败仍保留原状态和缓存头；正常 HEAD/304、GET 错误 body、ZIP 与资产两种池有回归覆盖。
- 原生 Chromium 复现：保存私有 Chart 后刷新详情返回 500，服务端诊断 `window is not defined`。发布组件在 render 阶段调用浏览器 API 工厂。改用项目现有 SSR 安全工厂；签名合成会话的 built HTTP 私有详情和实际浏览器刷新验证通过。

测试夹具修正单独记录：typed scenario rows、私有 Chart 当前版本指针、匿名保留的七日冷静期、下拉框可访问名称、区分 JS bundle 与谱面媒体路径，以及恢复流读取的取消信号。这些不作为产品缺陷计数。

## 原生浏览器和完整恢复

最终 `91affcf` 的全新服务启动验证了 web/media/control 三个角色新鲜心跳、独立 PG 会话锁和六项 readiness。Chromium 12 步通过，耗时 51.744 秒，未捕获页面错误 0、hydration 错误 0；见 [浏览器回执](community-public-charts-2026-10-16/browser-result.json)。

- 作者实际使用显式版本选择与原始 ZIP 确认发布；尚未公开的草稿、新私有版本拒绝匿名访问。修改私有元数据后，公开 DTO 快照保持相同。
- 匿名从首页进入目录、详情，点击后才加载 maidata/audio 并运行实际 Canvas 预览；没有请求私有谱面 API。封面返回图片，音频 Range 字节一致，浏览器下载原始 ZIP 字节相同，正常下载 HEAD/304 保持缓存策略。
- 默认中文、英文、日文详情的 SSR/React Router `.data` 返回 200；无效和不存在 ID 返回 404，全部 `private, no-store`，HTML 错误页 noindex。真实查询失败产生的 503 由上述 built HTTP 覆盖。
- 撤回后，旧详情、下载及 maidata/audio/cover URL 的 GET、HEAD、Range、If-None-Match、If-Range 均返回 404、`private, no-store`；列表不再包含该谱面。
- 缺少封面/音频、不支持预览难度仍可进入详情和下载原始 ZIP，预览按钮禁用并显示原因。桌面与 390×844 手机视口详情均检查；手机无横向溢出。后续同源码诊断环境补充目录桌面与 390px 手机截图，并断言目录无横向溢出。

[桌面详情](community-public-charts-2026-10-16/public-desktop.png) · [手机详情](community-public-charts-2026-10-16/public-mobile.png) · [缺媒体与不支持预览](community-public-charts-2026-10-16/public-optional-media.png)。执行者与父任务均已目视复核这三张合成数据截图。执行者和父任务也已目视复核 [桌面目录](community-public-charts-2026-10-16/public-catalog-desktop.png) 与 [手机目录](community-public-charts-2026-10-16/public-catalog-mobile.png)。

完整原生恢复：1 pass / 0 fail、113 断言，测试总计 45.79 秒；实际 PG dump、认证 S3、Restic 和原生媒体流程恢复两个数据库与 9 个原件，恢复段 RTO 31.282 秒、配置每日 RPO 24 小时，见 [恢复回执](community-public-charts-2026-10-16/restore.json)。该 RTO 是此小型合成夹具的测量值，不外推生产容量。

在旧快照后实际提交撤回、替换、删谱和匿名保留事实，通过独立加密 journal 重放：旧权限不复活；快照缺失最新获准版本时拒绝公开并发出 `CHART_PUBLICATION_RESTORE_PENDING`，不回退旧版本；匿名保留仅保留确切公开版本，删除用户/资料/私有新版本和原文件名，恢复后 S3 原始 ZIP 响应字节与输入一致。演练继续验证独立 hash chain、缺头/篡改/缺口关闭、正常入口关闭、未决 IO 的所有权与受限恢复；Cloudflare purge 使用已有隔离 HTTP 夹具，并非生产 Cloudflare 请求。Task 1 的 40 项 PG 加密 journal 回归属于另一层定向证据，不替代本次实际 CLI 演练。

**此前真实可用性失败（仍保留为发布风险）：** 最终浏览器回执写于 04:08:21 CST，control 在 04:08:54 报 `STORAGE_ROLE_LOST`；04:09:04 采样三个角色心跳均陈旧约 12 秒、会话锁不存在、三个容器已退出且 restart/OOM 为 0。主动 restore stop 是 04:09:05，故该退出发生在主动停止之前。较早一轮也曾冷启动失去角色，而相同配额暖重启 6/6 成功；这些不足以定位根因。未放宽角色超时或安全限制。

同 `91affcf` 镜像的新夹具复验包含完整浏览器、120 秒静置与 30 轮私有 PATCH / 公开快照读取 / readiness。原先引用的 238.730576 秒、204 次采样包括启动；实际从首个完整三角色样本到最后样本是 **177 次 / 206.995090 秒**，UTC 2026-10-15 20:16:09.299401–20:19:36.294491。该段没有 PG probe 失败、缺角色、缺容器、失锁或陈旧心跳，最大采样间隙 1.216381 秒，最大心跳年龄 1.620 秒。PG 峰值 196472832 字节、六容器 OOM/重启为 0。这仅证明采样段；精确 HTTP ready 成功时刻没有专门时间戳，静置期没有连续 HTTP readiness 采样，不能填成“0 次失败”。[修正回执](community-public-charts-2026-10-16/stability.json) 标记 `incomplete`，不再把缺少完整生命周期证据写成整体通过。

随后测试专用诊断 preload 记录的有限窗口为 **311 次 / 364.492672 秒**，UTC 20:23:15.191839–20:29:19.684511，覆盖 300 秒静置及前后 60 轮读写。窗口内角色会话/锁保持，最大心跳年龄 1.778 秒，最大成功角色查询 1335.506ms，维护 owner/lease 为空、恢复状态 open。该边界同样来自首个新三角色样本，不能冒充精确 HTTP ready 时间。

**持续应用日志在窗口结束后捕获了再次失败。** UTC 20:29:57.327–.330 三个专用角色会话启动心跳 UPDATE；20:29:59.327–.331 分别触发 `Error: Query read timeout`，耗时 2000.564 / 2000.517 / 2000.545ms，紧接 `STORAGE_ROLE_LOST` 与 connection end。清理输出文件在 20:30:11.236 才首次创建，证明失败早于主动清理。[修正增强诊断回执](community-public-charts-2026-10-16/diagnostic-stability.json) 标记 `failed`，分别列出窗口内健康样本和窗口后的三次查询错误、三次角色退出；不再称整个诊断练习“未复现”。

已知直接触发是 pg 客户端两秒 read timer，错误无 SQLSTATE。失败前 maintenance SELECT 在约 0.4–0.6ms 内返回无 owner；同一失败窗口没有已记录的 >250ms 事件循环延迟或 >100ms wall/monotonic 差。连接 end 出现在读超时之后。此前某些成功慢查询邻近样本观察到 `WalSync`/`WALWrite`，但这不证明本次超时由 WAL 导致：PG/资源 sampler 在 20:29:19 停止，最后 PG 日志快照在 20:29:56.376 抓取，恰好早于失败，无法区分 server statement timeout、提交等待或 transport 问题。这是本轮采证缺口。

第 1 轮修复新增严格离线验证器：观察期间任何 PG probe 错误、缺角色、缺容器/cgroup、异常采样间隙都阻止通过，主动停机前的尾日志错误也会判失败；缺少带时间戳的 ready、最后健康检查或贯穿停机的采样/日志，只能得到 incomplete。远程 8 项回归通过，包含 9 类损坏样本副本、窗口结束后的坏样本、缺失最终健康/尾日志，真实三角色超时日志，以及连续 HTTP readiness 的缺失/失败样本。原验证器确有跳过潜在异常的缺陷，但原始数据重算确认这两段的就绪代理边界之后没有被跳过的异常样本。新诊断已经持续采集至主动停止；它补齐本轮生命周期的采证边界，不补造历史失败时缺失的 PG 证据。

第 1 轮新夹具使用同一 `91affcf` 镜像和原资源配额，专用 PG 开启 250ms 慢语句/锁等待/IO 计时，保留参数抑制；应用诊断 preload 不改变查询结果或超时。UTC 20:55:11.214830 取得真实 HTTP ready 回执，21:03:13.934727 最后健康检查成功，8.569ms 后主动停止；三个应用均正常退出，完整 PG/应用日志于 21:03:14.612314 收齐，采样器在其后结束。[完整生命周期回执](community-public-charts-2026-10-16/lifecycle-stability.json) 对 **516 个就绪后样本 / 481.895873 秒**判定通过，最大间隙 1.205129 秒，PG/角色/容器/cgroup/连续 HTTP 异常均为 0，主动停止前尾日志没有角色查询错误或退出。全部 525 个样本中另有 8 个启动样本、1 个主动停止后样本，均保留且明确在健康区间之外。完整 Chromium 再跑 12 步、49.326 秒、页面与 hydration 错误均 0，另有前后共 60 轮实际读写通过，见[本轮浏览器回执](community-public-charts-2026-10-16/fix-round-1-browser.json)。产品和恢复代码、四个镜像未变，原实际恢复证据继续适用。

本轮最大成功心跳查询为 1313.435ms：21:00:54.889–55.890 的六个 200ms 样本显示一个角色等待 `IO/WalSync`，另外两个等待 `LWLock/WALWrite`，21:00:56.075–.076 三查询完成。PG 共记录 9 条慢语句，含一次 1164.997ms 的显式 commit；就绪后无 ERROR/FATAL/PANIC 或 statement-cancel。这里可确认成功慢调用中的 WAL 等待，**不能推定历史两秒超时的原因**。最大事件循环延迟 422.239ms 出现在 ready 前冷启动，之后无 >250ms 延迟或 >100ms 时钟差。完整日志解析未发现本轮再次超时；没有据此调整 guard、持久化或资源配额。

父任务明确处置为：此完整有界生命周期、功能和恢复证据可用于本地功能开发验收；历史自主角色丢失仍是未解决的生产发布风险，公开功能发布前须另行复核。此处置待独立审查，不声称根因修复、长期健康或授权上线。

角色 fail-closed 和生产 supervisor/restart 是不同边界；未更改 2000ms query/statement timeout、2500ms 就绪边界、业务/journal/backup 耐久语义或生产策略。本轮有界健康不构成长期可用性保证。

本轮完成证据核对后清理了自有 Compose 项目与卷，确认项目容器数 0、scratch 绑定容器数 0，授权管理者已确认正常卸载、loop 分离、512 MiB 镜像删除。完整私有原始日志保留；各轮 scratch 均已卸载。

## 历史生产备份状态

仅引用父任务已完成的生产回执，本任务没有访问生产：2026-10-16 03:30:01–03:30:06 CST 定时备份成功（退出 0）。从加密快照回读清单、两个数据库 dump 和一个原件，大小/SHA-256 一致；清单 5 个原件、六项 readiness 为 ok、定时器 active，下一次 10 月 17 日 03:30。此证据替代旧交接文档“尚未观察到定时执行”的历史状态，不代表本次公开谱面功能已上线。

## 边界

真实 OAuth/Passkey 登录、实体移动设备、实际听感和游戏导入不在此次合成隔离验收范围。没有使用生产数据、账号或凭据，没有推送、合并或部署。父任务负责最终独立复核与整分支审查。
