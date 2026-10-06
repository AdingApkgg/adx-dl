#!/bin/sh
# 生产库第一次启动、数据目录还是空的时候，postgres 镜像执行这里的脚本（compose.yaml 把这个目录挂到
# /docker-entrypoint-initdb.d）。建 Umami 的角色和库（spec 第 9.1 节：一个实例两个库，每个库一个角色）。
# 以后再启动不会再执行：数据目录已经有了。
#
# 密码从环境变量 UMAMI_DB_PASSWORD 来，用 psql 的 \getenv 取进变量再引用：不出现在命令行（ps 看得到）和输出里。
set -eu

if [ -z "${UMAMI_DB_PASSWORD:-}" ]; then
  echo "UMAMI_DB_PASSWORD 未设置：先运行 ops/fill-secrets.sh" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv umami_password UMAMI_DB_PASSWORD
CREATE ROLE umami LOGIN PASSWORD :'umami_password';
CREATE DATABASE umami OWNER umami;
SQL
