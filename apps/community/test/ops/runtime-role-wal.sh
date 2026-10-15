#!/usr/bin/env bash
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo REMOTE_LINUX_REQUIRED; exit 1; }
cd "$(dirname "$0")/../../../.."
repo=$PWD
root=$(mktemp -d /tmp/adxc-role-wal.XXXXXXXX)
name="adxc-role-wal-$(date +%s)-$$"
printf '%s\n' "$name" > "$root/.owner"
cleanup() {
 if docker inspect "$name" >/dev/null 2>&1; then
  [[ $(docker inspect --format '{{index .Config.Labels "astrodx.test-owner"}}' "$name") == "$name" ]] || return 1
  docker rm -fv "$name" >/dev/null
 fi
 [[ $(cat "$root/.owner") == "$name" ]] && rm -rf "$root"
}
trap cleanup EXIT
mkdir "$root/markers"
# Only synthetic PID/entry markers, inside a private outer directory; no secrets.
chmod 0777 "$root/markers"
cc -shared -fPIC -O2 -Wall -Wextra -Werror -o "$root/wal-delay.so" apps/community/test/ops/wal-delay.c -ldl
chmod 0444 "$root/wal-delay.so"
docker run -d --pull=missing --network none --name "$name" --label "astrodx.test-owner=$name" \
 --cpus 1 --memory 512m --pids-limit 128 -e POSTGRES_USER=community -e POSTGRES_PASSWORD=wal-fixture-only \
 -e POSTGRES_DB=community_role_wal_test -e LD_PRELOAD=/test-wal-delay.so \
 -v "$root/wal-delay.so:/test-wal-delay.so:ro" -v "$root/markers:/wal-delay" \
 postgres:18@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336 >/dev/null
for i in $(seq 1 120); do
 if docker exec -e PGPASSWORD=wal-fixture-only "$name" psql -h 127.0.0.1 -U community -d community_role_wal_test -Atqc 'select 1' >/dev/null 2>&1; then break; fi
 sleep .25
done
docker run --rm --pull=missing --network "container:$name" --user "$(id -u):$(id -g)" --cpus 2 --memory 1g --pids-limit 256 \
 -e HOME=/tmp -e STORAGE_TEST_WAL_DELAY=isolated-backend-only \
 -e TEST_DATABASE_URL=postgres://community:wal-fixture-only@127.0.0.1:5432/community_role_wal_test \
 -v "$repo:/repo:ro" -v "$root/markers:/wal-delay" -w /repo/apps/community \
 oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 \
 bun test test/ops/runtime-role-wal.test.ts
