# AstroDX 自制谱社区站

设计：`docs/superpowers/specs/2026-09-28-community-foundation-design.md`（本机文件）。

## 本机开发

```bash
cd apps/community
docker compose -f compose.dev.yaml up -d   # PG 18（127.0.0.1:55432）和 Redis 8（127.0.0.1:56379）
cp .env.example .env && ops/fill-secrets.sh  # 补上随机密钥（只打印变量名）；再填 Google 的两项，见下
bun run db:migrate
bun run dev                                # http://localhost:5373
bun run worker                             # 另开一个终端：注销的清除、每天的补投和过期会话清理、QQ 机器人都在这里
```

### 账号相关的配置

- 随机密钥（`BETTER_AUTH_SECRET`、`QQ_CODE_HMAC_KEY` 等）：`ops/fill-secrets.sh` 只填还空着的项，已有的不动，只打印变量名。
- Google：在 Google Cloud Console 建一个 OAuth 客户端（类型选 Web application），
  Authorized redirect URIs 填 `http://localhost:5373/api/auth/callback/google`，把 Client ID 和 Secret 填进 `.env`。
- Turnstile：`.env.example` 里已经是 Cloudflare 官方的测试密钥（总是通过），本机不用改。
- QQ：本机用 `QQ_SENDER=console`，验证码直接打印在 `bun run dev` 的终端里，不需要机器人。
  要接真的 NapCat，把 `QQ_SENDER` 改成 `napcat` 并填上 `NAPCAT_*` 四项，再跑 `bun run worker`
  （它负责自动通过好友申请、每分钟检查机器人是否在线）。NapCat 的部署在 1d。
- 浏览器一定用 `http://localhost:5373` 打开：通行密钥不认 `127.0.0.1`。

## 检查和测试

```bash
bun run check        # lint、编译文案、生成路由类型、类型检查、单元与集成测试（需要 compose.dev 的服务在运行），最后是交互测试
bun run test:dom     # 只跑交互测试（vitest）
bun run build
bun run test:http    # 启动构建产物，做页面和接口的 HTTP 级测试，并检查构建产物只 import 生产依赖
```

`test:http` 启动的构建产物用同一个 Redis 的 1 号库（每次启动前清空）：`napcat:health`、`rl:*` 是固定的键名，
和开发服务器（0 号库）共用会互相串。

部署和备份的 shell 脚本（`deploy.sh`、`ops/*.sh`）的测试在 `test/ops`：把脚本拷进临时目录，`PATH` 最前面放一组假的
`git`、`docker`、`curl`、`pg_dump`、`restic`（`test/ops/fake-commands.ts`），只看脚本按什么顺序调了什么，不连 Docker、
不碰数据库。`check` 和 `test` 脚本都跑它们。

集成测试默认连 `compose.dev.yaml` 起的测试库 `community_test` 和 Redis；
用 `TEST_DATABASE_URL`、`TEST_REDIS_URL` 可以改。

测试库每轮重建：每个 `bun test` 进程第一次用到数据库时，会删掉测试库里的表、重新跑一遍迁移
（`src/server/testing/test-db.ts`）。所以 `TEST_DATABASE_URL` 必须指向名字以 `_test` 结尾的专用测试库
（库名不对时直接报错，不会动它）；也不要同时跑两轮测试：每轮都会先重建测试库。
各测试文件之间的数据会留着，测试里的用户、QQ 号一律用随机值。
测试不连外网：Google、Cloudflare、NapCat 都用替身或本机起的假服务。

要投递任务的测试用 `testSender()`（`src/server/testing/test-boss.ts`）：它在测试库重建之后再建 pg-boss 的表和队列
（重建会删掉整个 pgboss schema）。测试里不启动 worker，清除任务的处理函数直接调用。

数据库在远端（比如经 SSH 隧道）时往返慢：`test`、`check`、`test:http` 脚本已经带了 `--timeout 30000`，单独跑某个测试文件时也加上。

