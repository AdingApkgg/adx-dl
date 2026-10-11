#!/bin/bash
# Lightweight SSH/GitHub management client; all builds and services run remotely.
set -euo pipefail
runner_host="${GHA_RUNNER_HOST:-i@localhost-1.tailac9c6f.ts.net}"
runner_root=/home/i/.local/share/gha-runners
command_name="${1:-status}"
repository="${2:-}"
instance="${3:-01}"
if ! [[ "$command_name" =~ ^(add|start|stop|restart|status|logs|build|install)$ ]]; then
  echo 'Usage: runnerctl.sh install|build|status|add|start|stop|restart|logs [OWNER/REPO] [INSTANCE]' >&2
  exit 2
fi
if [ "$command_name" = install ]; then
  source_dir="$(cd "$(dirname "$0")/runner" && pwd)"
  ssh "$runner_host" "mkdir -p '$runner_root/runner'"
  COPYFILE_DISABLE=1 tar -C "$source_dir" -cf - . | ssh "$runner_host" "tar -C '$runner_root/runner' -xf -"
  echo "Management files installed on $runner_host:$runner_root"
  exit 0
fi
if [ -n "$repository" ] && ! [[ "$repository" =~ ^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo 'Repository must be OWNER/REPO.' >&2
  exit 2
fi
if ! [[ "$instance" =~ ^[a-z0-9][a-z0-9-]{0,24}$ ]]; then
  echo 'Invalid instance name.' >&2
  exit 2
fi
remote_command="python3 '$runner_root/runner/manager.py' '$command_name'"
if [ -n "$repository" ]; then
  remote_command="$remote_command '$repository' --instance '$instance'"
fi
if [ "$command_name" = add ]; then
  if [ -z "$repository" ]; then
    echo 'add requires OWNER/REPO.' >&2
    exit 2
  fi
  # GitHub administrative authentication stays local. Only a one-hour registration
  # token and public repository metadata are sent over SSH stdin; no secret files.
  repo_metadata="$(gh api "repos/$repository" --jq '{repository:.full_name,repository_id:.id,owner_id:.owner.id,default_branch:.default_branch}')"
  workflow_paths="$(gh api "repos/$repository/contents/.github/workflows" --jq '[.[] | select(.type == "file" and (.name | test("\\.ya?ml$"))) | .path]')"
  registration="$(gh api -X POST "repos/$repository/actions/runners/registration-token")"
  payload="$(jq -cn --argjson repo "$repo_metadata" --argjson registration "$registration" --argjson workflows "$workflow_paths" '$repo + {token:$registration.token,workflows:$workflows}')"
  if [ "$(jq -r .repository <<< "$repo_metadata")" = AdingApkgg/adx-dl ]; then
    remote_command="$remote_command --label astrodx-ci"
    payload="$(jq -c '. + {workflows:[".github/workflows/web-check.yml",".github/workflows/dash-check.yml",".github/workflows/community-check.yml",".github/workflows/deploy-gh-pages.yml",".github/workflows/runner-smoke.yml"],schedule_workflows:[".github/workflows/deploy-gh-pages.yml"],schedules:["0 20 * * *"]}' <<< "$payload")"
  fi
  printf '%s\n' "$payload" | ssh "$runner_host" "$remote_command"
  unset registration payload
else
  ssh "$runner_host" "$remote_command"
fi
