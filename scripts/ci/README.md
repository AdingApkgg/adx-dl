# Personal repository CI runners

The management client only runs SSH, GitHub API requests, and file transfer locally. All managed image builds, runner services, and self-hosted CI jobs run on `i@localhost-1.tailac9c6f.ts.net` (128 logical CPUs). Set `GHA_RUNNER_HOST` to choose another approved remote host.

## AstroDX

```sh
./scripts/ci/runnerctl.sh status
./scripts/ci/runnerctl.sh logs AdingApkgg/adx-dl
./scripts/ci/runnerctl.sh restart AdingApkgg/adx-dl
./scripts/ci/runnerctl.sh stop AdingApkgg/adx-dl
./scripts/ci/runnerctl.sh start AdingApkgg/adx-dl
```

The first worker uses 32 CPU equivalents and an 8 GiB RAM limit, plus a private Docker daemon limited to 16 CPU equivalents and 4 GiB RAM for service containers and image builds. It starts with one worker because the shared server had only about 17 GiB available at installation. These are resource ceilings; CI does not necessarily use every core. Additional instances need a separate command and sufficient available memory.

AstroDX's main-site checks (`web-check.yml`) and the build/archive job in `deploy-gh-pages.yml` run on GitHub-hosted `ubuntu-latest` for every event. Both site-build steps cap Next's static-generation pool at four workers, matching the tested hosted configuration. The self-hosted runner remains available for the other workflows and the Docker/job-container checks in `runner-smoke.yml`; this change does not stop or reconfigure its service.

Both site-build steps load `scripts/ci/runner/next-export-links.cjs` from the checked-out source through `NODE_OPTIONS` and `ASTRODX_CI_EXPORT_LINKS=1`. For Next 16.3.6, it reuses immutable `.next/server/app` prerenders in `out/` via hardlinks instead of duplicating their bytes. Public assets, other paths, non-default copy flags, symlinks and unsupported/cross-device links keep normal copy behavior. An unsupported Next version disables reuse automatically. Scheduled old `pages-live` checkouts without the script use normal copying; no hosted job depends on `/etc/gha-runner` helpers.

After successful static export, both workflows record trace durations and available cgroup memory/I/O counters, then remove `.next/server`. The generated `out/`, diagnostic trace and `.next/cache` remain. Compiler caches use `actions/cache`; the self-hosted cache-move restore/save steps are no longer part of the main-site workflows. Existing local cache data and management helpers are retained for other uses and are not deleted by this change.

Pages packaging keeps the official Linux tar flags, including hardlink dereferencing, and the standard artifact uploader with its default compression. The old `runner-smoke.yml` `pages_archive` mode is retired because it depended on the preceding self-hosted Web CI workspace, which hosted jobs do not retain. The smoke workflow now tests runner health only. Push and PR checks do not publish or move `pages-live`; the existing manual/scheduled Pages publication rules remain unchanged.


The retained self-hosted runner still uses `BUN_INSTALL_CACHE_DIR=/opt/actions-runner/_work/.bun-install-cache`, outside the repository checkout on the same workspace volume. Job containers use its translated `/__w/.bun-install-cache` path. Before recreating an idle worker, preserve its existing Bun cache rather than discarding it; old `/home/runner/.bun/install/cache` contents can be copied into the workspace cache while idle.

Legacy Next compiler cache slots and `next-build-cache.py` remain on the self-hosted work volume, but the main-site workflows no longer call them. Their keys include the Bun lockfile, Node/Bun versions, platform/architecture and absolute workspace path. Slots are retained for rollback and are not successful-build attestations. Symlink and non-directory cache paths remain rejected. Remove old data only through an explicitly authorized idle-worker maintenance task.

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

Job containers share persistent work/tool volumes. Use `container.options: --user 1001:123` for this runner image, matching the volumes' owner. Running checkout or setup actions as container root can leave files that later runner-host jobs cannot clean up. See `runner-smoke.yml` for a Node job-container example.

