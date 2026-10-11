# Community Chart Upload and Private Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 按用户要求在当前会话顺序实施，只在最终做一次独立复核，不为每片重复跑无关测试。

**Goal:** 用户可上传单首谱面的 ZIP/文件夹，显式保存私有草稿、查看自己的内容、预览并管理版本和删除。

**Architecture:** 扩展现有 purpose/三阶段 pg-boss flow；原 ZIP 加一个私有可重建 artifact；ChartVersion 以 FK 关联专属逻辑 File 和派生 recipe。所有客户端业务经过 API，预览有限复用纯 Canvas 引擎。

**Tech Stack:** 沿用锁文件 Bun 1.4.2、React Router、Hono、Drizzle/PostgreSQL、pg-boss、SeaweedFS、sharp；新增固定 yauzl 3.2.0，客户端按需引用 fflate 0.8.3，均在远程更新锁文件。

**Spec:** [单首谱面上传与私有草稿设计](/Users/i/Code/AstroDX/docs/superpowers/specs/2026-10-11-community-chart-draft-design.md)。2026-10-11 用户已批准设计并授权继续编码。本文细化总计划 Task 6–14；远程准备/头像收尾按总计划 Task 2–5 独立执行。

## 本轮执行记录（2026-10-11）

Task 6–14 的实现已落地：用途隔离和实际用量、受限 ZIP/maidata 导入、source-bound recipe、私有草稿 API/版本/删除、文件夹上传和恢复、三语列表/编辑及按需 Canvas 预览。按照用户的必要测试要求，使用隔离 PG/S3 和固定 Bun 在远程运行定向用例；没有逐片重复全套或旧登录验收。

一次最终独立复核发现的六个问题均已修复；另外补齐取消后的计算 lease 清理，仅释放已结束且未持有物理输出 claim 的本代计算。实现和必要测试合并整理为一个原子功能提交，避免用途开放与 worker/业务链路分离。下面的逐项命令和拟定提交名保留为原实施切片，不代表这些命令全部运行过。

远程真实浏览器和 fresh-volume full restore 仍依赖待完成的 sparse scratch sudo 安装；此项不冒充已验收。测试逐项结果、构建和发布边界见 `docs/verification/community-chart-drafts-2026-10-11.md`。不推送、不部署。

## Global Constraints

- 源码基线 `codex/community-storage-design` / `3b0a580`，排除主工作区主站和 AWMC；开始产品代码前确认详细设计定稿。谱面阶段同步白名单增补 tracked `packages/maimai-chart-engine`；头像阶段原镜像不因文档变化重建。
- 本机只有轻量读写/Git/SSH；所有安装、迁移生成、fixture、构建、测试、预览在 `i@localhost-1.tailac9c6f.ts.net:/home/i/astrodx-community-storage-dev-20261011` 的 owned 容器中执行。远程不可用则停运行，不回退本机。
- 源 ZIP 64 MiB，128 条目/128 MiB 实际展开，8 层/240 UTF-8 字节路径；maidata 1 MiB UTF-8，音频 32 MiB，封面输入 8 MiB/16 MP/8192 边，输出 1024 内 JPEG85/1 MiB，artifact 48 MiB/manifest 32 KiB。
- 每人谱面 256 MiB/头像独立 32 MiB；未完成上传共享最多两个，4 MiB 分片。每人 50 草稿/每谱面 20 活版本。历史版本、未保存 ready File 和各 purpose reservation 正常计逻辑费用；零物理预留。
- worker 一把原生容量门，512 MiB/1 CPU；子进程 30 秒硬期限、scratch 192 MiB，取消后等待确实退出。每难度 100000 音符/3600 秒，最多 64 诊断。
- MD5(raw maidata bytes)→Base64 只作互通标识；ZIP/artifact SHA-256 作存储校验。未知预览语法只给警告/禁该难度预览，不宣称完整校验。
- 只做本人私有草稿；不用 `/media`、签名分享、新服务/桶/缓存淘汰；原有 20/2/2 GiB 应用上限和 5 GiB 空闲底线不改。
- 无生产部署、push、Cloudflare 改动。合成账号和新测试密钥，不搬旧 .env、身份、依赖或卷；UI 文案中/日/英同步。
- 所有下列命令省略 SSH/容器包装，只能在该远程 owned test 容器内执行，community 命令 cwd `/repo/apps/community`。同时最多一个资源重任务。

