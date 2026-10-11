# Personal repository CI runners

The management client only runs SSH, GitHub API requests, and file transfer locally. All image builds, runner services, and CI jobs run on `i@localhost-1.tailac9c6f.ts.net` (128 logical CPUs). Set `GHA_RUNNER_HOST` to choose another approved remote host.

## AstroDX

```sh
./scripts/ci/runnerctl.sh status
./scripts/ci/runnerctl.sh logs AdingApkgg/adx-dl
./scripts/ci/runnerctl.sh restart AdingApkgg/adx-dl
./scripts/ci/runnerctl.sh stop AdingApkgg/adx-dl
./scripts/ci/runnerctl.sh start AdingApkgg/adx-dl
```

The first worker uses 32 CPU equivalents and an 8 GiB RAM limit, plus a private Docker daemon limited to 16 CPU equivalents and 4 GiB RAM for service containers and image builds. It starts with one worker because the shared server had only about 17 GiB available at installation. These are resource ceilings; CI does not necessarily use every core. Additional instances need a separate command and sufficient available memory.

AstroDX's two site-build steps cap Next 16's static-generation pool at eight workers. Docker's CPU quota alone does not change the host CPU count used by Next; the override is scoped to these build steps and does not affect other repositories.

## Add another repository

Run this from an authenticated administrative workstation with `gh`, `jq`, SSH, and repository admin access:

```sh
./scripts/ci/runnerctl.sh add OWNER/REPO
```

Each repository must already have `.github/workflows`. Its current workflow filenames and default branch are recorded in the runner's policy. The automatically assigned custom label is `<repository-name>-ci`; use it in that repository's trusted-branch jobs:

```yaml
runs-on: [self-hosted, linux, x64, repository-name-ci]
```

Keep pull-request jobs on GitHub-hosted runners. The management command does not edit other repositories. For a second worker registered to the same repository:

```sh
./scripts/ci/runnerctl.sh add OWNER/REPO 02
```

Calling `add` again for an existing instance starts the existing configuration without replacing its registration. The initial default branch plus `main`, `dev`, and `pre` are trusted; scheduled jobs are denied by default for newly added repositories. Review and explicitly update the instance's policy to add scheduled workflows or additional workflow filenames.

## Installation and maintenance

```sh
./scripts/ci/runnerctl.sh install
./scripts/ci/runnerctl.sh build
./scripts/ci/runnerctl.sh add AdingApkgg/adx-dl
```

Remote management lives under `/home/i/.local/share/gha-runners`. Every instance has its own Compose project, runner registration/state, workspace, tool cache, Docker data, and policy. Containers use `unless-stopped` restart policies, so they resume when the remote Docker daemon restarts. Stop and restart commands preserve registration and caches; they do not unregister or erase data. Never restart a busy worker without checking its GitHub busy state.

The local client creates a one-hour registration token and sends it on SSH stdin. Long-lived administrative GitHub credentials stay on the workstation. No registration token is written to manifests, Compose environment, source files, or task logs. Runner credentials issued by GitHub are stored only in that instance's private Docker state volume.

The runner uses the official GitHub runner 2.338.0 image with Python, Compose, and the job admission hook added. It runs as UID 1001 without sudo or host-home/host-Docker-socket mounts. The runner shares only its private daemon's network namespace and workspace. DinD requires a privileged sidecar: this is isolation from accidental service/cache conflicts, not a VM-grade boundary against malicious privileged Docker workloads. Only trusted branch jobs are admitted; do not grant untrusted contributors push access to these branches or expose the daemon's port.

The read-only policy and hook reject public PR events and unsupported workflows/refs before user steps. A rejected job terminates its own Runner.Worker; returning a failed hook alone would allow malicious `always()` steps. Persistent state is shared by trusted jobs within one repository. For stronger isolation from compromised trusted code, use a dedicated VM or replace persistent workers with fresh per-job environments.

The listener retains official automatic runner updates. When updating the base image version, change the Dockerfile and manager image tag together, run `install` and `build`, then recreate idle worker containers with their existing volumes. Do not indiscriminately prune host images, volumes, or containers: the server runs other projects.

AstroDX's Pages `resolve`, publication, IndexNow submission, and `pages-live` update remain GitHub-hosted. The remote build sends both the Pages artifact and its generated catalog to the publication job. Installing runners does not itself publish the website.
