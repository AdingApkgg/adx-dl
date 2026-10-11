#!/usr/bin/env bash
# Select the two runtime acceptance cases, using the complete PR/push diff.
set -euo pipefail
browser=false
restore=false
base=${ACCEPTANCE_BASE_SHA:-}
head=${ACCEPTANCE_HEAD_SHA:-HEAD}
if [[ ${ACCEPTANCE_EVENT:-} == workflow_dispatch || ! $base =~ ^[a-f0-9]{40}$ || $base == 0000000000000000000000000000000000000000 ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  browser=true
  restore=true
else
  paths=$(git diff --name-only "$base" "$head" --)
  while IFS= read -r path; do
    case "$path" in
      *.md|*.mdx) continue ;;
      apps/community/ops/backup/fresh-restore.test.ts) browser=true; restore=true; continue ;;
      *.test.*) continue ;;
    esac
    case "$path" in
      .github/workflows/community-check.yml|apps/community/test/acceptance/*|apps/community/test/storage/*|apps/community/Dockerfile|apps/community/compose*|bun.lock|package.json|patches/*|packages/maimai-chart-engine/*)
        browser=true; restore=true ;;
      apps/community/src/server/storage/*|apps/community/src/server/charts/*|apps/community/src/server/db/*|apps/community/src/server/jobs/*|apps/community/src/server/app.ts|apps/community/src/server/services/user-deletion.ts|apps/community/src/media-worker/*|apps/community/src/worker/*|apps/community/ops/backup/*|apps/community/ops/seaweed/*)
        # Unit-test-only edits use the existing test step, without another native run.
        if [[ $path != *.test.* ]]; then browser=true; restore=true; fi ;;
      apps/community/src/*|apps/community/messages/*|apps/community/project.inlang/*|apps/community/*config*|apps/community/package.json|packages/ui/*|packages/tsconfig/*)
        if [[ $path != *.test.* ]]; then browser=true; fi ;;
    esac
  done <<< "$paths"
fi
printf 'browser=%s\nrestore=%s\n' "$browser" "$restore"
