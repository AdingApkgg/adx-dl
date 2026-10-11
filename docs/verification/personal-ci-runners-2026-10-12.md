# Personal repository runners — 2026-10-12

## Installation

- Target: `i@localhost-1.tailac9c6f.ts.net`, Linux x86_64, 128 logical CPUs, approximately 50 GiB RAM. About 17 GiB RAM was available when installation began.
- Shared manager: `/home/i/.local/share/gha-runners`.
- First repository: `AdingApkgg/adx-dl`; GitHub runner ID `21`.
- Runner name: `localhost-128-adingapkgg-adx-dl-ef6e2b43--01-563135cd`.
- Labels: `self-hosted`, `Linux`, `X64`, `managed-ci`, `astrodx-ci`.
- One persistent worker initially: 32 CPU equivalents / 8 GiB RAM; private DinD: 16 CPU equivalents / 4 GiB RAM. Additional workers are explicit additions rather than automatic scaling.
- The runner runs as UID 1001, with no host home directory or host Docker socket mounted. Each instance has separate state, workspace, tools, Docker data, and admission policy.
- A restart while idle preserved ID `21` and returned to online/idle. Container restart policy is `unless-stopped`; no host reboot was performed.

All image builds, tests, runner services, and workload execution took place on the remote server. The local Mac was used only for reading/editing, Git, GitHub requests, and SSH/file transfer.

## Verification before workflow execution

- Remote runner image build succeeded using the official runner `2.338.0` base.
- Final remote Python tests: 43 passed (22 admission, 16 manager, and 5 Docker proxy configuration tests).
- Rejection tests include terminating a mock Linux `Runner.Worker` before a later `always()` marker can execute, as well as malformed events and environment spoofing. Official runner `2.338.0` source ordering was also reviewed: the admission hook precedes Docker action preparation execution, job/service container startup, action pre-steps, and ordinary user steps. Action archive download/extraction happens earlier; the hook does not prevent all untrusted data from reaching disk.
- Remote actionlint `1.7.12` accepted all five workflows with the custom-label configuration. Shellcheck and pyflakes were disabled; this is workflow syntax/context validation.
- Independent final review found no remaining blocking issue after fixing fresh-volume initialization, job-container executable/tool mounts, stale proxy defaults on disable, and job-container root ownership.
- Workflow implementation commit: `db06660c2cdca679ee6a218fa66754f345122d10`.
- Shared proxy/job-container implementation: `6e214544868f721cc02fcc250716f3f541873381`; non-root container smoke: `ad3dc50c1bd65056b4defd3d2d9ecba877e30278`.

## Proxy and container verification

The standalone `managed-ci-egress` service uses one CPU and 256 MiB. Actual HTTPS CONNECT requests and outbound logs prove mainland domains/literal IPs are direct and GitHub/Docker Hub use the existing upstream proxy. See [the detailed proxy report](../../scripts/ci/proxy/VERIFICATION.md). Unknown domains use the proxy. The existing host sing-box service and host Docker daemon were not reconfigured.

`network.json` points all managed repository instances at the shared credential-free endpoint `http://172.17.0.1:11092`. Runner environment, private Docker pulls, child containers, and runner-host Dockerfile builds inherit it. The original host/inner Docker bridge overlap was fixed by assigning the private daemon bridge `10.240.0.1/24` and pool `10.241.0.0/16`. Host routes were checked before the change.

After applying the setting while idle, GitHub retained runner ID `21` and returned to online/idle. Actual GitHub API requests from the runner returned HTTP 200, Redis 8 pulled successfully, and a child container inherited the proxy. The private daemon ID was `ff4e58fc-6d71-4949-9660-54cfd1717979`, distinct from the host's `1228c66b-d16a-4139-9f8a-fe2d6ad3b7d2`.

A separate fresh-volume Compose fixture ran only its initializer and private daemon, with no GitHub registration or runner service. Its runner executables included Node v24.21.0; UID 1001 could write the workspace/tool cache; the CLI proxy config was mode 600; bridge routing matched the new range. Its exact containers and volumes were removed afterward. No new image was pulled for that fixture.

