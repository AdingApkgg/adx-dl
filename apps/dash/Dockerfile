# 构建上下文是仓库根（见 compose.yaml 的 context: ../..），因为 bun workspaces
# 的 lockfile 在根上，只拷 apps/dash 装不出依赖。
FROM oven/bun:1.3.14 AS builder
WORKDIR /repo

# 先只拷清单，让依赖层能被缓存住：改源码不必重装依赖。
COPY package.json bun.lock ./
COPY apps/dash/package.json apps/dash/
COPY apps/web/package.json apps/web/
COPY packages/maimai-chart-engine/package.json packages/maimai-chart-engine/
COPY patches/ patches/
RUN bun install --frozen-lockfile

COPY apps/dash/ apps/dash/
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