## Review Focus

1. 同 ZIP hash 的 avatar 原件不等于 chart 已校验；purpose recipe、quota 与取消分流必须正确（Task 6、8）。
2. ZIP 声明小但实际展开大、CRC 错或取消中：不得产生 ready 文件或遗留无界进程（Task 7）。
3. 旧 File 的创建/追加重试不能重新切回旧版本；结果不明的 metadata 保存不能盲覆盖新 revision（Task 9、10、14）。
4. artifact 总 hash 相同却用不同分段 manifest、Range 误用整包长度：拒绝不一致输出，不泄漏其他资产（Task 8、13）。
5. snapshot 后删除版本/整草稿，再恢复：专属 File journal 必须继续遮蔽被删除内容，共享物理 blob 不误删（Task 10）。

---

## 文件与类型边界

- `src/shared/charts.ts`：设计第 7 节 DTO、稳定码、purpose 规则可序列化值；不依赖 DB/DOM。
- `src/server/charts/{upload-rules,package-validation,maidata-summary,artifact,service,assets,references,deletion}.ts`：分别承载额度、ZIP、文本、bundle 格式、业务事务、私有读取、引用及删除。
- `src/media-worker/{chart-import,chart-child,native-slot}.ts`：任务分流、受控子进程、两用途共享容量门；不抽通用工作流框架。
- `src/server/db/schema/charts.ts` / 新 additive migration；`src/server/api/charts.ts` 挂载于现有 `/api/v1`。
- `src/client/lib/chart-input.ts` / Worker：文件夹 STORED ZIP；`src/client/components/{chart-upload,private-chart-preview,chart-editor}.tsx` 与三个 `/me/charts` route。
- 不新建公共 preview package；对 engine 的可选诊断/限额参数保持旧调用兼容。

### Task 6: 谱面用途、额度及恢复记录

**Files:** Modify `src/server/storage/{rules,uploads,flow,deletion}.ts`, `src/shared/storage.ts`, `src/client/lib/file-upload.ts`；Create `src/server/charts/upload-rules.ts`；Test `upload-rules.test.ts`，受影响 `src/server/storage/uploads.test.ts` / controller 用例仅对应名字。

**Interfaces:**
- `chartUploadRule = {maxSize:67108864, quota:268435456, partSize:4194304}`；avatar 规则不变。
- `usageByPurpose(tx:DbTransaction,userId:string,purpose:StoragePurpose):Promise<{usedBytes:number,reservedBytes:number}>`，在现有 user/usage 锁内查询。
- `storageFlowQueues(purpose:StoragePurpose):readonly [string,string,string]`：ingest、该用途处理、finalize；取消调用必须获得同 purpose。
- controller options 增加 `purpose?:StoragePurpose`（默认 avatar）和该 purpose 的 maxSize；恢复记录 schemaVersion=2/purpose，新记录拒绝跨用途，旧记录仅作 avatar。

- [ ] 先写必要断言：64 MiB+1 拒绝；chart 使用不挤占 avatar 32 MiB；chart 256 MiB 含 reservation/旧版本；全用户两个会话；失败不写 S3。
- [ ] 远程定向运行确认新增行为当前失败；实现分 purpose 规则/锁内统计，保持总账，不加每用户配额表。chart flow 未闭环前返回 PURPOSE_NOT_AVAILABLE。
- [ ] 分流取消与用途恢复；旧 avatar 记录正常读，chart 记录不能当 avatar 恢复。
- [ ] 运行 `bun test src/server/charts/upload-rules.test.ts`；只在公共上传/controller 改动时追加受影响名字，记录退出码。
- [ ] 提交限定文件：`feat(community): add chart upload rules and purpose isolation`。

