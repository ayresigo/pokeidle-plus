# Technology Stack

**Analysis Date:** 2026-10-12

## Languages

**Primary:**
- TypeScript 5.9.3 (resolved from `^5.7.0` in root `package.json`; `^5` in `apps/web/package.json`) - all application code: `apps/central-api/src/`, `apps/control-plane/src/`, `apps/web/`, `packages/worker/src/`, `packages/updater/src/`, `e2e/`
  - Shared compiler base `tsconfig.base.json`: `strict: true`, `target: ES2022`, `module`/`moduleResolution: NodeNext`
  - Backend packages extend it and add `lib: ["ES2024"]` (`apps/control-plane/tsconfig.json`, `packages/worker/tsconfig.json`, `packages/updater/tsconfig.json`), emitting to `dist/` from `src/`
  - `apps/web/tsconfig.json` is the Next.js-generated config (`moduleResolution: bundler`, `jsx: react-jsx`, `noEmit`, path alias `@/*` → `./*`)
  - `e2e/tsconfig.json` runs TS directly (`allowImportingTsExtensions`, `verbatimModuleSyntax`, `erasableSyntaxOnly`) — imports use `.ts` extensions (e.g. `e2e/global-setup.ts` imports `./docker.ts`)

**Secondary:**
- SQL (PostgreSQL dialect) - Prisma migrations in `apps/central-api/prisma/migrations/*/migration.sql`
- Prisma Schema Language - `apps/central-api/prisma/schema.prisma`
- YAML - GitHub Actions (`.github/workflows/ci.yml`, `.github/workflows/release.yml`), Docker Compose (`docker-compose.yml`, `docker-compose.central.yml`, `e2e/docker-compose.e2e.yml`, `docker/docker-compose.dev.yml`), Kustomize manifests (`k8s/base/*.yaml`)
- Bash - inline release scripts in `.github/workflows/release.yml` (uses `jq`, `curl`, `docker buildx imagetools`)
- CSS - Tailwind v4 entry `apps/web/app/globals.css` (`@import "tailwindcss";`)

**Language conventions:**
- Code identifiers, log messages and error strings are written in Brazilian Portuguese (e.g. `criarRepasse`, `ErroCentralInalcancavel`, `"central inalcançável"`). Public API/DTO field names stay in English (`accessToken`, `pokeidleUser`, `imageDigest`).
- All Node packages are ESM: `"type": "module"` in `apps/central-api/package.json`, `apps/control-plane/package.json`, `packages/worker/package.json`, `packages/updater/package.json`, `e2e/package.json`. Relative imports use the `.js` suffix (e.g. `import { buildApp } from "./app.js";` in `apps/central-api/src/server.ts`).

## Runtime

**Environment:**
- Node.js 22 - every Dockerfile uses `node:22-slim` (`docker/Dockerfile.*`, `e2e/fake-game/Dockerfile`); CI uses `actions/setup-node@v7` with `node-version: 22` (`.github/workflows/ci.yml`)
  - `undici@8.11.2` (worker) declares `engines: node >=22.19.0` in `pnpm-lock.yaml` — keep Node ≥ 22.19
  - Prisma 7.10 requires `node ^20.19 || ^22.12 || >=24.0`
  - Uses modern Node built-ins: `process.loadEnvFile()` (`apps/central-api/src/server.ts`, `apps/control-plane/src/server.ts`, `apps/central-api/prisma.config.ts`), `Promise.withResolvers()` (`packages/worker/src/http.ts`, `e2e/docker.ts`), global `fetch`/`AbortSignal.timeout`, top-level `await`, `--experimental-strip-types` (fake-game container CMD in `e2e/fake-game/Dockerfile`)
- Browser (web panel) - React 19 client components; `EventSource` for SSE (`apps/web/components/Dashboard.tsx`)

**Package Manager:**
- pnpm 9.15.0 (`"packageManager": "pnpm@9.15.0"` in root `package.json`), activated with `corepack enable` in Dockerfiles and CI
- Workspace: `pnpm-workspace.yaml` → `apps/*`, `packages/*`, `e2e`
- Lockfile: present (`pnpm-lock.yaml`, `lockfileVersion: '9.0'`); every install uses `pnpm install --frozen-lockfile`
- `.npmrc` present at repo root (copied into every Docker build stage) — contents not inspected

