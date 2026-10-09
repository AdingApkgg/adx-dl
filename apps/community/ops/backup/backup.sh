#!/usr/bin/env bash
# 在 backup 容器里跑（docker compose run --rm backup；g510 上的 systemd 定时器每天 03:30 触发，spec 第 12.5 节）：
#   1. community、umami 两个库各 pg_dump -Fc 一份（连接参数在 PGHOST、PGUSER、PGPASSWORD 里）；
#   2. 交给 restic 加密、去重，存进本机的仓库（compose 把宿主机的 BACKUP_REPO_DIR 挂到 /restic）；
#   3. restic forget --prune：保留 7 份每日、4 份每周、6 份每月。
# 哪一步失败就停在哪一步，退出码不是 0（systemd 里这一次就是 failed）：只要有一个库没导出来，就不做这一次快照。
# 仓库要先手工 restic init（上线手册）：这里不自动建，路径或密码设错时宁可报错，也不悄悄换成一个新仓库。
set -euo pipefail

DUMP_DIR="${DUMP_DIR:-/dumps}"
# 主机名和路径都固定：forget 按（主机，路径）分组算保留的份数。容器每次的主机名都不一样，不固定的话，
# 每个快照自成一组，一份也不会被清掉。
HOST_TAG="astrodx-community"

if [ -z "${RESTIC_PASSWORD:-}" ]; then
  echo "RESTIC_PASSWORD 未设置：在 .env 里填上（同时存进密码管理器）" >&2
  exit 1
fi
if ! restic cat config > /dev/null; then
  echo "打不开 restic 仓库 ${RESTIC_REPOSITORY:-}：还没 restic init，或者密码不对、BACKUP_REPO_DIR 设错了" >&2
  exit 1
fi

mkdir -p "$DUMP_DIR"
for db in community umami; do
  pg_dump --format=custom --dbname="$db" --file="$DUMP_DIR/$db.dump"
  echo "pg_dump $db: $(wc -c < "$DUMP_DIR/$db.dump" | tr -d ' ') bytes"
done

restic backup --host "$HOST_TAG" --tag community-db "$DUMP_DIR"
restic forget --host "$HOST_TAG" --tag community-db --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 6
