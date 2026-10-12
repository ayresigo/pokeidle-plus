# External Integrations

**Analysis Date:** 2026-10-12

## APIs & External Services

**Game backend — Poke Idle World (`https://poke.idleworld.online`):**
- The automated target. Workers act as a headless game client (no browser). Protocol research and selectors live in `packages/worker/GAME.md`.
  - SDK/Client: `undici` `fetch` + `WebSocket` (`packages/worker/src/http.ts`, `packages/worker/src/game/client.ts`); every request goes through the account's optional proxy dispatcher and a 15 s `AbortSignal.timeout` (`TIMEOUT_HTTP_MS`).
  - Auth: per-account game tokens (`ACCESS_TOKEN`/`REFRESH_TOKEN`) or game credentials (`POKEIDLE_USER`/`POKEIDLE_PASS`) + captcha solver; injected into the worker container env by the control-plane (`apps/control-plane/src/workers/routes.ts` → `montarEnv`).
  - Base URL: `GAME_URL` (control-plane default `https://poke.idleworld.online` in `apps/control-plane/src/app.ts`; required in worker `packages/worker/src/config.ts`).
  - REST endpoints used:
    - `POST /api/auth/login` body `{ identifier, password, captchaToken }` → `{ accessToken, refreshToken }`; `twoFactor` in the response is rejected as unsupported (`packages/worker/src/auth/provider.ts` → `loginComCaptcha`)
    - `POST /api/auth/refresh` body `{ refreshToken }`, retried with backoff `[1s, 2s, 4s]` on network errors/5xx/429 (`packages/worker/src/auth/refresh.ts`); access-token expiry read from the JWT `exp` (60 s margin, 30 s floor in `provider.ts`)
    - `GET /api/game/map-markers` (unauthenticated) to pick a hunt when `HUNT_SLUG` is unset (`packages/worker/src/game/client.ts` → `buscarHunts`)
    - `GET /login` and `/_next/static/chunks/*.js` to scrape the Cloudflare Turnstile sitekey (`packages/worker/src/auth/solver.ts` → `descobrirSitekey`); override with `TURNSTILE_SITEKEY`
  - WebSocket: `wss://<game>/ws?token=<accessToken>&v=2` with header `Origin: <GAME_URL>`. Sharded by DJB2 hash of the JWT `sub` over `GAME_WS_SHARDS` (default 88) → path `/ws<N>` (`montarUrlWs` in `packages/worker/src/game/client.ts`). Overrides: `GAME_WS_URL`, `GAME_WS_PATH` (default `/ws`).
    - Messages sent: `restart-state`, `balls-get`, `enter-hunt {slug, resume}`, `leave-hunt`, `set-city {slug}`, `restart-resume`, `ping`
    - Messages handled (per fake game): `field-init`, `field-kill`, `field-none`, `balls`, `pong`
    - Close codes with meaning: `4001` auth refused, `4003` maintenance, `4005` session replaced (another login), plus terminal codes in `FECHAMENTOS_TERMINAIS`
    - Heartbeat: check every 10 s, ping after 45 s silence, 15 s ping deadline; reconnect backoff 1.5 s → 24 s (5-min long cap after 5 failures)
  - Edge protections: Cloudflare (challenge platform + Turnstile on login). No `cmid` fingerprint is sent. See `packages/worker/GAME.md` §6.

**Captcha solver — 2Captcha-compatible API (`https://api.2captcha.com`):**
- Solves the game's Cloudflare Turnstile so the worker can log in without stored tokens.
  - SDK/Client: hand-rolled JSON calls via the worker `HttpFetch` (`packages/worker/src/auth/solver.ts` → `resolverTurnstile`)
  - Endpoints: `POST {SOLVER_API_URL}/createTask` with `{ clientKey, task: { type: "TurnstileTaskProxyless", websiteURL, websiteKey } }`, then `POST {SOLVER_API_URL}/getTaskResult` polled every 5 s up to 24 times; `errorId !== 0` → `SolverError`
  - Auth: `SOLVER_KEY` (per-account `solverKeyEnc` stored encrypted in central; requires `POKEIDLE_USER` + `POKEIDLE_PASS`)
  - Base URL: `SOLVER_API_URL` (default `https://api.2captcha.com`, `DEFAULT_SOLVER_API_URL` in `packages/worker/src/config.ts`)
  - Note: proxyless task means the captcha is solved from the solver's IP, not the account proxy.

