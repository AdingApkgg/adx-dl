# 构建上下文是仓库根目录（bun.lock 在根目录）：
#   docker build -f apps/community/Dockerfile .
# Bun ≥ 1.4 允许 --frozen-lockfile 时其他 workspace 的目录不存在，所以只复制根清单、本应用的清单，以及本应用依赖的
# 两个工作区包（@astrodx/ui、@astrodx/tsconfig）的清单：少一个就报 "listed in bun.lock but not on disk"，
# 只装生产依赖的运行阶段也一样。

FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS builder
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/community/package.json apps/community/
COPY packages/ui/package.json packages/ui/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/maimai-chart-engine/package.json packages/maimai-chart-engine/
COPY patches/ patches/
RUN bun install --frozen-lockfile --filter community
# 只按白名单复制源码，不整目录复制，避免把 .env 带进镜像层。
COPY apps/community/tsconfig.json apps/community/react-router.config.ts apps/community/vite.config.ts apps/community/
COPY apps/community/project.inlang/settings.json apps/community/project.inlang/
COPY apps/community/messages apps/community/messages
COPY apps/community/public apps/community/public
COPY apps/community/src apps/community/src
COPY apps/community/ops/backup/*.ts apps/community/ops/backup/
COPY apps/community/ops/seaweed/*.ts apps/community/ops/seaweed/
COPY apps/community/ops/charts/*.ts apps/community/ops/charts/
# tsconfig 继承 @astrodx/tsconfig；共享界面包只放源码，构建时打进产物。
COPY packages/tsconfig/base.json packages/tsconfig/
COPY packages/ui/tsconfig.json packages/ui/
COPY packages/ui/src packages/ui/src
COPY packages/maimai-chart-engine/src packages/maimai-chart-engine/src
WORKDIR /repo/apps/community
# 构建时 Vite 插件把文案编译进 src/paraglide/，插件从 node_modules 加载，不连 CDN。
RUN bun run build \
    && test -s build/client/favicon.ico \
    && test -s build/client/opengraph-image.png

# 服务端渲染的构建产物只把生产依赖（dependencies）留给运行时 import（test/http/build-output.test.ts 检查），
# 其余的都打进了产物：react-router-hono-server、共享界面包和它用到的库。所以运行阶段要自己装生产依赖，
# 不能照搬 dash 的单文件做法；devDependencies 不装。@astrodx/ui 是社区站的 devDependency，它整棵依赖树
# （包括它依赖的 shadcn CLI）都不装。
FROM oven/bun:1.4.5-slim@sha256:b780593f3e10918cbdaec3d5a08d52224b9198069a65eb47812085c2ec007643 AS runner
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/community/package.json apps/community/
COPY packages/ui/package.json packages/ui/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/maimai-chart-engine/package.json packages/maimai-chart-engine/
COPY patches/ patches/
RUN bun install --frozen-lockfile --production --filter community
COPY --from=builder /repo/apps/community/build apps/community/build
# worker 和迁移直接用 Bun 跑 TypeScript 源码：需要 src（SQL 迁移文件在里面）和
# tsconfig（@/ 路径别名）。src 从构建阶段复制，因为编译好的文案 src/paraglide/
# 只在那里有（它不入库）。
COPY apps/community/tsconfig.json apps/community/
# 上面的 tsconfig 继承 @astrodx/tsconfig（在 dependencies 里，bun install 链接了它），它的 base.json 也要在。
COPY packages/tsconfig/base.json packages/tsconfig/
COPY --from=builder /repo/apps/community/src apps/community/src
COPY packages/maimai-chart-engine/src packages/maimai-chart-engine/src
COPY apps/community/ops/backup/*.ts apps/community/ops/backup/
COPY apps/community/ops/seaweed/*.ts apps/community/ops/seaweed/
COPY apps/community/ops/charts/*.ts apps/community/ops/charts/
WORKDIR /repo/apps/community
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
# 静态资源的路径相对于当前目录，所以必须在 apps/community 下启动。
CMD ["bun", "./build/server/index.js"]
