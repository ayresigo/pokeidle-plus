# Architecture

**Analysis Date:** 2026-10-12

## Pattern Overview

**Overall:** Distributed hub-and-spoke system in a pnpm TypeScript monorepo — one shared **central API** (multi-tenant, Postgres, runs in Kubernetes) plus a **local stack per user** (Next.js panel + Fastify control-plane) that dynamically orchestrates one **ephemeral Docker container per game account** (worker) through the Docker socket.

**Key Characteristics:**
- Three trust zones: central (`apps/central-api`, k8s at `https://pokeidle.ayresigo.dev`), local stack (`apps/web` + `apps/control-plane`, compose project `mpw` from `docker-compose.yml`), and workers (`packages/worker`, created by dockerode, never declared in compose).
- No local database. All durable domain data (users, accounts, encrypted credentials, releases) lives in central Postgres; the control-plane only persists small JSON files under `/data` (`session.json`, `settings.json`, `rollback.json`, `update-failed.json`).
- Strict chain of calls: browser → `apps/web` route handler `/cp/*` → control-plane → central. The browser never talks to the central API directly; workers never talk to the central API at all (no central credentials in workers).
- Desired-state reconciliation: the control-plane `Supervisor` polls Docker every 10s and restarts crashed workers with exponential backoff; the `UpdateManager` polls `/version` every 6h and performs rolling worker recreation.
- Workers are headless WS/REST clients (`undici` fetch + WebSocket), not browsers; game protocol knowledge is isolated in `packages/worker/src/game/` and documented in `packages/worker/GAME.md`.
- Every image is versioned by a single semver (`VERSION` build-arg → `APP_VERSION` env) and published as `ghcr.io/ayresigo/mpw-<name>:<version>` with moving channel tags `:stable` / `:beta` (`.github/workflows/release.yml`).
- Code identifiers, log messages and API error strings are in Brazilian Portuguese (`buscarCredenciais`, `ErroCentralInalcancavel`, `{ error: "central inalcançável" }`); keep that convention.

## Layers

**Central API (`apps/central-api`):**
- Purpose: Source of truth for users, refresh tokens, PokeIdle accounts (with AES-256-GCM encrypted secrets) and releases; issues JWTs.
- Location: `apps/central-api/src/`, schema in `apps/central-api/prisma/schema.prisma`
- Contains: Fastify app factory (`src/app.ts`), feature route modules (`src/auth/`, `src/accounts/`, `src/releases/`, `src/users/`), crypto helper (`src/crypto/secrets.ts`), admin seed (`prisma/seed.ts`).
- Depends on: PostgreSQL via Prisma 7 + `@prisma/adapter-pg`, `argon2`, `jsonwebtoken`, env `DATABASE_URL`, `JWT_SECRET` (≥32 chars), `SECRETS_KEY` (64 hex chars).
- Used by: control-plane (`SessionStore`, `criarRepasse`, worker routes, `UpdateManager`) and the release workflow (`POST /admin/releases`).

**Control-plane (`apps/control-plane`):**
- Purpose: Local backend-for-frontend and orchestrator. Holds the user's central session, proxies account/user CRUD to central, creates/stops/supervises worker containers, streams logs/status via SSE, runs updates.
- Location: `apps/control-plane/src/`
- Contains: `SessionStore` (`src/session/store.ts`), Docker abstraction `ContainerOrchestrator` + `DockerOrchestrator` (`src/orchestrator/`), `Supervisor` (`src/supervisor/supervisor.ts`), `UpdateManager` (`src/update/manager.ts`), route modules per feature, central passthrough helper (`src/central/repasse.ts`).
- Depends on: central API over HTTPS (`CENTRAL_API_URL`), Docker Engine via `/var/run/docker.sock` (`dockerode`), worker `/health` endpoints on the shared Docker network (`http://mpw-worker-<accountId>:3001/health`), `/data` volume.
- Used by: `apps/web` (through `/cp/*` proxy), the compose healthcheck (`GET /health`).

