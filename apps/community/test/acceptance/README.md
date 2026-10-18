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

Production read-only smoke uses a separate remote entrypoint: `scripts/remote/community-smoke.sh`. See [the release workflow](../../../../docs/verification/community-headless-e2e.md). It never runs this isolated write scenario against production.

作者关注验收复用同一隔离账号与真实 worker：默认不提醒、发布进入动态、开启后新版本投递、标读、元数据不重复、取消停止后续投递，并检查 320/390 像素。恢复 fixture 通过真实旧 dump 和加密 tail 验证取消、关闭提醒、已读及注销。定向服务测试另覆盖 101 人中断续投和导出屏障等待。

正式生产门禁现要求十组场景，新增 `production_following_feed_and_alert_settings`：只读访问本人关注、动态、提醒筛选与作者控件，核对后台私有控制屏障。未包含这一组的旧九组收据无法完成新发布。生产验收不会创建关注或谱面；写入行为在隔离环境验收。