交互测试（页头、设置面板、语言切换、语言不一致提示、toast）在 `test/dom`，用 vitest 在 happy-dom 里点和按键，
配置是 `vitest.config.ts`（不用 `vite.config.ts`，那里的插件不该在测试里跑）。vitest 跑在 Node 上，用 Node 24
（vitest 要求 ^22.12、^24 或 >=26），CI 也用 24。其余测试照旧用 `bun test`：脚本只给它 `src`、`test/ops` 和 `test/http` 这几个路径，它扫不到 `test/dom`；
在这个目录下直接跑不带参数的 `bun test` 会把交互测试也拉进来，跑不通。

## 目录约定

- `src/server`：Hono 应用、接口、数据库、Redis、任务队列。
- `src/client`：React Router 应用。**不能引用 `src/server`**（Biome 会报错），
  例外是 `import type` 自 `@/server/api/app-type` 和 `@/server/auth/auth-type`（都只有类型）。
- `src/shared`：两边都要用的代码，不能引用 `src/server` 和 `src/client`，
  例外和 `src/client` 一样：`import type` 自 `@/server/api/app-type` 和 `@/server/auth/auth-type`（都只有类型）。
- `src/worker`：pg-boss 的 worker 进程，和网页用同一个镜像。
- `src/paraglide`：Paraglide 编译出的文案函数，不入库，不要手改。

## 多语言

- 文案在 `messages/{zh,en,ja}.json`，以 `zh.json` 为准。键只用小写字母、数字和下划线，按功能加前缀（如 `settings_profile_title`）。
- 代码里 `import { m } from "@/paraglide/messages.js"`，调用 `m.settings_profile_title()`；带参数的写成 `m.reply_count({ count })`。
- `bun run dev` 和 `bun run build` 会自动编译文案；`bun run check`、`bun run test` 会先跑 `bun run i18n`。
- 改了文案要重启 `bun run dev`：用 Bun 跑 Vite 时，Paraglide 的热更新不生效（opral/paraglide-js#609）。
- 漏翻译不会报类型错误，`src/shared/i18n/messages.test.ts` 会检查三种语言的键和参数是否一致。
- 切换语言一律整页跳转。服务端渲染只用 `react-dom/server.edge`（原因写在 `src/client/entry.server.tsx`）。

## 界面

- 样式是 Tailwind 4（`@tailwindcss/vite`）加共享界面包 `@astrodx/ui`（`packages/ui`）。入口是 `src/client/app.css`：
  先引 `tailwindcss` 和包的 `theme.css`，类名只从 `src/client` 里找（原因写在文件里）。
- 明暗模式、强调色、减少动画和 web 是同一套（localStorage 的键也一样，两个站的域名不同，各存各的）。
  防闪烁脚本带着本次请求的 nonce 内联在 `<head>` 里（`src/client/components/theme-boot-script.tsx`）。
- 组件从 `@astrodx/ui/components/<名字>` 引入；toast 用同一个文件转出的 `toast`。包里不放文字，界面上的文字一律走 Paraglide。
- 包里的类名也会进 web 的 CSS（`theme.css` 扫描整个包）。0b 加的 `Label`、`Alert` 只用了 web 已经有的类名；
  以后加组件，web 的 CSS 会多出它的类名。
- 加 shadcn 组件：在本目录跑 `../../packages/ui/node_modules/.bin/shadcn add <名字> --dry-run --view`，照它给出的内容
  在 `packages/ui/src/components/` 里手写，引用改成包内相对路径（`cn` 用 `../lib/utils`）。不加 `--dry-run` 时 CLI 报
  `lib`、`hooks` 两个别名解析不了，一个文件也不写。
- 服务端产物里只有 `dependencies` 留给运行时 import，其余都打进产物（包括 `@astrodx/ui`）。社区站自己的某个 devDependency
  要在服务端用到，就加进 `vite.config.ts` 的 `ssr.noExternal`；漏了的话 `test:http` 里的 `build-output.test.ts` 会报出来。

## 账号

- Better Auth 1.7.6 挂在 `/api/auth/*`，配置全在 `src/server/auth/auth.ts`。`better-auth` 和
  `@better-auth/passkey` 必须同版本、精确锁版本，一起升级。
