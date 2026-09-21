# 构建上下文是仓库根（见 compose.yaml 的 context: ../..），因为 bun workspaces
# 的 lockfile 在根上，只拷 apps/dash 装不出依赖。仓库根还有一份 .dockerignore，
# 专门挡住 apps/dash/.env（部署时会写进 GitHub App 私钥的地方）之类的文件——
# 但下面按文件名显式 COPY，而不是整目录 COPY apps/dash/，是第二道独立的防线：
# 就算哪天 .dockerignore 被误删，这里也不会把 .env 拷进镜像层，因为它压根没
# 被列进来。两道防线都要留着，不要图省事合并成一道。

# 只借它的 node 二进制：SPA 预渲染在 bun 的 node 兼容 shim
# （/usr/local/bun-node-fallback-bin/node，其实是 bun 自己伪装的）下跑
# entry.server.tsx 会失败，构建卡在
#   "SPA Mode: Received a 500 status code from `entry.server.tsx`
#    while prerendering your SPA Fallback HTML file."
# 换成这个阶段里的真 Node 二进制就能跑通。这个阶段本身不装依赖、不跑构建，
# 只是拿来源文件用的，不会拖慢关心层缓存的其它步骤。
FROM node:22-slim AS realnode

FROM oven/bun:1.3.14 AS builder
WORKDIR /repo

# 必须放在 bun install / bun run build 之前，且落在 /usr/local/bin——bun 官方
# 镜像把 /usr/local/bun-node-fallback-bin 追加在继承的 PATH 末尾
# （见 oven-sh/bun 仓库 dockerhub/*/Dockerfile 里的
# `ENV PATH "${PATH}:/usr/local/bun-node-fallback-bin"`），而 /usr/local/bin
# 在基础 Debian 镜像里本来就排在 PATH 前面，所以 /usr/local/bin/node 会先于
# fallback shim 被解析到。不要把这步挪到 build 之后，也不要"优化"掉整个
# realnode 阶段——上面这条 entry.server.tsx 500 就是删掉它之后会复现的故障，
# 而且只有在真实部署容器里才会现形，本地 `bun run build`（Mac 上没有这个 shim
# 问题）测不出来。
COPY --from=realnode /usr/local/bin/node /usr/local/bin/node

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
