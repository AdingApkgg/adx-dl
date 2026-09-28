# 构建上下文是仓库根目录（bun.lock 在根目录）：
#   docker build -f apps/community/Dockerfile .
# Bun ≥ 1.4 允许 --frozen-lockfile 时其他 workspace 的目录不存在，所以只复制根清单和本应用的清单。

FROM oven/bun:1.4.2 AS builder
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/community/package.json apps/community/
COPY patches/ patches/
RUN bun install --frozen-lockfile --filter community
# 只按白名单复制源码，不整目录复制，避免把 .env 带进镜像层。
COPY apps/community/tsconfig.json apps/community/react-router.config.ts apps/community/vite.config.ts apps/community/
COPY apps/community/project.inlang/settings.json apps/community/project.inlang/
COPY apps/community/messages apps/community/messages
COPY apps/community/src apps/community/src
WORKDIR /repo/apps/community
# 构建时 Vite 插件把文案编译进 src/paraglide/，插件从 node_modules 加载，不连 CDN。
RUN bun run build

# 服务端渲染的构建产物不打包依赖（只打包了 react-router-hono-server），
# 所以运行阶段要自己装生产依赖，不能照搬 dash 的单文件做法。
FROM oven/bun:1.4.2-slim AS runner
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/community/package.json apps/community/
COPY patches/ patches/
RUN bun install --frozen-lockfile --production --filter community
COPY --from=builder /repo/apps/community/build apps/community/build
# worker 和迁移直接用 Bun 跑 TypeScript 源码：需要 src（SQL 迁移文件在里面）和
# tsconfig（@/ 路径别名）。src 从构建阶段复制，因为编译好的文案 src/paraglide/
# 只在那里有（它不入库）。
COPY apps/community/tsconfig.json apps/community/
COPY --from=builder /repo/apps/community/src apps/community/src
WORKDIR /repo/apps/community
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
# 静态资源的路径相对于当前目录，所以必须在 apps/community 下启动。
CMD ["bun", "./build/server/index.js"]