- 会话只存 PG，不给 Better Auth 配 Redis 缓存：Redis 满了会淘汰键，可能只丢掉"这个用户有哪些会话"那个键，
  之后"退出其他设备"、删除用户就作废不了缓存里的旧会话（已经撤销的会话照样能用），而撤销必须立即生效；
  Redis 断线时还会全站 401。代价是每个带 Cookie 的请求多查一次 PG。
- 往 Better Auth 的表（`src/server/db/schema/auth.ts`）加列：列要可空或带默认值，并同步改
  `src/server/auth/fields.ts`（或插件的 `schema`）。Better Auth 启动时会逐列比对，对不上时所有认证请求都会失败。
- 登录方式列表、登录设备和踢下线用我们自己的 `/api/v1/me/*`；Better Auth 自带的会话列表、改资料等接口都关掉了
  （`disabledPaths`）。
- 敏感操作（解绑、绑定新的登录方式（Google、QQ）、删除或添加通行密钥、踢下线、退出其他设备）要求 10 分钟内刚登录过，错误码 `REAUTH_REQUIRED`，
  前端引导用户重新登录一次。
- Cookie 前缀 `adxc`、通行密钥的 rpID（站点域名，线上是 `adxc.saop.cc`）上线后都不能改：改了所有人要重新登录，
  已有的通行密钥全部失效。以后要是换域名，所有人都得重新添加通行密钥。
- Turnstile 用真实密钥时，服务端核对 siteverify 带回的 `hostname`（必须是 `PUBLIC_ORIGIN` 的主机名）和 `action`
  （发 QQ 验证码是 `qq-send-code`，通行密钥注册是 `passkey-sign-up`，见 `src/shared/turnstile-actions.ts`）；
  Cloudflare 的测试密钥回的是 `example.com`、没有 action，不核对。
- 换 Google 令牌这一步最多等 10 秒（`src/server/auth/google-timeout.ts`）：Better Auth 自己不设超时，g510 的代理出问题时
  回调会一直挂着。超时后跳回登录页，地址带 `error=invalid_code`。

## 资料和注销

- 昵称在 `user.name`，简介和"引导页看过没有"在 `profiles` 表（第一次写入时才建行）。规则在 `src/shared/nickname.ts`、
  `src/shared/bio.ts`，前后端共用。个人主页 `/u/<用户 id>` 公开、允许收录，旁边总显示用户 id（昵称可以重名）；
  注销中的账号例外：只显示"该用户正在注销"的占位页和用户 id，不公开昵称和简介，页面 `noindex`。
- 新用户登录后先到 `/onboarding`：确认昵称、选填简介、建议再加一种登录方式。点"完成"或"以后再说"后不再显示。
- 注销（`POST /api/v1/me/deletion`）要求 10 分钟内刚登录过，还要照着输入自己的用户 id。发起后账号立即进入
  "注销中"、所有会话失效，并投递一个 `user.purge` 任务：没有内容的账号立即清除，有内容的保留 7 天，期间重新登录
  可以撤销（`/account-deletion`）。冷静期里除了注销提示页本身，页面都跳到注销提示页；`/api/v1/*` 只放行
  `GET /api/v1/me`、`DELETE /api/v1/me/deletion`、`GET /api/v1/meta`、`GET /api/v1/login-options`、
  `GET /api/v1/users/:id` 五个请求（`HEAD` 同 `GET`），其余一律 403 `ACCOUNT_PENDING_DELETION`；Better Auth 里改账号的
  7 个接口（绑定、解绑、添加 / 改名 / 删除通行密钥、绑定 QQ，见 `src/server/auth/account-rules.ts`）也一样，登录和退出
  不受影响。白名单在 `src/server/middleware/pending-deletion.ts`。
