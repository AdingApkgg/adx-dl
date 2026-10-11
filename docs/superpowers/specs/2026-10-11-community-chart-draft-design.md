# 单首谱面上传与私有草稿设计

状态：2026-10-11 用户已批准详细设计并授权编码；构建和必要测试只在远程运行。产品用途随完整链路完成开放，未授权生产部署。

依据：已批准的社区总体设计 A.3、存储设计及小服务器按需容量补充。核对源码为 `codex/community-storage-design` / `3b0a580`，不是主工作区的主站下载分支。

## 1. 用户闭环与约束

用户选择一首谱面的 ZIP 或整个文件夹 → 分片上传 → 查看标题、艺术家、难度及警告 → 明确保存为自己的私有草稿 → 在“我的谱面”找回、编辑信息、预览、上传新版本、切换版本、删除。

- 原始谱面、音频和封面仅本人可读；管理员身份本批不产生私人文件读取权限。
- 本批覆盖私有草稿，公开发布、搜索、签名分享、论坛、游戏兼容接口、PV 转码和 AWMC 留在后续。
- 保留现有 Bun/Hono、PostgreSQL、pg-boss、SeaweedFS，不添加服务、桶、资产对象表或独立备份系统。
- 本机只读取、编辑、Git 和连接远程。所有依赖安装、迁移生成、fixture、构建、测试、预览均在 `i@localhost-1.tailac9c6f.ts.net` 的隔离目录执行；g510 是生产，不在那里验证。
- 下面的初始上限由本轮设计选择，可通过后续小改动调整；不代表用户已同意长期产品套餐，也不预分配空间。

## 2. 输入与容量

| 项目 | 初始规则 |
|---|---|
| 源 ZIP | 1 字节–64 MiB，含 ZIP 结构开销 |
| ZIP 中央目录 | 最多 128 个条目，含目录和被忽略条目 |
| 实际展开 | 全部文件累计最多 128 MiB；逐流计数，不只信任目录声明 |
| 路径 | NFC 规范化，最多 8 层、UTF-8 最多 240 字节；拒绝绝对路径、盘符、反斜杠、空段、`.`、`..`、NUL/控制字符 |
| maidata | 1 字节–1 MiB，UTF-8，可有 BOM；非法编码提示重新导出 UTF-8，不猜测编码 |
| 音频 | 可缺省；最多一份 MP3/OGG/WAV，输入最多 32 MiB |
| 封面 | 可缺省；静态 JPEG/PNG/WebP，输入最多 8 MiB，最多 16 MP、单边不超过 8192 |
| 预览封面 | 等比缩至 1024×1024 内、无放大、JPEG quality 85、白色底、去元数据，输出最多 1 MiB |
| 私有预览 artifact | 最多 48 MiB，实际写入计费；manifest 最多 32 KiB |
| 谱面逻辑配额 | 每人 256 MiB，按各逻辑源文件完整 ZIP 大小计；未完成上传预留与历史版本均计入 |
| 头像 | 仍为 8 MiB 输入、32 MiB 独立逻辑配额；不会因新增谱面缩减或扩大头像规则 |
| 元数据边界 | 每人最多 50 个未删除草稿，每谱面最多 20 个未删除版本；满额可删除旧内容后重试 |
| 上传与处理 | 沿用 4 MiB 分片和每人最多两个未完成上传，两用途共享；一个 media worker 同时仅运行一个原生处理子进程 |
| 导入资源 | 子进程硬期限 30 秒，取消/超时后 kill 并等待退出；单任务 scratch 实际字节最多 192 MiB，worker 容器继续采用 512 MiB 内存/1 CPU 上限 |

文件夹经浏览器 Worker 生成 STORED ZIP，保留文件字节和规范路径，生成后的 ZIP 必须仍在 64 MiB 内。客户端只做提前提示，服务端重新检查同一套规则。无完整目录路径能力的浏览器提示改用 ZIP；不能把不完整 FileList 当成已上传整个文件夹。

