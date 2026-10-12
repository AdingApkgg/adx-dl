#!/usr/bin/env bash
# Disposable GitHub-hosted Linux acceptance only; never a local/production launcher.
set -euo pipefail
umask 077
fail() { printf '%s\n' "$1" >&2; exit "${2:-2}"; }
[[ $# == 1 ]] || fail 'usage: run.sh prepare|up|restore|down'
[[ $(uname -s) == Linux ]] || fail 'REMOTE_LINUX_REQUIRED'
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted ]] || fail 'GITHUB_HOSTED_RUNNER_REQUIRED'
[[ ${RUNNER_TEMP:-} == /* && ${ACCEPTANCE_ROOT:-} == "$RUNNER_TEMP"/* ]] || fail 'ACCEPTANCE_ROOT_OUTSIDE_RUNNER_TEMP'
[[ $(realpath -m "$ACCEPTANCE_ROOT") == "$ACCEPTANCE_ROOT" && ! -L $ACCEPTANCE_ROOT ]] || fail 'ACCEPTANCE_ROOT_INVALID'
[[ ${ACCEPTANCE_PROJECT:-} == "community-ci-${GITHUB_RUN_ID:?required}-${GITHUB_RUN_ATTEMPT:?required}" ]] || fail 'ACCEPTANCE_PROJECT_INVALID'
[[ ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || fail 'SOURCE_SHA_REQUIRED'
export ACCEPTANCE_APP_IMAGE=${ACCEPTANCE_APP_IMAGE:-community:ci}
export ACCEPTANCE_SEAWEED_IMAGE=${ACCEPTANCE_SEAWEED_IMAGE:-community-seaweed:ci}
export ACCEPTANCE_BACKUP_IMAGE=${ACCEPTANCE_BACKUP_IMAGE:-community-backup:ci}
export ACCEPTANCE_TEST_IMAGE=${ACCEPTANCE_TEST_IMAGE:-community-acceptance:ci}
ROOT=$ACCEPTANCE_ROOT
PROJECT=$ACCEPTANCE_PROJECT
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/../../../.." && pwd)
IMAGE=$ROOT/state/scratch-512m.ext4
compose() { docker compose --env-file "$ROOT/fixture/compose.env" -p "$PROJECT" -f "$SCRIPT_DIR/compose.yaml" "$@"; }
assert_owner() {
  [[ -d $ROOT && -f $ROOT/.owner && $(cat "$ROOT/.owner") == "$PROJECT" ]] || fail 'ACCEPTANCE_OWNER_MISMATCH'
}
stop_named() {
  local name=$1
  if docker inspect "$name" >/dev/null 2>&1; then
    [[ $(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$name") == "$PROJECT" ]] || fail 'FOREIGN_CONTAINER_REFUSED'
    if [[ $(docker inspect --format '{{.State.Running}}' "$name") == true ]]; then
      docker stop --time 15 "$name" >/dev/null || docker kill "$name" >/dev/null
      docker wait "$name" >/dev/null
    fi
    [[ $(docker inspect --format '{{.State.Running}}' "$name") == false ]] || fail 'ACCEPTANCE_PROCESS_STILL_RUNNING'
    docker rm "$name" >/dev/null
  fi
}
run_named() {
  local seconds=$1 service=$2 label=$3 code=0 name=$PROJECT-$3
  shift 3
  [[ -z $(docker ps -aq --filter "name=^/${name}$") ]] || fail 'ACCEPTANCE_RUN_ALREADY_EXISTS'
  timeout --foreground --signal=TERM --kill-after=15 "$seconds" \
    docker compose --env-file "$ROOT/fixture/compose.env" -p "$PROJECT" -f "$SCRIPT_DIR/compose.yaml" \
    run --name "$name" --no-deps -T "$service" "$@" >"$ROOT/private-logs/$label.log" 2>&1 || code=$?
  stop_named "$name"
  printf '{"sourceSha":"%s","check":"%s","exitCode":%s}\n' "$GITHUB_SHA" "$label" "$code" >"$ROOT/evidence/$label.json"
  [[ $code == 0 ]] || fail "ACCEPTANCE_${label}_FAILED exit=$code; private logs retained until cleanup" "$code"
}
base_and_bootstrap() {
  compose up -d --wait --wait-timeout 75 postgres redis seaweedfs >"$ROOT/private-logs/services.log" 2>&1
  if [[ ! -f $ROOT/state/bootstrap.done ]]; then
    run_named 120 bootstrap bootstrap
    : >"$ROOT/state/bootstrap.done"
  fi
}

case "$1" in
  prepare)
    [[ ! -e $ROOT ]] || fail 'ACCEPTANCE_ROOT_MUST_BE_NEW'
    [[ -z ${DOCKER_HOST:-} || ${DOCKER_HOST:-} == unix:///var/run/docker.sock ]] || fail 'LOCAL_RUNNER_DOCKER_REQUIRED'
    [[ $(docker info --format '{{.OSType}}') == linux ]] || fail 'LINUX_DOCKER_REQUIRED'
    sudo -n true || fail 'HOSTED_RUNNER_PASSWORDLESS_SUDO_REQUIRED'
    mkdir -m 0700 "$ROOT"
    printf '%s\n' "$PROJECT" >"$ROOT/.owner"
    mkdir -m 0700 "$ROOT/fixture" "$ROOT/state" "$ROOT/scratch" "$ROOT/evidence" "$ROOT/private-logs"
    app_id=$(docker image inspect --format '{{.Id}}' "$ACCEPTANCE_APP_IMAGE")
    backup_id=$(docker image inspect --format '{{.Id}}' "$ACCEPTANCE_BACKUP_IMAGE")
    seaweed_id=$(docker image inspect --format '{{.Id}}' "$ACCEPTANCE_SEAWEED_IMAGE")
    for image in "$ACCEPTANCE_APP_IMAGE" "$ACCEPTANCE_BACKUP_IMAGE" "$ACCEPTANCE_SEAWEED_IMAGE"; do
      revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
      [[ $revision == "$GITHUB_SHA" ]] || fail 'ACCEPTANCE_IMAGE_SOURCE_SHA_MISMATCH'
    done
    printf '{"sourceSha":"%s","appImage":"%s","backupImage":"%s","seaweedImage":"%s"}\n' "$GITHUB_SHA" "$app_id" "$backup_id" "$seaweed_id" >"$ROOT/evidence/images.json"
    docker build -f "$SCRIPT_DIR/Dockerfile" \
      --build-arg "ACCEPTANCE_APP_IMAGE=$ACCEPTANCE_APP_IMAGE" \
      --build-arg "ACCEPTANCE_BACKUP_IMAGE=$ACCEPTANCE_BACKUP_IMAGE" \
      --label "org.opencontainers.image.revision=$GITHUB_SHA" \
      -t "$ACCEPTANCE_TEST_IMAGE" "$REPO_ROOT" >"$ROOT/private-logs/image.log" 2>&1
    truncate --size 536870912 "$IMAGE"
    mkfs.ext4 -q -m 0 -E lazy_itable_init=1,lazy_journal_init=1 "$IMAGE"
    device=$(sudo -n losetup --find --show "$IMAGE")
    [[ $device =~ ^/dev/loop[0-9]+$ ]] || fail 'LOOP_DEVICE_INVALID'
    printf '%s\n' "$device" >"$ROOT/state/scratch-device"
    sudo -n mount -t ext4 -o nodev,nosuid,noexec "$device" "$ROOT/scratch"
    sudo -n chown "$(id -u):$(id -g)" "$ROOT/scratch"
    sudo -n chmod 0700 "$ROOT/scratch"
    docker volume create --label "com.docker.compose.project=$PROJECT" --label 'com.docker.compose.volume=source-storage' "${PROJECT}_source-storage" >/dev/null
    code=0
    timeout --foreground --signal=TERM --kill-after=15 75 \
      docker run --rm --name "$PROJECT-prepare" --label "com.docker.compose.project=$PROJECT" --memory 256m --cpus 1 --pids-limit 64 \
      -e ACCEPTANCE_ROOT -e ACCEPTANCE_PROJECT -e ACCEPTANCE_APP_IMAGE -e ACCEPTANCE_BACKUP_IMAGE -e ACCEPTANCE_TEST_IMAGE -e ACCEPTANCE_SEAWEED_IMAGE \
      --mount "type=bind,src=$ROOT/fixture,dst=/acceptance-fixture" \
      --mount "type=bind,src=$ROOT/state,dst=/acceptance-state" \
      --mount "type=volume,src=${PROJECT}_source-storage,dst=/source-storage" \
      "$ACCEPTANCE_TEST_IMAGE" bun ./test/acceptance/prepare.ts >"$ROOT/private-logs/fixture.log" 2>&1 || code=$?
    stop_named "$PROJECT-prepare"
    [[ $code == 0 ]] || fail "ACCEPTANCE_PREPARE_FAILED exit=$code" "$code"
    printf '{"sourceSha":"%s","scratchLogicalBytes":536870912,"scratchAllocatedBytes":%s}\n' \
      "$GITHUB_SHA" "$(( $(stat -c '%b' "$IMAGE") * 512 ))" >"$ROOT/evidence/environment.json"
    printf 'DISPOSABLE_ACCEPTANCE_PREPARED source=%s\n' "$GITHUB_SHA"
    ;;
  up)
    assert_owner
    [[ ! -f $ROOT/state/up.attempted ]] || fail 'ACCEPTANCE_UP_ALREADY_ATTEMPTED'
    : >"$ROOT/state/up.attempted"
    base_and_bootstrap
    compose --profile browser up -d web media >"$ROOT/private-logs/runtime.log" 2>&1
    for ((attempt=0; attempt<180; attempt++)); do
      if curl --fail --silent --output /dev/null --max-time 2 http://127.0.0.1:41909/readyz; then
        printf 'ACTUAL_WEB_MEDIA_READY http://127.0.0.1:41909\n'
        exit 0
      fi
      sleep 0.5
    done
    fail 'ACTUAL_WEB_MEDIA_NOT_READY' 1
    ;;
  restore)
    assert_owner
    [[ ! -f $ROOT/state/restore.attempted ]] || fail 'FRESH_RESTORE_ALREADY_ATTEMPTED'
    : >"$ROOT/state/restore.attempted"
    compose --profile browser stop web media >"$ROOT/private-logs/stop-browser.log" 2>&1
    base_and_bootstrap
    compose --profile restore up -d --wait --wait-timeout 75 restore-postgres restore-seaweedfs >"$ROOT/private-logs/restore-services.log" 2>&1
    run_named 110 restore restore-ready bun ./test/acceptance/bootstrap.ts restore-ready
    run_named 240 restore restore-full
    sudo -n cat -- "$ROOT/state/proof/result.json" >"$ROOT/evidence/restore.json"
    printf 'ACTUAL_FRESH_RESTORE_PASSED source=%s\n' "$GITHUB_SHA"
    ;;
  down)
    [[ -e $ROOT ]] || exit 0
    assert_owner
    cleanup_failed=0
    if [[ -f $ROOT/fixture/compose.env ]]; then
      compose --profile browser --profile tools --profile restore down --volumes --remove-orphans --timeout 135 >"$ROOT/private-logs/cleanup.log" 2>&1 || cleanup_failed=1
    fi
    for name in "$PROJECT-prepare" "$PROJECT-bootstrap" "$PROJECT-restore-ready" "$PROJECT-restore-full"; do stop_named "$name"; done
    [[ -z $(docker ps -q --filter "label=com.docker.compose.project=$PROJECT") ]] || fail 'OWNED_CONTAINERS_STILL_RUNNING'
    for suffix in source-pg source-storage restore-pg restore-storage; do
      volume=${PROJECT}_$suffix
      if docker volume inspect "$volume" >/dev/null 2>&1; then
        [[ $(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "$volume") == "$PROJECT" ]] || fail 'FOREIGN_VOLUME_REFUSED'
        docker volume rm "$volume" >/dev/null || cleanup_failed=1
      fi
    done
    if findmnt --mountpoint "$ROOT/scratch" --noheadings --output SOURCE >/dev/null 2>&1; then
      device=$(findmnt --mountpoint "$ROOT/scratch" --noheadings --output SOURCE)
      [[ $device =~ ^/dev/loop[0-9]+$ && $(sudo -n losetup --noheadings --output BACK-FILE "$device") == "$IMAGE" ]] || fail 'FOREIGN_SCRATCH_MOUNT_REFUSED'
      sudo -n umount "$ROOT/scratch" || fail 'OWNED_SCRATCH_STILL_BUSY'
    fi
    while read -r device; do
      [[ -z $device ]] && continue
      [[ $device =~ ^/dev/loop[0-9]+$ && $(sudo -n losetup --noheadings --output BACK-FILE "$device") == "$IMAGE" ]] || fail 'FOREIGN_LOOP_DEVICE_REFUSED'
      sudo -n losetup --detach "$device" || cleanup_failed=1
    done < <(sudo -n losetup --associated "$IMAGE" --noheadings --output NAME)
    [[ $cleanup_failed == 0 ]] || fail 'ACCEPTANCE_CLEANUP_INCOMPLETE'
    # Only sanitized evidence survives. Never upload env, cookies, raw DB/S3/restic data or logs.
    sudo -n rm -rf -- "$ROOT/fixture" "$ROOT/state" "$ROOT/scratch" "$ROOT/private-logs"
    printf 'DISPOSABLE_ACCEPTANCE_REMOVED; sanitized evidence retained\n'
    ;;
  *) fail 'usage: run.sh prepare|up|restore|down' ;;
esac
