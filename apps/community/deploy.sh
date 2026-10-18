#!/usr/bin/env bash
# g510 上的受控部署。仓库根目录正式入口：python3 scripts/remote/community-deploy.py
#   1. 拉 pre 分支（git pull --ff-only）；
#   2. 检查 compose 的变量（缺了直接报出来），构建镜像；
#   3. 跑迁移（docker compose run --rm migrate），失败就停：web 和 worker 不动，旧版本照常服务；
#   4. 重启 web 和 worker；
#   5. /readyz 后写 .serving-revision；强制等待登录态无头验收与清理收据。
#   6. 验收通过后才推进 .deploy-revision 并标记发布完成；正式调用方为 scripts/remote/community-deploy.py。
# 回滚：先确认迁移与认证日志格式兼容，再检出兼容提交并通过正式入口 --no-pull 部署；不自动启动旧读者。
# NapCat 和 Umami 不在这里重启：NapCat 重启可能要重新扫码登录 QQ；Umami 升级要先看它的更新说明。
set -euo pipefail

script_dir="$(cd -- "$(dirname "$0")" && pwd)"
cd "${COMMUNITY_DEPLOY_DIR:-$script_dir}"
release_gate="$script_dir/ops/release/await-acceptance.py"

READY_URL="${READY_URL:-http://127.0.0.1:12703/readyz}"
READY_TIMEOUT="${READY_TIMEOUT-60}"
# 拒绝空值、小数和溢出的整数，不能等拉完代码、重启容器以后才发现期限无效。
if ! [[ "$READY_TIMEOUT" =~ ^[1-9][0-9]*$ ]] || [ "${#READY_TIMEOUT}" -gt 10 ] || [ "$READY_TIMEOUT" -gt 2147483647 ]; then
  echo "READY_TIMEOUT 必须是 1 到 2147483647 之间的整数（秒）" >&2
  exit 2
fi

pull=1
verify_current=0
case "${1:-}" in
  "") ;;
  --no-pull) pull=0 ;;
  --verify-current) pull=0; verify_current=1 ;;
  *)
    echo "用法：./deploy.sh [--no-pull] [--verify-current]（由正式协调器调用）" >&2
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
    echo "当前在 $branch，不是 pre：部署只从 pre 拉代码。回滚时通过正式入口 --no-pull" >&2
    exit 1
  fi
fi

# The coordinator supplies an owned per-release directory; direct execution cannot
# silently mark readiness as a completed release. Keep this lock through acceptance.
if [ ! -x "$release_gate" ] || ! "$release_gate" --preflight; then
  echo "请使用正式入口 scripts/remote/community-deploy.py；缺少受控验收上下文，未执行部署。" >&2
  exit 1
fi
exec 9>.deploy.lock
flock -n 9 || { echo "另一轮发布仍在执行" >&2; exit 1; }

# HEAD 在 pull 后已经变了，即使迁移或就绪失败也不会自动退回。单独记录已部署的版本，失败重试不能覆盖它。
# 第一次用脚本时，先以拉取前的 checkout 为基线；之后只有 /readyz 与生产登录态验收均成功才推进记录。不要删除这个本机文件。
state_file=.deploy-revision
state_tmp=""
trap 'if [ -n "$state_tmp" ]; then rm -f "$state_tmp"; fi' EXIT
save_revision() {
  state_tmp="$(mktemp "$state_file.XXXXXX")"
  printf '%s\n' "$1" > "$state_tmp"
  mv -f "$state_tmp" "$state_file"
  state_tmp=""
}
if [ -f "$state_file" ]; then
  previous="$(cat "$state_file")"
  if ! [[ "$previous" =~ ^[0-9a-f]{7,64}$ ]]; then
    echo "$state_file 不是有效的提交记录：确认实际部署版本后修复它，再重试。" >&2
    exit 1
  fi
else
  save_revision "$previous"
fi
if [ "$pull" = 1 ]; then
  git pull --ff-only