### Task 7: ZIP 包检查和 maidata 摘要

**Files:** Create `src/server/charts/{package-validation,maidata-summary}.ts` 及同名 tests；Modify `packages/maimai-chart-engine/{package.json,src/core/parser/ChartParser.ts,src/core/parser/SimaiParser.ts}`（仓库根相对路径）、`apps/community/package.json`、`apps/community/Dockerfile`、`apps/community/ops/backup/Dockerfile`、根 `bun.lock`；按需要添加对应 engine 定向 test。

**Interfaces:**
- `summarizeMaidata(bytes:Uint8Array):ChartImportSummary`；audio=null/hasCover=false，完整包再填。
- `inspectChartPackage(inputPath:string,outputPath:string,signal?:AbortSignal):Promise<ChartPackageInspection>`。
- `parseSimaiChart(text,difficulty?,options?:{onDiagnostic?:(diagnostic:ParseDiagnostic)=>void;maxNotes?:number;maxDurationMs?:number})`；旧调用不设限/不收诊断，保持原来结果。
- `ChartImportError={code:ChartImportErrorCode}`，码见 spec 第 7 节；包处理在 child 内调用，禁止 Web/main 请求进程直接执行完整解析。

- [ ] 在远程固定 Bun 容器安装锁定 yauzl，并登记 `@lxns-network/maimai-chart-engine:workspace:*`；新增package export `./parser -> ./src/core/parser/ChartParser.ts` 及诊断类型导出。应用/备份所有依赖安装阶段补清单，运行镜像补engine源码；纯服务端只用parser子路径。一个小包确认文件式读取、真实 size/CRC、close/cancel。按依赖版本 API 实现，不调用 master 未确认的 Promise API；不能本机安装。
- [ ] 先写用例：NFC/大小写碰撞、包装目录、ambiguous/missing maidata、symlink/encryption、真实膨胀/CRC、取消；UTF-8 BOM/CRLF raw hash差异、多行1–7、重复/非法难度、非正 BPM、未知 token 的预览禁用。
- [ ] 远程确认失败，再实现顺序中央目录/逐流计数与 CRC；拒绝 128 条目/128 MiB/路径超限，无界数据不落盘；只保留选中资产 scratch，其他条目验证后丢弃。
- [ ] 实现独立结构扫描+可选 parser 诊断/资源限额；完整 raw bytes 先哈希再解码。缺失标题在固有 summary 留空，相同ZIP改外部名字输出仍一致，默认标题留File/Chart显示层。没有音频仅警告，不挡保存；未知 token 不伪装完整解析。
- [ ] 运行 `bun test src/server/charts/package-validation.test.ts src/server/charts/maidata-summary.test.ts`；engine 只跑新增兼容性名字及其原有 fixture，不运行所有 Web 测试。
- [ ] 提交 `feat(community): inspect chart packages and report preview capability`。

### Task 8: 私有 artifact 与异步导入

**Files:** Create `src/server/charts/artifact.ts`, `src/media-worker/{chart-import,chart-child,native-slot}.ts`；Modify `src/media-worker/{ingest,avatar,finalize,main}.ts`, `src/server/storage/{objects,flow,backup,files}.ts`, `src/worker/storage-reconcile.ts`, `ops/backup/restore.ts`, queue registry 的实际挂载处；Test `artifact.test.ts`, `src/media-worker/chart-import.test.ts`。