- 以后的模块（谱面、论坛……）有用户数据时，在 `src/server/services/user-deletion.ts` 的 `DELETION_HANDLERS` 里加一个
  处理器：`hasContent` 决定要不要冷静期，`purge` 在清除的事务里执行，必须能重复执行。内容表指向作者的外键用
  `ON DELETE SET NULL`（spec 第 9.2 节）；`user-deletion.test.ts` 会检查所有指向 `user` 的外键都是 CASCADE 或 SET NULL。
- 最终清除在一个事务里：锁住用户行、确认"注销中且到了清除时间"、依次调处理器、删 profiles、删用户行（会话、绑定、
  通行密钥由外键级联删除）。撤销和清除都以这一行和数据库的时钟为准，所以同一个任务跑几遍、撤销和清除撞在一起都不会出错。
- `user.purge` 失败会按退避重试 8 次（约 3 到 4 小时），每次失败记 `user_purge_failed`（带用户 id），重试用完进死信队列
  `user.purge.dead`。worker 每天东八区 04:47 跑一次 `user.purge.sweep`：死信队列里有任务就记 `user_purge_dead_letters`；
  清除时间过了一小时还在"注销中"、又没有排队或执行中的清除任务的账号（任务进了死信、超过了保留期、被误删），重新投递一次
  `user.purge`，记 warn `user_purge_requeued`（只有数量）。所以一直清除失败的账号每天会再进一次死信。修好原因后，第二天的
  补投会接着清除；死信里的旧任务用 pg-boss 的 `redrive` 放回 `user.purge` 或者删掉都行（清除按用户行判断，多出来的任务什么也不做）。
- "至少保留一种登录方式"除了钩子里的检查（400 `LAST_LOGIN_METHOD`），数据库里还有一个提交时检查的约束触发器
  （迁移 `0003_login_method_guard.sql`），挡住两个并发的删除把人删到 0 种；撞上的那个请求得到 500。

## 数据库迁移

```bash
bun run db:generate                        # 改了 src/server/db/schema 之后生成 SQL 迁移（写到 src/server/db/migrations），提交进仓库
bun run db:generate --custom --name <名字>  # 只能手写的 SQL（触发器这类）：生成一个空的迁移文件，把 SQL 写进去
bun run db:migrate                         # 执行 Drizzle 迁移，建好 pg-boss 的表和队列（src/server/jobs/queues.ts）
```

迁移只做向后兼容的改动（spec 第 9.3 节）。队列也在 `db:migrate` 里建：部署时 web 和 worker 同时启动，
web 投递的队列必须已经在了。worker 启动时也会调一次 `ensureQueues`，但不能代替 `db:migrate`：两个进程同时起，
pg-boss 的表和队列还没建好时，web 的 `jobs` 就绪检查不过，`/readyz` 返回 503。已经存在的队列不会被改，
改队列的选项要另写一次性的 `updateQueue`（`policy` 改不了）。

**升级 pg-boss 要单独部署一次，先备份。** 它的 schema 只往上迁（12.35.0 是第 43 版）：`db:migrate` 和 worker 启动时会把库里
的 schema 升到新版本，但没有降级。升级之后再回滚到旧代码，网页进程的发送端会报 `pg-boss database requires migrations`
（`/readyz` 的 `jobs` 不过，注销投递不了），worker 则是旧代码跑在新 schema 上。这样的部署出了问题只能往前修，或者从备份恢复。

## 统计（Umami）

- 自托管的 Umami（compose 里的 `umami`）。管理后台是 `https://adxc-umami.saop.cc`，放在 Cloudflare Access 后面。
- 统计脚本和上报都走本站：页面里是 `<script src="/_s/script.js" data-host-url="/_s">`，tracker 把上报发到
  `data-host-url` 加 `/api/send`，也就是 `/_s/api/send`。Hono 只转发这两个地址给 `UMAMI_INTERNAL_URL`
  （`src/server/middleware/umami.ts`）：Umami 的登录、管理接口不经主站暴露。转发时访客 IP 取自 `CF-Connecting-IP`，
  Cookie、Authorization 不转发；上游的 Set-Cookie、CSP 不带回来。