保留原件 20 GiB、派生 2 GiB、临时 2 GiB 应用上限和 5 GiB 空闲底线，都是按实际账本判断。当前用户总账继续汇总两用途；在现有 user/usage 事务锁内分别累计 File 和上传 reservation 的 purpose，判断各用途限额。禁止给每人创建 256 MiB 文件或磁盘预留。满全局预算返回现有 `STORAGE_BUDGET_EXCEEDED`，不扩大卷、不增加缓存淘汰。

## 3. ZIP 识别与可重复处理

检查完整中央目录后再读取条目。仅允许 STORED/DEFLATE；拒绝加密、分卷、符号链接和设备条目。每个文件都串行展开、检查实际长度和 CRC32，包括不会生成预览的文件。非选中资产只计数、验证后丢弃，源 ZIP 仍保留。终止时销毁流、关闭 ZIP、等待子进程结束并删除任务 scratch。

忽略 `.DS_Store`、`__MACOSX` 内容参与资产选择，但仍计算条目、路径与展开限额。允许一层共同包装目录。以 NFC 后路径的小写形式判断碰撞，碰撞一律拒绝，不选择先出现或最后出现的项；显示保留原名称。剩余文件须属于同一个谱面目录；不接受多首合集或多个竞争根目录。

识别顺序：

1. maidata：不区分大小写的 `maidata.txt` 优先，否则该谱面目录内唯一 `.txt`。出现多个候选返回歧义错误。
2. 音频：`track.mp3/track.ogg/track.wav` 中唯一匹配优先，否则唯一受支持音频。不能按目录顺序猜选；多个优先候选或多个 fallback 返回歧义错误。
3. 封面：`bg.jpg/bg.jpeg/bg.png/bg.webp` 中唯一匹配优先，否则唯一受支持图片。多个候选同样拒绝。
4. 其他文件只保留在原 ZIP；视频不生成预览，给出 `ASSET_NOT_PREVIEWED` 警告。通过扩展名选择后仍检查字节容器，不信任浏览器 MIME。

