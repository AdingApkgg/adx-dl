# AstroDX 社区 · 文件存储与上传基础设计

日期：2026-10-10

状态：设计草稿，已通过独立 builder check，等待完整设计确认；本次只写文档

前置：[社区地基设计](2026-09-28-community-foundation-design.md)，尤其附录 A.2

范围：子项目 2；首个业务接入是头像，给子项目 3 谱面文件提供可复用基础

## 1. 要完成什么

社区已经有账号、资料、注销和独立 worker。接下来让用户在个人资料页上传、替换和移除头像，同时把上传、内容寻址、权限、派生文件、任务、配额和备份做成后续谱面模块能够调用的基础。

成功的具体场景：用户选一张照片，看到本地预览、上传进度和处理状态；服务端校验和处理成功后，用户明确保存为头像；刷新资料页、个人主页和账号菜单都显示新头像。网络中断可以继续上传，处理失败保留旧头像，移除后恢复现有按 id 生成的默认头像。原照片和 EXIF/GPS 不通过公开头像地址发出。

本项目实现：认证上传 API、分片续传、受限秒传、SeaweedFS 存储适配器、三层数据模型、头像派生流水线、公开与私有读取入口、撤销公开缓存的任务、配额、孤儿清理、注销接入和原件备份。通用接口完成后，谱面模块只需登记用途规则和带外键的业务关联表。

本项目不实现 Chart/ChartVersion、谱面发布、压缩包目录解析、maidata 校验、音视频转码、论坛、管理后台和签名分享产品。签名读取契约在本文固定，但分享链接的创建 UI/API 随对应业务落地。首版网页只有头像上传；不开放任意文件托管。

Google/QQ 头像导入也不在本批实现。地基把它们留给存储阶段，但尚未规定导入流程；当前 Google 令牌被明确清空，现有代码没有可复用的头像来源。本批不扩大账号数据保留范围。后续可把平台导入作为服务器受控的上传来源，复用相同校验、配额和处理，不在网页上直接引用外站图片，也不允许用户输入抓取 URL。

## 2. 沿用的决定与本次补齐的选择

沿用已认可的 A.2：SeaweedFS 单机 `weed mini`，仅内部网络；SHA-256；`storage_policies → blobs → files` 和各业务自己的外键关联；`blobs`、`derived` 两个桶；浏览器 Web Worker 流式算哈希，服务器重新算；分片经过 Hono；受限秒传；权限放逻辑文件；配额按逻辑大小；图片只公开去 metadata 后的版本；公开地址保持同域 `/media/<sha256>.jpg`；公开切私有需 purge；pg-boss flow 编排 worker；原件进入现有备份，派生件可重建。

以下是本次设计者提出的默认值，完整设计确认后才成为实施依据：8 MiB 头像、4 MiB 分片、每人最多两个未完成上传、32 MiB 头像逻辑配额、512×512 JPEG 头像、只显示当前头像而不做头像历史、7 天孤儿宽限、登录下载与签名读取走 `/api/v1` 的独立入口。具体数值见第 5 节。

对 A.2 的解释和修正：