- 开关是 `UMAMI_WEBSITE_ID`：空着时页面里没有脚本，`/_s/*` 返回 404，站点照常运行。在 Umami 后台建好网站以后，把网站 ID
  填进 `.env`，再 `docker compose up -d web`。
- 不记查询串和 `#` 后面的内容（`data-exclude-search`、`data-exclude-hash`），只在本站的域名上记（`data-domains`）。
- 自定义事件只有两个（spec 第 11.6 节），都不带用户 id 和任何个人信息：`login`（`{ method: "google" | "qq" | "passkey" }`）
  和 `onboarding_done`。登录成功以后是整页跳转，登录方式写在新地址的 `#login=…` 里，落地页的 `LoginEvent` 上报一次，
  再把它从地址里去掉（`src/client/lib/analytics.ts`、`src/client/components/login-event.tsx`）。

## 环境变量

`.env.example` 是完整的清单，每一项都有说明；`test/ops/env-example.test.ts` 检查应用读的、`compose.yaml` 用到的变量都在里面。
随机密钥由 `ops/fill-secrets.sh` 生成（只填空着的项，只打印变量名）。所有密钥在密码管理器里另存一份。

| 变量 | 本机开发 | g510（`compose.yaml`） | 谁来填 |
|---|---|---|---|
| `PUBLIC_ORIGIN` | `http://localhost:5373` | `https://adxc.saop.cc` | 手填 |
| `DATABASE_URL`、`REDIS_URL` | `compose.dev.yaml` 的地址 | compose 给出容器网络里的地址 | — |
| `PORT`、`HOST` | 默认 `127.0.0.1:3000` | 镜像里是 `0.0.0.0:3000` | — |
| `BETTER_AUTH_SECRET` | 必填 | 必填，上线后不能换（换了所有人要重新登录） | `ops/fill-secrets.sh` |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | 开发用的客户端 | 社区站自己的 Google Cloud 项目里的生产客户端 | 用户 |
| `TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY` | 官方测试密钥 | 真实密钥（域名 `adxc.saop.cc`） | 用户 |
| `HTTPS_PROXY` | 可选：本机连 Google 的代理 | 不填；用 `OUTBOUND_HTTPS_PROXY` | 用户 |
| `QQ_SENDER` | `console` | compose 定为 `napcat` | — |
| `QQ_CODE_HMAC_KEY` | 必填 | 必填 | `ops/fill-secrets.sh` |
| `NAPCAT_ACCESS_TOKEN` | `QQ_SENDER=napcat` 时 | 必填；也用来写 NapCat 的配置 | `ops/fill-secrets.sh` |
| `NAPCAT_BOT_QQ` | `QQ_SENDER=napcat` 时 | 必填：社区站专用的机器人小号 | 用户 |
| `NAPCAT_HTTP_URL`、`NAPCAT_WS_URL` | `QQ_SENDER=napcat` 时 | compose 给出 | — |
| `UMAMI_WEBSITE_ID` | 可选 | Umami 后台建好网站以后填，空着就不统计 | 用户 |
| `UMAMI_INTERNAL_URL` | 设了网站 ID 时 | compose 给出 `http://umami:3000` | — |
| `NAPCAT_WEBUI_TOKEN` | — | 必填：NapCat WebUI 第一次启动时的登录令牌 | `ops/fill-secrets.sh` |
| `POSTGRES_PASSWORD` | — | 必填，只在库第一次启动时生效，之后不能改 | `ops/fill-secrets.sh` |
| `UMAMI_DB_PASSWORD` | — | 同上（`ops/postgres-init/10-umami.sh` 建角色时用） | `ops/fill-secrets.sh` |
| `UMAMI_APP_SECRET` | — | 必填 | `ops/fill-secrets.sh` |
| `OUTBOUND_HTTPS_PROXY` | — | `http://host.docker.internal:20171`（宿主机上 v2rayA 的 HTTP 入口），空着就不用代理 | 用户 |
| `BACKUP_REPO_DIR` | — | restic 仓库在宿主机上的绝对路径 | 用户 |
| `RESTIC_PASSWORD` | — | restic 仓库的密码，同时存进密码管理器 | 用户 |