**Per-account outbound proxies (user-supplied):**
- Each account may set `proxyUrl` (`http://`, `https://` or `socks5://`, validated by `REGEX_PROXY_URL` in `apps/central-api/src/accounts/routes.ts` and `PROXY_PROTOCOLS` in `packages/worker/src/config.ts`).
  - Client: `undici` `ProxyAgent` / `Socks5ProxyAgent` (`criarDispatcher` in `packages/worker/src/http.ts`), applied to both REST and WebSocket traffic to the game. Solver calls also go through `criarFetch(proxyUrl)`.
  - Env: `PROXY_URL` in the worker container.

**IP echo — ipify (`https://api.ipify.org`):**
- Used by control-plane `POST /proxy/test` to verify a proxy's exit IP. Runs a one-shot `curlimages/curl` container: `curl -s --max-time 15 -x <proxyUrl> https://api.ipify.org`, 20 s total timeout, then removes the container (`apps/control-plane/src/proxy/routes.ts`).

**Central API (first-party, `https://pokeidle.ayresigo.dev`):**
- Multi-tenant backend that stores users, game accounts (encrypted secrets) and the release catalog. Consumed by the local control-plane and by the release workflow.
  - Client: global `fetch` in the control-plane (`apps/control-plane/src/session/store.ts`, `apps/control-plane/src/central/repasse.ts`, `apps/control-plane/src/workers/routes.ts`, `apps/control-plane/src/update/manager.ts`); `curl` + `jq` in `.github/workflows/release.yml`
  - Auth: `Authorization: Bearer <JWT>` obtained via `POST /auth/login`; base URL from `CENTRAL_API_URL`
  - Endpoints (`apps/central-api/src/*/routes.ts`):
    - `GET /health` (public)
    - `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` (public, body-validated); `GET /auth/me` (Bearer)
    - `GET|POST /accounts`, `PATCH|DELETE /accounts/:id`, `GET /accounts/:id/credentials` (returns decrypted secrets), `PUT /accounts/:id/tokens` — Bearer, scoped to `request.userId`
    - `GET /version?channel=<stable|beta>` (Bearer) → `{ version, channel, imageDigest, changelog, publishedAt }`; `POST|GET /admin/releases` (admin)
    - `GET|POST /admin/users`, `PATCH /admin/users/:id` (admin)
  - Control-plane relays `/accounts*` and `/admin/users*` to central with the stored session token (`criarRepasse` in `apps/control-plane/src/central/repasse.ts`); central 5xx/network errors map to 502, missing session to 503 `"central inalcançável"`.
  - Update check: control-plane polls `GET /version?channel=stable` every 6 h (`INTERVALO_PADRAO_MS` in `apps/control-plane/src/update/manager.ts`); the channel is hardcoded to `stable`.

**Docker Engine API (local host):**
- The control-plane and updater manage containers on the user's machine through the mounted socket `/var/run/docker.sock`.
  - SDK/Client: `dockerode` (`new Docker()` default socket)
  - Control-plane (`apps/control-plane/src/orchestrator/orchestrator.ts`): create/start/stop/remove `mpw-worker-<accountId>` containers labelled `mpw.managed=true` + `mpw.account-id=<id>`, on network `WORKER_NETWORK`; pull images on 404; stream logs; create `mpw-updater` with the socket bind-mounted and `TARGET_TAG=<version>`; one-shot containers (proxy test).
  - Updater (`packages/updater/src/docker.ts`, `packages/updater/src/atualizar.ts`): finds containers by label `mpw.role` (`control-plane`, `web`), pulls `<repo>:<TARGET_TAG>`, renames/recreates them preserving user env, networks and config (`packages/updater/src/recriacao.ts`).
  - E2E harness shells out to the `docker` CLI (`e2e/docker.ts`).
- Internal HTTP between containers on the `mpw` network: control-plane polls `http://mpw-worker-<accountId>:3001/health` (`apps/control-plane/src/supervisor/supervisor.ts`, `apps/control-plane/src/update/manager.ts`); the health body may include renewed game tokens, which the control-plane writes back to central via `PUT /accounts/:id/tokens`.

