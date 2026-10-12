# Context (intel sintetizada)

Gerado por gsd-doc-synthesizer em 2026-10-12 (modo new). Fontes DOC: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (precedência 2) e README.md (precedência 3). Notas organizadas por tema; trechos entre aspas são literais. Itens superados ou com WARNING aberto em `.planning/INGEST-CONFLICTS.md` estão marcados.

## Convenções do projeto
source: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (cabeçalho)
- "sem comentários em linhas de código; respostas em PT-BR; sem comandos destrutivos sem confirmação; Windows-first."
- Cada task termina em commit verde, com TDD (teste falhando → implementação → PASS → commit).
- "testes de integração com Docker fazem skip gracioso sem daemon."

## Layout do monorepo e stack
source: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (Architecture; Tech Stack; Task 1)
- Monorepo pnpm (`packageManager: pnpm@9.15.0`), workspaces `apps/*` e `packages/*`; TypeScript strict, ES2022, NodeNext; Vitest; tsx.
- `apps/central-api` (Fastify + Prisma + Postgres), `apps/control-plane` (Fastify + dockerode), `apps/web` (Next.js + Tailwind), `packages/worker`, `packages/updater`, `packages/shared` (tipos/contratos).
- [SUPERADO] "Next.js 15" → 16.4.0 no código; [SUPERADO] "packages/worker (bot Playwright)" e "Playwright" no stack do worker → Node puro WS/REST.

## Plano por fases e dependências
source: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (Fases 0-6; Ordem e dependências)
- Fase 0 scaffold (Task 1); Fase 1 central-api (Tasks 2-8); Fase 2 control-plane (Tasks 9-16 + 20b); Fase 3 worker (Tasks 17-20); Fase 4 web (Tasks 21-25); Fase 5 packaging/release (Tasks 26-28); Fase 6 E2E (Task 29).
- "Fase 0 → 1 → 2 (depende do contrato do central) → 3 (independe de 2; Task 17 pode rodar em paralelo com Fase 2) → 4 (depende de 2) → 5 → 6"
- Task 17 (pesquisa PokeIdle) concluída: GAME.md commitado em 94ff8e1.

## Central API — contratos do plano
source: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (Tasks 2-8)
- `GET /health` → `{status:"ok"}`; `PORT` padrão 8080.
- Auth: `POST /auth/login` {username, password} → `{accessToken, refreshToken}`; Argon2id; access JWT de 15 min com payload `{sub: userId, role}` e `JWT_SECRET`; refresh opaco de 32 bytes em hex, SHA-256 em `refresh_tokens`, 30 d; `POST /auth/refresh` rotaciona (marca `revoked_at`); `POST /auth/logout`; usuário inativo → 401 genérico.
- Crypto: AES-256-GCM com `SECRETS_KEY` (32 B hex); formato `nonce(12B) || ciphertext || tag(16B)`; sem chave → crash no boot.
- Accounts: `GET/POST /accounts`, `PATCH/DELETE /accounts/:id`, `GET /accounts/:id/credentials` (único endpoint com plaintext), `PUT /accounts/:id/tokens`; conta de outro usuário → 404.
- Releases: `GET /version?channel=stable` → `{version, imageDigest, changelog}`; `POST /admin/releases` (admin); `GET /admin/releases`.
- Seed do admin por `ADMIN_USERNAME`/`ADMIN_PASSWORD`; Dockerfile multi-stage com `prisma migrate deploy` no entrypoint.

## Control-plane — contratos do plano
source: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (Tasks 9-16, 20b)
- SessionStore: refresh em `/data/session.json`, access em memória; grace offline < 7 d → `offline: true`; expirado → null (read-only).
- Guard `requireSession`: `/accounts` e `/workers/*` protegidos; `/auth/*` e `/health` abertos; falha de auth nunca toca no Docker.
- `ContainerOrchestrator` (createWorker/startWorker/stopWorker/removeWorker/listWorkers/workerLogs/pullImage); `DockerOrchestrator`: `mpw-worker-<accountId>`, labels `mpw.managed=true` e `mpw.account-id`, `AutoRemove=false`, sem volume de browser.
- Supervisor: poll a cada 10 s; backoff 1m, 2m, 5m, teto 15m; `degraded` após 3 falhas; `GET /workers/status`.
- Start: busca `/accounts/:id/credentials`, monta env (`ACCOUNT_ID`, `GAME_URL`, `POKEIDLE_USER`, `POKEIDLE_PASS`, `ACCESS_TOKEN?`, `REFRESH_TOKEN?`, `SOLVER_KEY?`, `PROXY_URL?`); credenciais só em memória. Token write-back: o supervisor lê `tokens` do `/health` do worker → `PUT /accounts/:id/tokens`. Stop: drain de 30 s + remove.
- SSE: `GET /workers/:accountId/logs/stream`, `GET /events`.
- Update manager: check no boot + 6 h; rolling um a um; `/data/rollback.json` gravado antes do updater; updater efêmero com `TARGET_TAG`; falha de pull → `update_failed`; settings em `/data/settings.json`.
- Task 20b: `POST /auth/login`, `POST /auth/logout`, `GET /auth/session` → `{authenticated, offline}`; proxy de `/accounts` ao central sem expor `/credentials`; `POST /proxy/test` (container efêmero curl, timeout 20 s, sempre removido).