## 部署（g510）

`compose.yaml`（项目名 `astrodx-community`）里的服务：

| 服务 | 镜像 | 宿主机端口 | 说明 |
|---|---|---|---|
| `web` | 本仓库构建的 `astrodx-community:latest` | `127.0.0.1:12703` | 主站，cloudflared 把 `adxc.saop.cc` 转到这里 |
| `worker` | 同上 | 无 | pg-boss 任务和 NapCat 事件；停机最多等 45 秒（`main.ts` 自己等 30 秒） |
| `migrate` | 同上 | 无 | `profiles: [tools]`，`deploy.sh` 里 `docker compose run --rm migrate` |
| `napcat-config` | 同上 | 无 | NapCat 启动前按 `.env` 写它的 OneBot 配置，写完就退出 |
| `napcat` | `mlikiowa/napcat-docker:v4.18.32` | `127.0.0.1:12705`（WebUI） | 社区站专用的机器人；HTTP 3000、WebSocket 3001 只在内部网络 |
| `umami` | `ghcr.io/umami-software/umami:3.4.0` | `127.0.0.1:12704` | 管理后台经隧道对外（`adxc-umami.saop.cc`，Cloudflare Access） |
| `postgres` | `postgres:18` | 无 | `community`、`umami` 两个库，数据在卷 `pgdata` |
| `redis` | `redis:8` | 无 | 不持久化 |
| `backup` | `ops/backup/Dockerfile`（postgres:18 加 restic） | 无 | `profiles: [tools]`，systemd 定时器每天跑 |

- 端口一律只绑 127.0.0.1：g510 上的 cloudflared 跑在宿主机上，经回环地址连进来。绑到 0.0.0.0 等于让局域网绕过
  Cloudflare，还能自己带 `CF-Connecting-IP` 冒充访客的 IP（限流和登录设备都认这个头）。g510 上给 astrbot 用的 napcat
  容器（WebUI 在宿主机的 6099）和这里的 `napcat` 互不相干。
- **部署**：在 g510 的 `apps/community` 下 `./deploy.sh`。它只在 `pre` 分支上拉代码（`git pull --ff-only`），检查 compose
  的变量，构建，先跑迁移（失败就停，旧版本照常服务），再重启 web 和 worker，最后等 `/readyz`（最多 60 秒）。没就绪时打印
  回滚办法：`git checkout --detach <上一个提交> && ./deploy.sh --no-pull`。NapCat 和 Umami 不由它重启，要动它们时单独
  `docker compose up -d napcat`（或 `umami`）。
- `/readyz` 只回答本机的探针：带 `CF-Connecting-IP` 的请求（经 Cloudflare 来的）一律 404。
- **访问 Google 的代理**：`.env` 里 `OUTBOUND_HTTPS_PROXY=http://host.docker.internal:20171`，compose 把它作为
  `HTTPS_PROXY` 交给 web，`extra_hosts` 让容器里认得 `host.docker.internal`。不在 `.env` 里直接写 `HTTPS_PROXY`：
  执行 docker compose 的 shell 里要是设了同名变量，插值时会盖过 `.env`。Turnstile 和容器网络里的服务在 `NO_PROXY` 里。
- **第一次上线**的完整步骤（准备 `.env`、拉镜像、建库、NapCat 扫码、Umami 建站、Cloudflare 隧道和 Access、备份和恢复演练）
  在 `docs/superpowers/plans/2026-10-06-community-1d-launch.md` 的"上线手册"里（本机文件）。
- **NapCat**：第一次启动后用机器人的 QQ 扫码登录。在 Mac 上开一条 SSH 端口转发（`-L 12705:127.0.0.1:12705`），打开
  `http://127.0.0.1:12705/webui`，用 `.env` 里的 `NAPCAT_WEBUI_TOKEN` 登录（自己在终端里看，不要贴到别处）。之后重启用
  `ACCOUNT`（机器人 QQ 号）快速登录。OneBot 配置每次启动前由 `napcat-config` 按 `.env` 重写，WebUI 里改的网络配置会被
  盖掉。NapCat 的日志里有 WebUI 的令牌，贴日志之前先过滤掉。

