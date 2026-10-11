#!/bin/bash
set -euo pipefail
cd /opt/actions-runner
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
if [ ! -f .runner ]; then
  echo 'Runner is not registered. Use runnerctl add before starting it.' >&2
  exit 1
fi
exec ./run.sh