## Worker — contratos do plano
source: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (Fase 3, Tasks 18-20)
- "Decisão pós-pesquisa (GAME.md, commit 94ff8e1): worker é Node puro WS/REST, sem Chromium."
- config: `ACCOUNT_ID`, `GAME_URL` obrigatórias; `POKEIDLE_USER`/`POKEIDLE_PASS` obrigatórias se houver `SOLVER_KEY`; `ACCESS_TOKEN`/`REFRESH_TOKEN`/`PROXY_URL` opcionais; `CONTROL_PLANE_URL`.
- `/health` na porta 3001: `{state: "booting"|"authenticating"|"in-game"|"needs-login"|"error", lastAction, lastError, uptimeSec, tokens?}` (`tokens` só quando renovados).
- TokenProvider: `StoredTokenProvider`, `SolverTokenProvider` (createTask/getTaskResult, `TurnstileTaskProxyless`); ordem stored → solver → needs-login.
- Game loop: rodízio de ações com jitter; 5 erros consecutivos → throw para o supervisor; SIGTERM → drain de 20 s → exit 0; Dockerfile `node:22-slim` sem Playwright/Chromium.
- [SUPERADO] "Socket.IO" (Fase 3, Tasks 19 e 20) → WebSocket nativo; [SUPERADO] "4001 (sessão duplicada)" → 4001 token recusado / 4005 sessão substituída.

## Web — contratos do plano
source: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (Tasks 21-25)
- `apiFetch` com base `CONTROL_PLANE_URL` (padrão `http://localhost:4000`), cookie de sessão, 401 → `/login`.
- Login: cookie http-only; 401 → "credenciais inválidas"; banner amarelo "modo offline — alterações limitadas".
- Dashboard: label, status (running/parado/erro/degraded), última ação, uptime, start/stop/restart; SSE `/events`; drawer de logs.
- Form de conta: label, pokeidleUser, pokeidlePass, proxyUrl, solverKey, seção "ou cole os tokens"; "testar proxy"; CTA para needs-login.
- Settings: badge de versão, changelog, atualizar agora, rollback, toggle de auto-update, erro de update.

## Packaging e release (plano) — superado
source: docs/plans/2026-10-11-multiacc-pokeidle-plan.md (Tasks 26-29)
- [WARNING aberto] Task 26: compose com `ports: ["3000:3000"]` e `CURRENT_VERSION`; README/código: 127.0.0.1, `MPW_TAG`, `IMAGE_REGISTRY`, `ALLOWED_HOSTS`.
- Task 27: updater recria `mpw-web` e `mpw-control-plane` com `TARGET_TAG` lendo o inspect atual; falha → `:stable`.
- [WARNING aberto] Task 28: 4 imagens, `:stable`, `CENTRAL_ADMIN_TOKEN`; README/código: 5 imagens multi-arch, stable/beta, `CENTRAL_ADMIN_USERNAME`/`CENTRAL_ADMIN_PASSWORD`.
- [WARNING aberto] Task 29: `worker-mock` + `docker-compose.e2e.yml` na raiz; README/código: `e2e/fake-game` + worker real + `e2e/docker-compose.e2e.yml`.

## Instalação do usuário final
source: README.md (Para quem vai usar)
- Pré-requisitos: Docker Desktop (WSL 2 no Windows), usuário/senha da central fornecidos pelo admin; `.env.example` já traz `https://pokeidle.ayresigo.dev`; imagens públicas no ghcr.io, sem `docker login`.
- "docker compose pull" + "docker compose up -d"; painel em http://localhost:3000.
- "O painel só escuta em `127.0.0.1` ... Ele também só responde quando aberto como `localhost`, `127.0.0.1` ou `[::1]`; se você usa outro nome que aponta para o próprio PC, coloque-o em `ALLOWED_HOSTS` no `.env`."

## Contas e needs-login
source: README.md (Cadastrar contas)
- Dashboard → Nova conta: usuário/senha do jogo, proxy opcional com "testar proxy", Iniciar.
- needs-login: logar em https://poke.idleworld.online, rodar `sessionStorage.getItem('pokeweb:tokens')` no console, colar em "JSON de pokeweb:tokens", salvar e reiniciar o worker; não jogar mais com a conta naquele navegador (uma sessão por conta).

