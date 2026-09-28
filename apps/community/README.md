# AstroDX 自制谱社区站

设计：`docs/superpowers/specs/2026-09-28-community-foundation-design.md`（本机文件）。

## 本机开发

```bash
cd apps/community
docker compose -f compose.dev.yaml up -d   # PG 18（127.0.0.1:55432）和 Redis 8（127.0.0.1:56379）
cp .env.example .env
bun run db:migrate
bun run dev                                # http://localhost:5373
bun run worker                             # 另开一个终端，需要后台任务时
```

## 检查和测试

```bash
bun run check        # lint、编译文案、生成路由类型、类型检查、单元与集成测试（需要 compose.dev 的服务在运行）
bun run build
bun run test:http    # 启动构建产物，做页面和接口的 HTTP 级测试
```

集成测试默认连 `compose.dev.yaml` 起的测试库 `community_test` 和 Redis；
用 `TEST_DATABASE_URL`、`TEST_REDIS_URL` 可以改。

## 目录约定

- `src/server`：Hono 应用、接口、数据库、Redis、任务队列。
- `src/client`：React Router 应用。**不能引用 `src/server`**（Biome 会报错），
  唯一例外是 `import type` 自 `@/server/api/app-type`。
- `src/shared`：两边都要用的代码，不能引用 `src/server` 和 `src/client`。
- `src/worker`：pg-boss 的 worker 进程，和网页用同一个镜像。
- `src/paraglide`：Paraglide 编译出的文案函数，不入库，不要手改。

## 多语言

- 文案在 `messages/{zh,en,ja}.json`，以 `zh.json` 为准。键只用小写字母、数字和下划线，按功能加前缀（如 `settings_profile_title`）。
- 代码里 `import { m } from "@/paraglide/messages.js"`，调用 `m.settings_profile_title()`；带参数的写成 `m.reply_count({ count })`。
- `bun run dev` 和 `bun run build` 会自动编译文案；`bun run check`、`bun run test` 会先跑 `bun run i18n`。
- 改了文案要重启 `bun run dev`：用 Bun 跑 Vite 时，Paraglide 的热更新不生效（opral/paraglide-js#609）。
- 漏翻译不会报类型错误，`src/shared/i18n/messages.test.ts` 会检查三种语言的键和参数是否一致。
- 切换语言一律整页跳转。服务端渲染只用 `react-dom/server.edge`（原因写在 `src/client/entry.server.tsx`）。

## 数据库迁移

```bash
bun run db:generate   # 改了 src/server/db/schema 之后生成 SQL 迁移（写到 src/server/db/migrations），提交进仓库
bun run db:migrate    # 执行 Drizzle 迁移，并建好 pg-boss 的表
```

迁移只做向后兼容的改动（spec 第 9.3 节）。
