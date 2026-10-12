#!/usr/bin/env bash
# Run the web dev server on the remote build machine and preview it here at
# http://localhost:3310 through an SSH tunnel.
#
#   scripts/remote/dev.sh start    # sync the working tree, (re)start `next dev` remotely, open the tunnel
#   scripts/remote/dev.sh sync     # push local edits; the remote dev server hot-reloads them
#   scripts/remote/dev.sh status   # dev server and tunnel state
#   scripts/remote/dev.sh logs     # follow the dev server's output (Ctrl-C to stop following)
#   scripts/remote/dev.sh stop     # stop the dev server and close the tunnel
#
# The Mac is not a build machine (see the repo-root AGENTS.md), so `next dev`
# never runs here. It runs on localhost-1 in the pinned Bun image, listening
# only on that machine's 127.0.0.1; `ssh -L` forwards it to localhost here.
# Seen from this side it is an ordinary localhost dev server: the in-app
# browser trusts it without a per-site prompt, Next's dev-origin check passes
# with no allowedDevOrigins, and hot reload's WebSocket goes through the tunnel.
# Nothing is exposed on the tailnet or the build machine's LAN.
set -euo pipefail

HOST="${ASTRODX_BUILD_HOST:-i@localhost-1.tailac9c6f.ts.net}"
EXPECT_HOSTNAME="${ASTRODX_BUILD_HOSTNAME:-localhost}"
PORT="${ASTRODX_DEV_PORT:-3310}"
IMAGE="oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895"
REMOTE_ROOT="/home/i/astrodx-verify"
REMOTE_DIR="$REMOTE_ROOT/dev"
CONTAINER="astrodx-dev-preview"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)
SSH=(ssh "${SSH_OPTS[@]}" "$HOST")
# Control socket of the background tunnel, so status/stop can find it.
TUNNEL_SOCKET="${TMPDIR:-/tmp}/astrodx-dev-tunnel-$PORT.sock"

# GNU rsync, not macOS's openrsync: the sync relies on per-directory
# .gitignore filter rules, which openrsync does not implement.
RSYNC="${ASTRODX_RSYNC:-}"
if [ -z "$RSYNC" ]; then
  for candidate in /opt/homebrew/bin/rsync /usr/local/bin/rsync; do
    [ -x "$candidate" ] && RSYNC="$candidate" && break
  done
fi

remote_guard="[ \"\$(uname -n)\" = '$EXPECT_HOSTNAME' ] || { echo 'dev.sh: unexpected remote host' \"\$(uname -n)\" >&2; exit 90; }"

sync_tree() {
  [ -n "$RSYNC" ] || { echo "dev.sh: needs GNU rsync (brew install rsync) or ASTRODX_RSYNC" >&2; exit 2; }
  cd "$(git rev-parse --show-toplevel)"
  "${SSH[@]}" "$remote_guard; mkdir -p '$REMOTE_DIR'"
  # Ignored paths (node_modules, .next, …) are neither sent nor deleted on the
  # remote, so its installed dependencies and dev cache survive every sync.
  # Only changed files transfer, with their mtimes, so hot reload sees just
  # those.
  "$RSYNC" -a --delete --filter=':- .gitignore' --exclude='/.git/' \
    -e "ssh ${SSH_OPTS[*]}" ./ "$HOST:$REMOTE_DIR/"
}

tunnel_up() {
  ssh -S "$TUNNEL_SOCKET" -O check "$HOST" >/dev/null 2>&1
}

open_tunnel() {
  if tunnel_up; then
    return
  fi
  rm -f "$TUNNEL_SOCKET"
  # Background master connection that only forwards the port. Fails loudly if
  # something here already holds the port.
  ssh "${SSH_OPTS[@]}" -f -N -M -S "$TUNNEL_SOCKET" \
    -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
    -L "127.0.0.1:$PORT:127.0.0.1:$PORT" "$HOST"
}

close_tunnel() {
  if tunnel_up; then
    ssh -S "$TUNNEL_SOCKET" -O exit "$HOST" >/dev/null 2>&1 || true
  fi
  rm -f "$TUNNEL_SOCKET"
}

case "${1:-}" in
  start)
    sync_tree
    "${SSH[@]}" 'bash -s' <<REMOTE
set -euo pipefail
$remote_guard
mkdir -p '$REMOTE_ROOT/bun-cache'
docker rm -f '$CONTAINER' >/dev/null 2>&1 || true
# Host network so it can reach the proxy that /etc/environment sets
# (127.0.0.1:11090); it listens on 127.0.0.1 only, for the tunnel.
docker run -d --name '$CONTAINER' --pull=never --network host \
  --user "\$(id -u):\$(id -g)" \
  --cpus 8 --memory 12g --pids-limit 4096 \
  -e HOME=/tmp -e BUN_INSTALL_CACHE_DIR=/cache -e NEXT_TELEMETRY_DISABLED=1 \
  -e http_proxy -e https_proxy -e HTTP_PROXY -e HTTPS_PROXY -e no_proxy -e NO_PROXY \
  -v '$REMOTE_DIR:/repo' -v '$REMOTE_ROOT/bun-cache:/cache' -w /repo \
  --entrypoint sh '$IMAGE' \
  -c "bun install --frozen-lockfile && cd apps/web && exec bun run dev --hostname 127.0.0.1 --port $PORT" >/dev/null
REMOTE
    open_tunnel
    echo "dev.sh: starting (first start installs dependencies; follow with: scripts/remote/dev.sh logs)" >&2
    echo "http://localhost:$PORT"
    ;;
  sync)
    sync_tree
    echo "dev.sh: synced" >&2
    ;;
  status)
    "${SSH[@]}" "$remote_guard
      docker ps --filter name='^$CONTAINER\$' --format 'remote: {{.Names}} {{.Status}}' | grep . || echo 'remote: not running'"
    if tunnel_up; then
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:$PORT/" || true)"
      echo "tunnel: up — http://localhost:$PORT -> HTTP $code"
    else
      echo "tunnel: down (scripts/remote/dev.sh start reopens it)"
    fi
    ;;
  logs)
    "${SSH[@]}" "$remote_guard; docker logs -f --tail 100 '$CONTAINER'"
    ;;
  stop)
    close_tunnel
    "${SSH[@]}" "$remote_guard; docker rm -f '$CONTAINER' >/dev/null 2>&1 && echo 'dev.sh: stopped' || echo 'dev.sh: was not running'"
    ;;
  *)
    sed -n '2,17p' "$0"
    exit 2
    ;;
esac
