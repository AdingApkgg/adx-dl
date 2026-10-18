#!/usr/bin/env bash
# Production read-only Chromium on the builder; never starts anything on the Mac.
set -euo pipefail
HOST=${ASTRODX_BUILD_HOST:-i@localhost-1.tailac9c6f.ts.net}
EXPECTED=${ASTRODX_BUILD_HOSTNAME:-localhost}
MODULE=${ACCEPTANCE_PLAYWRIGHT_PATH:-/home/i/astrodx-verify/public-browser-20261016/node_modules/playwright/index.mjs}
STATE=${PRODUCTION_STORAGE_STATE:-}
ROLE=${PRODUCTION_AUTH_ROLE:-admin}
USER_ID=${PRODUCTION_EXPECT_USER_ID:-}
if [[ ${1:-} == --help || ${1:-} == -h ]]; then
  echo 'usage: scripts/remote/community-smoke.sh [--authenticated|--anonymous] (default: authenticated through trusted SSH)'
  exit 0
fi
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
if [[ ${1:-} == --authenticated || ( $# == 0 && -z $STATE ) ]]; then
  exec python3 "$ROOT/scripts/remote/community-auth-smoke.py"
fi
if [[ ${1:-} == --anonymous ]]; then shift; STATE=; fi
[[ $# == 0 ]] || { echo 'see --help' >&2; exit 2; }
# These values become Python literals on the remote end. Restrict them before transport.
[[ $EXPECTED =~ ^[A-Za-z0-9.-]+$ && $MODULE =~ ^/[A-Za-z0-9_./-]+$ ]] || exit 2
[[ -z $STATE || $STATE =~ ^/[A-Za-z0-9_./-]+$ ]] || exit 2
[[ $ROLE == admin || $ROLE == user ]] || exit 2
[[ -z $USER_ID || $USER_ID =~ ^[1-9][0-9]*$ ]] || exit 2
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
TREE=$(git -C "$ROOT" rev-parse 'HEAD^{tree}')
SOURCE=$(base64 < "$ROOT/apps/community/test/acceptance/production-smoke.mjs" | tr -d '\n')
# No session file or browser profile is copied from this machine.
{
  printf "expected='%s'\nmodule='%s'\nstate='%s'\nrole='%s'\nuser_id='%s'\ntree='%s'\nsource='%s'\n" "$EXPECTED" "$MODULE" "$STATE" "$ROLE" "$USER_ID" "$TREE" "$SOURCE"
  cat <<'PY'
import base64, hashlib, json, os, pathlib, subprocess, tempfile
if os.uname().sysname != 'Linux' or os.uname().nodename != expected:
    raise SystemExit('UNEXPECTED_BUILD_HOST')
os.umask(0o077)
parent = pathlib.Path('/home/i/astrodx-verify/production-smoke')
parent.mkdir(mode=0o700, exist_ok=True)
root = pathlib.Path(tempfile.mkdtemp(prefix='run-', dir=parent))
script = base64.b64decode(source, validate=True)
(root / 'smoke.mjs').write_bytes(script)
(root / 'source.json').write_text(json.dumps({'baseTree': tree, 'smokeSha256': hashlib.sha256(script).hexdigest()}) + '\n')
env = dict(os.environ, ACCEPTANCE_PLAYWRIGHT_PATH=module, PRODUCTION_EVIDENCE_DIR=str(root / 'evidence'), PRODUCTION_TOOL_BASE_TREE=tree, PRODUCTION_SMOKE_SHA256=hashlib.sha256(script).hexdigest(), PRODUCTION_AUTH_ROLE=role)
for key in ['PRODUCTION_STORAGE_STATE', 'PRODUCTION_EXPECT_USER_ID']:
    env.pop(key, None)
if state: env['PRODUCTION_STORAGE_STATE'] = state
if user_id: env['PRODUCTION_EXPECT_USER_ID'] = user_id
print('REMOTE_HEADLESS_EVIDENCE ' + str(root), flush=True)
run = subprocess.run(['timeout', '--signal=TERM', '--kill-after=10s', '300s', 'node', str(root / 'smoke.mjs')], env=env)
result = root / 'evidence/result.json'
if not result.is_file():
    print('PRODUCTION_SMOKE_INCOMPLETE: no completed result', flush=True)
    raise SystemExit(run.returncode or 1)
proof = json.loads(result.read_text())
print(json.dumps(proof), flush=True)
if run.returncode != 0 or proof.get('status') != 'passed':
    raise SystemExit(run.returncode or 1)
PY
} | ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" 'python3 -u -'