**Web panel (`apps/web`):**
- Purpose: Local UI (Next.js 16 App Router, React 19, Tailwind 4), bound to `127.0.0.1:3000`.
- Location: `apps/web/app/`, `apps/web/components/`, `apps/web/lib/`
- Contains: pages (all client components), the catch-all proxy route handler `app/cp/[...path]/route.ts`, typed API client `lib/api.ts`, pure view-model helpers (`lib/status.ts`, `lib/conta.ts`, `lib/update.ts`, `lib/usuario.ts`, `lib/sse.ts`), session React context (`lib/sessao.ts`).
- Depends on: control-plane at `CONTROL_PLANE_URL` (default `http://localhost:4000`).
- Used by: the end user's browser.

**Worker (`packages/worker`):**
- Purpose: Plays one PokeIdle account headlessly: authenticates, keeps a WebSocket session alive, keeps the leader in a hunt.
- Location: `packages/worker/src/`
- Contains: env config parser (`config.ts`), health state + HTTP server (`health.ts`), HTTP/proxy helpers (`http.ts`), auth strategies (`auth/provider.ts`, `auth/refresh.ts`, `auth/solver.ts`), game client and loop (`game/client.ts`, `game/loop.ts`), entry/drain wiring (`index.ts`).
- Depends on: the game (`GAME_URL`, default `https://poke.idleworld.online`), optional HTTP/SOCKS5 proxy (`PROXY_URL`), optional 2captcha-compatible solver (`SOLVER_KEY`, `SOLVER_API_URL`).
- Used by: control-plane only (creates it with env vars; polls its `/health`; reads its logs).

**Updater (`packages/updater`):**
- Purpose: Short-lived container that recreates the `web` and `control-plane` containers on a new image tag (the control-plane cannot replace itself).
- Location: `packages/updater/src/`
- Contains: `atualizar()` orchestration (`atualizar.ts`), recreation planner that clones a container's config minus image defaults (`recriacao.ts`), dockerode adapter `motorDockerode` (`docker.ts`), entry (`main.ts`).
- Depends on: Docker socket bind, env `TARGET_TAG`, label `mpw.role` on compose services.
- Used by: control-plane `UpdateManager.applyUpdate()` via `orchestrator.createUpdater()` (container name `mpw-updater`).

**Delivery / infra (non-code layers):**
- `docker/Dockerfile.*` — one multi-stage Dockerfile per image (`node:22-slim`, pnpm via corepack, `pnpm --filter <pkg> build`).
- `docker-compose.yml` — end-user install (only `web` + `control-plane`).
- `docker-compose.central.yml` — alternative VPS deployment of central + Postgres.
- `k8s/base/` — Kustomize manifests for the official central (namespace `pokeidle`, Traefik ingress, NetworkPolicy, `pg_dump` CronJob).
- `.github/workflows/` — CI tests and tag-driven release.
- `e2e/` — Playwright smoke against locally built `:e2e` images plus a fake game server.

## Data Flow

**User login (panel → central):**

1. `apps/web/app/login/page.tsx` calls `login()` in `apps/web/lib/api.ts` → `POST /cp/auth/login`.
2. `apps/web/app/cp/[...path]/route.ts` (`encaminhar`) validates `Host` (localhost/`ALLOWED_HOSTS`) and `Origin`, strips hop-by-hop headers and forwards to `${CONTROL_PLANE_URL}/auth/login`.
3. `apps/control-plane/src/session/routes.ts` → `SessionStore.login()` (`src/session/store.ts`) → central `POST /auth/login`, then `GET /auth/me` for the profile.
4. Central `apps/central-api/src/auth/service.ts` verifies argon2 hash, signs HS256 access JWT (15 min, `sub`=userId, `role`) and stores a SHA-256 hash of a random refresh token (30 days).
5. Control-plane keeps the access token in memory and persists `{ refreshToken, obtainedAt, perfil }` to `/data/session.json`. The browser holds **no** token; local session = control-plane's single session.

**Access-token renewal and offline grace:**

1. Every guarded control-plane route runs `app.requireSession(opts)` (`src/auth/guard.ts`) → `SessionStore.getAccessToken()`.
2. If access token expires within 30s, a single-flight `renovar()` calls central `POST /auth/refresh` (refresh token is rotated: old one revoked atomically with `updateMany ... revokedAt: null`).
3. Central unreachable/5xx and last refresh < 7 days ago → `{ token: null, offline: true }`; routes with `precisaCentral: true` answer 503, other routes (stop, status, logs, rollback) keep working. Central 401 → session wiped.

