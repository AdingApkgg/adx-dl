# Community runtime acceptance

`Community check` keeps its existing lint, type, unit/DOM, built HTTP and image checks. After those pass, `select.sh` selects two additional acceptance cases from the complete push/PR diff. Documentation and unit-test-only changes do not select these cases. A manual workflow run selects both.

- Browser: one Chromium scenario against the already-built web and actual media worker. Synthetic accounts verify ZIP processing, explicit private draft save and reload, Canvas preview, private audio Range bytes, owner isolation, deletion/quota release, and avatar save/public JPEG.
- Recovery: storage/worker/DB/backup changes run the existing opt-in fresh-volume recovery case once, with actual normal role entrypoints, PostgreSQL, restic and authenticated S3. The browser roles stop before the restore starts. UI-only edits skip this case.

Playwright 1.58.2 and its Chromium headless shell are installed only in the runner's temporary directory; they are not product dependencies. Both cases reuse the application and backup images from the same CI run. The acceptance image only copies test sources and the existing server build.

`run.sh` requires a GitHub-hosted Linux VM and an owned directory under `RUNNER_TEMP`. It creates a 512 MiB sparse ext4 scratch disk using passwordless `sudo`, keeps the production worker's bounded-disk startup check, and deletes only this run's containers, volumes, loop mount, fixture and scratch after completion or failure. It never provisions storage on g510, uses a production secret, or deploys the application.

Only result JSON and failure screenshots are uploaded, retained for seven days. Cookie/env files, raw service logs, dumps, restic repositories and browser traces are excluded. Timeouts fail the job and stop the corresponding owned container before cleanup; reruns use a new run-attempt namespace.

GitHub PRs and pushes to `main`, `dev` or `pre` trigger the workflow. A local commit or a push to a feature branch without a PR does not run it. Production deployment remains the existing separately authorized process.

Automation checks the browser business flow and recovery behavior. Physical-device game import, actual listening quality and a user's real OAuth/passkey interaction remain distinct evidence; this workflow does not repeat those login checks.
