#!/bin/bash
set -euo pipefail
cd /opt/actions-runner
if [ -f .runner ]; then
  echo 'This instance is already registered; registration is unchanged.'
  exit 0
fi
IFS= read -r registration_token
if [ -z "$registration_token" ]; then
  echo 'A short-lived registration token on stdin is required.' >&2
  exit 1
fi
./config.sh --unattended --url "https://github.com/$MANAGED_REPOSITORY" \
  --token "$registration_token" --name "$MANAGED_RUNNER_NAME" \
  --labels "$MANAGED_RUNNER_LABELS" --work _work
unset registration_token