**Web panel → control-plane (local BFF proxy):**
- Browser calls same-origin `/cp/*` (`API_BASE` in `apps/web/lib/api.ts`); the Next.js route handler `apps/web/app/cp/[...path]/route.ts` forwards GET/POST/PUT/PATCH/DELETE to `CONTROL_PLANE_URL` (default `http://localhost:4000`), strips hop-by-hop headers, passes SSE through with `cache-control: no-cache, no-transform` + `x-accel-buffering: no`.
- Host allowlist: only `localhost`, `127.0.0.1`, `[::1]` plus `ALLOWED_HOSTS` (comma-separated); requests with a body must have a matching `Origin`. Violations → 403.
- Real-time: `EventSource("/cp/events")` (`apps/web/components/Dashboard.tsx`, events `snapshot`/`update`) and fetch-based SSE for `/cp/workers/:accountId/logs/stream` (`apps/web/components/LogStream.tsx`).

## Data Storage

**Databases:**
- PostgreSQL 16 (central only)
  - Connection: `DATABASE_URL` (`postgresql://...`)
  - Client: Prisma 7.10 `PrismaClient` + `@prisma/adapter-pg` (`pg` 8.23.1); schema `apps/central-api/prisma/schema.prisma`
  - Tables: `users` (argon2 `passwordHash`, `role` enum `admin|user`, `active`), `refresh_tokens` (SHA-256 `tokenHash`, `expiresAt`, `revokedAt`), `accounts` (`pokeidlePassEnc`, `accessTokenEnc`, `refreshTokenEnc`, `solverKeyEnc` as `Bytes`, plus `proxyUrl`), `releases` (unique `[version, channel]`, `imageDigest`, `changelog`)
  - Migrations: `apps/central-api/prisma/migrations/20261011192400_init`, `20261011193000_releases_version_channel_unique`; applied with `prisma migrate deploy` at container start (`docker/Dockerfile.central-api`) and in CI
  - Seed: `apps/central-api/prisma/seed.ts` idempotently creates the admin from `ADMIN_USERNAME`/`ADMIN_PASSWORD` on every start
  - Production: shared Postgres `postgres.tcgtracker.svc.cluster.local`, database `pokeidle`, role `pokeidle` (non-superuser) — per `README.md` and `k8s/base/postgres-backup-cronjob.yaml`
  - Dev: `docker/docker-compose.dev.yml` (`mpw_dev`); CI: service container `mpw_test` (`.github/workflows/ci.yml`); VPS: `postgres:16` in `docker-compose.central.yml`
- Encryption at rest for account secrets: AES-256-GCM with `SECRETS_KEY` (32-byte hex); payload layout `nonce(12) | ciphertext | tag(16)` (`apps/central-api/src/crypto/secrets.ts`). Losing `SECRETS_KEY` makes stored credentials unreadable.

**File Storage:**
- Local filesystem only. Control-plane JSON state in `DATA_DIR` (default `/data`, Docker volume `mpw-data` → `mpw_mpw-data`): `session.json` (central refresh token + profile), `settings.json` (`autoUpdate`), `rollback.json` (previous worker version/digest), `update-failed.json`.
- Backups: `k8s/base/postgres-backup-cronjob.yaml` writes `pg_dump` files to PVC `pokeidle-backup-pvc` (2Gi) daily at 03:30, 14-day retention.

**Caching:**
- None (in-memory only: access-token cache and single-flight refresh in `apps/control-plane/src/session/store.ts`; `SECRETS_KEY` buffer cache in `apps/central-api/src/crypto/secrets.ts`).

## Authentication & Identity

