# 构建上下文是仓库根（见 compose.yaml 的 context: ../..），因为 bun workspaces
# 的 lockfile 在根上，只拷 apps/dash 装不出依赖。仓库根还有一份 .dockerignore，
# 专门挡住 apps/dash/.env（部署时会写进 GitHub App 私钥的地方）之类的文件——
# 但下面按文件名显式 COPY，而不是整目录 COPY apps/dash/，是第二道独立的防线：
# 就算哪天 .dockerignore 被误删，这里也不会把 .env 拷进镜像层，因为它压根没
# 被列进来。两道防线都要留着，不要图省事合并成一道。
FROM oven/bun:1.3.14 AS builder
WORKDIR /repo

# 先只拷清单，让依赖层能被缓存住：改源码不必重装依赖。
COPY package.json bun.lock ./
COPY apps/dash/package.json apps/dash/
COPY apps/web/package.json apps/web/
COPY packages/maimai-chart-engine/package.json packages/maimai-chart-engine/
COPY patches/ patches/
RUN bun install --frozen-lockfile

# 显式白名单：只列构建 (`bun run build` / `bun run build:server`) 真正会读到的
# 文件。不包含 .env、.gitignore、build/、dist/、.react-router/、node_modules ——
# 这些要么是生成物（构建自己会产出），要么是密钥/元数据，本来就不该出现在
# 镜像里的任何一层。
COPY apps/dash/tsconfig.json apps/dash/react-router.config.ts apps/dash/vite.config.ts apps/dash/bun-test.d.ts apps/dash/
COPY apps/dash/src apps/dash/src
WORKDIR /repo/apps/dash
RUN bun run build
RUN bun run build:server

FROM oven/bun:1.3.14-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# 打包成单文件（0.40 MB），不拷 node_modules。src/server/main.ts 默认导出
# { port, fetch }，Bun 直接识别并起服务，不需要 Bun.serve。
COPY --from=builder /repo/apps/dash/dist/server.js ./server.js
COPY --from=builder /repo/apps/dash/build/client ./build/client

EXPOSE 3000
CMD ["bun", "run", "server.js"]