**Start a worker:**

1. `AccountRow` (`apps/web/components/AccountRow.tsx`) → `POST /cp/workers/:accountId/start`.
2. `apps/control-plane/src/workers/routes.ts` `iniciarWorker()` fetches decrypted credentials from central `GET /accounts/:id/credentials` (ownership enforced by `userId` filter in `apps/central-api/src/accounts/routes.ts`).
3. `montarEnv()` builds the worker env contract: `ACCOUNT_ID`, `GAME_URL`, `POKEIDLE_USER`, `POKEIDLE_PASS`, `CONTROL_PLANE_URL`, optional `ACCESS_TOKEN`, `REFRESH_TOKEN`, `SOLVER_KEY`, `PROXY_URL`.
4. `DockerOrchestrator.createWorker()` (`src/orchestrator/orchestrator.ts`) creates container `mpw-worker-<accountId>` with labels `mpw.managed=true` and `mpw.account-id=<id>` on network `WORKER_NETWORK` (pulls the image on 404), then starts it; `Supervisor.desireRunning(accountId)` records desired state.

**Worker runtime:**

1. `packages/worker/src/index.ts` parses env (`loadConfig`, exits 1 on invalid config), starts the health server on `:3001` (`GET /health` → `HealthSnapshot`).
2. `AuthManager.autenticar()` (`src/auth/provider.ts`) tries strategies in order: stored tokens (`StoredTokenProvider`) → refresh via game `/api/auth/refresh` (`src/auth/refresh.ts`, retries 1s/2s/4s) → Turnstile solver + `/api/auth/login` (`SolverTokenProvider`, `src/auth/solver.ts`). All fail → state `needs-login`. Transient refresh failure → deferred retry with backoff (30s → 5 min).
3. `GameClient` (`src/game/client.ts`) opens the sharded game WebSocket (`montarUrlWs`), handles reconnect, heartbeat, maintenance close (4003) and terminal closes (4001 auth refused → `needs-login`).
4. `runGameLoop()` (`src/game/loop.ts`) executes actions from `criarAcoes()` (`restart-freeze`, `garantir-hunt`, `watchdog-stall`) with 10–30s jittered delay; health state reflects `lastAction`/`lastError`.
5. SIGTERM/SIGINT → `drenar()` waits up to 20s for the in-flight action, disconnects, closes health server.

**Token write-back (pull-based):**

1. Worker `HealthState.snapshot()` includes `tokens` only when they differ from the ones it was started with.
2. `Supervisor.poll()` reads each running worker's `/health`; `verificarTokens()` calls the callback registered in `workers/routes.ts` (`supervisor.setOnTokensRenovados`) → central `PUT /accounts/:id/tokens` (re-encrypted).
3. On crash restart, if observed tokens differ from container env, the supervisor recreates the container with the new tokens (`configDeRecriacao` / `envComTokens` in `src/orchestrator/recriar.ts`).

**Live status and logs (SSE):**

1. `Dashboard` (`apps/web/components/Dashboard.tsx`) opens `EventSource('/cp/events')`; control-plane `src/stream/routes.ts` sends `snapshot` then `update` events whenever `Supervisor.mudancas` emits a changed snapshot (dedup by JSON serialization).
2. `LogStream` opens `/cp/workers/:id/logs/stream`; control-plane sends the last 200 lines (`workerLogs`) then follows Docker logs (`followLogs`).
3. The Next.js proxy passes `text/event-stream` bodies through and sets `cache-control: no-cache, no-transform` + `x-accel-buffering: no`.
4. UI merges `GET /cp/accounts` with the worker snapshot in `mesclarContas()` (`apps/web/lib/status.ts`).

**Release and update:**

