# dash

Admin dashboard for the AstroDX site repo: a React Router 8 SPA served by a
Hono process, gated by Cloudflare Access, backed by a GitHub App that can
read and write `AdingApkgg/adx-dl`.

## Local development

Run these from `apps/dash` (in two terminals):

```bash
bun run dev    # Vite dev server on :5273, proxies /api/* to :3000
bun run start  # Hono server on :3000 (reads apps/dash/.env)
```

Open `http://localhost:5273`. `bun run check` runs `tsc --noEmit` plus the
test suite (`bun test`) and should be clean before every commit.

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Meaning |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Access team domain, e.g. `https://saop-pages.cloudflareaccess.com`. No trailing slash. Used to build the JWKS URL and validate the JWT `iss` claim. |
| `CF_ACCESS_AUD` | The Access application's Application Audience (AUD) Tag. Only exists once the Access application has been created in the Zero Trust dashboard — see below. |
| `GITHUB_APP_ID` | `5020220` — the AstroDX dash GitHub App. |
| `GITHUB_APP_PRIVATE_KEY` | The App's private key (PEM). Write it as a single line with literal `\n` in place of newlines; `env.ts` unescapes them. |
| `GITHUB_APP_INSTALLATION_ID` | `163475623` — the installation on `AdingApkgg/adx-dl`. |
| `GITHUB_REPO_OWNER` / `GITHUB_REPO_NAME` | `AdingApkgg` / `adx-dl`. |
| `PORT` | Optional, defaults to `3000`. |
| `DASH_CLIENT_ROOT` | Optional, defaults to `./build/client`. Where the Hono server serves the built SPA from. |

The GitHub App has Contents RW, Actions RW, Pull requests RW, and Metadata R
on `AdingApkgg/adx-dl`, and no webhook configured — the design polls the
GitHub API rather than receiving events.

## Container image

`Dockerfile` builds in two stages:

- **builder** (`oven/bun:1.3.14`): installs the full workspace (the lockfile
  lives at the repo root, so the build context is the repo root, not
  `apps/dash` — see `compose.yaml`'s `context: ../..`), then runs
  `bun run build` (the SPA, via `react-router build`) and
  `bun run build:server` (bundles `src/server/main.ts` into a single
  `dist/server.js` with `bun build --target=bun`).
- **runner** (`oven/bun:1.3.14-slim`): copies only `dist/server.js` and
  `build/client` out of the builder — no `node_modules`. The bundle is
  ~0.40 MB and runs standalone.

## Deployment on g510

The container runs on the home server **g510** (Arch Linux, hostname `arch`,
LAN `192.168.1.3`), reached over SSH through its own Cloudflare Access
tunnel:

```bash
ssh -o ProxyCommand='/opt/homebrew/bin/cloudflared access ssh --hostname ssh-g510.saop.cc' i@ssh-g510.saop.cc
```

g510 already runs two token-based (remotely-managed) `cloudflared` tunnels
as templated systemd units (`cloudflared@<uuid>.service`); their ingress
rules live in the Cloudflare dashboard, not in a local `config.yml`. dash
reuses one of those tunnels rather than running its own `cloudflared`
container: a Public Hostname entry in the Cloudflare dashboard points at
`http://localhost:3000` on the host. Because of that, `compose.yaml` binds
the container's port to `127.0.0.1:3000` on the host — see the comment in
that file for why `0.0.0.0` or a bare `3000:3000` publish would be a
security hole (LAN-wide access to a repo-write-credentialed backend).

Port 3000 is confirmed free on g510; it doesn't collide with nginx (80/443),
the chart vhost (12701), or the pageview counter (12700). The compose
project is named `astrodx-dash` to keep it independent of those.

### First deploy / updating

From `apps/dash` on g510:

```bash
git pull && docker compose up -d --build
docker compose ps
docker compose logs --tail=50
```

Expect the container to reach `running (healthy)` and the log line
`dash listening on :3000 (repo AdingApkgg/adx-dl)`.

### Mandatory negative check

Run this after any change to auth or deployment config — on g510, not
through the tunnel:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/me
# must print 403

curl -s http://127.0.0.1:3000/api/ping
# must print {"ok":true}
```

This matters because the container's port is bound on the host
(`127.0.0.1:3000`). Cloudflare Access normally sits in front of the tunnel,
but once the port is exposed on the host, the JWT check inside the app is
the *only* thing standing between any process on g510 and a backend that
can write to the repository. If `/api/me` ever returns anything other than
`403` without a valid Access assertion, the Access middleware is not
actually doing its job — stop and fix it before doing anything else.
`/api/ping` must stay open (`{"ok":true}`) since it's the container
healthcheck endpoint, registered before the Access middleware on purpose.