**Interfaces:**
- `encodeChartPreviewManifest(manifest:ChartPreviewManifest):Uint8Array`：固定键/角色顺序 canonical JSON，≤32768 bytes。
- `readChartPreviewManifest(bytes:Uint8Array):ChartPreviewManifest`：schema/offset/size/hash/不重叠校验。
- `processChart(inputPath,outputPath,signal?):Promise<ChartPackageInspection>`：30 秒，等待 child reaped；同 avatar 共用 `withNativeSlot<T>(run:(signal:AbortSignal)=>Promise<T>,signal?):Promise<T>`。
- `handleChartImport(ctx:StorageContext,job:StorageJobData):Promise<void>`，保持 generation/lease/settlement。
- 明确 `recipe:"avatar-v1"|"chart-preview-v1"` dispatcher，按 purpose 查当前 build；`FileDto.chart?:ChartImportSummary` 仅 ready chart 提供，不为导入新增 polling API。

- [ ] 写 artifact 边界绑定（相同拼接 bytes、不同manifest不能混用）、取消/重复 delivery、不把avatar recipe当chart、failure不ready、两用途native slot互斥的用例。
- [ ] 远程确认失败；实现 magic/length/manifest/maidata/audio/cover artifact，先输出临时文件、验证整 hash，再按现有 claim/finalize 结算。metadata 只写 derivedObjects.properties.chartPreview。
- [ ] 分流 ingest/type校验、队列/取消、output settlement、reconcile/rebuild。restore 清旧队列包含 chart-import，既有 avatar recipe 路径保持。
- [ ] 将 chart-purpose 开放与 flow 完成放在同一提交；无有效 recipeBuild 或全局预算不足不 ready。临时故障报 PROCESSING_FAILED，不当成用户格式错误。
- [ ] 运行 `bun test src/server/charts/artifact.test.ts src/media-worker/chart-import.test.ts`，只加受影响 avatar native-slot 定向名字；记录实际 scratch/退出，确认单实例受限，不再重复生命周期全套。
- [ ] 提交 `feat(community): import private chart preview artifacts`。

### Task 9: Schema、引用与私有草稿 API

**Files:** Create `src/server/db/schema/charts.ts`, additive migration, `src/shared/charts.ts`, `src/server/charts/{service,references,deletion}.ts`, `src/server/api/charts.ts`；Modify schema index、API mount、storage FILE_REFERENCES 和 account-deletion registry；Test `src/server/api/charts.test.ts`。

**Interfaces:**
- `createChart(ctx:ChartContext,userId:string,input:{fileId:string}):Promise<ChartDto>`。
- `listCharts(ctx,userId,input:{cursor?:string,limit?:number}):Promise<{items:ChartListItemDto[],nextCursor:string|null}>`。
- `getChart(ctx,userId,chartId:string):Promise<ChartDto>`。
- `updateChart(ctx,userId,chartId,input:{expectedRevision:number,title?:string,artist?:string,currentVersionId?:string}):Promise<ChartDto>`；version切换实现由 Task 10 补齐，前期未实现字段不开放。
- `chartFileReference:FileReference`，public=false，与 `charts` account-deletion partner 成对；注入顺序在 storage 前。

- [ ] 写匿名401/非owner404、仅接受本人ready chart File、source/recipe FK匹配、同File重试不新建、50draft上限、分页稳定和revision冲突用例。
- [ ] 远程红灯；写两表和 composite current-version FK、唯一 sourceFileId；迁移只 additive，远程生成并检查 SQL，不能改旧迁移。显式记录降级不回滚已写数据。
- [ ] 实现 create/List/Get/PATCH metadata 与API，业务引用和首版本在同一事务；缺失title按File.originalName去ZIP扩展名/trim/120字符/Untitled回退。JSON DTO 不泄漏 bucket/key/token。修改按 expectedRevision 一次增长。
- [ ] 实现引用与注销撤回，冷静期保留引用且资产不可读；deleteContent=false 不转公开。
- [ ] 运行 `bun test src/server/api/charts.test.ts` 于独立 `_test` DB，断言 DB+HTTP权限而非只mock请求；提交 `feat(community): persist owner-only chart drafts`。

### Task 10: 版本、删除和恢复投影

**Files:** Modify `src/server/charts/{service,deletion,references}.ts`, `src/server/storage/files.ts`, `ops/backup/restore.ts`；Test `src/server/charts/versions.test.ts`, `ops/backup/chart-journal.test.ts`。

