#!/usr/bin/env bash
# g510 上的部署（spec 第 12.4 节）。在 apps/community 下执行：./deploy.sh
#   1. 拉 pre 分支（git pull --ff-only）；
#   2. 检查 compose 的变量（缺了直接报出来），构建镜像；
#   3. 跑迁移（docker compose run --rm migrate），失败就停：web 和 worker 不动，旧版本照常服务；
#   4. 重启 web 和 worker；
#   5. 轮询 /readyz，最多 READY_TIMEOUT 秒（默认 60）。没就绪就打印回滚办法。
# 回滚：git checkout --detach <上一个提交>，再 ./deploy.sh --no-pull（不拉代码，按当前检出的提交重建）。迁移只做
# 向后兼容的改动（spec 第 9.3 节），回滚代码是安全的。
# NapCat 和 Umami 不在这里重启：NapCat 重启可能要重新扫码登录 QQ；Umami 升级要先看它的更新说明。
set -euo pipefail

cd "$(dirname "$0")"

READY_URL="${READY_URL:-http://127.0.0.1:12703/readyz}"
READY_TIMEOUT="${READY_TIMEOUT:-60}"

pull=1
case "${1:-}" in
  "") ;;
  --no-pull) pull=0 ;;
  *)
    echo "用法：./deploy.sh [--no-pull]" >&2
    exit 2
    ;;
esac

if [ ! -f .env ]; then
  echo ".env 不存在：先 cp .env.example .env，运行 ops/fill-secrets.sh，再按 .env.example 的说明填好其余各项" >&2
  exit 1
fi

previous="$(git rev-parse HEAD)"
if [ "$pull" = 1 ]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$branch" != pre ]; then
    echo "当前在 $branch，不是 pre：部署只从 pre 拉代码。回滚时用 ./deploy.sh --no-pull" >&2
    exit 1
  fi
  git pull --ff-only
fi
current="$(git rev-parse HEAD)"
echo "== 部署 $current（部署前是 $previous）"

rollback_hint() {
  echo "回滚：git checkout --detach $previous && ./deploy.sh --no-pull" >&2
  echo "修好以后回到 pre：git checkout pre && ./deploy.sh" >&2
}

# compose.yaml 里必填的变量写成 ${…:?}：缺了在这里就报出来，不用等到容器起不来。
docker compose config --quiet

echo "== 构建镜像"
docker compose build web

echo "== 迁移"
if ! docker compose run --rm migrate; then
  echo "迁移失败：web 和 worker 没有重启，旧版本照常服务。看上面的报错，修好以后再跑 ./deploy.sh。" >&2
  exit 1
fi

echo "== 重启 web 和 worker"
docker compose up -d web worker

echo "== 等 /readyz（最多 ${READY_TIMEOUT} 秒）"
for _ in $(seq 1 $((READY_TIMEOUT / 2))); do
  if body="$(curl -fsS --max-time 5 "$READY_URL" 2>/dev/null)"; then
    echo "$body"
    echo "== 部署完成：$current"
    exit 0
  fi
  sleep 2
done

echo "/readyz 在 ${READY_TIMEOUT} 秒内没有就绪。最后一次的结果：" >&2
curl -sS --max-time 5 "$READY_URL" >&2 || true
echo >&2
echo "看日志：docker compose logs --tail=100 web worker" >&2
rollback_hint
exit 1
