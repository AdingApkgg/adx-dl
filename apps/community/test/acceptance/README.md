# Community runtime acceptance

`Community check` keeps its existing lint, type, unit/DOM, built HTTP and image checks. After those pass, `select.sh` selects two additional acceptance cases from the complete push/PR diff. Documentation and unit-test-only changes do not select these cases. A manual workflow run selects both.

- Browser: one Chromium scenario against the already-built web and actual media/control workers with an independently persisted journal. Synthetic accounts verify ZIP processing, explicit private draft save and reload, Canvas preview, private audio Range bytes, owner isolation, deletion/quota release, and avatar save/public JPEG. The public flow selects a version and confirms the full original ZIP, keeps private edits/newer versions isolated, browses the anonymous catalog/detail/Canvas at desktop and mobile sizes, checks exact ZIP bytes, and rejects old asset/download requests after withdrawal. Missing media and unsupported preview difficulty are also exercised.
- Recovery: storage/worker/DB/backup changes run the existing opt-in fresh-volume recovery case once, with actual normal role entrypoints, PostgreSQL, restic and authenticated S3. The browser roles stop before the restore starts. It also replays later chart withdrawal, replacement, whole-chart deletion and anonymous exact-version retention; a missing latest permitted version stays closed. UI-only edits skip this case.

Playwright 1.58.2 and its Chromium headless shell are installed only in the runner's temporary directory; they are not product dependencies. Both cases reuse the application and backup images from the same CI run. The acceptance image only copies test sources and the existing server build.

`run.sh` requires a GitHub-hosted Linux VM and an owned directory under `RUNNER_TEMP`. It creates a 512 MiB sparse ext4 scratch disk using passwordless `sudo`, keeps the production worker's bounded-disk startup check, and deletes only this run's containers, volumes, loop mount, fixture and scratch after completion or failure. It never provisions storage on g510, uses a production secret, or deploys the application.

Only result JSON and failure screenshots are uploaded, retained for seven days. Cookie/env files, raw service logs, dumps, restic repositories and browser traces are excluded. Timeouts fail the job and stop the corresponding owned container before cleanup; reruns use a new run-attempt namespace.

GitHub PRs and pushes to `main`, `dev` or `pre` trigger the workflow. A local commit or a push to a feature branch without a PR does not run it. Production deployment remains the existing separately authorized process.

Automation checks the browser business flow and recovery behavior. Physical-device game import, actual listening quality and a user's real OAuth/passkey interaction remain distinct evidence; this workflow does not repeat those login checks.

The offline `verify-native-evidence.py` checker audits private native diagnostic JSONL samples and application tail logs. It requires explicit observation bounds; a finite healthy window without timestamped HTTP readiness, final health, and coverage through intentional shutdown is `incomplete`, never a native acceptance pass. A failed PG probe, missing role/container/cgroup, unhealthy role, observation gap, or application failure before shutdown fails the audit, including errors after the nominal finite window. Keep the collector and PG/application log followers alive until all applications have been explicitly stopped and their tail logs collected.

Its fixture-based regression test runs only on the builder: set `TASK3_RAW_ROOT` to the preserved private diagnostic log directory and run `python3 apps/community/test/acceptance/verify-native-evidence.test.py`. It mutates in-memory copies of real observations, never the original evidence or running services. These tests validate the verifier and do not count as a new application acceptance run.
