# 备份用的一次性容器（spec 第 12.5 节）：postgres:18 自带和库同版本的 pg_dump，再从 restic 的官方镜像拷一个
# 静态编译的 restic 进来，不用 apt 装（g510 在国内，连 Debian 的源不稳）。由 compose.yaml 的 backup 服务构建。
FROM restic/restic:0.19.1 AS restic

FROM postgres:18
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