**Interfaces:**
- `addChartVersion(ctx,userId,chartId,input:{fileId:string,expectedRevision:number}):Promise<ChartDto>`。
- `deleteChartVersion(ctx,userId,chartId,versionId,input:{expectedRevision:number}):Promise<void>` / `deleteChart(ctx,userId,chartId,input):Promise<void>`。
- 提取 `deleteOwnedFileInTransaction(tx:DbTransaction,userId:string,fileId:string):Promise<void>`，供deleteFile原路径及业务删除共享；已有锁顺序不变。
- restore 对已有 file_deleted/user_deleted 同步版本/Chart投影，无新 journal事件或守护服务。

- [ ] 写新版本激活/失败保留旧版、20版本上限、重复旧File不重新激活、旧revision409、当前版本不可直接删除、重复delete不扣费的用例。
- [ ] 写同物理blob两个不同File，删一个版本只解除它的quota/引用；另一owner/File继续可读。
- [ ] 远程红灯；实现 append/切换/删除，DB业务软删除+File deleted+usage+tombstone 原子提交；不能先删引用再另起deleteFile。
- [ ] 扩展 restore file/user journal replay：已删sourceFile对应版本不可读，current删则选最新有效版本，空Chart删。新类测试直接复用 replay入口，整fixture只用一个小ZIP，不为该投影新跑所有恢复用例。
- [ ] 运行 `bun test src/server/charts/versions.test.ts ops/backup/chart-journal.test.ts`；如改动整restore流程而非投影，最后整体验收复用总计划那一次full restore，避免重复跑。
- [ ] 提交 `feat(community): manage private chart versions and deletion`。

### Task 11: ZIP/文件夹上传和显式保存

**Files:** Create `src/client/lib/chart-input.ts`, `chart-zip.worker.ts`, `src/client/components/chart-upload.tsx`, `src/client/routes/charts-new.tsx`；Modify `src/client/routes.ts`, 三语messages；Test `test/dom/chart-upload.test.tsx`。

**Interfaces:**
- `prepareChartInput(files:File[],kind:"zip"|"folder",signal:AbortSignal,onProgress:(bytes:number)=>void):Promise<File>`：文件夹最终STORED ZIP≤64MiB，缺路径能力返回明确输入错误。
- `ChartUpload({userId,onSaved}):JSX.Element` 调现有purpose controller，不另建传输器；`onSaved(chart:ChartDto)` 仅POSTcreate成功后调用。

- [ ] 定向用例：选择→ready摘要→显式保存、处理rejected不可save、folder cancel终止worker、跨purpose恢复拒绝、旧响应不覆盖新选包；红灯只跑本文件。
- [ ] 实现输入能力判断、Worker、四阶段进度和可重试错误；不完整FileList拒绝且提示ZIP。实现create草稿自然幂等，离开未保存可discard。
- [ ] 接入 `:lang?/me/charts/new` 和中/日/英文案；用户页面不显示S3/recipe/internal queue等实现细节。
- [ ] 远程运行 `bun x vitest run test/dom/chart-upload.test.tsx --testTimeout 15000`；提交 `feat(community): upload chart packages as private drafts`。

### Task 12: 我的草稿列表与详情

**Files:** Create `src/client/routes/{charts,chart-detail}.tsx`；Modify `src/client/routes.ts`, 导航及messages；Test `test/dom/chart-drafts.test.tsx`。

**Interfaces:** `/me/charts`消费list DTO/cursor；`/me/charts/:id`消费ChartDto，不直接读取DB。

- [ ] 写空状态、稳定分页、私有标签、非本人404和会话失效停止恢复的定向用例；只验证页面数据边界，不重测后端分页算法。
- [ ] 实现loader经API、详情摘要/警告/版本；首次显示不下载音频；状态失效保留安全的登录跳转，不显示旧用户数据。
- [ ] 远程运行 `bun x vitest run test/dom/chart-drafts.test.tsx --testTimeout 15000`；提交 `feat(community): list and view private chart drafts`。