服务端拟采用固定 `yauzl@3.2.0`，`lazyEntries: true`、`autoClose: false`、`validateEntrySizes: true`、`strictFileNames: true`。它不自动校验 CRC32，应用需逐流校验。接口与版本依据 [官方 3.2.0 README](https://github.com/thejoshwolfe/yauzl/blob/3.2.0/README.md)。Bun 下文件流、取消及 CRC32 工具复用须在远程用一个小包验证；不在设计阶段安装依赖。浏览器 ZIP 写入可沿用已有 fflate 0.8.3 的 Zip/ZipPassThrough。

## 4. maidata 与预览能力

先对原始 maidata 字节计算 `MD5 → Base64` 互通标识，再 UTF-8 fatal 解码；BOM、CRLF 和空白不改写原件。去 BOM/规范换行仅用于解析。MD5 不参与存储去重、授权或版本唯一性；源 ZIP SHA-256 和 artifact SHA-256 承担存储校验。

community 中新增结构扫描器：提取 title、artist、first、lv_1…7 和完整多行 inote 块。缺少标题/艺术家允许保存，固有 summary 保留空字符串；上传摘要界面及创建 Chart 时才用本人 File.originalName 去 ZIP 扩展名、trim 并截至 120 字符作为默认标题，仍为空用 `Untitled`。上传文件名不进入 artifact/recipe 输入，因此同 ZIP 改名不会改变派生 hash。重复相同 key、重复 inote、inote 编号不在 1–7、无任何非空难度、非数值或非正 BPM/分拍返回拒绝。空难度忽略并警告；没有 inote 标记的单一谱面正文沿用难度 4，并警告 legacy 格式。标题/艺术家显示最多 120 字符；first 须是有限数值且绝对值不超过 3600 秒。

复用纯核心 `getAvailableDifficulties` / `parseSimaiChart`，不引用 Web 的 Zustand、下载器或整个 chart-preview 组件。现有 workspace 名为 `@lxns-network/maimai-chart-engine`，新增只导出 ChartParser 的 `./parser` 子路径，社区作为直接 workspace 依赖；应用/备份镜像复制其清单和源码，服务端不导入含浏览器模块的根 barrel。现有 Simai 解析器会默认 BPM 120、跳过未知 token；因此新增**可选诊断回调和结果资源界限**，旧的两参数调用行为不变。结构扫描通过但解析器发现未知 token、越界音符或缺少起始 BPM 时，原件可成为私有草稿，该难度标记 `previewSupported=false`，显示具体警告；不能把部分渲染说成完整有效谱面。

每难度最多 100000 个解析后音符，时间轴不超过 3600 秒，警告最多 64 条（超出合并为一条）。限制在解析过程中检查，失败返回 `CHART_COMPLEXITY_EXCEEDED`；不是先无界生成整个结果再计数。整个解析与资源处理都在上述受限子进程内完成。

音频只做有界容器识别，不引入 FFmpeg/服务端转码，也不承诺完整解码成功。浏览器解码失败显示无法播放音频，仍可查看摘要和无音频谱面预览。无音频时显示“未提供音频，仅预览谱面”，采用时间轴播放，不阻止保存草稿。封面缺省用现有默认图形。

## 5. 原件与私有预览包

方案：一个私有原始 ZIP + 一个可重建私有 artifact。读取预览资产时直接映射 S3 Range，不临时解压 ZIP。不把每个资产变成独立 File/Object。

artifact 格式 v1：8 字节 magic `ADXCPV1\0` + uint32 little-endian manifest 长度 + canonical UTF-8 JSON manifest + 连续资产字节。资产顺序固定 maidata、audio（可缺省）、cover（可缺省）；offset 相对数据区。

`ChartPreviewManifest` 包含 `format:1`、`assets:[{role,path,mime,size,sha256,offset}]`、`summary`；不包含 ownerId、sourceFileId、输入 ZIP hash、时间等使用者/任务数据。整包 SHA-256 绑定 manifest 和分段边界，避免同样拼接字节却对应不同分段。相同派生对象可跨来源物理去重；来源通过 `blobDerivatives.sourceBlobId` 关联。

同份经过校验的 manifest 存在 `derivedObjects.properties.chartPreview`，不是不存在的 `blobDerivatives.properties`。复用输出时必须验证 manifest 一致、offset 不重叠、所有 size/hash 和整包 hash/size/MIME；不能把同 hash 的不同 manifest 直接覆盖。

recipe 为 `chart-preview-v1`。recipeBuild 记录 ZIP 规则版本、解析器源码 SHA、artifact 格式及 sharp/vips 版本；该 build 的 summary 同样不可变。恢复按 manifest 中记录的 build 处理，缺少构建能力或 hash 不匹配保持 closed，不能用新解析器输出冒充旧派生。

历史版本读取按自身 previewDerivativeId 记录的 recipeBuild 检查，不能因当前导入 build 升级就拒绝仍完整的历史输出。导入/重建才选择对应 build；同一源 ZIP 使用不同 build 不自动替换业务版本引用。

## 6. 两张业务表及生命周期

`charts`：UUID id、ownerId FK、title/artist（用户显示信息）、currentVersionId、revision（从 1 开始）、createdAt/updatedAt/deletedAt。只能处于私有草稿，不提前增加 publish/search 状态机。

`chart_versions`：UUID id、chartId FK、ordinal、**sourceFileId UNIQUE FK files**、previewDerivativeId FK blobDerivatives、maidataMd5Base64、summary、createdAt/deletedAt。`(chartId,ordinal)` 唯一；ordinal 单调递增，不因删除复用。currentVersion 必须属于同一 Chart，可用 `(chartId,currentVersionId)` 复合外键并在同一事务创建首版本。源文件和派生来源匹配、用途为 chart-source、所有者相同、状态 ready、recipe/build 正确及未封禁，在事务内锁定后检查。

每版本专属一个逻辑 File；相同物理 ZIP 仍全局 SHA-256 去重。版本上传再次产生 File 并完整计逻辑容量，避免跨版本共享一个 File 后无法表达单版本删除。maidata hash 可重复；只换音乐或封面也可以成为新版本。版本 summary 不可编辑；编辑标题/艺术家只改 Chart 显示字段，不修改原件和互通 hash。

ready 未保存 File 沿用 24 小时无引用回收；“保存草稿”原子登记 ChartVersion 引用，不能先返回成功再补引用。失败导入、取消沿用现有 settlement/GC，quota reservation 只释放一次。

登记 `FileReference`：未删除版本引用与 retention 均为 true，包括历史版本及账号注销冷静期；`publicRepresentations` 恒 false，并与 charts 账号删除 handler 配对。账号注销由 charts handler 先撤回所有私有草稿，再走 storage，`deleteContent=false` 也不会把私人谱面公开。

新增版本成功后成为当前版本并增加 Chart revision；失败保留旧版本。可显式切换到任一未删除、仍 ready 的历史版本。删除历史版本不影响当前；删除当前版本需先切换或删除整个草稿，返回 `CHART_CURRENT_VERSION`。任何版本删除、整草稿删除必须把业务软删除、source File deleted、logical usage 扣减及既有 `file_deleted` tombstone 写在**同一事务**，提取现有 deleteFile 的事务内操作复用；不调用一个先提交的业务删除再另起 File 删除。实际物理回收仍由原有延迟 GC 执行。

## 7. 契约及 API

共享类型放 `src/shared/charts.ts`；所有字节/revision/ordinal 为安全整数，时间为 ISO 字符串。本文签名中的 ChartContext = StorageContext；ChartActor = 已通过 Cookie/Bearer 身份校验的 userId，Cookie 写请求沿用 CSRF 验证。

```ts
type ChartDifficultySummary = {
  difficulty: 1|2|3|4|5|6|7; level: string|null;
  noteCount: number|null; durationMs: number|null;
  previewSupported: boolean;
};
type ChartDiagnostic = {
  code: string; difficulty?: 1|2|3|4|5|6|7; line?: number;
};
type ChartImportSummary = {
  title: string; artist: string; maidataMd5Base64: string;
  difficulties: ChartDifficultySummary[]; warnings: ChartDiagnostic[];
  audio: { mime: string; size: number } | null; hasCover: boolean;
};
type ChartPackageInspection = {
  summary: ChartImportSummary; manifest: ChartPreviewManifest;
  artifact: { path: string; size: number; sha256: string };
};
inspectChartPackage(inputPath: string, outputPath: string,
  signal?: AbortSignal): Promise<ChartPackageInspection>;
summarizeMaidata(bytes: Uint8Array): ChartImportSummary;
```

`summarizeMaidata` 的结果中 audio=null/hasCover=false，包检查器在完整识别后填入；这里的 manifest 类型由第 5 节固定格式定义。检查抛出有稳定 code 的 ChartImportError，由 worker 转换为 rejected/errorCode；原始 token 和文件文本不写日志。

`ChartVersionDto={id,ordinal,sourceFileId,sourceSize,summary,createdAt}`。`ChartDto={id,title,artist,revision,currentVersionId,versions:ChartVersionDto[],createdAt,updatedAt}`，versions 最多 20 个。列表返回 `ChartListItemDto={id,title,artist,revision,currentVersionId,summary,updatedAt}`，不附每个历史版本。

| 路由 | 输入 → 结果 |
|---|---|
| 现有 uploads/file API | `purpose:"chart-source"`；分片/complete/cancel 不变，ready FileDto 新增可选 `chart:ChartImportSummary`；失败 UploadDto.errorCode 包含下表导入码 |
| `POST /api/v1/me/charts` | `{fileId}` → 201 ChartDto；同 File 重试返回已创建的本人 Chart，不再创建版本 |
| `GET /api/v1/me/charts` | cursor（不透明时间/id）、limit 默认 20、1–50 → `{items,nextCursor}`，按 updatedAt/id 降序 |
| `GET /api/v1/me/charts/:id` | → ChartDto |
| `PATCH /api/v1/me/charts/:id` | `{expectedRevision,title?,artist?,currentVersionId?}` → ChartDto；至少一项改变，title 1–120/artist 0–120 字符，只写一个新 revision |
| `POST /api/v1/me/charts/:id/versions` | `{fileId,expectedRevision}` → 201 ChartDto；同 File/同 Chart 重试返回现状，不再次切换当前版本；该 File 已属于别的 Chart 则 409 |
| `DELETE /api/v1/me/charts/:id/versions/:versionId` | `{expectedRevision}` → 204；本人已经删除则 204，不重复扣费 |
| `DELETE /api/v1/me/charts/:id` | `{expectedRevision}` → 204；本人已经删除则 204 |
| `GET/HEAD /api/v1/me/charts/:id/versions/:versionId/assets/:role` | role 只允许 maidata/audio/cover；200/206/416，资产不存在 404 |

创建/追加用 sourceFileId 唯一性实现自然幂等，不增加通用幂等表。PATCH 网络结果不明时先重新 GET 对比，不能盲目用新 revision 覆盖；旧 revision 返回 409，保留用户输入。同 File 的重试先匹配所属用户/Chart 后返回，不把重试当成重新激活旧版本。账号状态失效即停止；匿名 401，非本人/非法 UUID/不存在统一 404。

私有资产读取每次先查 owner、账号状态、业务删除标记、File/blob/derivative/output 的 ready/source/build 和 hash block；再验证整包 HEAD。从可信 manifest 映射 `dataStart + asset.offset + clientRange`，仅支持单 Range。HEAD、416、错误也发 `Cache-Control: private, no-store`；长度、Content-Type、Content-Range 和 ETag 均按资产设置，nosniff，不使用整包 MIME/长度。断开即取消 S3 body。无需读取或解压全部音频；不走 `/media`，不生成可转发签名 URL。

| 状态 | 稳定新增 code / 行为 |
|---|---|
| 422 导入拒绝 | `CHART_PACKAGE_INVALID`, `CHART_PATH_INVALID`, `CHART_PATH_COLLISION`, `CHART_ARCHIVE_UNSUPPORTED`, `CHART_ENTRY_LIMIT`, `CHART_EXPANDED_LIMIT`, `CHART_ASSET_TOO_LARGE`, `CHART_ASSET_AMBIGUOUS`, `CHART_MAIDATA_MISSING`, `CHART_INVALID_UTF8`, `CHART_DIFFICULTY_INVALID`, `CHART_METADATA_INVALID`, `CHART_COMPLEXITY_EXCEEDED`, `CHART_ASSET_INVALID` |
| 409 业务冲突 | `CHART_CHANGED`, `CHART_FILE_NOT_READY`, `CHART_FILE_ASSIGNED`, `CHART_CURRENT_VERSION`, `CHART_DRAFT_LIMIT`, `CHART_VERSION_LIMIT` |
| 沿用存储码 | `FILE_TOO_LARGE`, `QUOTA_EXCEEDED`, `HASH_BLOCKED`, `PROCESSING_FAILED`, `STORAGE_BUSY`, `STORAGE_BUDGET_EXCEEDED`, `STORAGE_MAINTENANCE`, `NOT_FOUND`, `INVALID_RANGE` |

CHART import code 出现在 rejected 轮询结果时 HTTP 本身仍为成功读取状态，不伪造一次同步 422。临时 IO/期限/内存退出沿用 PROCESSING_FAILED，可重新上传；不把服务器故障提示成文件语法问题。警告码初始包含 `LEGACY_SINGLE_DIFFICULTY`, `EMPTY_DIFFICULTY`, `PREVIEW_UNSUPPORTED`, `AUDIO_MISSING`, `ASSET_NOT_PREVIEWED`, `WARNINGS_TRUNCATED`。

## 8. 处理、恢复及备份接入

沿用三阶段 flow：ingest → avatar 或 chart-import → finalize。队列创建、取消映射、对象 claim/settlement、reconcile、backup rebuild 均按 purpose/recipe 分流；不是仅把 initUpload 的 avatar 判断放开。全局原件可信度不意味着已经通过 chart 校验；已有同 hash blob 仍须匹配 chart recipe/build 才可 ready。

原件 ingest 校验完整 SHA-256；chart 子进程输出受限 artifact 和 manifest，finalize 验证完整产物并绑定 File。upload generation、lease、取消和重复 pg-boss delivery 沿用现有 fencing，过期任务不得把新一代候选写成 ready，也不得双扣费用。共用一把原生子进程容量门，不让 avatar/chart 同时各占一个。

当前 pg_dump 已导出整库，新增业务表自然进入 community dump；现有原件 manifest 覆盖 ZIP，不改 Umami。派生包不进入备份，以记录 build 重建。补充 chart recipe 的 reconcile/rebuild，以及 restore 清旧任务的 chart-import 队列。

重放最新 `file_deleted` journal 时同步删除对应专属 ChartVersion；currentVersion 被删除则选最新仍有效版本，若没有则标记 Chart deleted。整草稿删除会对全部版本写 File tombstone，因此旧快照不能恢复其可读状态。`user_deleted` 同步撤回全部本人私有草稿。replay/rebuild 未完成、最新日志不可用或派生完整校验失败仍保持 closed。不给已有文件/恢复协议另加一个长期服务。

## 9. 页面与客户端边界

- `/me/charts`：我的私有草稿、容量使用量、创建入口；无公开链接。
- `/me/charts/new`：ZIP/文件夹二选一，说明大小限制；上传显示准备、hash、分片、处理状态和恢复/取消。ready 后展示摘要与警告，显式“保存私有草稿”。只有保存成功才进入草稿详情。
- `/me/charts/:id`：显示“仅自己可见”、标题/艺术家编辑、版本选择、上传新版本、历史版本删除和整个草稿删除。失败换包保留当前版本，冲突先刷新并保留输入；删除动作有确认。
- 预览首次点击才取 maidata/audio/cover；懒加载纯引擎，独立播放时钟，支持难度、播放暂停、seek；不开启依赖 Web 路径的打击音效。解码音频上限 32 MiB，不声称音频流式解码。切版本/退出/卸载取消请求、停止 RAF、释放 AudioContext 和对象 URL，旧请求不覆盖新版本。
- 上传 controller 新增显式 purpose，头像调用默认 avatar；恢复记录增加 purpose/schemaVersion=2，旧 avatar 记录映射 avatar，不允许跨用途或跨账号恢复。文件夹取消终止 ZIP Worker。
- loader/组件通过 API，客户端不查库；新增产品文案中/日/英同步。

## 10. 必要验证与未证实假设

设计阶段只做代码/文档核对，不运行测试。后续各变更只跑拥有该行为的定向用例；一次合成小包的真实浏览器闭环覆盖上传、显式保存、预览、版本及删除。共享上传代码确有修改才加受影响 avatar/controller 用例；不重跑 QQ/Google/Passkey/Turnstile 或全仓测试。

必需五组：包路径/碰撞/真实展开/CRC/取消；原始 maidata hash、UTF-8/多行/非法难度/BPM及预览诊断；导入重复 delivery/取消及用途配额；owner 隔离/资产 Range/版本冲突与幂等；专属 File 删除/共享 blob 保留及 post-snapshot journal 重放。

远程开工时小型确认：固定 Bun + yauzl 文件流和取消；核心解析器无 DOM 导入；共享 512 MiB worker 下受限包处理和 scratch 峰值；当前 recipeBuild 的确定性输出。发生阻塞保留证据，不能回退本机，也不反复扩大测试范围。真实游戏导入、各移动设备音频兼容和生产行为不属于本批通过声明。

## 11. 设计复核记录

2026-10-11 完成一次独立 builder check，唯一必须澄清项为“缺失标题按外部文件名回退是否破坏 artifact 确定性”；已按第 4 节改为 File/Chart 层显示回退。其余实现日常选择由 builder 决定。本轮尚未执行解析器或 ZIP 库运行验证。
