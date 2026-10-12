# Multiacc PokeIdle — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** App distribuído onde cada usuário roda localmente (compose: UI + control-plane + workers efêmeros) bots Playwright de contas PokeIdle, com auth/dados/versionamento numa API central (VPS) + PostgreSQL.

**Architecture:** Monorepo pnpm. `apps/central-api` (Fastify+Prisma, VPS), `apps/control-plane` (Fastify+dockerode, local), `apps/web` (Next.js, local), `packages/worker` (bot Playwright), `packages/shared` (tipos/contratos). Workers são containers efêmeros criados via dockerode; imagens publicadas no GHCR.

**Tech Stack:** Node 22, TypeScript, pnpm workspaces, Vitest, Fastify, Prisma+Postgres, dockerode, Next.js 15 (App Router) + Tailwind, Playwright, Docker, GHCR.

**Referência de design:** `docs/plans/2026-10-11-multiacc-pokeidle-design.md`

**Convenções globais (do AGENTS.md do usuário):** sem comentários em linhas de código; respostas em PT-BR; sem comandos destrutivos sem confirmação; Windows-first.

---

## Fase 0 — Scaffold

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.npmrc`

**Step 1: Criar arquivos**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`package.json` (raiz):
```json
{
  "name": "multiacc-pokeidle",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "tsx": "^4.19.0"
  }
}
```

`tsconfig.base.json`: `strict: true`, `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`.

`.gitignore`: `node_modules`, `dist`, `.next`, `.env`, `*.log`.

**Step 2: Verificar instalação**

Run: `pnpm install`
Expected: lockfile gerado sem erros.

**Step 3: Commit**

```bash
git add .
git commit -m "chore: scaffold monorepo pnpm"
```

---

## Fase 1 — Central API (`apps/central-api`)

### Task 2: Boot Fastify + health

**Files:**
- Create: `apps/central-api/package.json`, `apps/central-api/tsconfig.json`, `apps/central-api/src/server.ts`, `apps/central-api/src/app.ts`
- Test: `apps/central-api/src/app.test.ts`

**Step 1: Teste falhando**

```ts
// app.test.ts
import { describe, it, expect } from "vitest";
import { buildApp } from "./app.js";