### 每次改了部署相关的东西之后

在 g510 上（第 1–4 条）和 g510 之外（第 5–7 条）各查一遍，结果不对就当回归处理：

1. `curl -s http://127.0.0.1:12703/readyz`：`{"ok":true,"checks":{"db":"ok","redis":"ok","jobs":"ok"}}`。
2. `curl -s -o /dev/null -w '%{http_code}\n' -H 'cf-connecting-ip: 203.0.113.7' http://127.0.0.1:12703/readyz`：`404`。
3. `docker compose ps -a`：web 和 umami 是 `healthy`，worker、napcat、postgres、redis 在跑，napcat-config 是 `Exited (0)`。
4. `docker compose exec web printenv | grep -i proxy`：只有 `HTTPS_PROXY`（等于 `OUTBOUND_HTTPS_PROXY`）和 `NO_PROXY` 两行。
5. 局域网里的另一台机器：`curl -m 5 http://<g510 的局域网地址>:12703/healthz`（12704、12705 也一样）连不上。
6. `curl -s -o /dev/null -w '%{http_code}\n' https://adxc.saop.cc/readyz`、`…/_s/api/auth/login`（POST）：都是 `404`。
7. 没登录 Cloudflare Access 时打开 `https://adxc-umami.saop.cc/`：跳到 Access 的登录页。

## 备份和恢复

每天东八区 03:30，systemd 定时器（`ops/systemd/`）执行 `docker compose run --rm -T backup`：两个库各 `pg_dump -Fc` 一份，
交给 restic 存进 `BACKUP_REPO_DIR`，再 `restic forget --prune`（保留 7 份每日、4 份每周、6 份每月）。快照的主机名固定为
`astrodx-community`、标签 `community-db`。哪一步失败，这次备份就是 failed（`systemctl status astrodx-community-backup`）。

装一次（`RESTIC_PASSWORD`、`BACKUP_REPO_DIR` 先在 `.env` 里填好，目录先建好）：

```bash
cd <g510 上的 apps/community>
docker compose --profile tools build backup
docker compose run --rm -T --entrypoint restic backup init
for unit in astrodx-community-backup.service astrodx-community-backup.timer; do
  sed "s|@COMMUNITY_DIR@|$PWD|" "ops/systemd/$unit" | sudo tee "/etc/systemd/system/$unit" > /dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable --now astrodx-community-backup.timer
sudo systemctl start astrodx-community-backup.service      # 马上跑一次
journalctl -u astrodx-community-backup.service -n 50
docker compose run --rm -T --entrypoint restic backup snapshots
```

**恢复演练**（上线前做一次，之后定期做）：把最新的快照恢复到临时库 `community_restore_drill`，和线上的库比一比用户数，再删掉：

```bash
docker compose run --rm -T --entrypoint bash backup -c '
  set -euo pipefail
  restic restore latest --host astrodx-community --tag community-db --target /tmp/restore
  ls -l /tmp/restore/dumps
  createdb community_restore_drill
  pg_restore --no-owner --dbname=community_restore_drill /tmp/restore/dumps/community.dump
  echo "restored users: $(psql -d community_restore_drill -Atc "select count(*) from \"user\"")"
  echo "live users:     $(psql -d community -Atc "select count(*) from \"user\"")"
  dropdb community_restore_drill
'
```

两个数应当一样（备份之后新注册的用户除外）。`umami.dump` 同样可以这样恢复到临时库检查。

**真正的恢复**（库坏了、误删了数据）：先停 web 和 worker，用指定的快照（`restic snapshots` 里的 ID）重建库，再部署一次：

```bash
docker compose stop web worker
docker compose run --rm -T --entrypoint bash backup -c '
  set -euo pipefail
  restic restore <快照 ID> --target /tmp/restore
  dropdb --force community
  createdb community
  pg_restore --no-owner --dbname=community /tmp/restore/dumps/community.dump
'
./deploy.sh --no-pull
```
