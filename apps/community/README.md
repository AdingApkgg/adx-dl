# AstroDX 自制谱社区站

设计：`docs/superpowers/specs/2026-09-28-community-foundation-design.md`（本机文件）。

## 本机开发

```bash
cd apps/community
docker compose -f compose.dev.yaml up -d   # PG 18（127.0.0.1:55432）和 Redis 8（127.0.0.1:56379）
cp .env.example .env                       # 再填上 BETTER_AUTH_SECRET、QQ_CODE_HMAC_KEY 和 Google 的两项，见下
bun run db:migrate
bun run dev                                # http://localhost:5373
bun run worker                             # 另开一个终端，需要后台任务时
```

### 账号相关的配置

- `BETTER_AUTH_SECRET`、`QQ_CODE_HMAC_KEY`：各用 `openssl rand -base64 32` 生成一个。
- Google：在 Google Cloud Console 建一个 OAuth 客户端（类型选 Web application），
  Authorized redirect URIs 填 `http://localhost:5373/api/auth/callback/google`，把 Client ID 和 Secret 填进 `.env`。
- Turnstile：`.env.example` 里已经是 Cloudflare 官方的测试密钥（总是通过），本机不用改。
- QQ：本机用 `QQ_SENDER=console`，验证码直接打印在 `bun run dev` 的终端里，不需要机器人。
  要接真的 NapCat，把 `QQ_SENDER` 改成 `napcat` 并填上 `NAPCAT_*` 四项，再跑 `bun run worker`
  （它负责自动通过好友申请、每分钟检查机器人是否在线）。NapCat 的部署在 1d。
- 浏览器一定用 `http://localhost:5373` 打开：通行密钥不认 `127.0.0.1`。

## 检查和测试

```bash
bun run check        # lint、编译文案、生成路由类型、类型检查、单元与集成测试（需要 compose.dev 的服务在运行）
bun run build
bun run test:http    # 启动构建产物，做页面和接口的 HTTP 级测试
```

集成测试默认连 `compose.dev.yaml` 起的测试库 `community_test` 和 Redis；
用 `TEST_DATABASE_URL`、`TEST_REDIS_URL` 可以改。

测试库每轮重建：每个 `bun test` 进程第一次用到数据库时，会删掉测试库里的表、重新跑一遍迁移
（`src/server/testing/test-db.ts`）。所以 `TEST_DATABASE_URL` 必须指向名字以 `_test` 结尾的专用测试库
（库名不对时直接报错，不会动它）；也不要同时跑两轮测试：每轮都会先重建测试库。
各测试文件之间的数据会留着，测试里的用户、QQ 号一律用随机值。
测试不连外网：Google、Cloudflare、NapCat 都用替身或本机起的假服务。

数据库在远端（比如经 SSH 隧道）时往返慢：`test`、`check`、`test:http` 脚本已经带了 `--timeout 30000`，单独跑某个测试文件时也加上。

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
- Cookie 前缀 `adxc`、通行密钥的 rpID（站点域名）上线后都不能改：改了所有人要重新登录，已有的通行密钥全部失效。

## 数据库迁移

```bash
bun run db:generate   # 改了 src/server/db/schema 之后生成 SQL 迁移（写到 src/server/db/migrations），提交进仓库
bun run db:migrate    # 执行 Drizzle 迁移，并建好 pg-boss 的表
```

迁移只做向后兼容的改动（spec 第 9.3 节）。