## Frameworks

**Core:**
- Fastify 5.12.5 (`^5.2.0`) - HTTP server for `apps/central-api` (port 8080) and `apps/control-plane` (port 4000). Apps are built by a `buildApp()` factory (`apps/central-api/src/app.ts`, `apps/control-plane/src/app.ts`) and started in `src/server.ts`. JSON-schema validation through Fastify route `schema` (central-api sets `ajv: { customOptions: { coerceTypes: false } }`).
- Prisma ORM 7.10.0 - `prisma` CLI + `@prisma/client` with the driver adapter `@prisma/adapter-pg` (node-postgres `pg@8.23.1`). Config in `apps/central-api/prisma.config.ts` (schema `prisma/schema.prisma`, migrations `prisma/migrations`, datasource URL from `env("DATABASE_URL")`). Generator `prisma-client-js`.
- Next.js 16.4.0 (App Router, Turbopack) - `apps/web`. `next.config.ts` sets `output: "standalone"`, `cacheComponents: true`, `partialPrefetching: true`, and a Turbopack CSS loader rule for `@tailwindcss/turbopack`. `apps/web/AGENTS.md` warns this Next version has breaking changes: read `node_modules/next/dist/docs/` before writing Next code.
- React 19.3.0 / React DOM 19.3.0 - web UI (`apps/web/app/`, `apps/web/components/`)
- Tailwind CSS 4.3.3 via `@tailwindcss/turbopack` 4.3.3 - styling (no `tailwind.config.*`; v4 CSS-first config in `apps/web/app/globals.css`)

**Testing:**
- Vitest 3.2.7 (`^3.0.0` root, `^3` web) - unit/integration tests for every workspace package (`"test": "vitest run"`). Configs: `apps/central-api/vitest.config.ts` (`fileParallelism: false`, `setupFiles: ["./src/test-setup.ts"]` — refuses DBs not ending in `_dev`/`_test`), `apps/control-plane/vitest.config.ts` (`fileParallelism: false`). central-api tests hit a real PostgreSQL.
- Playwright 1.64.0 (`@playwright/test`) - E2E smoke in `e2e/` (`e2e/playwright.config.ts`: Chromium "Desktop Chrome", 1 worker, `baseURL http://127.0.0.1:3100`, locale `pt-BR`, global setup/teardown that build and boot `e2e/docker-compose.e2e.yml`)
- `ws` 8.22.0 - WebSocket server for test doubles (`packages/worker/src/game/client.test.ts`, `e2e/fake-game/server.ts`)

**Build/Dev:**
- `tsc` - production builds for backend packages (`"build": "tsc -p tsconfig.json"`), output run with `node dist/*.js` in containers
- tsx 4.23.15 - dev runner (`tsx watch src/server.ts`, `tsx src/index.ts`), Prisma seed (`tsx prisma/seed.ts`), `e2e/down.ts`
- `next build` - web build (standalone output copied into the runtime image)
- ESLint 9.39.5 with `eslint-config-next` 16.4.0 (`core-web-vitals` + `typescript` presets) - only the web app is linted (`apps/web/eslint.config.mjs`, `pnpm --filter web lint`)
- Docker Buildx + QEMU - multi-arch image builds (`linux/amd64`, `linux/arm64`) in `.github/workflows/release.yml`
- Kustomize - `k8s/base/kustomization.yaml` (namespace `pokeidle`, pins `ghcr.io/ayresigo/mpw-central-api` `newTag: 0.0.1-beta.1`)
- No Prettier/Biome config detected; formatting is by convention only.

## Key Dependencies

