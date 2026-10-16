#!/usr/bin/env bash
# Exercise the real remote container: cache-to-workspace installs must be able
# to hardlink rather than copy dependency contents onto the shared VM disk.
set -euo pipefail
cd "$(dirname "$0")/../.."
command=$(cat <<'REMOTE_TEST'
set -eu
trap 'rm -f "${cache_probe:-}" "${repo_probe:-}"' EXIT
cache_probe=$(mktemp "$BUN_INSTALL_CACHE_DIR/.astrodx-link-test.XXXXXXXX")
repo_probe=$(mktemp "$PWD/.astrodx-link-test.XXXXXXXX")
printf astrodx-storage-regression > "$cache_probe"
rm "$repo_probe"
ln "$cache_probe" "$repo_probe"
test "$(stat -c %d:%i "$cache_probe")" = "$(stat -c %d:%i "$repo_probe")"
printf "cache-to-workspace hardlink: passed\n"
REMOTE_TEST
)
scripts/remote/verify.sh -- "$command"