**Auth Provider:**
- Custom (central-api), no third-party IdP.
  - Implementation: username/password verified with argon2 (`apps/central-api/src/auth/service.ts`; constant-time dummy hash for unknown users). Issues HS256 JWT access tokens (15 min, claims `sub`=user id, `role`) signed with `JWT_SECRET`, plus opaque 32-byte refresh tokens (30 days) stored as SHA-256 hashes and rotated on every refresh. Guards `requireAuth` / `requireAdmin` in `apps/central-api/src/auth/guard.ts`.
  - Control-plane session: logs into central on behalf of the local user, persists the refresh token in `session.json`, refreshes access tokens on demand; 7-day offline grace (`GRACE_MS`) lets read-only routes work when central is unreachable (`apps/control-plane/src/session/store.ts`, guard `requireSession({ precisaCentral })` in `apps/control-plane/src/auth/guard.ts`). The control-plane itself has no separate user store.
  - Web panel: no auth of its own; relies on the control-plane session via `/cp/auth/login`, `/cp/auth/session`, `/cp/auth/logout` (`apps/web/lib/api.ts`). Network exposure limited to `127.0.0.1:3000` plus host/origin checks.
- Game identity: per-account game JWTs (`pokeweb:tokens` from the game's `sessionStorage`, pasted by the user per `README.md`) or automated login via Turnstile solver. Accounts with 2FA are unsupported.

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry or equivalent).

**Logs:**
- Fastify instances are created without a logger (`Fastify()` in `apps/control-plane/src/app.ts`; central-api only sets `ajv` options), so `request.log`/`app.log` calls are no-ops unless a logger is configured.
- Worker and updater write plain `console.log`/`console.error` lines prefixed with the account id (`packages/worker/src/index.ts`) or `[updater]` (`packages/updater/src/main.ts`); collected by Docker and streamed to the UI via SSE (`/workers/:accountId/logs/stream`).
- Health endpoints: central-api `GET /health` (k8s readiness/liveness probes), control-plane `GET /health` (compose healthcheck), worker `GET /health` JSON on `HEALTH_PORT` 3001 with `state` (`booting|authenticating|in-game|needs-login|error`), `lastAction`, `lastError`, `uptimeSec`, optional renewed `tokens` (`packages/worker/src/health.ts`).
- Next.js telemetry disabled (`NEXT_TELEMETRY_DISABLED=1` in `docker/Dockerfile.web` and CI).

## CI/CD & Deployment

**Hosting:**
- Central API: Kubernetes cluster `tcgreaper`, namespace `pokeidle`, Traefik ingress + cert-manager `letsencrypt-prod` TLS for `pokeidle.ayresigo.dev` (`k8s/base/`). Applied manually: `kubectl --context tcgreaper apply -k k8s/base`; version pinned by `newTag` in `k8s/base/kustomization.yaml` (currently `0.0.1-beta.1`).
- End-user stack: user's own machine via `docker-compose.yml` (images pulled with `pull_policy: always`).
- Container registry: GitHub Container Registry `ghcr.io/ayresigo/mpw-*` (public packages; `IMAGE_REGISTRY` overrides).

**CI Pipeline:**
- GitHub Actions.
  - `.github/workflows/ci.yml` (push to `main`, PRs, `workflow_call`): Ubuntu 24.04, Postgres 16 service, `pnpm install --frozen-lockfile`, `prisma generate` + `migrate deploy`, `tsc --noEmit` for central-api/control-plane/worker/updater, `pnpm -r test`, web lint + build.
  - `.github/workflows/release.yml` (tags `v*`): validates semver (pre-release → channel `beta`, else `stable`) → reuses CI → builds/pushes 5 images multi-arch with GHA cache → reads worker digest via `docker buildx imagetools inspect` → logs into central and `POST /admin/releases` `{ version, channel, imageDigest, changelog }` (changelog = annotated tag message or `git log` since previous tag, max 8192 chars; HTTP 409 treated as already published) → moves `:stable`/`:beta` tags with `docker buildx imagetools create`.
  - Actions used: `actions/checkout@v7`, `actions/setup-node@v7`, `docker/setup-qemu-action@v4`, `docker/setup-buildx-action@v4`, `docker/login-action@v4`, `docker/build-push-action@v7`.
- Client self-update: control-plane compares `APP_VERSION` with central `/version`, recreates workers on the release `imageDigest`, and launches the `mpw-updater` container to recreate the `control-plane` and `web` containers on the new tag; rollback info kept in `rollback.json` (`apps/control-plane/src/update/manager.ts`, `packages/updater/src/atualizar.ts`).

## Environment Configuration