1. Push tag `vX.Y.Z[-pre]` → `.github/workflows/release.yml`: run `ci.yml`, build 5 images multi-arch, read worker manifest digest, log in to central as `ci-release` admin and `POST /admin/releases` `{version, channel, imageDigest, changelog}`, then retag `:stable`/`:beta`.
2. Control-plane `UpdateManager.checkForUpdate()` (boot + every 6h) calls central `GET /version?channel=stable`; `updateAvailable` = latest ≠ `CURRENT_VERSION`/`APP_VERSION`.
3. `applyUpdate()` (auto if enabled, or `POST /update/apply`): pull new worker image → write `/data/rollback.json` → `recriarEmSequencia()` (pause supervisor per account, stop 30s drain, remove, create on new image, wait for `/health` state ≠ `booting` up to 60s, compensate by restoring old image on failure) → pull `mpw-updater:<tag>` → `createUpdater({ targetTag })` and start it.
4. `packages/updater/src/atualizar.ts` finds containers by label `mpw.role=control-plane|web`, pulls `<repo>:<tag>`, and for each: stop → rename to `<name>-old-<ts>` → create from `planejarRecriacao()` → reconnect extra networks → start → wait healthy → remove old; any failure restores the old container.
5. Next control-plane boot runs `conciliarUpdater()`: inspects the exited `mpw-updater`, records non-zero exits to `/data/update-failed.json` (auto-update won't retry that tag), and removes it.
6. Rollback (`POST /update/rollback`) recreates workers from `rollback.json.digestAnterior` (workers only; panel rollback is manual via `MPW_TAG`).

**State Management:**
- Central: Postgres (Prisma models `User`, `RefreshToken`, `Account`, `Release`; tables `users`, `refresh_tokens`, `accounts`, `releases`).
- Control-plane: in-memory (`SessionStore` access token, `Supervisor` desired states/backoff/observed tokens/game state, `UpdateManager` state machine `idle|checking|updating|update_failed|rolling_back`) + JSON files in `DATA_DIR` (`/data`). Supervisor desired state is **not** persisted; after a control-plane restart existing worker containers keep running but are not auto-restarted until started again.
- Docker itself is the registry of running workers (label query `mpw.managed=true`).
- Worker: in-memory `HealthState`, `AuthManager`, `GameClient.estado`.
- Web: React component state only; session in `SessaoContext` (`apps/web/lib/sessao.ts`) polled every 15s by `apps/web/app/(painel)/layout.tsx`.

## Key Abstractions

**`ContainerOrchestrator` (interface):**
- Purpose: All Docker operations used by the control-plane (workers, updater, one-shot containers, logs, pulls).
- Examples: `apps/control-plane/src/orchestrator/types.ts` (interface), `apps/control-plane/src/orchestrator/orchestrator.ts` (`DockerOrchestrator`)
- Pattern: Port/adapter. `buildApp({ orchestrator })` accepts a fake for tests; production defaults to `new DockerOrchestrator(undefined, WORKER_NETWORK)`. Add new Docker capabilities to the interface first, then implement in `DockerOrchestrator`.

**`MotorDocker` (interface):**
- Purpose: Same idea for the updater — minimal Docker verbs (`listarPorRole`, `renomear`, `criar`, `conectar`, ...).
- Examples: `packages/updater/src/atualizar.ts` (interface), `packages/updater/src/docker.ts` (`motorDockerode`)
- Pattern: Port/adapter with injected motor; tests use fakes plus `packages/updater/src/fixtures.ts`.

**`SessionStore`:**
- Purpose: The control-plane's single central session (login, single-flight refresh, 7-day offline grace, profile cache, persistence).
- Examples: `apps/control-plane/src/session/store.ts`
- Pattern: Stateful service class; returns discriminated union `ResultadoToken` (`{ token, offline }`) instead of throwing.

**`requireSession` decorator:**
- Purpose: Route guard for every local endpoint except `/auth/*` and `/health`.
- Examples: `apps/control-plane/src/auth/guard.ts`; used as `{ preHandler: app.requireSession({ precisaCentral: true }) }`
- Pattern: Fastify `app.decorate` factory returning a `preHandlerHookHandler`. Use `precisaCentral: true` for any route that must reach central.

**`criarRepasse` (central passthrough):**
- Purpose: Forward a local request to central with the session's bearer token; maps network errors/5xx to 502 and passes 2xx/4xx through verbatim.
- Examples: `apps/control-plane/src/central/repasse.ts`, used by `src/accounts/routes.ts` and `src/users/routes.ts`
- Pattern: Factory returning `(reply, metodo, caminho, corpo?) => Promise<FastifyReply>`. New pure-proxy endpoints should use it rather than hand-written `fetch`.

**`Supervisor`:**
- Purpose: Reconcile desired state vs Docker state; backoff per consecutive failure 1m → 2m → 5m → 15m ceiling (`calcularBackoff`), first restart immediate, `degraded` after 3 failures, reset after 2 stable polls; aggregate worker game state; detect renewed tokens; emit `mudancas` "update" events.
- Examples: `apps/control-plane/src/supervisor/supervisor.ts`
- Pattern: Polling loop (`setInterval`, re-entrancy guard `emPoll`) + `EventEmitter`. `pausar/retomar` lets `UpdateManager` suspend reconciliation per account.

**`UpdateManager`:**
- Purpose: Version check, auto/manual update, rolling worker recreation with compensation, updater lifecycle, rollback metadata.
- Examples: `apps/control-plane/src/update/manager.ts`
- Pattern: Explicit state machine; operations return string-literal result unions (`ResultadoApply`, `ResultadoRollback`) that `src/update/routes.ts` maps to HTTP codes (200/400/404/409/502).

**`TokenProvider` / `AuthManager`:**
- Purpose: Swappable login strategies for the game.
- Examples: `packages/worker/src/auth/provider.ts` (`StoredTokenProvider`, `SolverTokenProvider`, `AuthManager`, `criarAuthManager`)
- Pattern: Strategy + chain-of-responsibility with single-flight (`unico()`), self-scheduled refresh timer, secret redaction (`ocultarSegredos`). Results as union `ResultadoAuth`.

**`GameClient` / `ClienteJogo` and `Acao<C>`:**
- Purpose: Game WebSocket session (state in `EstadoJogo`) and pluggable loop actions.
- Examples: `packages/worker/src/game/client.ts`, `packages/worker/src/game/loop.ts`
- Pattern: Injected dependencies (`criarSocket`, `fetch`, `random`, timings) for deterministic tests; new bot behaviours are added as `Acao<ClienteJogo>` objects in `criarAcoes()`.

**`HealthState`:**
- Purpose: The worker's only outward channel: state (`booting|authenticating|in-game|needs-login|error`), last action/error, uptime, renewed tokens.
- Examples: `packages/worker/src/health.ts`
- Pattern: Mutable state object + tiny `node:http` server. The control-plane consumes it in `Supervisor.lerHealth()` and `UpdateManager.aguardarSaudavel()`.

**`HttpFetch`:**
- Purpose: Minimal fetch signature with proxy dispatcher and 15s timeout.
- Examples: `packages/worker/src/http.ts` (`criarFetch`, `criarDispatcher` for `ProxyAgent`/`Socks5ProxyAgent`)
- Pattern: All worker HTTP goes through an injected `HttpFetch`; game traffic uses the account proxy, solver traffic does not.

**Encrypted secret columns:**
- Purpose: `pokeidlePassEnc`, `accessTokenEnc`, `refreshTokenEnc`, `solverKeyEnc` stored as `nonce(12) | ciphertext | tag(16)`.
- Examples: `apps/central-api/src/crypto/secrets.ts` (`encrypt`, `decrypt`, `initSecrets`), used in `apps/central-api/src/accounts/routes.ts`
- Pattern: Only `/accounts/:id/credentials` returns plaintext; list/create/patch return the `publico()` projection.

## Entry Points

**Central API server:**
- Location: `apps/central-api/src/server.ts` (factory `apps/central-api/src/app.ts` `buildApp()`)
- Triggers: Container CMD `pnpm exec prisma migrate deploy && pnpm db:seed && node dist/server.js` (`docker/Dockerfile.central-api`); dev `pnpm --filter central-api dev`.
- Responsibilities: Load `.env` if present, validate secrets, listen on `PORT` (8080). Routes: `GET /health`, `POST /auth/login|refresh|logout`, `GET /auth/me`, `GET|POST /accounts`, `PATCH|DELETE /accounts/:id`, `GET /accounts/:id/credentials`, `PUT /accounts/:id/tokens`, `GET /version?channel=`, `GET|POST /admin/releases`, `GET|POST /admin/users`, `PATCH /admin/users/:id`.

**Admin seed:**
- Location: `apps/central-api/prisma/seed.ts` (`seedAdmin()`)
- Triggers: Every central container start; `pnpm --filter central-api db:seed`.
- Responsibilities: Idempotently create the `ADMIN_USERNAME` admin.

**Control-plane server:**
- Location: `apps/control-plane/src/server.ts` (factory `apps/control-plane/src/app.ts` `buildApp(opts)` returns `{ app, sessionStore, supervisor, updateManager }`)
- Triggers: Compose service `control-plane` (`node dist/server.js`), dev `pnpm --filter control-plane dev`.
- Responsibilities: `sessionStore.init()`, background `atualizarPerfil()`, `supervisor.start()`, `updateManager.start()`, listen on `PORT` (4000). Routes: `/health`, `/auth/login|logout|session`, `/accounts*` and `/admin/users*` (passthrough), `/workers/:id/start|stop|restart`, `/workers/status`, `/workers/:id/logs/stream`, `/events`, `/update/status|apply|settings|rollback`, `/proxy/test`.

**Web panel:**
- Location: `apps/web/app/layout.tsx` (root), `apps/web/app/(painel)/layout.tsx` (authenticated shell), `apps/web/app/cp/[...path]/route.ts` (API proxy)
- Triggers: Compose service `web` (`node apps/web/server.js`, Next standalone output).
- Responsibilities: Pages `/login`, `/` (dashboard), `/accounts/new`, `/accounts/[id]`, `/settings`, `/users` (admin-only link); proxy `GET|POST|PUT|PATCH|DELETE /cp/*` to the control-plane.

**Worker process:**
- Location: `packages/worker/src/index.ts`
- Triggers: Container `mpw-worker-<accountId>` created by the control-plane (`node dist/index.js`).
- Responsibilities: Config → health server → auth → game client + loop → graceful drain on SIGTERM.

**Updater process:**
- Location: `packages/updater/src/main.ts`
- Triggers: Container `mpw-updater` created by `UpdateManager.applyUpdate()` with env `TARGET_TAG`.
- Responsibilities: Recreate `web` and `control-plane` on the target tag; exit code 0/1/2 is read back by `conciliarUpdater()`.

**Fake game (test only):**
- Location: `e2e/fake-game/server.ts`
- Triggers: `e2e/docker-compose.e2e.yml` service `fake-game` (image `mpw-fake-game:e2e`).
- Responsibilities: Accepts only the fake JWT from `e2e/fake-game/token.ts`, emits `field-init`/`field-kill`, `POST /__e2e/kick` closes sessions with WS 4005.

**E2E harness:**
- Location: `e2e/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/global-teardown.ts`, `e2e/smoke.spec.ts`, `e2e/docker.ts`
- Triggers: `pnpm e2e` (root script → `pnpm --filter e2e e2e`).
- Responsibilities: Build `:e2e` images, bring up compose project `mpw-e2e`, verify admin seed, run the smoke, tear down.

## Error Handling

**Strategy:** Fail soft at boundaries, never crash long-running services on downstream failure; translate failures into explicit HTTP codes and user-visible state (`lastError`, `degraded`, `needs-login`, `update_failed`).

**Patterns:**
- Error responses are always JSON `{ error: "<mensagem em português>" }`. Central: 400 (AJV schema, `coerceTypes: false`), 401 `"não autenticado"`/`"credenciais inválidas"`, 403 `"acesso restrito a administradores"`, 404 `"conta não encontrada"`, 409 duplicate release, 500 `"credenciais ilegíveis"` on decrypt failure.
- Control-plane mapping: central unreachable → 503 `"central inalcançável"`; central 5xx or network error during passthrough → 502 `"falha ao contatar o central"`; Docker failures → 502 `"falha ao criar ou iniciar worker no orquestrador"`; busy update → 409.
- Typed error classes for control flow: `ErroCredenciaisInvalidas`, `ErroCentralInalcancavel` (`apps/control-plane/src/session/store.ts`), `ErroCredenciais` (`apps/control-plane/src/workers/routes.ts`), `AuthIndisponivelError`, `AuthAdiadaError`, `LoginError` (`packages/worker/src/auth/provider.ts`), `RefreshRecusadoError`, `RefreshIndisponivelError` (`packages/worker/src/auth/refresh.ts`), `SolverError` (`packages/worker/src/auth/solver.ts`), `ConfigError` (`packages/worker/src/config.ts`).
- Result unions instead of exceptions for expected outcomes: `ResultadoToken`, `ResultadoAuth`, `ResultadoApply`, `ResultadoRollback`.
- Docker idempotency: `DockerOrchestrator` swallows 304 (already started/stopped) and 404 (already removed) and auto-pulls on 404 image-not-found during create.
- Compensation on multi-step changes: `UpdateManager.recriarWorker()` restores the previous image if the new worker fails health; updater `recriar()` renames back and restarts the old container, reporting `rollback incompleto` details.
- Secrets never leak into errors/logs: worker `ocultarSegredos()`; control-plane logs only `{ accountId }` on failures; central logs decrypt errors with account id only.
- Timing-safe login: central verifies a dummy argon2 hash when the user is missing/inactive (`HASH_DUMMY` in `apps/central-api/src/auth/service.ts`).
- Empty `catch {}` is used deliberately for optional operations (`process.loadEnvFile(".env")`, best-effort logout, health polling).

## Cross-Cutting Concerns

**Logging:** Fastify's default logger instance (`request.log`, `app.log`) in central and control-plane (logger not enabled in `Fastify()` options, so it is effectively silent except where explicitly configured); worker and updater use `console.log`/`console.error` with prefixes (`worker <accountId>: ...`, `[updater] ...`). Worker stdout is the log stream surfaced through Docker logs → SSE → `LogStream`.

**Validation:** Fastify JSON Schema per route (`schema: { body | querystring }`, `additionalProperties: false`, `maxLength`, `pattern`) in both Fastify apps; central disables type coercion. The proxy URL regex `^(https?|socks5)://\S+$` is duplicated in `apps/central-api/src/accounts/routes.ts`, `apps/control-plane/src/proxy/routes.ts` and `apps/web/lib/conta.ts` — keep them in sync. Worker validates its env in `loadConfig()`. Web mirrors server limits in `apps/web/lib/conta.ts` (`LIMITES`) and `apps/web/lib/usuario.ts` (`LIMITES_USUARIO`).

**Authentication:**
- Central: HS256 JWT bearer (`requireAuth`, `requireAdmin` in `apps/central-api/src/auth/guard.ts`) registered as `preHandler` hooks inside `app.register` scopes; tenant isolation by always filtering Prisma queries with `userId: request.userId!`.
- Control-plane: no per-request credential from the browser — it trusts any caller that reaches it and uses its own stored session (`requireSession`). Protection relies on network placement: control-plane has no published port; web binds `127.0.0.1:3000` and its `/cp` proxy enforces `Host` allow-list and same-origin `Origin` for mutating requests.
- Workers: unauthenticated `/health` reachable only on the Docker network `mpw`.
- Admin-ness in the UI comes from the cached profile (`/auth/session` → `role`); enforcement is in central.

**Configuration:** Environment variables only (no config files). Precedence in `apps/control-plane/src/app.ts`: `buildApp(opts)` > `process.env` > defaults. Key vars: control-plane `CENTRAL_API_URL`, `DATA_DIR`, `IMAGE_REGISTRY`, `WORKER_IMAGE`, `CURRENT_VERSION`/`APP_VERSION`, `AUTO_UPDATE`, `WORKER_NETWORK`, `CONTROL_PLANE_URL`, `GAME_URL`, `PORT`; web `CONTROL_PLANE_URL`, `ALLOWED_HOSTS`; central `DATABASE_URL`, `JWT_SECRET`, `SECRETS_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `PORT`. Root `.env.example` documents the end-user values (`.env` itself is git-ignored).

**Docker labels contract:** `mpw.managed=true` + `mpw.account-id` (workers), `mpw.managed=false` (updater, one-shots), `mpw.role=web|control-plane` (compose services, used by the updater), `mpw.e2e=true` (e2e stack). Changing any label requires updating both `apps/control-plane/src/orchestrator/orchestrator.ts` and `packages/updater/src/atualizar.ts`.

---

*Architecture analysis: 2026-10-12*
