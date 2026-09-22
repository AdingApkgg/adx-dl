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
| `CF_ACCESS_TEAM_DOMAIN` | **Confirmed:** `https://saop-pages.cloudflareaccess.com`. This is the real team domain — verified against this Mac's local Access cache (`~/.cloudflared/saop-pages.cloudflareaccess.com-jwks`), not a placeholder. No trailing slash. Used to build the JWKS URL and validate the JWT `iss` claim. |
| `CF_ACCESS_AUD` | **Confirmed, deployed.** The Access application's Application Audience (AUD) Tag, generated when the Access application was created in the Zero Trust dashboard. It is now set in `apps/dash/.env` on g510 — verified by observing the JWKS `kid` in the login redirect from an unauthenticated request, which matches this value exactly. |
| `DASH_PUBLIC_ORIGIN` | **Required, no default.** The origin the browser actually sends (`https://adxdls-dash.saop.cc` for this deployment, no trailing slash). Passed to `hono/csrf`'s `origin` option to reject cross-origin writes (see Finding I-2). Must be set explicitly: this process sits behind `cloudflared`, so the origin Hono would otherwise derive from the incoming request is the tunnel's local address (`http://localhost:12702`), not the public domain the browser sends — the two never match, so there is no safe default to fall back to. `parseEnv` throws if it's unset, the same fail-fast treatment as the other required variables: a container that starts up looking healthy with this protection silently disabled is worse than one that refuses to start. **This means an existing deployment's `.env` on g510 must be updated with this variable before/when this change ships, or the container will fail to start.** |
| `GITHUB_APP_ID` | `5020220` — the AstroDX dash GitHub App. |
| `GITHUB_APP_PRIVATE_KEY` | The App's private key (PEM). Write it as a single line with literal `\n` in place of newlines; `env.ts` unescapes them. |
| `GITHUB_APP_INSTALLATION_ID` | `163475623` — the installation on `AdingApkgg/adx-dl`. |
| `GITHUB_REPO_OWNER` / `GITHUB_REPO_NAME` | `AdingApkgg` / `adx-dl`. |
| `PORT` | Optional, defaults to `3000`. This is the port the Hono process itself listens on *inside* the container (or locally) — not the host-published port on g510, which is 12702 (see "Deployment on g510" below). |
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
container: a Public Hostname entry in the Cloudflare dashboard should
point at **`http://localhost:12702`** on the host. That entry is created by
hand in the Zero Trust console (Access → Applications → the dash
application → its tunnel's Public Hostname) — it is not part of anything
this repo runs.

The deployed public hostname is **`adxdls-dash.saop.cc`**.

**Caution — stick to one subdomain level.** An earlier attempt used a
three-level subdomain (e.g. `dash.adx.saop.cc`-shaped). It failed TLS,
because Cloudflare's Universal SSL certificate on this zone covers only
`saop.cc` and `*.saop.cc` — exactly one level of subdomain, not two. Any
new Public Hostname for this project (or a future one) must be a direct
`*.saop.cc` name, or it needs its own certificate arranged first.

The container listens on port **3000 inside the container** — that part
never changes, and the healthcheck (which runs inside the container) still
targets `127.0.0.1:3000`. Only the *published* host-side port is different:
`compose.yaml` binds it as `127.0.0.1:12702:3000`, i.e. host port 12702
forwards to the container's port 3000. See the comment in that file for why
the bind must stay `127.0.0.1`-scoped — publishing on `0.0.0.0` (or a bare
`12702:3000`, which docker treats the same way) would be a security hole
(LAN-wide access to a repo-write-credentialed backend).

Port 12702 is confirmed free on g510; it doesn't collide with nginx
(80/443), the chart vhost (12701), or the pageview counter (12700). It sits
in the same range as those other AstroDX services. Port 3000 is
deliberately not published on the host at all. The compose project is
named `astrodx-dash` to keep it independent of those other services.

### First deploy / updating

From `apps/dash` on g510:

```bash
git pull && docker compose up -d --build
docker compose ps
docker compose logs --tail=50
```

Expect the container to reach `running (healthy)` and the log line
`dash listening on :3000 (repo AdingApkgg/adx-dl)`.

**Before pulling the commit that introduces `DASH_PUBLIC_ORIGIN`** (Finding
I-2's csrf protection), add it to `apps/dash/.env` on g510 —
`DASH_PUBLIC_ORIGIN=https://adxdls-dash.saop.cc` — first. It's a required
variable with no default; `docker compose up -d --build` will build fine
but the container will exit immediately (`环境变量有问题：- DASH_PUBLIC_ORIGIN
未设置`) without it.

**The clone on g510 is a sparse, partial checkout, not a full clone.** It
was created with `--filter=blob:none --sparse`, limited to the paths the
Docker build actually needs, with a repo-local proxy configured. A full
clone of the whole repository over that link runs at a few KB/s and is not
practical. If this is ever set up again on a fresh machine, replicate the
sparse + partial + proxy setup rather than doing a plain `git clone` —
plan for that up front, since converting a full clone into a sparse one
after the fact is more work than starting sparse.

### Mandatory post-change smoke checklist

Run this after **any** change to auth, deployment config, or the
workflows. It is not optional — the first item is the one thing standing
between any process on g510 and a backend that can write to the
repository, so if it fails, stop and fix it before checking anything else.
Below each step is the result it actually produced the one time this was
run end-to-end against the live deployment (commit `3c6c5db`,
2026-09-22) — treat a different result as a regression, not as "probably
fine."

1. **Host-direct 403 check (leads the list; most important step).** On
   g510 itself, not through the tunnel:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:12702/api/me
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:12702/api/runs
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:12702/api/events
   ```

   Expected: **403** for all three, every time. `compose.yaml` binds the
   container's port on the host (`127.0.0.1:12702`); Cloudflare Access
   normally sits in front of the tunnel, but once a port is exposed on the
   host at all, the JWT check inside the app is the *only* thing standing
   between any process on g510 and a backend that can write to the
   repository. `/api/events` (the SSE stream) must also 403 and must not
   hang — the auth denial has to short-circuit before streaming starts.
   Actually observed: all three returned 403, and `/api/events` did not
   hang.

2. **Healthcheck endpoint stays open:**

   ```bash
   curl -s http://127.0.0.1:12702/api/ping
   ```

   Expected: `{"ok":true}` — it's registered before the Access middleware
   on purpose, since it's also the container healthcheck target (hit
   internally at `127.0.0.1:3000`). Actually observed: `{"ok":true}`.

3. **LAN unreachability.** From another machine on the LAN (not g510
   itself):

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://192.168.1.3:12702/api/ping
   ```

   Expected: connection failure / unreachable — the bind is
   `127.0.0.1`-scoped, so nothing off-host should be able to reach the
   port at all. Actually observed: unreachable.

4. **Public, unauthenticated access redirects to Access login.** From any
   browser, not logged in:

   ```
   https://adxdls-dash.saop.cc/
   https://adxdls-dash.saop.cc/api/me
   ```

   Expected: **302** to
   `https://saop-pages.cloudflareaccess.com/cdn-cgi/access/login/adxdls-dash.saop.cc?kid=...`.
   Check that the `kid` query parameter matches `CF_ACCESS_AUD` in the
   deployed `.env` — if it doesn't, the wrong Access application is
   fronting this hostname. Actually observed: 302 to that login page, `kid`
   matched `CF_ACCESS_AUD` exactly.

5. **Logged in, through Cloudflare Access, in a browser:**
   - `/` renders with the correct email and `AdingApkgg/adx-dl`, no
     `repoError`.
   - `/actions` lists runs with status, trigger source and duration,
     matching the GitHub web UI.
   - Click "触发 Dash check" (or any dispatchable workflow). Expected: a
     new run appears in the list **without a manual refresh**, and its
     status advances to completion on its own via the SSE stream.
     Actually observed once end to end: the first click hit a workflow
     that did not yet have a `workflow_dispatch` trigger and returned
     GitHub's 422 verbatim (`{"error":"GitHubRequestError: Workflow does
     not have 'workflow_dispatch' trigger - ..."}`) — that was the correct
     behavior for that state. After `workflow_dispatch` was added and
     merged to `main`, clicking again worked: a new run appeared
     automatically and reached `success` on its own (independently
     confirmed via the API: run `35634055473`,
     `event=workflow_dispatch`, `conclusion=success`).
   - Open a historical failed run, if one exists, and confirm the failed
     step and the tail of its log are visible in the run detail view.

**Known rough edges, not regressions:** the "触发" (trigger) button
renders for every workflow, including GitHub's own
`pages-build-deployment`, which cannot be dispatched — GitHub's
workflow-list API doesn't report whether a workflow accepts
`workflow_dispatch`, so the client can't filter it out in advance. The
422 text is clear enough that this is tolerable. Separately, dispatch
always targets the repository's default branch; the UI has no ref
picker even though `POST /api/workflows/:workflowId/dispatch` accepts
one — a real gap now that the repo uses a `dev` → `pre` → `main` model,
but not a checklist failure.

**Known unverified item:** `DASH_PUBLIC_ORIGIN` and the `hono/csrf` check it
feeds (Finding I-2) have only been verified with `bun test`'s in-process
`app.request()`, never against the real tunnel. The risk this test suite
cannot rule out: if `cloudflared`, Cloudflare Access, or some proxy in
between rewrites or strips the `Origin` header before it reaches the
container, every real POST from the deployed UI (触发/重跑/取消) would
start failing with 403 even though `DASH_PUBLIC_ORIGIN` is configured
correctly. After the next deploy, click "触发" once and confirm it still
works (202, run appears) before trusting this is fully verified — if it
403s instead, check `docker logs` for a `[api] POST ... -> 403: (no error
message)` line, which confirms it's this check (not accessJwt, which logs
its own distinct `[access-jwt] rejected: ...` line) rejecting the request.

**Known unverified item:** the `paths-ignore: ['apps/dash/**']` rule on
`deploy-gh-pages.yml` has never actually been demonstrated. The merge to
`main` in step 5 above did trigger the site deploy workflow, but that
push also touched `bun.lock`, `.github/` and `pipeline/` — all outside
the ignore rule — so it proves nothing about whether the rule itself
works. A real check needs a push to `main` that touches **only**
`apps/dash/**`, followed by confirming `deploy-gh-pages.yml` did *not*
run for that push.