### Task 13: 资产 Range 与有限 Canvas 预览

**Files:** Create `src/server/charts/assets.ts`, `src/client/components/private-chart-preview.tsx`, `src/client/lib/private-chart-player.ts`；Modify API assets挂载和详情；Test `src/server/charts/assets.test.ts`, `test/dom/private-chart-preview.test.tsx`。

**Interfaces:**
- `chartAssetResponse(ctx:ChartContext,userId:string,chartId:string,versionId:string,role:"maidata"|"audio"|"cover",request:Request):Promise<Response>`。
- `PrivateChartPreview({chartId,version:ChartVersionDto}):JSX.Element`；所有URL走owner API，复用MainRenderer/纯timing及可选AudioManager，无Zustand/Web下载器。

- [ ] 写匿名/非owner/删除/封禁/build不匹配不可读；同artifact两段单Range/HEAD/416长度正确、manifest错拒绝、断开取消body。
- [ ] 远程红灯；实现先鉴权/ready/head，按version记录build而非当前导入build验证；后由manifest映射offset/Range；响应private,no-store/nosniff，ETag按asset，不调用整对象representationResponse冒充子段。
- [ ] 实现懒加载/难度/播放暂停/seek，无audio用时间轴、audio解码失败可继续无音频预览；unsupported难度显示警告且禁止启动。暂不复制Web打击音资源。
- [ ] 生命周期定向断言：切版本/退出/卸载中止请求与RAF、关闭AudioContext、释放URL，旧解码不覆盖当前版本。
- [ ] 运行 `bun test src/server/charts/assets.test.ts` 和 `bun x vitest run test/dom/private-chart-preview.test.tsx --testTimeout 15000`，串行；提交 `feat(community): preview private charts through authenticated assets`。

### Task 14: 编辑、版本和删除界面及一次闭环

**Files:** Create `src/client/components/chart-editor.tsx`；Modify详情、chart-upload append模式和三语messages；Test `test/dom/chart-editor.test.tsx`；Update设计/验收报告。

**Interfaces:** 编辑消费PATCH ChartDto；append消费POSTversion ChartDto；删除204。callback `(next:ChartDto)=>void` 不使用未确认新revision；网络结果不明先GET并保留输入。

- [ ] 定向用例：旧revision冲突输入保留、append失败保留旧版、重试旧File不激活旧版、切版清预览、确认删除/重复请求不再次扣费。
- [ ] 实现标题/艺术家编辑、换包、历史选择/删除、当前版禁止直接删；409先展示最新状态并留用户编辑，不自动覆盖。
- [ ] 远程运行 `bun x vitest run test/dom/chart-editor.test.tsx --testTimeout 15000`。随后构建当前源码一次（包含三语/route/types），不为每个UI片重复构建。
- [ ] 在浏览器只走一次合成小包闭环：ZIP上传→显式保存→刷新找回→两难度/有声或无声预览→添加第二版本→切回→删历史→删草稿。核对脱敏HTTP/页面状态，不能用DOM test冒充真实音频播放。
- [ ] 做一次最终独立复核和限定diff检查；已有必要测试通过后不再全仓重跑。报告列明当前source SHA、远程镜像/命令/结果、真实UI边界及未验证的移动设备/游戏/生产。
- [ ] 提交 `feat(community): edit and manage private chart drafts`，停止owned运行服务保留证据；不push/deploy。源ZIP/数据已写时降级代码不等于回滚数据。

## 计划自检

spec 1–2 → Task 6/11；3–4 → 7；5/8 → 8/10；6–7 → 9/10/13；9 → 11–14；10 → 各任务定向检查及最终一次UI。每个新增接口及稳定错误都有所属片，五个review focus均有对应必要用例。构建和数据库工具只在远程，未把任何测试声明为已经通过。
