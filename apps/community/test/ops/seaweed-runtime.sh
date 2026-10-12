#!/usr/bin/env bash
# Real pinned-image process supervision regression. Linux remote/CI only.
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo REMOTE_LINUX_REQUIRED; exit 1; }
OPS=$(realpath "${1:?pass the ops/seaweed directory}")
[[ -f $OPS/entrypoint.sh && -f $OPS/forward-s3.sh ]]
OWNER=adxc-seaweed-runtime-regression
ROOT=$(mktemp -d)
chmod 700 "$ROOT"
name=
cleanup() {
  if [[ -n $name ]] && [[ $(docker inspect --format '{{index .Config.Labels "org.astrodx.owner"}}' "$name" 2>/dev/null || true) == "$OWNER" ]]; then
    docker rm -f "$name" >/dev/null
  fi
  rm -rf -- "$ROOT"
}
trap cleanup EXIT
printf '%s\n' '{"identities":[{"name":"runtime-test","credentials":[{"accessKey":"runtime-test-only","secretKey":"runtime-test-secret-only"}],"actions":["Read:blobs"]}]}' > "$ROOT/s3.json"
chmod 600 "$ROOT/s3.json"
IMAGE=chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d
probe() {
  local response
  response=$(docker exec "$name" wget -S -O /dev/null -T 2 http://127.0.0.1:8333/ 2>&1 || true)
  [[ $response == *'403 Forbidden'* ]]
}
for role in relay mini; do
  name="adxc-seaweed-runtime-${role}-$(basename "$ROOT")"
  docker run -d --pull=never --name "$name" --label "org.astrodx.owner=$OWNER" --network none \
    --memory 512m --pids-limit 256 --tmpfs /data:rw,size=134217728 \
    --mount "type=bind,src=$ROOT/s3.json,dst=/config/s3.json,readonly" \
    --mount "type=bind,src=$OPS,dst=/opt/community-seaweed,readonly" \
    --entrypoint /opt/community-seaweed/entrypoint.sh "$IMAGE" >/dev/null
  ready=0
  for (( attempt=0; attempt<30; attempt++ )); do
    if probe; then ready=1; break; fi
    sleep 1
  done
  [[ $ready == 1 ]] || { echo S3_STARTUP_FAILED; exit 1; }
  if [[ $role == relay ]]; then
    # BusyBox timeout leaves its watchdog behind when the target finishes early.
    # PID1 must not interpret the adopted watchdog's exit as a service failure.
    docker exec "$name" sh -c 'timeout 1 true'
    for (( attempt=0; attempt<8; attempt++ )); do
      sleep 1
      probe || { echo ORPHAN_EXIT_STOPPED_S3; exit 1; }
    done
    echo ORPHAN_EXIT_IGNORED
  fi
  process=nc
  [[ $role == mini ]] && process=weed
  docker exec "$name" sh -c '
    wanted=$1
    for pid in $(cat /proc/1/task/1/children); do
      read -r comm < "/proc/$pid/comm" || continue
      if [ "$comm" = "$wanted" ]; then kill -TERM "$pid"; exit 0; fi
    done
    exit 1
  ' sh "$process"
  code=$(timeout --signal=TERM --kill-after=2s 20s docker wait "$name")
  [[ $code == 1 ]] || { echo SERVICE_EXIT_NOT_FAIL_CLOSED; exit 1; }
  echo "SERVICE_EXIT_FAIL_CLOSED role=$role"
  docker rm "$name" >/dev/null
  name=
done
echo SEAWEED_SUPERVISION_REGRESSION_PASSED