**Required env vars:**
- central-api: `DATABASE_URL`, `JWT_SECRET` (≥ 32 chars), `SECRETS_KEY` (64 hex chars), `ADMIN_USERNAME`, `ADMIN_PASSWORD`; optional `PORT` (8080)
- control-plane: `CENTRAL_API_URL` (required by `docker-compose.yml`; code default `http://localhost:8080`); optional `IMAGE_REGISTRY`, `WORKER_IMAGE`, `WORKER_NETWORK`, `CONTROL_PLANE_URL` (URL workers use to reach it; default `http://host.docker.internal:4000`), `GAME_URL`, `AUTO_UPDATE` (`"true"` enables; `settings.json` overrides), `CURRENT_VERSION`/`APP_VERSION`, `DATA_DIR`, `PORT` (4000)
- web: `CONTROL_PLANE_URL`, optional `ALLOWED_HOSTS`, `PORT`/`HOSTNAME` (set in image)
- worker (set by control-plane): `ACCOUNT_ID`, `GAME_URL`, and either `ACCESS_TOKEN`+`REFRESH_TOKEN` or `SOLVER_KEY`+`POKEIDLE_USER`+`POKEIDLE_PASS`; optional `PROXY_URL`, `CONTROL_PLANE_URL`, `HEALTH_PORT`, `SOLVER_API_URL`, `TURNSTILE_SITEKEY`, `GAME_WS_URL`, `GAME_WS_PATH`, `GAME_WS_SHARDS`, `HUNT_SLUG`
- updater (set by control-plane): `TARGET_TAG`
- user `.env` for `docker-compose.yml`: `CENTRAL_API_URL`, optional `IMAGE_REGISTRY`, `MPW_TAG`, `AUTO_UPDATE`, `ALLOWED_HOSTS`
- VPS `.env` for `docker-compose.central.yml`: `POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRETS_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, optional `CENTRAL_PORT`
- E2E toggles: `E2E_SKIP_BUILD=1`, `E2E_KEEP=1`; fake game: `PORT`, `FAKE_KILL_MS`
- GitHub Actions: repository variable `CENTRAL_API_URL`; secrets `CENTRAL_ADMIN_USERNAME`, `CENTRAL_ADMIN_PASSWORD` (dedicated `ci-release` admin); built-in `GITHUB_TOKEN` for GHCR push

**Secrets location:**
- Kubernetes Secret `pokeidle-secrets` in namespace `pokeidle`, created manually from the template `k8s/base/secrets.example.yaml` (template exists; never commit the real Secret); mounted via `envFrom` in `k8s/base/central-api.yaml` and `POSTGRES_PASSWORD` key used by the backup CronJob.
- Local/VPS: `.env` files (gitignored); templates `.env.example` (root) and `apps/central-api/.env.example` exist.
- GitHub repository secrets/variables for the release job.
- Game credentials, game tokens and solver keys: encrypted in the central `accounts` table; decrypted only by `GET /accounts/:id/credentials` and passed as worker container env.
- Test-only fixed secrets are inlined in `.github/workflows/ci.yml`, `e2e/docker-compose.e2e.yml` and test files (non-production values).

## Webhooks & Callbacks

**Incoming:**
- None (no third-party webhooks). Internal callbacks only: workers expose `/health` polled by the control-plane; central `POST /admin/releases` is called by the release workflow.

**Outgoing:**
- None to third-party webhook endpoints. Outbound calls are request/response: game REST/WS, captcha solver, ipify (proxy test), central API, GHCR image pulls.

## Test Doubles

**Fake game server (`e2e/fake-game/server.ts`, image `ghcr.io/ayresigo/mpw-fake-game:e2e`):**
- Implements `GET /health`, `GET /api/game/map-markers`, `POST /api/auth/refresh` (always 401), `POST /__e2e/kick` (closes sockets with 4005) and WS on `/ws\d*` accepting only the fixed JWT from `e2e/fake-game/token.ts`. E2E never touches the real game or GHCR.
- Unit tests use `ws` `WebSocketServer` fakes and `vi.stubGlobal("fetch", ...)` for central/game HTTP (`packages/worker/src/game/client.test.ts`, `apps/control-plane/src/**/routes.test.ts`).

---

*Integration audit: 2026-10-12*