## Atualização, pinagem e rollback
source: README.md (Atualizar; Fixar ou voltar de versão)
- Configurações: versão atual, "atualizar agora", toggle "Atualização automática"; a atualização automática não tenta de novo uma versão que falhou, mas "atualizar agora" tenta.
- "Configurações → voltar para vX devolve os workers para a versão anterior." [WARNING aberto: escopo do rollback]
- Painel inteiro: desligar a auto-atualização → `MPW_TAG=<versão>` → `docker compose pull && docker compose up -d`; voltar com `MPW_TAG=stable`. "Só `docker compose up -d` pode recriar o painel a partir de uma imagem local antiga."

## Parar e limpar
source: README.md (Parar)
- `docker compose stop` mantém os dados; antes de `down`, clicar em Parar em cada conta; remover workers por `label=mpw.managed=true`.
- "Seus dados ficam no volume `mpw_mpw-data`. Não use `docker compose down -v`, a menos que queira perder a sessão salva."

## Central no Kubernetes (oficial)
source: README.md (Para o admin: central no Kubernetes (tcgreaper))
- Cluster `tcgreaper`, namespace `pokeidle`, `https://pokeidle.ayresigo.dev`; `k8s/base` (Kustomize): Deployment + Service + Ingress (Traefik, TLS cert-manager `letsencrypt-prod`), NetworkPolicy, CronJob de backup diário (`pg_dump` do banco `pokeidle`, 14 dias, PVC `pokeidle-backup-pvc`).
- Banco `pokeidle` com role própria (sem superusuário) em `postgres.tcgtracker.svc.cluster.local`.
- Secret `pokeidle-secrets` criado à mão a partir de `k8s/base/secrets.example.yaml`, nunca commitado.
- Versão por `newTag` em `k8s/base/kustomization.yaml`; `kubectl --context tcgreaper apply -k k8s/base`.
- A imagem roda `prisma migrate deploy` e o seed do admin a cada start (idempotente).

## Central numa VPS (alternativa)
source: README.md (Para o admin: central numa VPS (alternativa))
- `docker-compose.central.yml` com `POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRETS_KEY` (ambos de `openssl rand -hex 32` e diferentes), `ADMIN_USERNAME`, `ADMIN_PASSWORD`; a API não sobe com `JWT_SECRET` menor que 32 caracteres.
- API em `127.0.0.1:8080` (`CENTRAL_PORT`), em HTTP, atrás de proxy reverso HTTPS (Caddy/nginx).
- "Guarde o `SECRETS_KEY`: sem ele as credenciais salvas não podem ser lidas."

## Gestão de usuários
source: README.md (Cadastrar amigos)
- Página Usuários, visível só para admins: novo usuário (3-64 caracteres; letras sem acento, números, `.`, `-`, `_`), "gerar senha forte", desativar/ativar, redefinir senha (revoga sessões), tornar admin/usuário (vale na próxima renovação, até 15 min); proteções contra autodesativação/autorrebaixamento e contra ficar sem admin ativo; desabilitada offline.
- Admin dedicado `ci-release` para o GitHub Actions.

## Publicação de versão
source: README.md (Para o admin: publicar uma versão)
- `.github/workflows/release.yml` em tag `v*`: testa, gera 5 imagens (`mpw-web`, `mpw-control-plane`, `mpw-worker`, `mpw-updater`, `mpw-central-api`) para `linux/amd64` e `linux/arm64`, publica `ghcr.io/ayresigo/mpw-*:<versão>`, registra a release na central e só então move `:stable` ou `:beta`. `ci.yml` roda testes em PR/push na `main`.
- Secrets `CENTRAL_ADMIN_USERNAME`/`CENTRAL_ADMIN_PASSWORD`; variable `CENTRAL_API_URL=https://pokeidle.ayresigo.dev`; tornar os 5 pacotes públicos após a primeira release.
- Tag semver com `v`; pré-release → canal beta; versão registrada sem o `v`; changelog vem da mensagem da tag anotada (ou da lista de commits); release duplicada só gera aviso.

## E2E
source: README.md (Rodar o E2E)
- Fluxo: login → criar conta → iniciar → logs → needs-login → parar → aviso de update, em navegador real (Playwright), contra imagens locais e um jogo falso; nunca toca o jogo real nem o GHCR.
- Imagens `ghcr.io/ayresigo/mpw-{web,control-plane,worker,central-api,fake-game}:e2e` (`VERSION=0.0.1-e2e`); projeto `mpw-e2e`, web 127.0.0.1:3100, central :3101, jogo falso :3102.
- `e2e/fake-game` aceita só o JWT de `e2e/fake-game/token.ts`, emite `field-init`/`field-kill`, `POST /__e2e/kick` → WS 4005.
- Cleanup: remove `mpw-worker-<id>` pelo nome exato e roda `docker compose -p mpw-e2e down -v`; `E2E_SKIP_BUILD=1`, `E2E_KEEP=1`; recusa rodar se existir container `mpw-updater`; não rodar junto com a instalação real que tenha workers ativos.