describe("health", () => {
  it("GET /health retorna ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});
```

**Step 2:** `pnpm --filter central-api test` → FAIL (módulo não existe).

**Step 3:** `app.ts` com `buildApp()` registrando `GET /health`; `server.ts` escuta `PORT` (default 8080).

**Step 4:** teste PASS.

**Step 5:** Commit `feat(central-api): boot fastify com health`.

### Task 3: Prisma + Postgres (users, refresh_tokens, accounts, releases)

**Files:**
- Create: `apps/central-api/prisma/schema.prisma`, `docker/docker-compose.dev.yml` (Postgres local para dev/test)

**Step 1:** Schema Prisma com os 4 modelos da tabela do design (Section 5 revisada). `accounts.pokeidle_pass_enc` é `Bytes` (nonce||ciphertext).

`docker-compose.dev.yml`: Postgres 16, porta 5432, volume `mpw-dev-db`. Uso exclusivo de dev/CI — **não** é o compose distribuído.

**Step 2:** `pnpm --filter central-api exec prisma migrate dev -n init` com `docker compose -f docker/docker-compose.dev.yml up -d` rodando.

**Step 3:** Teste de integração: `prisma.test.ts` cria user, conta, release; lê de volta; asserta isolamento por `user_id` na query de accounts.

**Step 4:** Commit `feat(central-api): schema prisma e migration inicial`.

### Task 4: Auth — login + JWT access/refresh

**Files:**
- Create: `apps/central-api/src/auth/routes.ts`, `apps/central-api/src/auth/service.ts`
- Test: `apps/central-api/src/auth/auth.test.ts`

**Regras:**
- `POST /auth/login` {username, password} → `{accessToken, refreshToken}`. Argon2id para hash de senha.
- Access JWT: 15min, payload `{sub: userId, role}`, segredo `JWT_SECRET` (env).
- Refresh: token opaco (32 bytes random, hex), hash SHA-256 persistido em `refresh_tokens`, expiração 30d.
- `POST /auth/refresh` {refreshToken} → novo par de tokens, rotaciona refresh (marca `revoked_at` no antigo).
- `POST /auth/logout` revoga o refresh.
- Login de user com `active=false` → 401 genérico (mesmo erro de senha errada).

**Steps TDD:** teste falhando (login com user seedado retorna par de tokens; refresh rotaciona e revoga antigo; refresh revogado retorna 401) → implementar → PASS → commit `feat(central-api): auth jwt com refresh rotativo`.

### Task 5: Criptografia de senhas PokeIdle

**Files:**
- Create: `apps/central-api/src/crypto/secrets.ts`
- Test: `apps/central-api/src/crypto/secrets.test.ts`

**Implementação:** AES-256-GCM, chave 32B de `SECRETS_KEY` (env, hex). `encrypt(plain): Buffer` = `nonce(12B) || ciphertext || tag(16B)`. `decrypt(buf): string`. Falha de chave ausente no boot = crash imediato (fail-fast).

**Teste:** roundtrip; ciphertext diferente a cada encrypt (nonce aleatório); decrypt com chave errada lança.

Commit `feat(central-api): criptografia aes-gcm de segredos`.

### Task 6: CRUD de accounts (multi-tenant)

**Files:**
- Create: `apps/central-api/src/accounts/routes.ts`
- Test: `apps/central-api/src/accounts/accounts.test.ts`

**Endpoints** (todos exigem access JWT válido — plugin `requireAuth` que valida e injeta `request.userId`):
- `GET /accounts` — só as do `request.userId` (nunca inclui senha nem tokens)
- `POST /accounts` {label, pokeidleUser, pokeidlePass, proxyUrl?, solverKey?, accessToken?, refreshToken?} — segredos criptografados antes de persistir
- `PATCH /accounts/:id` — mesmos campos opcionais
- `DELETE /accounts/:id`
- `GET /accounts/:id/credentials` — retorna senha, tokens e solverKey **descriptografados** (único endpoint; usado pelo control-plane no start do worker)
- `PUT /accounts/:id/tokens` {accessToken, refreshToken} — atualiza tokens (control-plane persiste refresh renovado pelo worker)
- Acesso a id de outro user → 404 (não 403, para não vazar existência)

**Testes:** isolamento entre dois users; segredos nunca em GET /accounts; credentials retorna plaintext correto; PUT /tokens atualiza e criptografa.

Commit `feat(central-api): crud multi-tenant de contas`.

### Task 7: Releases + endpoint de versão

**Files:**
- Create: `apps/central-api/src/releases/routes.ts`
- Test: `apps/central-api/src/releases/releases.test.ts`

**Endpoints:**
- `GET /version?channel=stable` — release mais recente do canal: `{version, imageDigest, changelog}`
- `POST /admin/releases` {version, channel, imageDigest, changelog} — role `admin` apenas
- `GET /admin/releases` — histórico

**Teste:** publica 1.0.0 e 1.1.0, /version retorna 1.1.0; canal beta não vaza para stable; user não-admin recebe 403 no POST.

Commit `feat(central-api): releases e versionamento`.

### Task 8: Seed admin + Dockerfile central-api

**Files:**
- Create: `apps/central-api/prisma/seed.ts` (cria admin inicial via env `ADMIN_USERNAME`/`ADMIN_PASSWORD`), `docker/Dockerfile.central-api`

**Dockerfile:** multi-stage — deps → build (prisma generate + tsc) → runtime `node:22-slim` com `prisma migrate deploy && node dist/server.js` no entrypoint.

Commit `feat(central-api): seed admin e dockerfile`.

---

## Fase 2 — Control-plane (`apps/control-plane`)

### Task 9: Boot + proxy de auth ao central

**Files:**
- Create: `apps/control-plane/src/app.ts`, `apps/control-plane/src/session/store.ts`
- Test: `apps/control-plane/src/session/store.test.ts`

**`SessionStore`:** persiste refresh token em `/data/session.json` (volume `mpw-data`), em memória guarda access token. `getAccessToken()`: se access válido retorna; senão refresh contra central; central inalcançável e refresh válido há <7d → modo grace (retorna flag `offline: true`); expirado → null (UI read-only).

**Testes (mock do central via `fetch` stub):** renova com access expirado; grace quando central cai; grace expirada retorna null.

Commit `feat(control-plane): session store com grace offline`.

### Task 10: Guard de rotas locais

**Files:**
- Create: `apps/control-plane/src/auth/guard.ts`

Plugin Fastify `requireSession`: 401 se `SessionStore.getAccessToken()` for null. Endpoints de dados (`/accounts`, `/workers/*`) protegidos; `/auth/*` e `/health` abertos. Workers em execução jamais são tocados por falha de auth (teste: guard 401 não chama docker).

Commit `feat(control-plane): guard de sessão`.

### Task 11: ContainerOrchestrator (dockerode)

**Files:**
- Create: `apps/control-plane/src/orchestrator/orchestrator.ts`, `apps/control-plane/src/orchestrator/types.ts`
- Test: `apps/control-plane/src/orchestrator/orchestrator.test.ts`

**Interface** (ponto de extensão para Swarm/K8s futuro):
```ts
export interface ContainerOrchestrator {
  createWorker(cfg: WorkerConfig): Promise<string>; // retorna container id
  startWorker(id: string): Promise<void>;
  stopWorker(id: string, timeoutSec: number): Promise<void>; // SIGTERM, drain
  removeWorker(id: string): Promise<void>;
  listWorkers(): Promise<WorkerStatus[]>;
  workerLogs(id: string, tail: number): Promise<string>;
  pullImage(ref: string): Promise<void>;
}
```

`WorkerConfig`: `{accountId, imageRef, env: Record<string,string>, labels}`.
`WorkerStatus`: `{id, accountId, state, health, startedAt, restartCount}`.

Implementação `DockerOrchestrator`: nome `mpw-worker-<accountId>`, labels `mpw.managed=true`, `mpw.account-id`, `HostConfig.AutoRemove=false` (restart gerenciado por nós). Worker é Node puro — sem volume de perfil de browser.

**Testes de integração** (Docker real, imagem `alpine` como fake worker — rodar com `DOCKER_HOST` disponível; skip se indisponível): ciclo create→start→stop→remove; listWorkers filtra por label.

Commit `feat(control-plane): docker orchestrator`.

### Task 12: Supervisor de workers (backoff + crash-loop)

**Files:**
- Create: `apps/control-plane/src/supervisor/supervisor.ts`
- Test: `apps/control-plane/src/supervisor/supervisor.test.ts` (orchestrator fake injetado)

**Regras:** poll a cada 10s do `listWorkers()`; worker desejado=running mas exited → restart com backoff 1m, 2m, 5m, teto 15m (por accountId, em memória); 3 falhas seguidas → status `degraded` no snapshot. Snapshot exposto via `GET /workers/status` para a UI.

**Testes:** backoff dobra até o teto; degraded após 3; sucesso reseta contador.

Commit `feat(control-plane): supervisor com backoff`.

### Task 13: Rotas de workers (start/stop/restart)

**Files:**
- Create: `apps/control-plane/src/workers/routes.ts`
- Test: `apps/control-plane/src/workers/routes.test.ts` (fetch stub do central + orchestrator fake)

**Fluxo de start:** `POST /workers/:accountId/start` → busca credenciais em `GET central /accounts/:id/credentials` (com access token) → monta env (`ACCOUNT_ID`, `GAME_URL`, `POKEIDLE_USER`, `POKEIDLE_PASS`, `ACCESS_TOKEN?`, `REFRESH_TOKEN?`, `SOLVER_KEY?`, `PROXY_URL?`) → `createWorker` → `startWorker`. Credenciais **só em memória**, nunca em disco/log.

**Token write-back:** o supervisor (Task 12), ao fazer poll de `/health` do worker, detecta tokens renovados no estado exposto e persiste via `PUT central /accounts/:id/tokens`. Worker não tem credencial do central.

Stop: `stopWorker(id, 30)` (tempo de drain) + `removeWorker`.

**Teste:** start monta env correta incluindo proxy e tokens; env não vaza em logs; write-back chama PUT ao detectar token novo no health.

Commit `feat(control-plane): rotas de ciclo de vida de workers`.

### Task 14: SSE de logs e status

**Files:**
- Create: `apps/control-plane/src/stream/routes.ts`

`GET /workers/:accountId/logs/stream` — SSE, tail do orchestrator + follow. `GET /events` — SSE do snapshot do supervisor a cada mudança de estado.

Commit `feat(control-plane): streaming sse de logs e status`.

### Task 15: Update manager

**Files:**
- Create: `apps/control-plane/src/update/manager.ts`
- Test: `apps/control-plane/src/update/manager.test.ts`

**Fluxo:** `checkForUpdate()` no boot + intervalo 6h → `GET /version` no central → compara com `CURRENT_VERSION` (env, injetada pelo compose a partir da tag). Se nova e auto-update ligado (`AUTO_UPDATE=true` ou via `POST /update/settings` persistido em `/data/settings.json`): `pullImage(worker:newTag)` → recreate rolling de workers (stop→remove→create→start, um por vez) → grava digest anterior em `/data/rollback.json` → sobe **updater container** efêmero (`ghcr.io/<owner>/mpw-updater:<tag>`) com env `TARGET_TAG` e socket montado; updater recria `control-plane` e `web` com a nova tag e se autodestrói. Falha de pull → mantém tudo, status `update_failed` no `/update/status`.

**Testes (orchestrator + fetch fake):** rolling recria um por vez; falha de pull aborta sem tocar workers; rollback.json escrito antes do updater.

Commit `feat(control-plane): update manager com rolling e rollback`.

### Task 16: Dockerfile control-plane

**Files:**
- Create: `docker/Dockerfile.control-plane`

Runtime precisa do CLI/socket apenas via `/var/run/docker.sock` montado — sem Docker CLI dentro (dockerode puro). Volume `mpw-data` em `/data`.

Commit `feat(control-plane): dockerfile`.

---

## Fase 3 — Worker (`packages/worker`)

**Decisão pós-pesquisa (GAME.md, commit 94ff8e1):** worker é **Node puro WS/REST, sem Chromium**. Login atrás de interface `TokenProvider` com duas estratégias: solver Turnstile (2captcha-compatível, primária) e token colado (fallback). Protocolo real do jogo em `packages/worker/GAME.md` — fonte de verdade para eventos Socket.IO e endpoints REST.

### Task 17: Pesquisa PokeIdle ✅ (concluída — GAME.md commitado em 94ff8e1)

### Task 18: Esqueleto do worker + health

**Files:**
- Create: `packages/worker/package.json`, `packages/worker/tsconfig.json`, `packages/worker/src/index.ts`, `packages/worker/src/health.ts`, `packages/worker/src/config.ts`
- Test: `packages/worker/src/config.test.ts`

`config.ts` valida env com falha clara (`ACCOUNT_ID`, `GAME_URL` obrigatórias; `POKEIDLE_USER`/`POKEIDLE_PASS` obrigatórias se `SOLVER_KEY` presente; `ACCESS_TOKEN`/`REFRESH_TOKEN` opcionais; `PROXY_URL` opcional; `CONTROL_PLANE_URL` para o supervisor alcançar). HTTP `/health` na porta 3001 retorna `{state: "booting"|"authenticating"|"in-game"|"needs-login"|"error", lastAction, lastError, uptimeSec, tokens?: {accessToken, refreshToken}}` — `tokens` presente apenas quando renovados (o control-plane lê e persiste no central).

Commit `feat(worker): esqueleto com health e config`.

### Task 19: TokenProvider + autenticação

**Files:**
- Create: `packages/worker/src/auth/provider.ts`, `packages/worker/src/auth/refresh.ts`, `packages/worker/src/auth/solver.ts`
- Test: `packages/worker/src/auth/provider.test.ts`, `packages/worker/src/auth/solver.test.ts`

**Interface:**
```ts
export interface TokenProvider {
  getTokens(): Promise<{accessToken: string, refreshToken: string}>;
}
```

- `StoredTokenProvider`: usa `ACCESS_TOKEN`/`REFRESH_TOKEN` do env; ausente → null
- `SolverTokenProvider`: se sem tokens e `SOLVER_KEY` presente → resolve Turnstile via API 2captcha-compatível (`createTask`/`getTaskResult`, task type `TurnstileTaskProxyless`, sitekey extraído do GAME.md/bundle) → `POST GAME_URL/api/auth/login {identifier, password, captchaToken}` → tokens
- `refresh.ts`: `POST /api/auth/refresh` com backoff; access expirado → refresh antes de cada janela de uso; refresh renovado exposto no `/health` para write-back
- Falha total de auth → state `needs-login` no health (UI pede token colado)
- `PROXY_URL`: `undici` ProxyAgent para REST e `ws` com agent para o Socket.IO

**Testes (fetch/HTTP stubs):** ordem de precedência stored→solver→needs-login; refresh chamado quando access expira; tokens renovados aparecem no health; solver parseia resposta 2captcha (incl. polling de resultado).

**Nota:** a integração real do solver só é validada em smoke manual com conta real — marcar no GAME.md como ponto de verificação.

Commit `feat(worker): token providers e refresh`.

### Task 20: Game loop WS/REST + drain + Dockerfile

**Files:**
- Create: `packages/worker/src/game/client.ts`, `packages/worker/src/game/loop.ts`, `docker/Dockerfile.worker`
- Test: `packages/worker/src/game/loop.test.ts`

`client.ts`: conecta Socket.IO com Bearer; parseia eventos do GAME.md (`field-init`, `field-kill`, `catch-result`, `balls`, `inventory`); expõe comandos (`enter-hunt`, `set-city`) e REST (`/api/game/balls/buy` etc.). WS close code 4001 (sessão duplicada) → state `needs-login`.

`loop.ts`: `runGameLoop(client, actions, {minDelayMs, maxDelayMs})` — rodízio de ações com jitter uniforme, registra `lastAction`, erro de ação não derruba o loop (5 consecutivos → throw para o supervisor).

**Teste (client fake):** jitter dentro do intervalo; 5 erros consecutivos propagam; sucesso reseta; close 4001 muda state para needs-login.

`SIGTERM` → para de agendar, aguarda ação corrente (timeout 20s), fecha WS, exit 0.

Dockerfile: `node:22-slim`, copia dist, `CMD ["node","dist/index.js"]`. Sem Playwright, sem Chromium.

Commit `feat(worker): game loop ws/rest com drain e dockerfile`.

---

### Task 20b: Rotas de sessão, accounts e proxy-test no control-plane (lacuna do plano)

A UI fala só com o control-plane, que não expõe auth nem accounts. Sessão é da instalação (um SessionStore por control-plane, uso local single-user).

- `POST /auth/login` {username, password} → `SessionStore.login`; 401 genérico em credencial inválida; 503 se central inalcançável
- `POST /auth/logout` → `SessionStore.logout` (204)
- `GET /auth/session` → `{authenticated, offline}` (aberto, a UI decide redirect/banner)
- `GET/POST /accounts`, `PATCH/DELETE /accounts/:id` → proxy ao central com Bearer (precisaCentral); nunca expõe `/credentials`; resposta/erro do central repassados sem segredos
- `POST /proxy/test` {proxyUrl} → container efêmero curl pelo proxy, retorna IP de saída (timeout 20s; container sempre removido)

Commit `feat(control-plane): rotas de sessão, accounts e teste de proxy`.

## Fase 4 — UI (`apps/web`)

### Task 21: Boot Next.js + cliente de API

**Files:**
- Create: `apps/web/` (create-next-app, App Router, Tailwind, src/), `apps/web/lib/api.ts`

`api.ts`: `apiFetch(path, opts)` → base `http://localhost:4000` (env `CONTROL_PLANE_URL`), anexa session cookie, em 401 redireciona `/login`. Tipos de `packages/shared`.

Commit `feat(web): boot next.js com api client`.

### Task 22: Login

**Files:**
- Create: `apps/web/app/login/page.tsx`

Form usuário/senha → `POST control-plane /auth/login` → cookie http-only de sessão local → redirect `/`. Erro 401 mostra "credenciais inválidas". Estado offline (central caiu, grace ativa) mostra banner amarelo "modo offline — alterações limitadas".

Commit `feat(web): tela de login`.

### Task 23: Dashboard de contas

**Files:**
- Create: `apps/web/app/page.tsx`, `apps/web/components/AccountRow.tsx`, `apps/web/components/LogStream.tsx`

Tabela: label, status (badge: running/parado/erro/degraded), última ação, uptime, ações start/stop/restart. SSE `/events` atualiza status em tempo real. Drawer de logs por conta consumindo SSE de logs.

Commit `feat(web): dashboard com status ao vivo`.

### Task 24: Form de conta + teste de proxy

**Files:**
- Create: `apps/web/app/accounts/new/page.tsx`, `apps/web/app/accounts/[id]/page.tsx`

Campos label, pokeidleUser, pokeidlePass, proxyUrl, solverKey (opcional) e seção "ou cole os tokens" (accessToken + refreshToken, com instrução de como extrair do `sessionStorage['pokeweb:tokens']` no DevTools). Botão "testar proxy" → `POST control-plane /proxy/test` (sobe container efêmero `curl` pelo proxy, retorna IP de saída). Validação de formato de URL no client. Conta em estado `needs-login` mostra CTA destacado para colar tokens.

**Nota:** adicionar endpoint `POST /proxy/test` no control-plane (Task implícita — teste falhando primeiro: orchestrator fake recebe create com entrypoint curl e proxy env).

Commit `feat(web): form de conta com teste de proxy`.

### Task 25: Painel de update

**Files:**
- Create: `apps/web/components/UpdateBadge.tsx`, `apps/web/app/settings/page.tsx`

Badge "v1.3.0 disponível" + changelog quando `/update/status` indica nova versão. Botões: atualizar agora, rollback (digest anterior), toggle auto-update. Erro de update exibido.

Commit `feat(web): painel de updates`.

---

## Fase 5 — Packaging e release

### Task 26: docker-compose distribuído

**Files:**
- Create: `docker-compose.yml` (raiz), `.env.example`

```yaml
services:
  web:
    image: ghcr.io/<owner>/mpw-web:stable
    ports: ["3000:3000"]
    environment: [CONTROL_PLANE_URL=http://control-plane:4000]
    depends_on: [control-plane]
  control-plane:
    image: ghcr.io/<owner>/mpw-control-plane:stable
    environment:
      - CENTRAL_API_URL=${CENTRAL_API_URL}
      - CURRENT_VERSION=${CURRENT_VERSION:-stable}
      - AUTO_UPDATE=${AUTO_UPDATE:-true}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - mpw-data:/data
volumes:
  mpw-data:
```

`.env.example` documenta `CENTRAL_API_URL` (única variável obrigatória — aponta para sua VPS).

Commit `feat: compose distribuído`.

### Task 27: Updater container

**Files:**
- Create: `packages/updater/src/index.ts`, `docker/Dockerfile.updater`
- Test: `packages/updater/src/index.test.ts`

Script único: recebe `TARGET_TAG`, monta socket, pull de `mpw-web:TARGET_TAG` e `mpw-control-plane:TARGET_TAG`, recria ambos com mesmas envs/volumes (lê do inspect do container atual), remove a si mesmo. Falha → recria com `:stable` (rollback).

Commit `feat(updater): container de auto-update`.

### Task 28: CI release (GitHub Actions → GHCR)

**Files:**
- Create: `.github/workflows/release.yml`

Trigger: tag `v*`. Jobs: test (vitest + Docker service) → buildx das 4 imagens (web, control-plane, worker, updater) → push `ghcr.io/<owner>/mpw-*:<versao>` + retag `:stable` → chamada autenticada `POST /admin/releases` na central com digest (secret `CENTRAL_ADMIN_TOKEN`).

Commit `ci: pipeline de release para ghcr`.

---

## Fase 6 — E2E smoke

### Task 29: E2E local

**Files:**
- Create: `e2e/smoke.test.ts`, `docker/Dockerfile.worker-mock`, `docker-compose.e2e.yml`

Sobe compose com central-api + Postgres de teste, seed de user, imagem `worker-mock` (HTTP server que responde /health e fica vivo — sem PokeIdle). Playwright: login → cria conta → start worker → asserta status running no dashboard → stop → asserta parado → simula release nova → asserta badge.

Commit `test: e2e smoke do fluxo completo`.

---

## Ordem e dependências

- Fase 0 → 1 → 2 (depende do contrato do central) → 3 (independe de 2; Task 17 pode rodar em paralelo com Fase 2) → 4 (depende de 2) → 5 → 6
- Cada task termina em commit verde; testes de integração com Docker fazem skip gracioso sem daemon.
