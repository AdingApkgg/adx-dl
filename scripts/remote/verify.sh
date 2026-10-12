#!/usr/bin/env bash
# Run this repo's checks on the remote build machine instead of this Mac.
#
#   scripts/remote/verify.sh                      # working tree (incl. uncommitted and untracked files), default checks
#   scripts/remote/verify.sh --ref HEAD~1         # a specific commit instead
#   scripts/remote/verify.sh -- 'cd apps/web && bun test src/lib/notices.test.ts'
#   scripts/remote/verify.sh --keep               # leave the remote run directory in place to poke at
#
# The Mac is not a build machine (see the repo-root AGENTS.md): installs, full
# test suites, type checks and builds run here, on localhost-1, inside the
# pinned Bun image with resource limits. Only lightweight git work happens
# locally: the snapshot is a git tree object, shipped with `git archive`.
#
# Exits with the remote command's exit status.
set -euo pipefail

HOST="${ASTRODX_BUILD_HOST:-i@localhost-1.tailac9c6f.ts.net}"
# The remote's own hostname: checked before anything runs, so a misconfigured
# HOST can never turn "remote" into this machine.
EXPECT_HOSTNAME="${ASTRODX_BUILD_HOSTNAME:-localhost}"
IMAGE="oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895"
REMOTE_ROOT="/home/i/astrodx-verify"
# Mirrors web-check.yml's verification steps (minus the catalog rebuild and the
# static build, which need the media server and are CI's job).
DEFAULT_CMD='bun install --frozen-lockfile && bun run lint && (cd packages/ui && bun run check) && (cd apps/web && bun run check)'

ref=""
keep=0
cmd="$DEFAULT_CMD"
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) ref="${2:?--ref needs a commit}"; shift 2 ;;
    --keep) keep=1; shift ;;
    --) shift; cmd="$*"; break ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "verify.sh: unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done
[ -n "$cmd" ] || { echo "verify.sh: empty command after --" >&2; exit 2; }

cd "$(git rev-parse --show-toplevel)"

if [ -n "$ref" ]; then
  tree="$(git rev-parse --verify "$ref^{tree}")"
  label="$(git rev-parse --short "$ref")"
else
  # The working tree as git would commit it with `git add -A`: tracked edits
  # plus untracked, non-ignored files. Built in a throwaway index, so the real
  # index and working tree are never touched.
  index="$(mktemp)"
  trap 'rm -f "$index"' EXIT
  cp "$(git rev-parse --git-path index)" "$index"
  GIT_INDEX_FILE="$index" git add -A
  tree="$(GIT_INDEX_FILE="$index" git write-tree)"
  label="wt-$(git rev-parse --short HEAD)"
fi

run="$(date +%Y%m%d-%H%M%S)-$label"
echo "verify.sh: $HOST run $run (tree ${tree:0:12})" >&2

# Step 1: ship the snapshot into a fresh run directory.
git archive --format=tar "$tree" | ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" \
  "set -euo pipefail
   [ \"\$(uname -n)\" = '$EXPECT_HOSTNAME' ] || { echo 'verify.sh: unexpected remote host' \"\$(uname -n)\" >&2; exit 90; }
   dir='$REMOTE_ROOT/runs/$run'
   mkdir -p \"\$dir\"
   printf '%s\n' astrodx-verify > \"\$dir/.owner\"
   printf '%s\n' '$tree' > \"\$dir/.source-tree\"
   tar -x -C \"\$dir\""

# Step 2: run the command in the pinned image. The command travels base64
# encoded so no quoting survives two shells.
cmd_b64="$(printf '%s' "$cmd" | base64 | tr -d '\n')"
set +e
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" 'bash -s' -- "$run" "$cmd_b64" "$keep" <<REMOTE
set -uo pipefail
run="\$1"; cmd="\$(printf '%s' "\$2" | base64 -d)"; keep="\$3"
[ "\$(uname -n)" = '$EXPECT_HOSTNAME' ] || { echo "verify.sh: unexpected remote host \$(uname -n)" >&2; exit 90; }
root='$REMOTE_ROOT'
dir="\$root/runs/\$run"
mkdir -p "\$root/bun-cache"
# Old runs left by --keep or an interrupted session.
find "\$root/runs" -mindepth 1 -maxdepth 1 -type d -mtime +2 -exec rm -rf {} + 2>/dev/null
# Host network so the image reaches the proxy on 127.0.0.1:11090 that
# /etc/environment sets; the ssh session already carries those variables.
docker run --rm --pull=never --network host \
  --user "\$(id -u):\$(id -g)" \
  --cpus 16 --memory 16g --pids-limit 4096 \
  -e HOME=/tmp -e CI=1 -e BUN_INSTALL_CACHE_DIR=/cache \
  -e http_proxy -e https_proxy -e HTTP_PROXY -e HTTPS_PROXY -e no_proxy -e NO_PROXY \
  -v "\$dir:/repo" -v "\$root/bun-cache:/cache" -w /repo \
  --entrypoint sh '$IMAGE' -c "\$cmd"
status=\$?
if [ "\$keep" = 1 ]; then
  echo "verify.sh: kept \$dir" >&2
else
  rm -rf "\$dir"
fi
exit \$status
REMOTE
status=$?
set -e
if [ "$status" -eq 0 ]; then
  echo "verify.sh: passed" >&2
else
  echo "verify.sh: failed with exit status $status" >&2
fi
exit "$status"