## Actual GitHub Actions runs

Initial implementation runs identified the Docker Hub direct-network timeout; the shared proxy fixes that path. Web and Dash already passed on runner 21 before the network change.

| Workflow | Run |
| --- | --- |
| Dash check — passed on runner 21 | [38160549941](https://github.com/AdingApkgg/adx-dl/actions/runs/38160549941) |
| Web check — passed on runner 21 | [38160549989](https://github.com/AdingApkgg/adx-dl/actions/runs/38160549989) |
| Community check — failed while pulling service images directly | [38160549940](https://github.com/AdingApkgg/adx-dl/actions/runs/38160549940) |
| Managed runner smoke — same initial pull failure | [38160558185](https://github.com/AdingApkgg/adx-dl/actions/runs/38160558185) |

The initial Web run passed 698 Bun tests and 38 shared UI tests, then built 11,750 pages using eight workers. Its site build took approximately 7m12s. The runner's 8 GiB cgroup limit was reached including file cache, with `oom=0` and `oom_kill=0`; this does not establish a like-for-like speed comparison with GitHub-hosted runners.

Final checks after enabling the shared proxy:

| Workflow | Run | Result |
| --- | --- | --- |
| Community | [38163641140](https://github.com/AdingApkgg/adx-dl/actions/runs/38163641140) | Passed on runner 21 |
| Web | [38163645947](https://github.com/AdingApkgg/adx-dl/actions/runs/38163645947) | Passed on runner 21 |
| Dash | [38163651109](https://github.com/AdingApkgg/adx-dl/actions/runs/38163651109) | Passed on runner 21 |
| Host and non-root job-container smoke | [38163926113](https://github.com/AdingApkgg/adx-dl/actions/runs/38163926113) | Passed on runner 21 |

Run `38163636445` passed the host Docker/service/workspace smoke; its still-queued job-container check was canceled to apply the non-root volume-owner fix before it executed. No root-owned workspace repair was necessary.

Community passed 688 test executions: shared UI 38, Bun unit/integration 575, interactive 24, and built-server HTTP 51. PostgreSQL 18 and Redis 8 service pulls succeeded. Both Dockerfile dependency-install steps completed, with `registry.npmjs.org` requests recorded on the proxy upstream. The built image `community:ci-38163641140-1` was removed without pruning shared caches or other images. Dash's schema/type/test/build steps also all succeeded.

The final Web run completed successfully with 698 Bun tests and 38 shared UI tests, including its full site build and cache upload. Eight workers generated 11,750 pages in 77 seconds. The site-build step ran from 18:33:14 to 18:39:08 UTC, approximately 5m54s; the job completed at 18:39:47 UTC. Final page optimization accounts for most of the remaining build time. The 8 GiB cgroup peak included file cache, and observed OOM/OOM-kill counters remained zero.

The final smoke workflow ran both jobs on runner 21. Its job-container check completed in 1m29s with checkout, setup-node, UID 1001, executable, workspace, and `/__t` assertions passing; host smoke took 19 seconds. Afterward, sampled workspace, Git metadata (95 entries), and Node-cache metadata (15 entries) retained UID 1001 ownership, with no root-owned entries in the checked ranges. Workflows that build Docker images inside a job container still need explicit proxy build arguments or their own proxy-only Docker CLI configuration, as described in the management README.

After all final checks, GitHub reported runner 21 online with `busy=false`; the persistent runner and private Docker service remained running, with the daemon healthy.

## Scope and remaining limits

Public pull-request jobs remain GitHub-hosted. The host-side hook independently admits only approved events, workflows, repository identity, and trusted refs. Persistent workers assume trusted branch code. Privileged DinD is not a VM-grade security boundary against malicious trusted workloads.

Pages builds use the remote runner; Pages publication, IndexNow submission, and the `pages-live` update remain GitHub-hosted. The build passes its generated catalog to the publication job. No production publication was triggered to validate this installation, so the split publication path is reviewed and linted but not yet exercised end to end.

Next 16 site-build steps cap static-generation workers at eight; other repositories do not inherit this override. See [the management README](../../scripts/ci/README.md) to add a repository or worker.