| 原条目 | 核实结果和实施含义 |
|---|---|
| `weed mini` 首次带凭据；认证切换单向 | 仍成立。官方说明无凭据时 Allow All，动态添加 identity 后不会因删除凭据恢复 Allow All；环境变量只是凭据来源之一。凭据轮换不依赖“清空 env 重置”。[S3 Credentials](https://github.com/seaweedfs/seaweedfs/wiki/S3-Credentials) |
| `pg-boss flow` | 不是不存在的能力。本仓库锁定 `12.35.0`，本地类型和该版本源码有 `flow`/`FlowJob`。保留 flow；父任务最终失败后子任务会停在 blocked，必须另做终态收敛。[12.35.0 类型](https://github.com/timgit/pg-boss/blob/12.35.0/src/types.ts)、[官方 flow](https://pgboss.io/api/jobs#flow-jobs-options) |
| 100 MB 上传、512 MB 可缓存 | 当前 Free/Pro 仍是每个请求最多 100 MB，Free/Pro/Business 每个缓存文件最多 512 MB；它们是两种限制。保守用 4 MiB 请求和 480,000,000 字节通用硬上限，不贴着边界。[Cloudflare 默认缓存](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/) |
| 固定 `.jpg`，真实 MIME | 保留兼容地址，固定后缀不等于 JPEG。头像输出实际为 JPEG；未来其他类型仍按实际 MIME、用途与 disposition 返回。不能从 URL 后缀推断解码器。 |
| `/media/` 禁查询串；签名链接 | 两者不能共用带签名查询串的 `/media`。公开媒体拒绝所有查询串；私有文件与签名入口独立且全程 `no-store`。 |
| 按 URL purge 后即私有 | 源站可以立即停止新公开读取，CDN purge 是异步撤销过程；不能撤销访问者已经保存的公开副本或浏览器 immutable 缓存。不得把“曾经公开”描述成可恢复保密。 |

考虑过三种接法：浏览器直连 S3 最省源站流量，但需要公开存储入口、另做 CORS/签名和上传授权，与已批准内部存储边界不符；单次整文件 POST 简单，但不满足通用续传与大文件准备；本设计选择所有上传经 Hono 分片，由 worker 校验合成，保留统一认证和限额。

## 3. 当前代码边界（2026-10-10 工作区只读核实）

| 现有事实 | 本项目接入处 |
|---|---|
| `server/app.ts` 的 `/media/*` 在会话前返回 404 | 替换为仅公开媒体处理器；仍不读取/续期会话，不产生 Set-Cookie |
| `/api/v1/*` 统一 64 KiB；`csrfGuard` 的 Cookie 写请求只接受 JSON | 仅精确分片 PUT 路由放宽为受限二进制；其余保留现状，不能在下游再挂宽 bodyLimit |
| `db/schema` 只有 auth/profiles；`user.image` 为 nullable text | 增加存储表和 `user_avatars`；`user.image` 保留为受控的站内头像 URL 投影 |
| `auth/auth.ts` 创建用户时清空 image，Google access/refresh/id token 也清空 | 默认头像与数据最小化继续保留；阻止 Better Auth 通用 update-user 绕过头像业务直接写 image |
| `/me` 和公开用户资料已返回 `image`；`MyProfile` 尚无头像字段 | 扩展自己的资料 DTO：image、avatarRevision；只返回站内派生 URL |
| `client/components/avatar.tsx` 只有 SVG；资料页/个人主页/账号菜单使用它 | 增加图片分支和加载失败回退；所有使用处传 image；现有默认算法保留 |
| `jobs/boss.ts` 已有 `enqueueInTx`/`fromDrizzle`；`queues.ts` 集中建队列 | flow 和业务状态写在同一个 Drizzle 事务里，队列由迁移创建 |
| 一个现有 worker 同时负责注销/清理和 NapCat | 保留现有 worker，另启动同镜像的 media-worker，避免图片处理阻塞机器人与注销 |
| `DELETION_HANDLERS` 为空；`purgeUser` 在单个数据库事务内运行处理器 | 注册存储处理器，只写数据库和投递外部清理，禁止事务内调用 S3/Cloudflare |
| compose 尚无 SeaweedFS、临时磁盘和媒体工作进程；runner 是 Bun 1.4.2 slim | 按第 14 节增加；native sharp 必须在生产镜像验收 |
| backup.sh 目前只备份 community/umami 的 PG dump 到 restic | 加原件清单和 S3 对象导出；不能宣称已有文件备份 |
| community 清单没有 sharp/S3 SDK；根 lock 中 sharp 是 Next 的可选传递依赖 | 实施阶段给 community 显式添加生产依赖，不能依赖 workspace 偶然可见的包 |

目录沿用现有实际结构 `server/api/`，不按旧设计的 `server/api/v1/` 另起一套。客户端仍仅调用 API/TanStack Query，loader 不直接调用存储服务。

## 4. 总体结构

```text
浏览器 Web Worker 哈希/4 MiB 分片
          │ Cookie 或 Bearer、同域 API
          ▼
Cloudflare → community-web → 上传会话/配额（PG）
                         └→ blobs 桶 tmp/<upload>/<part>/<attempt>
                                      │
                   pg-boss flow：ingest → derive → finalize
                                      │
              media-worker → 原件 SHA256 key + derived SHA256 key
                                      │
                         files ready（暂未发布）
                                      │ 明确 PUT /me/avatar
                          user_avatars + user.image
                                      │
                       /media/<派生字节哈希>.jpg
```

存储驱动封装 `put/get/head/delete/list/copy`，传入 policy 与服务端生成的 key，所有调用有超时和取消。首个驱动是 S3-compatible；推荐显式生产依赖 `@aws-sdk/client-s3`，自定义 endpoint、path-style、固定 region `us-east-1`。SDK 可配置自定义 endpoint/请求 checksum，但 SeaweedFS 兼容性仍要在选定版本集成验证。[AWS SDK 客户端配置](https://github.com/aws/aws-sdk-js-v3/blob/main/supplemental-docs/CLIENTS.md)

大请求不读成完整 Buffer。web 每个分片最多暂存 4 MiB，可先收限长 Buffer、核实块哈希后 put；最多八个上传写请求同时执行，最多约 32 MiB 块缓冲。worker 按片流式下载到磁盘、增量 hash，然后将已校验文件流式写入最终 key。临时盘禁止用 tmpfs。

## 5. 用途规则和默认限制

限制写在服务端规则中；客户端从初始化响应拿可用值，不能靠客户端 MIME/大小自报绕过。

| 项目 | 首版默认值 |
|---|---|
| 开放用途 | `avatar`；`chart-source` 只预留规则接口，不对用户开放 |
| 头像输入类型 | JPEG、PNG、WebP、AVIF；拒绝 SVG、GIF、多页/动画 WebP/AVIF、HEIC/TIFF/其他 |
| 头像原件大小 | 1–8,388,608 字节（8 MiB） |
| 头像像素/边长 | width×height ≤16,000,000，单边 ≤8192；拒绝零尺寸/多页 |
| 头像输出 | `avatar-v1`：auto orientation、sRGB、中心 cover 到 512×512、白色 flatten、JPEG quality 85、非 progressive；无 EXIF/XMP/IPTC/ICC；最大 512 KiB |
| 分片 | 4,194,304 字节（4 MiB）；最后一片允许较小；0 开始的 index |
| 通用存储硬上限 | 480,000,000 字节，最多 115 片；未来谱面用途还必须单独定义更小上限 |
| 活动会话 | 每人最多两个 receiving/processing；全站最多 100 个；24 小时绝对到期，不因状态轮询续期 |
| 头像逻辑配额 | 每人 32 MiB，包括保留文件与预约的上传大小；同内容不同逻辑 file 仍计各自大小 |
| 初始化频率 | 每人 10 次/小时，每 IP 60 次/小时；分片每人 120 次/分钟、同时两次 |
| 全局临时对象预算 | 2 GiB（已写 + 当前预约）；超过返回 503，已有读取仍正常 |
| 原件总预算 | 初始 20 GiB；派生预算 2 GiB；宿主机可用盘不足 5 GiB 停新上传 |
| web 存储并发 | 公开/私有读取共 32、上传 put 8；不设无界等待队列，饱和 503 + Retry-After |
| media-worker 并发 | ingest 1、sharp 1；临时磁盘 2 GiB 上限；单头像图像处理 30 秒，任务 120 秒 |
| 保留 | receiving 24h；processing 最长 24h；临时对象终态后 1h；未附着 ready file 24h；替换/移除 file 24h；无引用 blob 7 天 |

这些预算是单机启动值，不是用户永久权益或容量证明。上线前核实 g510 实际可用空间；容量变化通过配置迁移/运维变更调整，不从 DB 自动无限扩容。不以 Redis 作为配额真相：Redis 可淘汰，精确预约和释放在 PG 事务里。

## 6. 数据模型和不变量

id 用现有 UUID 工具；hash 统一 64 个小写十六进制字符。大小用 PG bigint，TypeScript 对外 JSON 仍用安全整数；本项目上限远低于 2^53。状态列有 CHECK，非空/大小/索引/外键由迁移约束。

### 6.1 三层与派生层

| 表 | 主要字段、约束与作用 |
|---|---|
| `storage_policies` | id、name、driver=`s3`、endpoint、region、originalBucket、derivedBucket、credentialsRef、enabled、createdAt。credentialsRef 仅指向允许的环境变量组，不存密钥、不接受用户任意 endpoint。首版一行 `local-seaweed` |
| `blobs` | id、sha256 UNIQUE、policyId FK RESTRICT、key UNIQUE(policyId,key)、size、detectedMime、state=`pending/ready/deleting/deleted/blocked`、properties JSONB、verifiedAt、orphanedAt、generation、leaseUntil、createdAt。只有服务端核实完整字节后才能 ready |
| `files` | id、ownerId FK SET NULL、blobId FK RESTRICT、originalName、purpose、size、state=`processing/ready/rejected/deleted`、deletedAt、createdAt、retainedUntil。原始名规范化为纯 basename，去控制字符/路径，最多 255 字符。无通用 public 布尔开关，公开来自业务关联 |
| `derived_objects` | id、outputSha256 UNIQUE、policyId FK RESTRICT、key UNIQUE(policyId,key)、size、mime、properties（width/height）、state=`pending/ready/deleting/deleted/blocked`、generation、leaseUntil、orphanedAt、createdAt。这是派生字节的物理账本，每个输出 hash 只有一行 |
| `blob_derivatives` | id、sourceBlobId FK RESTRICT、recipe、recipeBuild、derivedObjectId nullable FK RESTRICT、state=`pending/ready/rejected/retired`、generation/leaseUntil、errorCode、createdAt；UNIQUE(sourceBlobId,recipe,recipeBuild)。只管来源与 recipe 的生成关系；ready 必须关联 ready 的 derived_object，不在此表记录/删除物理 key |
| `user_avatars` | userId PK FK CASCADE、fileId nullable FK RESTRICT、derivativeId nullable FK RESTRICT、revision bigint、updatedAt。fileId 和 derivativeId 同时为空或同时非空；移除头像也保留行和递增 revision |
| `blob_blocks` | sha256 PK、reasonCode、createdAt；只存内部审核原因，不向上传者暴露其他人信息；原件与派生 hash 都能封禁 |

所有原件 key 为 `sha256/ab/cd/<hash>`，派生 key 同样以输出 hash 存在 derived 桶；临时件放 blobs 桶 `tmp/<uploadId>/<index>/<attemptId>`。它们都没有用户控制的路径段。

`blobs.sha256` 是原始上传字节的哈希，不能拿来作为已经转码 JPEG 的 immutable 地址。`/media` 的 hash 始终指向实际响应字节；原件变化或 recipe/编码器变化都生成新派生 hash。两张不同来源图经处理产生相同输出时，两个 blob_derivatives 通过 FK 指向同一个 derived_objects 物理行；复用大小/MIME 必须一致，否则报存储一致性错误。不能因某个来源 orphan 就删除共享输出。

公开头像只授权 avatar 派生，**不让原件因存在公开头像引用而自动公开**。未来公开谱面原件须由相应的关联表、用途规则和业务状态明确授权。`files` 有引用但业务是草稿/审核中/注销中，也不是公开引用。

### 6.2 上传、预约和缓存撤销

| 表 | 主要字段与约束 |
|---|---|
| `upload_sessions` | id、ownerId FK CASCADE、purpose、originalName、expectedSha256、expectedSize、partSize、partCount、state=`receiving/processing/ready/rejected/cancelled/expired`、fileId nullable、expiresAt、errorCode、flowJobIds JSONB、generation、reservedBytes、createdAt/updatedAt；ownerId+idempotencyKey UNIQUE，requestDigest |
| `upload_parts` | uploadId FK CASCADE、index、size、sha256、tempKey、state=`writing/ready`、attemptId、leaseUntil；PK(uploadId,index)。块 sha256 必须是服务器实际算出的值，ETag 仅用于存储请求条件 |
| `storage_usage` | userId PK FK CASCADE、usedBytes、reservedBytes、activeUploads、updatedAt；同一用户所有上传/删除都锁该行更新 |
| `storage_budget` | 一行全局预算，temporaryReserved/temporaryWritten/originalReserved/originalWritten/derivedReserved/derivedWritten；事务预约、防超额，定时与物理 blobs/derived_objects 账本核对；共享 derived_object 的物理字节只计一次，不按 blob_derivatives 行数累计 |
| `media_publications` | outputSha256 PK FK derived_objects.outputSha256 RESTRICT、state=`public/revoking/private/blocked`、generation、updatedAt、lastPurgeAt。一个物理派生对象只有一个规范公开出口；只记录公开出口状态，不代替所有来源/业务的真实权限查询 |
| `media_purge_requests` | id、outputSha256、generation、state=`pending/running/done/failed`、attempts、nextAttemptAt、lastErrorCode、createdAt；UNIQUE(hash,generation)。作持久 outbox，pg-boss job 丢失也能补 |
| `avatar_mutations` | userId FK CASCADE、idempotencyKey UUID、requestDigest、resultImage/resultRevision、createdAt；PK(userId,idempotencyKey)，24h 保留。保存/移除的网络重放返回原成功结果，不再次修改 revision |

发布媒体时在事务里锁对应 `media_publications`、查询有效公开引用、更新 projection。读请求仍检查 publication 状态与有效引用，不以 reference count 作唯一权限证据。新增业务关联表须同时登记 `references(file)`、`publicRepresentations(file)` 和注销处理器；测试禁止新引用表遗漏清理注册。

用户配额采用 `usedBytes + reservedBytes + 新预约 ≤ quota`。初始化时预约 expectedSize；ready 原子释放 reserved、转为 used；拒绝/取消/过期释放一次；逻辑 file 删除原子扣 used（物理 blob 是否仍共享不影响）。通过锁/状态 compare-and-set 防双扣。usage 是可校正账本，夜间按 files/sessions 重算并记录漂移，不是 blob 引用计数。

派生物理预约在计算出 output hash 后、实际写对象前进行：事务锁 derived_objects 和全局 budget，已有 ready 输出直接关联，不再预约/计费；新物理行按实际输出大小预约，put/校验成功并 CAS ready 时 reserved→written。失败/删除按相同物理 generation 释放一次。不同来源同时产生相同 output 的竞争由 outputSha256 UNIQUE 和物理租约收敛，不因重复 recipe 关系双计预算。

## 7. HTTP 契约

控制请求 JSON ≤64 KiB，统一现有 `{ error: { code, message } }`；成功 DTO 只给使用者自己可知的信息，全部 API `private, no-store`。返回 Request-Id，错误细节不含 key、原始凭据、他人文件存在性。

| 方法与路径 | 请求 | 成功与幂等 |
|---|---|---|
| `POST /api/v1/uploads` | Idempotency-Key UUID；`{ purpose:"avatar", name, size, sha256 }` | 201 `{ id,state,expiresAt,partSize,partCount,receivedParts,fileId? }`。同用户同 key 同正文重放原结果；不同正文 409 IDEMPOTENCY_CONFLICT。过期 key 重放终态，不能偷偷开新会话 |
| `GET /api/v1/uploads/:id` | 登录者须为 owner | 200 上述 DTO + `errorCode?`；receivedParts 给 index/size/hash；不知道或别人的 id 都 404 |
| `PUT /api/v1/uploads/:id/parts/:index` | `application/octet-stream`；`X-Part-SHA256`；body 是该块完整字节 | 204；同 index 同 hash/长度已经 ready 则 204；不同内容 409 PART_CONFLICT；writing 409 PART_BUSY + Retry-After |
| `POST /api/v1/uploads/:id/complete` | JSON `{}` | receiving 且所有块 ready →202 processing；processing 重放 202；ready 重放 200 + fileId；缺块 409 UPLOAD_INCOMPLETE；terminal failure 409/410 带既定 code |
| `DELETE /api/v1/uploads/:id` | JSON `{}`（Cookie 写请求） | 204 可重放；ready 会话不能借此删除已附着头像，409 UPLOAD_ALREADY_COMPLETED；正在处理的会话先 cancelled，再异步收敛 |
| `GET /api/v1/files/:fileId` | owner 或将来的业务 read 权限 | 200 `{id,purpose,name,size,state,createdAt,previewUrl?}`；avatar previewUrl 指向登录读取的处理后派生，不给原件公开地址 |
| `GET/HEAD /api/v1/files/:fileId/content` | owner/业务授权，默认原件 attachment；用途白名单才 inline | 200/206；没有权限统一 404，no-store；原件不会由 /media 路径 Cookie 鉴权 |
| `GET/HEAD /api/v1/files/:fileId/preview` | owner；avatar-v1 ready | 200/206 处理后 JPEG，private no-store；ready 后保存前预览用此入口 |
| `DELETE /api/v1/files/:fileId` | JSON `{}`；owner | 未附着/已软删 204；业务仍引用 409 FILE_IN_USE；删除不直接碰 S3 |
| `PUT /api/v1/me/avatar` | Idempotency-Key UUID；JSON `{fileId, expectedRevision}` | 200 `{image,avatarRevision}`；file ready、purpose avatar、owner 是自己；相同 key/正文返回原成功结果；新操作 revision 不匹配 409 AVATAR_CHANGED；发布头像事务见第 10 节 |
| `DELETE /api/v1/me/avatar` | Idempotency-Key UUID；JSON `{expectedRevision}` | 200 `{image:null,avatarRevision}`；同 key/正文重放成功结果；新操作过时 revision 409 |
| `GET/HEAD /media/:hash.jpg` | **无任何查询串**；只公开表示 | 200/206/304；否则 404 no-store；Cookie/Bearer 均不改变结果 |

首版没有公开的列表文件 API、通用 publish/private 切换 API 或分享链接创建 API。大文件实现通过内部用途 fixture 验证流式行为；业务前未开放 `chart-source` 返回 400 PURPOSE_NOT_AVAILABLE。

私有分享契约预留为 `/api/v1/shares/<opaqueToken>/content`（不跳转 `/media`）。token 为至少 256 bit 随机值，只存 SHA-256；表有 fileId、允许的 representation、expiresAt、revokedAt、业务资源外键；默认 15 分钟、最长 24 小时、只读。每次验证 token、到期、撤销、file 与业务权限；全程 no-store。未来业务新增带具体外键的 share 表，不用多态 resourceType/resourceId。请求日志须把 token 段替换为 `[redacted]`，签名 URL 不进入分析上报；响应 `Referrer-Policy: no-referrer`。这些入口与 `/media` 无查询串 WAF 规则不冲突。

### 分片路由的受控例外

先按方法和完整路由模式匹配 `PUT /api/v1/uploads/<合法UUID>/parts/<0..114整数>`；不能仅用 `startsWith('/uploads')` 放开。仅此路由 Cookie 写请求接受 octet-stream，仍强制 Origin 等于 PUBLIC_ORIGIN、Sec-Fetch-Site 若存在为 same-origin；Bearers 继续按既有规则。不接受 multipart/form-data、text/plain 或 application/json 伪装分片。

大小限制中间件同样只对精确分片路由使用 4 MiB，其他路径维持 64 KiB；实际读流计字节，不只信 Content-Length。分片必须有声明长度并等于服务端根据 expectedSize/index 计算的长度；缺失 411、过大 413、错长 400。实现须保留现有 bodyLimitWhenDeclared 对无 body DELETE 的兼容处理，并在真实 HTTP/Bun 与开发适配器测试，不能只测 app.request。

分片跳过现有“每用户写 API 60/min”的桶，改用本项目 120/min 和同时两次；其余写请求仍计原桶。通用 IP 300/min 保留。Redis 限流失效沿用现有故障行为，但 PG 配额/active 上限和进程并发闸不会失效。

## 8. 上传和秒传状态机

1. 客户端 Worker 以 1 MiB 读取切片、增量 SHA-256；不能为未来大文件调用一次 `crypto.subtle.digest(await file.arrayBuffer())`。增量库由实施计划挑选并锁版；取消选择时停止 worker。name/size/hash 用于创建会话。
2. 服务端事务锁 user 状态、usage 与全局 budget，验证用途、大小、黑名单、配额和活动数，再创建会话。必须在事务中再次检查 `user.status=active`，避免与账号注销并发穿透。
3. 秒传资格只来自“原件 blob ready，且上传者自己已有未删除的 file 引用”，或“该原件已由合法业务明确公开”。**公开头像派生不代表头像原件公开**；拥有派生图的 hash 不能查询原照片是否存在。无资格时返回普通 receiving，与 blob 不存在时形状相同，绝不返回 exists/private owner 等探针信息。
4. 有资格也重新检查 size、用途校验版本、黑名单。原件此前用于其他用途但没通过 avatar 规则时仍须 derive 校验。创建自己的新逻辑 file、正常计配额；可直接进入 processing 复用已有验证与派生，不能凭客户端 hash 跳过用途规则。
5. 每片处理先短事务锁会话和该 part，取得带 generation 的租约；写 `tmp/<upload>/<index>/<attempt>`；服务器重新算块哈希。成功 put 后再短事务 CAS 租约且会话仍 receiving，part 变 ready。网络/进程在 put 后崩溃只留下孤儿 attempt key，由 sweep 清理；不能把“put 开始”当作上传成功。
6. 同片竞争只有一个租约能提交；租约 120 秒过期可重试。旧请求晚完成必须 CAS 失败并删自己的 attempt key，不能覆盖新片。complete 只在无 writing 且恰好 partCount 个 ready 时推进；有读写中的片返回 PART_BUSY。
7. complete 事务把 session 变 processing，创建 processing file，原子创建第 9 节 flow 并保存 job IDs；不在 web 请求内合成。成功响应与任务/状态一起提交。
8. ingest 按 index 读取已登记 tempKey，逐片核对长度和 hash，按序写本地临时文件并重算整体 SHA-256；任何偏差拒绝。服务端 byte count 必须等于 expectedSize。原件 put 成功、head/metadata 核实后，才能写 blob ready。客户端 hash 只是预期，S3 ETag 不能替代 SHA-256。
9. derive 完成后 finalize 把 file/session ready 和 quota reserved→used 放同事务；临时件异步清理。ready 不等于公开，也不自动替换当前头像。

终态 code 明确区分 `HASH_MISMATCH`、`PART_HASH_MISMATCH`、`TYPE_NOT_ALLOWED`、`IMAGE_INVALID`、`IMAGE_TOO_LARGE`、`ANIMATED_IMAGE_NOT_ALLOWED`、`HASH_BLOCKED`、`PROCESSING_FAILED`、`UPLOAD_EXPIRED`。客户端只向本人展示这些 code 对应文案。重试存储故障/超时不立刻变 rejected。

## 9. worker、flow、失败和竞态

flow 形状固定为 `storage.ingest → media.avatar → storage.finalize`，每个 payload 只给 uploadId、generation；中间结果从 DB 读。秒传也是此 flow，ingest 检查可复用原件后 no-op；每个 handler 都先查会话终态，终态直接成功 no-op。

flow 调用放在业务事务里，传 `db: fromDrizzle(tx, sql)`。不能先 send 再补 dependency；官方 flow 会原子创建 jobs 与依赖，custom db 的事务由调用方保证。[flow](https://pgboss.io/api/jobs#flow-jobs-options)、[Drizzle adapter](https://pgboss.io/api/adapters#drizzle)

| 队列 | 初始选项与并发 |
|---|---|
| `storage.ingest` | exclusive、singletonKey=uploadId:generation；retryLimit 5、retryDelay 30、backoff、max 600s；expire 600s、heartbeat 30s；deadLetter=`storage.dead`；并发 1 |
| `media.avatar` | exclusive、同 key；retryLimit 3、30s/backoff/max 300s；expire 120s、heartbeat 30s；deadLetter=`storage.dead`；并发 1 |
| `storage.finalize` | exclusive、同 key；retryLimit 5、30s/backoff/max 600s；expire 60s；deadLetter=`storage.dead`；并发 1 |
| `storage.dead` | retention 90 天；定期 drain，按 uploadId/generation 标 processing_failed 并取消 blocked 子任务 |
| `media.purge` | exclusive、hash:generation；retryLimit 8、30s/backoff/max 3600s；单次尝试总 deadline 60s，queue expire 90s 给取消/落状态留余量、heartbeat 30s；deadLetter=`media.purge.dead` |
| `media.purge.dead` | retention 90 天；记录 durable purge outbox failed，持续可见，值班处理后重投 |
| `storage.cleanup` | stately、每小时一次、expire 600s、无重试，下小时再扫；对象删除子任务可重试 |
| `storage.delete` | exclusive、对象 id:generation；retryLimit 8、30s/backoff/max 3600s；expire 120s；deadLetter=`storage.delete.dead`（90 天） |

成功任务保留 7 天，排队/重试保留 7 天；每分钟 sweep 检查 processing 超过 15 分钟但没有可运行任务的 session、死信和 blocked 后代。绝对 24h 未恢复则终态失败、释放预约，不永久占配额。周期 sweep 采用当前 `missed:"once"` 模式。

输入非法属于永久错误：handler 在短事务里把 session/file rejected、释放预约，取消尚未运行后代，自己返回成功（避免重复解码同一恶意图片）。PG/S3 暂时不可用则 throw，交队列退避。真正执行到死信时，在控制 worker 中使用数据库终态 CAS，然后取消 blocked 后代；任务 sweep 能修复 drain 中途崩溃。永久错误不是让子任务永远 blocked。

两个上传碰到同一个原始 hash：blob UNIQUE 保证一行；通过 blob 租约/generation 确定 canonical writer。另一个会话已经完整核验自己的字节，可以等待 ready 后复用；canonical key 只会写相同 hash 对应字节。S3 IO 不在 PG 行锁事务内做；旧租约写完成不得修改新状态。

两条 flow 碰到同一个 sourceBlob+recipeBuild：blob_derivatives UNIQUE + 生成租约只准一个提交 recipe 关系；另一条任务稍后重试读取 ready。不同来源输出相同字节时，在 output hash 核实后锁/创建同一个 derived_objects，以它自己的物理租约/generation 控制实际 put 和 ready；其他生成关系等待 ready 后用 FK 关联。不能把来源关系租约当作共享输出的独占写权。lease 决定 DB 发布权，任务 singleton 不是唯一并发防护。图像进程崩溃、响应中断、DB 提交失败均可重复运行；已生成物理对象按 hash 复用。

图片处理由独立受限子进程执行 sharp，子进程总墙钟 30s，超时终止；media-worker 继续心跳。使用 `failOn:'warning'`、`limitInputPixels:16_000_000`、默认安全特性和 page 数量检查，先验证 header/decoder format，再完整解码与重新编码。不打开 `unlimited`，不使用 keepMetadata/withMetadata。[sharp constructor](https://sharp.pixelplumbing.com/api-constructor/)、[sharp output](https://sharp.pixelplumbing.com/api-output/)

recipeBuild 固定 sharp/libvips 版本和处理配置。升级编码器新建 recipeBuild，不覆盖旧派生字节；相同版本重建也要核对 output hash。后续 ffprobe/ffmpeg 用同一受限任务边界，但本项目不安装/运行它们。

## 10. 头像保存、权限与缓存

`PUT /me/avatar` 是显式发布操作，不要求再次敏感登录，但要求当前账号 active。事务锁 user、user_avatars、目标 file/blob_derivative/derived_object、涉及的 publication；先查 avatar_mutations，同 key 同正文重放原结果，不同正文 409；新操作按 expectedRevision 更新 file/derivative 关联和 `user.image` 为 `/media/<derived_object.outputSha256>.jpg`，revision+1，并保存幂等结果。旧 file 设 24h 保留并取消其公开引用；查询共享 derived_object 的所有来源/业务，最后一个有效公开引用移除时才写 revoking 与 purge outbox，同事务 enqueue。若当前头像与目标 file 相同且 revision 匹配，返回当前 DTO，不重复预约/发布。重放后前端仍刷新查询，避免把缓存的旧成功结果当作当前资料。

发布新头像先验证它的 output 不在 revoking/blocked。revoking 中返回 409 MEDIA_REVOCATION_PENDING，避免旧 purge 任务与重新公开互相覆盖。完成后前端 invalidate `['me']` 和该用户公开 profile query；图片组件失败回退 SVG。默认头像只是资料而不是发布内容，单独有头像的账号仍按空账号注销，不因此增加 7 天冷静期。

公开媒体只提供规范路径：小写 hash、固定 `.jpg`、无查询串，不对错误 path 做容错重定向。只支持 GET/HEAD。本批 hash 经 media_publications 的 FK 唯一指向 derived_objects，再查询所有来源 derivative 和有效业务引用；不随访问者选择不同来源或物理字节。未来其他公开用途须接入相应具体外键授权，原件的公开出口随谱面设计补齐，不能把原件误登记为头像派生。无有效公开引用、状态非 public、黑名单或物理对象未 ready 均 404，**不尝试 Cookie 私有回退**。

公开响应统一：准确 `Content-Type`、`Content-Length`、ETag=`"sha256-<hash>"`、`Accept-Ranges: bytes`、`Cache-Control: public, max-age=31536000, immutable`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; sandbox`、`Cross-Origin-Resource-Policy: same-origin`；不 Set-Cookie，不按 Cookie/Authorization/Accept 选择内容、不 `Vary: Cookie`，不因文件名不同改公开 Content-Disposition（头像 inline、无原始名）。所有出错/404/410/429/503 都 `private, no-store`，避免默认 404 缓存。

未来内联白名单仍是 A.2 的 png/jpeg/webp/avif/gif、mp3/ogg/flac、mp4/webm、maidata text/plain，但“类型在白名单”不足以授权发布，业务用途还必须允许此 representation。SVG/HTML 永不内联；其他 attachment+octet-stream。下载文件名在 file 私有入口规范 RFC filename/filename* 处理，防 CRLF 注入；公开 hash URL 的响应不含上传者文件名。

Range 支持一个合法 bytes range，包括 suffix；多段 Range 返回 416，不构造 multipart。超界 416+`Content-Range: bytes */size`；HEAD 无 body；If-None-Match 与 If-Range 语义正确。鉴权/公开状态和黑名单检查必须先于 304/206；不能因为客户端有 ETag 绕过权限。存储流按 Range 转发、背压、断连取消，禁止全文件内存缓冲。相关 Cloudflare 行为由真实边缘验收确认，源站不要假定每次请求都能看到。[Cloudflare Range](https://developers.cloudflare.com/cache/reference/range-requests/)

### 公开撤销

移除最后公开引用的事务先置 publication=`revoking`，源站立刻拒绝新公开读取，并持久写 purge 请求；UI 返回头像已移除，但相关文件状态 DTO/运维记录为缓存撤销中。不能在操作响应里声称 CDN 已完成。

web 对每个公开 hash 跟踪在途读取；在异步查 DB 权限前先登记 AbortController，避免“检查已公开后、登记流之前”漏过 drain。web 另有 compose 内部专用监听 `:3001`，无宿主机端口/隧道，`POST /internal/media/drain` 收 `{hash,generation}`，用仅 web/控制 worker 知道的 bearer secret 鉴权。控制 worker 请求这个入口，按 hash 锁设置本地 revoking admission latch、拒绝新的读取登记并中断所有在途 origin stream；响应 `{generation,drained:true}` 后才 purge。重启使旧流自然中断，新进程从 PG revoking 状态拒绝读取；进程不响应时任务保持 revoking。若同 hash 合法重新发布，generation 递增后通过同一内部入口的 `POST /internal/media/resume` 解除相应 latch，并重新核查 PG public 状态。单 web 部署是约束，横向扩展需改成所有实例 drain。

一次撤销尝试最多 60 秒，网络请求各设 10 秒 deadline、使用取消信号且不做无界重试。按以下顺序收敛，整个过程保持 revoking：

1. 收到当前 generation 的 origin hash drain acknowledged；PG 再核实仍是当前 generation 且共享物理对象的所有来源均无有效公开引用。
2. `POST /zones/:zoneId/purge_cache` 清规范 URL `PUBLIC_ORIGIN/media/<hash>.jpg`，确认 API success；间隔至少 5 秒，再 purge 同一个规范 URL 并确认 success。
3. 从控制 worker 对该**社区规范公网 URL**发两次真实匿名 GET，间隔至少 5 秒；不带 Cookie、Authorization、Range、条件头、查询串或 Cache-Control cache-bust，避免绕过实际缓存路径。两个响应都必须是 404，且不能收到旧的 200/HIT 内容；检查状态、CF-Cache-Status、body 长度/响应 hash，不能以单个 purge API success 代替观测。404 若带 HIT 也不接受，便于发现负缓存配置漂移。probe 每次最多读 64 KiB；遇到 200/HIT/非404立即取消 body，不下载旧照片，大于限制也失败；只保存状态与404错误响应摘要。
4. 最后再次事务锁 publication/derived_object，核实 generation 未变、仍无有效公开引用、drain 与两次 purge/probe 证据齐全，才置 private 并完成 outbox。证据记录观测时间/状态/缓存状态，不记录私人字节内容。

网络错误、超时、200、HIT 或代际变化都不通过，保持 revoking；该轮结束后按队列退避重试，持续失败进入 durable outbox/死信并每小时补投。尝试最多两个 purge、两个 probe，不因测不到结果而循环探测。调用点的真实边缘观测与控制面确认足够作为本方案的撤销完成条件，**不假设能遍历所有 Cloudflare POP，也不承诺全球每份缓存或浏览器副本消失**。[Purge 文档](https://developers.cloudflare.com/cache/how-to/purge-cache/)

若核实时发现其他合法公共引用则重新计算 publication；不能把共享对象物理删掉或覆盖新一代公开状态。purge secret 只给控制 worker，不给浏览器或 media-worker。把 CF API token 限在该 zone 的 Cache Purge 权限。

已有浏览器缓存或保存副本不受 CDN purge 影响。这是 A.2 一年 immutable 公开分发的现实边界；任何“私有”功能必须从首次读取就使用私有入口。本项目没有私有头像开关。

## 11. 配额、清理与物理删除

files 未附着时 24h 过期；旧头像 24h 后逻辑删除；UI 不显示历史图库。用户明确删除未附着 file 时立即软删、扣逻辑配额、撤销分享；未来已有业务引用不让通用 DELETE 拆掉业务资源。逻辑 soft-delete 之后公开出口先走第 10 节，物理对象宽限不继续公开。

每小时批量扫描，每批最多 100 条，每轮至多 1000 对象或 10 分钟，避免长事务和无限循环：

1. 收敛过期会话、取消 flow 后代、释放预约；清理超过租约且未登记 ready 的 part attempt。
2. 删除终态会话 1h 之后的 tmp 前缀；没有 DB 会话的 tmp 至少保留 48h，再删除。
3. soft-delete 到期且没有业务 FK 引用的 file；保留最小墓碑 30 天用于幂等/排障，然后删除，原始名不长期留审计。
4. 对无任何未删除 file、没有活动会话/工作租约、没有派生生成任务的 blob 设置 orphanedAt。出现新引用即清空 orphanedAt。
5. 原件 orphanedAt 满 7 天后，短事务重新检查该 blob 的 files/业务/会话/生成租约，置 blob deleting、递增其物理 generation，登记**仅该原件**删除任务；该来源不再需要的 blob_derivatives 置 retired，不能直接删除它们指向的物理输出。
6. derived_objects 独立扫描：查询指向它的**所有** blob_derivatives，确认没有 ready/pending 的有效来源、任何业务 FK 引用/公开引用、活动 upload/生成/物理租约；全部无依赖才设置自己的 orphanedAt。重新出现依赖则清空它。满 7 天后再在短事务里复核同一条件及 publication 已完成撤销，锁该物理行，置 deleting、递增其物理 generation，登记派生物理删除任务。单个源 blob orphan 不足以删除共享输出。
7. 原件任务只用 blobs 的 key/generation，派生任务只用 derived_objects 的 key/generation；事务外 delete，404 视为成功；完成后 CAS 相应物理 generation 置 deleted 并释放物理预算一次。删除失败留 deleting 重试。不能先删物理账本行而丢失重试信息。关联行的 FK 不阻止物理对象状态墓碑保留，实际移除行在依赖墓碑到期后另行处理。

新上传/派生生成和 GC 竞争：只准新关联/秒传复用 ready 物理对象；命中 deleting/deleted hash 时先等旧删除终态，再由新 generation 完整写入恢复 pending→ready。原件的规则执行在 blobs，共享输出的规则执行在 derived_objects，不能用某一 blob_derivatives 的 generation 替代物理代际。删除任务开始 IO 前与每次重试都核对物理 generation；同一物理 hash/key 的旧 DELETE 必须完成/取消并确认后才能准新一代 PUT，避免旧任务删掉新写或只保护了其中一个来源。新来源/业务附着与 GC 置 deleting 都在同一物理行锁下核查，保证它们不会同时成功。

每晚以对象清单与 DB/预算账本核对，未知原件先记录隔离候选，48h 后重新核对才能删除；不是一次 list 就直接删。Ready DB 行对应 S3 404 标为存储故障，不从配额默默移除；尝试从原件备份恢复并记录。派生丢失则 enqueue rebuild。黑名单阻断所有入口与秒传，触发全部输出公开撤销，但不无条件销毁备份或共享来源；正式审核后台以后决定保留/申诉流程。

## 12. 账号注销接入

存储 `DeletionHandler.hasContent` 对“仅头像/临时上传”返回 false；未来谱面/论坛内容由各自 handler 决定冷静期，避免头像把空账号变成有内容账号。

申请注销时 user 状态已变 pending_deletion、会话已撤销；同一事务加入存储 prepare hook：撤销该账号头像公开引用、清空 user.image、user_avatars 暂停公开，取消 receiving/processing 会话、释放预约、写必要 purge outbox。冷静期撤销后可恢复原头像关联（file 原件不能在冷静期 GC），再通过相同 publication 锁发布；revoking 未收敛时暂显示默认头像。不能依赖 GET /media 时读 user.status 来撤销已经存在的 CDN 缓存。

最终 purge 的存储 handler 在现有 purgeUser 事务里删除头像关联、soft-delete 本人头像/未附着私有 files、清理 session 行、登记清理任务；不做 S3/CF 请求。头像总是删除，deleteContent=false 不会匿名保留个人照片。其他业务选择匿名保留时，由其具体 FK 关联保护所需 file，files.ownerId 随 user 删除 SET NULL、清除上传者文件名等不再需要的个人信息；deleteContent=true 时业务先解除引用，再交存储 GC。

DELETION_HANDLERS 顺序固定为“未来业务解除/保留文件关系 → storage → profiles/user”。本批只有 storage；模块注册测试和注销竞态测试检查 worker 不能在用户注销后把头像重新发布。取消注销不恢复已取消上传，会话需要重新初始化。存储 outbox 不 FK CASCADE 到 user，用户行删掉以后撤销/删除任务仍可完成。

账号删除后数据库中的活跃文件及公开入口按上述规则处理；加密 restic 历史快照按现有 7 daily/4 weekly/6 monthly 保留到自然淘汰，不逐个改写快照。隐私说明需要说明备份保留窗口，恢复后重放删除墓碑，不能恢复已经注销用户的公开内容。

## 13. 原件备份和恢复

沿用本机 restic，当前只备份 PG 的现状必须在上线前补齐。两个桶仍不公开；blobs 原件备份、derived 不备份、tmp 不备份。不能把运行中的整个 Seaweed 数据目录直接 restic 当作一致备份；本批选应用层 S3 导出+数据库一致快照。

每天既有 03:30 定时任务执行：先打开全站存储写维护闸（新上传/完成/保存/删除 503 STORAGE_MAINTENANCE，读取正常），暂停媒体推进和 GC，等在途存储写/删除收敛；取得专用 PG advisory exclusive lock，存储相关事务必须持有对应 shared xact lock。导出一致的 community dump 与包含所有需恢复 ready 原件的 manifest（hash/key/size/MIME/policy），再流式导出并逐件校验 SHA-256，到 staging 磁盘；打包这些原件、manifest、community/umami dump 到同一个 restic snapshot。

原件导出缓存只复用已经核实 hash 的本机只读 staging 文件；不可变 key 不需要每天重复下载，但 manifest 必须每次完整重建。整个备份最久 30 分钟，维护闸最多 5 分钟；首批头像预计很短，达到 5 分钟必须失败并解除维护，不能让网站无限停写。未来谱面规模超过这个窗口时再实施快照/增量对象复制，不能为未上线规模预先做复杂 HA。

成功 snapshot 后才 prune，任何对象缺失、hash 不符、dump/restic 失败整次失败。finally/故障租约确保闸会解除；失败备份不记录完成。快照标签从只有 community-db 改成 `community-full`，旧 DB-only 快照保留并标明无法恢复文件。保留规则仍 7 daily/4 weekly/6 monthly。

恢复先开维护闸、停 worker/GC：恢复 manifest 原件到相同 policy/bucket/key，逐件 hash 验证，恢复 PG；将未备份 tmp 的活动 upload 会话取消并重算预约；重建派生与 publication 投影，重放快照之后的账号删除/撤销公开墓碑，再 purge 所有受影响旧媒体。派生使用记录的 recipeBuild 与固定编码器；输出 hash 不符时不能写旧 immutable key，生成新派生并更新投影。检查头像、私有读取、权限、预算、job/outbox 后才开写。

删除/封禁墓碑与业务写在同一 PG 事务，并由控制 worker 至少每分钟导出到快照之外的加密 append-only 恢复日志，记录最小 userId/fileId/hash/generation/time，最长保留 7 个月（覆盖 6 monthly 备份）；不记录原始名/照片。此日志跟随本机加密备份，恢复时要求最新可验证版本；原机器尚可访问时先强制导出，不能只用旧快照内的墓碑。若原机/最新日志不可得或有导出缺口，恢复保持公开媒体关闭，待核对删除记录后开放，不能承诺每日备份覆盖快照之后的全部变更。当前依然没有异地备份承诺。

验收至少一次全新 Seaweed/PG 卷的恢复演练：原件 hash、头像重建、注销内容不复活、tmp 不恢复、旧分享失效、GC 不删有效文件。上线前记录实际 RPO=每日备份窗口、RTO 演练耗时，不预先编造恢复分钟数。

## 14. compose、配置、Cloudflare 与运维

新增 `seaweedfs` 服务：`chrislusf/seaweedfs:<明确稳定版本>@sha256:<digest>`，显式 `weed mini -dir=/data -s3.port=8333 -bucket=blobs,derived`，命名卷挂 `/data`，不映射宿主机端口、不新增 tunnel 公网入口。镜像版本在实施计划查官方 release/registry 后固定，不能用 latest；mini 默认组件/端口会随版本变化。[官方 mini](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini)

首次启动凭据生成走现有 fill-secrets。生产凭据建议按角色由 env 生成只读配置文件挂入 Seaweed：web 只读原件/派生并写 tmp，media-worker 读 tmp/写原件派生，控制 worker 负责 list/delete，backup 只读，初始化管理凭据仅初始化时使用。该版本 ACL 是否能按前缀细分必须测试；若仅能桶级，首版允许相应角色桶级权限并在文档说明，不假装已实现 prefix 隔离。配置文件是从 env 在启动辅助容器生成到权限 0600 的卷，不进入 Git/镜像层/日志；不启用 anonymous identity。

web/media/control/backup 只获得本角色变量；增加 `SEAWEED_ENDPOINT=http://seaweedfs:8333`、region、bucket、各角色 access/secret、配额/预算/临时目录、MEDIA_RECIPE_BUILD；Cloudflare zoneId/purge token 仅控制 worker。NO_PROXY 加 seaweedfs，不能被宿主代理转发。env 缺必需变量拒绝启动，Seaweed 匿名 GET/PUT 必须 403。

media-worker 单独 command、有限内存/CPU、可写 disk tmp 卷、stop_grace_period ≥45s；外部图片操作可取消并保存 DB 状态。现在不改 NapCat worker 的实时连接职责。web/private reads 的 circuit breaker 在 30 秒窗口连续 5 次真实存储故障后打开 15 秒，再放一个半开探针；404/权限拒绝不计故障。读并发闸、put 并发闸和 PG 预约分开，断连必须释放 permit。

`/readyz` 增加 signed HeadBucket 两桶、必要队列/配置存在性，不因图片 processing 排队就失败；探针仍只允许本机。存储故障时已有 DB 页面仍能读，上传/媒体明确 503，不把服务不可用误报为“文件已删除”。media-worker 的独立健康状态必须由 deploy.sh 验证，不能只检查 web `/healthz` 就算部署成功。

Cloudflare 规则只在部署阶段设置并验收：

- `/api/*` bypass cache，遵守 private/no-store，禁止全站 Cache Everything 或强制 TTL 覆盖私有头。
- `/media/` 严格规范 URL，任何 query 均阻断（应用也拒绝）；Cache Deception Armor 不覆盖此兼容路径。CDA 会比较扩展与 Content-Type，有部分例外，不能据此允许任意 MIME。[CDA](https://developers.cloudflare.com/cache/cache-security/cache-deception-armor/)
- 保留标准缓存键和无查询串契约；不加按 Cookie/Authorization 的变体或图片转换规则。若以后变动缓存键/变体，purge 范围和测试必须同步改。
- 为头像首次发布前的 404 响应检查 no-store，避免上传刚成功仍命中负缓存。
- 检查 4 MiB 上传正常、公开二次读取 CF-Cache-Status HIT、私有/签名入口不 HIT、查询串拒绝、真实 MIME、移除后边缘无旧公开 HIT。

公开媒体的现有 CDN 条款取舍沿用 A.2 用户决定，不重新增加批准流程。将来迁到 R2 要保留相同规范 URL 和 output key、媒体撤销规则与鉴权边界；不能把原件/私有桶无差别接公开 R2。

日志只记 requestId、userId、uploadId、状态、字节数、用时、内部 errorCode；不记原始文件名、session cookie、块内容、分享 token、S3/CF secrets。指标包括预约/实际字节、接收/处理队列年龄、失败率、dead 数、purge 未完成数、GC/备份最后成功时间；本批提供结构化日志和状态命令，不顺带建设监控平台。

## 15. 资料页交互和客户端边界

资料页当前头像旁加“更换头像”“移除头像”。选择文件后立即本地 object URL 预览，显示类型/8 MiB 限制；随后状态为“计算校验值 → 上传 n% → 处理中 → 可保存”。保存前服务器预览用已处理 JPEG，默认裁切是中心方形，本批不增加交互裁剪编辑器。头像保存和现有昵称/简介表单独立，不因为昵称校验失败丢弃已上传头像。

上传 progress 以服务器登记 ready 的片计数；重新进入当前页时 localStorage 只保存 uploadId、文件 name/size/hash 和到期时间，不保存文件字节/token，且按 userId 隔离。续传需要重新选择同一文件并重新验证完整 hash，服务器列出的 ready parts 才可跳过。退出账号时清本机恢复记录。浏览器关闭不假装后台继续上传。

处理状态每两秒轮询，超过一分钟退到五秒；切后台暂停，重回前台立即查询，终态停止。取消中止请求并调用 DELETE；服务端 24h TTL 是最后兜底。任何上传/处理失败仍保留现有头像，显示可操作错误；image 加载错误回退现有 SVG，读屏与现有 aria-hidden 约定一致。保存冲突提示资料已在另一处更新并重新取头像，不自动覆盖。

新增文案同步 zh/en/ja，沿用 Paraglide；API 错误按 code 翻译，不把服务端技术异常直接显示。修改 `Avatar` 的全部调用处以及 MyProfile DTO/queries，不能只让资料页显示图片而账号菜单仍用默认头像。

## 16. 验收与实施划分

本设计确认后单独写实施计划，不在本次改代码/依赖/服务器。推荐按三个可独立验收的步骤规划：

1. 存储与数据基础：迁移、S3 适配、额度预约、上传/续传/受限秒传、通用读取契约、compose/env/队列、原件备份；用受限内部 fixtures 验证大文件。
2. 头像业务：sharp/flow、user_avatars、资料页保存/移除、全站图片组件、注销、public/private 缓存边界。
3. 完整故障与运维验收：重试/死信/GC/purge 竞态、备份恢复、目标镜像和真实 Cloudflare 边缘验证。通过后才部署对外开放头像入口。

必须覆盖的有意义验证：

- 真 PG/pg-boss：预约并发不会超额，事务回滚无 flow，complete 幂等，父失败子任务终态收敛，进程被杀后恢复，GC vs 新引用/同 hash 新写互不误删。两份不同原件产生同一个 JPEG hash，验证只有一个 derived_object/一份物理预算；清一个来源后另一个头像仍可读，清最后来源后才进入独立 orphan 宽限；旧 DELETE 与另一来源新 PUT/附着竞争不会误删。
- 真 Seaweed：带/不带正确凭据，put/get/head/range/copy/delete，断流与重启，SDK checksum 兼容，现选 image 的配置及数据重启不丢失。Seaweed 官方列出的 API 支持不替代目标版本测试。[S3 API](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)
- 上传 HTTP：超声明/超实际长度、无 Content-Length、坏 hash、乱序/缺块/同片竞争、取消时 in-flight put、他人 id 404、非精确路由仍 64 KiB、Cookie Origin/类型拒绝、Bearer 可用。
- 安全图像 fixtures：EXIF/GPS orientation、CMYK/透明 PNG、巨大像素、小文件解码炸弹、损坏 JPEG、SVG 伪扩展、动画 WebP/AVIF；输出真实 JPEG、无 metadata、尺寸和大小达标。
- 权限：公开派生不能推出/下载私有原件，无资格秒传不暴露存在性，文件 metadata/id/ETag/Range 不能绕过 owner/状态/黑名单；注销期间缓存撤销、取消恢复、最终匿名内容保留的 FK 约束。
- 缓存：404/private/error no-store，无 Set-Cookie/用户变体，query 禁用；共享输出的最后有效公开引用撤销有 durable outbox；只有当前 generation drain acknowledged、两次间隔至少5秒的 purge success、两次间隔至少5秒的规范URL匿名404且非旧200/HIT probe 和最终锁下复核全部满足才 private。覆盖任一步网络错/200/HIT/超时维持 revoking、单轮≤60秒、origin drain+缓存填充竞态；明确只核实观测点、浏览器副本不可撤回。
- UI：进度/重选续传/取消/处理失败保旧/跨账号恢复隔离/expectedRevision 冲突/三语/全部头像调用回退；在现有测试框架验证，不顺带新增浏览器 E2E 平台。
- 运维：现有 community check/build 与针对修改的 ops/http 检查、生产镜像 native sharp 加载和处理、匿名 S3 拒绝、生产真实路径验收、全新卷备份恢复。只在实际运行后写“通过”，本稿没有测试或部署完成结论。

### 仍需在完整设计确认时看清的边界

本次提出的可检查选择是：头像公开、原件私有；8 MiB/32 MiB 与单机预算；中心裁切 JPEG 且首批不支持动画/裁剪 UI；头像平台导入留作下一批；曾公开照片无法撤回已有浏览器副本；备份留存到既有窗口自然淘汰。它们不是用户在旧 A.2 中逐条确认过的数值或行为。

库版本、具体增量 SHA-256 包、Seaweed 稳定镜像 digest、g510 实际容量、prefix ACL 与 native sharp/SDK 兼容验证都是实施者必须落实的技术检查，不需要再让用户决定。本稿不把未经运行的配置示例当作已经部署的现状。

## 17. 资料来源与证据说明

资料检索时间为 2026-10-10；本地代码核实以当前工作区为准，没有连接服务器或修改 Cloudflare。

SeaweedFS、sharp、pg-boss、Cloudflare 和 AWS SDK 均做了 Context7 文档获取；Context7 对 pg-boss 仅检索到 DeepWiki，因此其 flow/事务结论另以官方文档、12.35.0 上游源码和本地安装类型交叉确认，不把 DeepWiki 当 primary 证据。上文各结论旁的链接均指向官方项目/文档。

主要官方链接：

- [SeaweedFS mini 启动与版本默认值](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini)
- [SeaweedFS 凭据优先级与单向认证](https://github.com/seaweedfs/seaweedfs/wiki/S3-Credentials)
- [SeaweedFS 支持的 S3 API](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)
- [pg-boss flow](https://pgboss.io/api/jobs#flow-jobs-options)、[事务适配器](https://pgboss.io/api/adapters#drizzle)、[本仓库版本类型](https://github.com/timgit/pg-boss/blob/12.35.0/src/types.ts)
- [sharp 输入安全选项](https://sharp.pixelplumbing.com/api-constructor/)、[metadata/输出/timeout](https://sharp.pixelplumbing.com/api-output/)、[native 安装支持](https://sharp.pixelplumbing.com/install/)
- [Cloudflare 缓存默认规则与大小上限](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)、[CDA](https://developers.cloudflare.com/cache/cache-security/cache-deception-armor/)、[purge](https://developers.cloudflare.com/cache/how-to/purge-cache/)、[查询串缓存级别](https://developers.cloudflare.com/cache/how-to/set-caching-levels/)
- [AWS SDK v3 endpoint/流/checksum 配置](https://github.com/aws/aws-sdk-js-v3/blob/main/supplemental-docs/CLIENTS.md)