fi
current="$(git rev-parse HEAD)"
if [ "$verify_current" = 1 ]; then current="$(cat .serving-revision 2>/dev/null || cat .deploy-revision)"; fi
echo "== 部署 $current（部署前是 $previous）"

rollback_hint() {
  echo "已保留实际镜像 astrodx-community:rollback-$previous；使用 COMPOSE_FILE 原有 overlay，仅回滚应用服务。" >&2
  echo "确认迁移与日志读者兼容后回滚：git checkout --detach $previous，再在控制端运行 python3 scripts/remote/community-deploy.py --no-pull" >&2
  echo "修好以后回到 pre：git checkout pre，再在控制端运行 python3 scripts/remote/community-deploy.py" >&2
}

if [ "$verify_current" != 1 ]; then
# Never apply a newer checkout with an older operator/test bundle.
"$release_gate" --candidate "$current"
# compose.yaml 里必填的变量写成 ${…:?}：缺了在这里就报出来，不用等到容器起不来。
docker compose config --quiet

echo "== 构建镜像"
# Preserve the actual serving image; repeated failed attempts cannot overwrite this rollback tag.
serving="$(docker compose ps -q web)"
if [ -n "$serving" ]; then
  image_id="$(docker inspect --format '{{.Image}}' "$serving")"
  if [ -n "$image_id" ] && ! docker image inspect "astrodx-community:rollback-$previous" > /dev/null 2>&1; then
    docker image tag "$image_id" "astrodx-community:rollback-$previous"
  fi
fi
docker compose build web backup seaweedfs

echo "== 迁移"
if ! docker compose run --rm migrate; then
  echo "迁移失败：web 和 worker 没有重启，旧版本照常服务。看上面的报错，修好以后再跑正式入口。" >&2
  exit 1
fi

echo "== 存储预检"
docker compose run --rm --no-deps storage-config
docker compose up -d seaweedfs
# Existing state must be explicitly initialized by the first-install runbook; never auto-adopt it.
docker compose run --rm --no-deps backup bun ops/backup/preflight.ts

echo "== 重启 web、worker 和 media-worker"
docker compose up -d --no-deps web worker media-worker

fi

echo "== 等 /readyz（最多 ${READY_TIMEOUT} 秒）"
deadline=$(( $(date +%s) + READY_TIMEOUT ))
while true; do
  remaining=$((deadline - $(date +%s)))
  [ "$remaining" -gt 0 ] || break
  probe_timeout=5
  [ "$remaining" -ge "$probe_timeout" ] || probe_timeout="$remaining"
  if body="$(curl -fsS --max-time "$probe_timeout" "$READY_URL" 2>/dev/null)" && docker compose exec -T media-worker bun src/server/storage/health.ts media > /dev/null 2>&1; then
    # 探针返回时再核对一次：期限已经过去就不能把这次部署记成成功。
    if [ "$(date +%s)" -le "$deadline" ]; then
      serving_tmp="$(mktemp .serving-revision.XXXXXX)"
      printf '%s\n' "$current" > "$serving_tmp"
      mv -f "$serving_tmp" .serving-revision
      echo "$body"
      if ! "$release_gate" --await "$current"; then
        echo "应用已切换，但登录态验收未通过；发布未完成，保留上次验收通过版本 $previous。" >&2
        rollback_hint
        exit 1
      fi
      "$release_gate" --complete "$current"
      echo "== 部署完成：$current（生产登录态验收与清理已通过）"
      exit 0
    fi
    break
  fi
  remaining=$((deadline - $(date +%s)))
  [ "$remaining" -gt 0 ] || break
  pause=2
  [ "$remaining" -ge "$pause" ] || pause="$remaining"
  sleep "$pause"
done

echo "/readyz 在 ${READY_TIMEOUT} 秒内没有就绪。最后一次的结果：" >&2
# 最后的诊断请求不参与就绪判断，可以在上面的期限之外再花最多 5 秒。
curl -sS --max-time 5 "$READY_URL" >&2 || true
echo >&2
echo "看日志：docker compose logs --tail=100 web worker" >&2
rollback_hint
exit 1