Calling `add` again for an existing instance preserves its registration and caches. `add` and `start` regenerate Compose from the instance manifest and shared network settings, recreating both containers when that configuration changes; use them only while the runner is idle. The initial default branch plus `main`, `dev`, and `pre` are trusted; scheduled jobs are denied by default for newly added repositories. Review and explicitly update the instance's policy to add scheduled workflows or additional workflow filenames.

## Shared network routing

The installed CI egress service sends CN domains and literal CN IPs directly and other destinations through the existing proxy. Unknown domains use the proxy. Its setup, rule update commands, and actual routing checks are in [proxy/README.md](proxy/README.md).

All repository instances read the following shared file on the remote host, `/home/i/.local/share/gha-runners/network.json`:

```json
{"proxy_url":"http://172.17.0.1:11092"}
```

The manager injects proxy variables into the runner and its private Docker daemon. Initialization also configures Docker CLI defaults, so job/service containers and Dockerfile `RUN` instructions built from runner-host steps inherit the proxy. A workflow that invokes `docker build` inside a job container must pass `--build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY` or configure that container's Docker CLI; the runner's private CLI credentials/configuration are not mounted there. Private/loopback destinations bypass the proxy. Each DinD uses `10.240.0.1/24` and a `10.241.0.0/16` address pool, keeping the host bridge proxy reachable. Check route conflicts before installing on a different host.

After editing shared settings, check GitHub's runner busy state and call `start OWNER/REPO` for each idle instance. `restart` only restarts the listener and does not refresh configuration. Removing `proxy_url` removes an unchanged default written by this manager, while preserving registry credentials, other Docker contexts, and administrator edits. This CI setup does not change the host Docker daemon's network configuration; host-level bootstrap image builds need a separately configured proxy. Administrative workstation Git/GitHub requests also need its working proxy environment.

## Installation and maintenance

```sh
./scripts/ci/runnerctl.sh install
./scripts/ci/runnerctl.sh build
./scripts/ci/runnerctl.sh add AdingApkgg/adx-dl
```

Remote management lives under `/home/i/.local/share/gha-runners`. Every instance has its own Compose project, runner registration/state, workspace, tool cache, Docker data, and policy. Containers use `unless-stopped` restart policies, so they resume when the remote Docker daemon restarts. Stop and restart commands preserve registration and caches; they do not unregister or erase data. Never restart a busy worker without checking its GitHub busy state.

The local client creates a one-hour registration token and sends it on SSH stdin. Long-lived administrative GitHub credentials stay on the workstation. No registration token is written to manifests, Compose environment, source files, or task logs. Runner credentials issued by GitHub are stored only in that instance's private Docker state volume.

The runner uses the official GitHub runner 2.338.0 image with Python, Compose, and the job admission hook added. It runs as UID 1001 without sudo or host-home/host-Docker-socket mounts. The runner shares its private daemon's network namespace, workspace, and tool cache; DinD sees runner state read-only so job containers can mount action executables. An initializer seeds fresh volumes before the daemon starts. DinD requires a privileged sidecar: this is isolation from accidental service/cache conflicts, not a VM-grade boundary against malicious privileged Docker workloads. Only trusted branch jobs are admitted; do not grant untrusted contributors push access to these branches or expose the daemon's port.

The read-only policy and hook reject public PR events and unsupported workflows/refs before user steps. A rejected job terminates its own Runner.Worker; returning a failed hook alone would allow malicious `always()` steps. Persistent state is shared by trusted jobs within one repository. For stronger isolation from compromised trusted code, use a dedicated VM or replace persistent workers with fresh per-job environments.

The listener retains official automatic runner updates. When updating the base image version, change the Dockerfile and manager image tag together, run `install` and `build`, then recreate idle worker containers with their existing volumes. Do not indiscriminately prune host images, volumes, or containers: the server runs other projects.

AstroDX's Pages `resolve`, build/archive, publication, IndexNow submission, and `pages-live` update all use GitHub-hosted runners. The build job sends both the Pages artifact and its generated catalog to the publication job. Installing runners does not itself publish the website.
