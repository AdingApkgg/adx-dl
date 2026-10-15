# 自制谱公开发布与浏览：隔离验收

日期：2026-10-16（Asia/Shanghai）。状态：`DONE_WITH_CONCERNS`。功能、实际恢复和两轮有界稳定性复验通过；历史角色退出原因尚未定位，待独立审查评估残余风险。功能仅在本地分支实现与隔离构建机验证，未推送、合并或部署生产。

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

**未决稳定性问题，不能据此宣布整体验收全绿：** 最终浏览器回执写于 04:08:21 CST，control 在 04:08:54 报 `STORAGE_ROLE_LOST`；04:09:04 采样三个角色心跳均陈旧约 12 秒、会话锁不存在、三个容器已退出且 restart/OOM 为 0。主动 restore stop 是 04:09:05，故该退出发生在主动停止之前。较早一轮也曾冷启动失去角色，而相同配额暖重启 6/6 成功；这些都不足以定位根因。未放宽生产角色超时或安全限制。功能断言和恢复断言通过，但持续运行健康仍需诊断，不能称已修复；本轮未在清理前保存完整 PG 日志是证据缺口。

随后同 `91affcf` 镜像在新夹具、原资源配额下重新冷启动，完整浏览器再次通过，继续 120 秒静置和 30 轮私有 PATCH / 公开快照读取 / readiness 检查。238.731 秒、204 次同步采样中，三个角色原会话不变、锁始终存在，最大心跳年龄 1.620 秒；六个容器重启/OOM 均为 0，PG 峰值内存 196472832 字节。完整 PG 日志无崩溃/连接重置，见 [有界稳定性回执](community-public-charts-2026-10-16/stability.json)。这排除该复验轮的 OOM，但不能倒推旧失败的原因。随后仅在测试环境加入只读诊断 preload，同样配额下完成 300 秒静置与前后共 60 轮读写；就绪后 364.493 秒、311 次采样通过。三个角色原会话和锁保持，最大心跳年龄 1.778 秒、角色查询耗时 1335.506ms，角色查询错误/时钟跳变/OOM/重启均为 0，维护 owner/lease 始终为空，恢复状态始终 open；见 [增强诊断回执](community-public-charts-2026-10-16/diagnostic-stability.json)。启动时最大事件循环延迟约 319ms，未伴随角色失败。多次较慢 heartbeat UPDATE 的邻近 PG 采样出现 `WalSync`/`WALWrite` 等待，这是当前 WAL 持久化延迟的线索，未达到 2 秒超时，也不能作为旧失败的根因证明。

诊断只记录底层 PG 错误/连接事件、查询耗时、事件循环与时钟差、共享维护和恢复状态，不改变 2000ms 查询超时、2500ms 就绪边界或其他生产安全判断。隔离 Compose 的 restart 为 no，所以丢失角色会按 fail-closed 机制退出并留待观察；生产 supervisor/restart 策略是另一层运维边界，不能用复验通过推导自动恢复已验证，更不能保证长期可用性。此次未更改生产策略。

验收结束仅清理自有 Compose 项目及卷，确认项目容器数 0、绑定 scratch 的容器数 0 后通知父任务卸载；父任务已确认各轮 scratch 正常卸载、loop 设备分离、512 MiB 镜像删除，管理器无剩余自有磁盘。

## 历史生产备份状态

仅引用父任务已完成的生产回执，本任务没有访问生产：2026-10-16 03:30:01–03:30:06 CST 定时备份成功（退出 0）。从加密快照回读清单、两个数据库 dump 和一个原件，大小/SHA-256 一致；清单 5 个原件、六项 readiness 为 ok、定时器 active，下一次 10 月 17 日 03:30。此证据替代旧交接文档“尚未观察到定时执行”的历史状态，不代表本次公开谱面功能已上线。

## 边界

真实 OAuth/Passkey 登录、实体移动设备、实际听感和游戏导入不在此次合成隔离验收范围。没有使用生产数据、账号或凭据，没有推送、合并或部署。父任务负责最终独立复核与整分支审查。
