#!/usr/bin/env bash
# Existing 03:30 one-shot job. The coordinator owns one full original/dump bundle,
# five-minute write maintenance and thirty-minute job deadlines. Never prune DB-only history.
set -euo pipefail
if [ -z "${RESTIC_PASSWORD:-}" ]; then
  echo "RESTIC_PASSWORD 未设置：在 .env 里填上（同时存进密码管理器）" >&2
  exit 1
fi
if ! restic cat config > /dev/null; then
  echo "打不开 restic 仓库 ${RESTIC_REPOSITORY:-}：还没 restic init，或者密码不对、BACKUP_REPO_DIR 设错了" >&2
  exit 1
fi
# Container-local final watchdog supplements the coordinator's child/connection cancellation.
exec timeout --signal=TERM --kill-after=5s 1795s bun ./ops/backup/export.ts