**Critical:**
- `fastify` 5.12.5 - both backend HTTP services (`apps/central-api`, `apps/control-plane`)
- `@prisma/client` / `prisma` / `@prisma/adapter-pg` 7.10.0 - central data access; `PrismaClient` is always built with `new PrismaPg({ connectionString: process.env.DATABASE_URL })` (`apps/central-api/src/app.ts`, `apps/central-api/prisma/seed.ts`). Docker build runs `prisma generate` with a dummy `DATABASE_URL` (`docker/Dockerfile.central-api`).
- `argon2` 0.45.1 - password hashing/verification (argon2id) in `apps/central-api/src/auth/service.ts`; native module — the central-api image installs `openssl` and runs on `node:22-slim` (glibc)
- `jsonwebtoken` 9.0.3 - HS256 access tokens (15 min TTL) signed with `JWT_SECRET` (`apps/central-api/src/auth/service.ts`, verified in `apps/central-api/src/auth/guard.ts` with `algorithms: ["HS256"]`)
- `dockerode` 5.0.1 - Docker Engine API over `/var/run/docker.sock`: worker lifecycle, log streaming, image pulls, one-shot containers (`apps/control-plane/src/orchestrator/orchestrator.ts`) and self-update container recreation (`packages/updater/src/docker.ts`)
- `undici` 8.11.2 - worker HTTP client and WebSocket client with proxy dispatchers `ProxyAgent` / `Socks5ProxyAgent` (`packages/worker/src/http.ts`, `packages/worker/src/game/client.ts`)
- `next` 16.4.0 + `react`/`react-dom` 19.3.0 - local web panel

**Infrastructure:**
- Node built-in `node:crypto` - AES-256-GCM encryption of stored account secrets (`apps/central-api/src/crypto/secrets.ts`), SHA-256 refresh-token hashing and `randomBytes` token generation (`apps/central-api/src/auth/service.ts`)
- Node built-in `node:http` - worker health server (`packages/worker/src/health.ts`), fake game server (`e2e/fake-game/server.ts`)
- Node built-in `node:child_process` - E2E harness shells out to the `docker` CLI (`e2e/docker.ts`)
- `ws` 8.22.0 - test-only WebSocket server (runtime dependency of `e2e` for the fake game; devDependency of `worker`)
- Type packages: `@types/node` (`^22.10.0` backend, `^20` web), `@types/dockerode` `^4.0.2`, `@types/jsonwebtoken` `^9.0.10`, `@types/ws` `^8.5.0`, `@types/react`/`@types/react-dom` `^19`

## Configuration

**Environment:**
- All runtime config comes from environment variables; no config files/libraries (no dotenv package). Local dev loads `.env` with `process.loadEnvFile(".env")` wrapped in `try {} catch {}` (`apps/central-api/src/server.ts`, `apps/control-plane/src/server.ts`, `apps/central-api/prisma.config.ts`, `apps/central-api/prisma/seed.ts`).
- `.env.example` files exist at repo root and at `apps/central-api/.env.example` (end-user / dev templates; not read). `.env` is gitignored (`.gitignore`, `.dockerignore`).
- Fail-fast validation at startup:
  - central-api `buildApp()` calls `requireJwtSecret()` (`JWT_SECRET` ≥ 32 chars) and `initSecrets()` (`SECRETS_KEY` = 64 hex chars / 32 bytes)
  - worker `loadConfig(process.env)` in `packages/worker/src/config.ts` collects all problems into a `ConfigError` and exits 1
  - updater exits 2 without `TARGET_TAG` (`packages/updater/src/main.ts`)
- Key variables per service (full list in `.planning/codebase/INTEGRATIONS.md`):
  - central-api: `DATABASE_URL`, `JWT_SECRET`, `SECRETS_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `PORT` (8080)
  - control-plane: `CENTRAL_API_URL`, `IMAGE_REGISTRY` (default `ghcr.io/ayresigo`), `WORKER_IMAGE`, `WORKER_NETWORK`, `CONTROL_PLANE_URL`, `GAME_URL` (default `https://poke.idleworld.online`), `AUTO_UPDATE`, `CURRENT_VERSION`/`APP_VERSION`, `DATA_DIR` (default `/data`), `PORT` (4000)
  - web: `CONTROL_PLANE_URL` (default `http://localhost:4000`), `ALLOWED_HOSTS`
  - worker: `ACCOUNT_ID`, `GAME_URL`, `ACCESS_TOKEN`/`REFRESH_TOKEN` or `SOLVER_KEY`+`POKEIDLE_USER`+`POKEIDLE_PASS`, `PROXY_URL`, `SOLVER_API_URL`, `TURNSTILE_SITEKEY`, `GAME_WS_URL`, `GAME_WS_PATH`, `GAME_WS_SHARDS`, `HUNT_SLUG`, `HEALTH_PORT`, `CONTROL_PLANE_URL`
  - updater: `TARGET_TAG`
  - user install (`docker-compose.yml`): `CENTRAL_API_URL` (required), `IMAGE_REGISTRY`, `MPW_TAG` (default `stable`), `AUTO_UPDATE` (default `true`), `ALLOWED_HOSTS`
- Image version is baked at build time: `ARG VERSION=dev` → `ENV APP_VERSION=$VERSION` in every `docker/Dockerfile.*`; the control-plane compares it with the central `/version` response.
- Control-plane persistent state lives as JSON files in `DATA_DIR` (`/data` volume `mpw-data`): `session.json`, `settings.json`, `rollback.json`, `update-failed.json` (`apps/control-plane/src/session/store.ts`, `apps/control-plane/src/update/manager.ts`).

**Build:**
- `tsconfig.base.json` - shared strict TS settings
- `apps/web/next.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/tsconfig.json`
- `apps/central-api/prisma.config.ts`, `apps/central-api/prisma/schema.prisma`, `apps/central-api/prisma/migrations/migration_lock.toml` (`provider = "postgresql"`)
- `apps/*/vitest.config.ts`, `e2e/playwright.config.ts`
- Dockerfiles in `docker/` (one per image: `Dockerfile.central-api`, `Dockerfile.control-plane`, `Dockerfile.web`, `Dockerfile.worker`, `Dockerfile.updater`) plus `e2e/fake-game/Dockerfile`. Pattern: `deps` stage (copy workspace manifests + lockfile, `pnpm install --frozen-lockfile`) → `build` stage (`pnpm --filter <pkg> build`) → `runtime` stage on `node:22-slim` with `NODE_ENV=production`. Build context is the repo root; `.dockerignore` excludes `node_modules`, `dist`, `.next`, `docs`, `.git`, `.env`.
- Root scripts (`package.json`): `pnpm test` (`pnpm -r test`), `pnpm build`, `pnpm lint`, `pnpm e2e`.

## Platform Requirements

**Development:**
- Node.js 22.19+ and pnpm 9.15.0 (via corepack)
- Docker (Docker Desktop with WSL 2 on Windows) - required for control-plane/worker orchestration and the E2E suite
- PostgreSQL 16 for central-api dev/tests: `docker/docker-compose.dev.yml` (db `mpw_dev`, port 5432); tests require a DB name ending in `_dev` or `_test` (`apps/central-api/src/test-setup.ts`)
- Playwright Chromium (`pnpm --filter e2e exec playwright install chromium`) for E2E; E2E needs free ports 3100–3102

**Production:**
- **End-user install (local PC):** Docker Compose project `mpw` from `docker-compose.yml` — `mpw-web` (bound to `127.0.0.1:3000`) + `mpw-control-plane` (mounts `/var/run/docker.sock`, volume `mpw-data`, network `mpw`); the control-plane spawns `mpw-worker-<accountId>` containers and the transient `mpw-updater` container on that network.
- **Central API:** Kubernetes cluster `tcgreaper`, namespace `pokeidle` (`k8s/base/`): single-replica `Recreate` Deployment of `ghcr.io/ayresigo/mpw-central-api` (requests 50m CPU / 96Mi, limit 256Mi, `/health` probes), Service port 80 → 8080, Traefik Ingress with cert-manager TLS on `pokeidle.ayresigo.dev`, NetworkPolicy allowing only Traefik from `kube-system`, daily `pg_dump` CronJob. Container start runs `prisma migrate deploy && pnpm db:seed && node dist/server.js`.
- **Central API alternative (VPS):** `docker-compose.central.yml` (central-api on `127.0.0.1:${CENTRAL_PORT:-8080}` + `postgres:16`), fronted by a TLS reverse proxy (Caddy/nginx, per `README.md`).
- Images: `ghcr.io/ayresigo/mpw-{web,control-plane,worker,updater,central-api}`, multi-arch `linux/amd64` + `linux/arm64`, tags `<semver>`, `:stable`, `:beta`.

---

*Stack analysis: 2026-10-12*
