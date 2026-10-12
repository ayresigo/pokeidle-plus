# Decisions (intel sintetizada)

Gerado por gsd-doc-synthesizer em 2026-10-12 (modo new).

## ADRs ingeridos

Nenhum. O manifest (`.planning/ingest-manifest.yaml`) só declara SPEC e DOC, então não há decisões LOCKED e a checagem LOCKED vs LOCKED não teve entrada.

## Decisões vigentes (não-LOCKED, extraídas de SPEC/DOC)

Decisões de arquitetura que estão nos docs e já foram implementadas. Nenhuma é LOCKED: uma ADR futura pode substituí-las. Quando havia divergência, ela foi resolvida em `.planning/INGEST-CONFLICTS.md` (bucket INFO).

### D-01 Worker Node puro WS/REST, sem browser
- status: vigente (implementada)
- escopo: packages/worker
- decisão: worker em `node:22-slim`, cliente WS/REST puro (`ws` + `fetch`/`undici`), ~50 MB de RAM por conta, sem Playwright/Chromium. Recebe config por env vars, healthcheck HTTP local, logs JSON no stdout, drain gracioso em SIGTERM. Não tem nenhuma credencial do central.
- supera: "bot Playwright" (design: Objetivo e Requisitos; plano: Goal/Architecture/Tech Stack); GAME.md seção 7, itens 2 e 6
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Componentes/Worker); docs/plans/2026-10-11-multiacc-pokeidle-plan.md (Fase 3, "Decisão pós-pesquisa", e Task 20)

### D-02 Protocolo do jogo: WebSocket nativo + REST
- status: vigente (implementada)
- escopo: packages/worker/src/game
- decisão: WebSocket nativo com mensagens JSON `{type, ...}` em `wss://poke.idleworld.online/ws` com sharding por conta (88 shards, djb2 do `sub` do JWT), access token na query (`?token=<access>&v=2`), mais REST `/api/*` com Bearer. Não é Socket.IO.
- supera: "Socket.IO" (design: Worker; plano: Fase 3 e Tasks 19/20)
- source: packages/worker/GAME.md (seções 2 e 4.4)

### D-03 Semântica dos close codes do WS
- status: vigente (implementada)
- escopo: packages/worker/src/game/client.ts
- decisão: 4001 = token recusado (invalidar/refresh no máximo 1 vez a cada 5 min e reconectar; 4001 repetido ou refresh recusado sem solver → `needs-login`); 4005 = sessão substituída → `needs-login` sem reconectar; 4006/4007 → `error` sem reconectar; 4008/4009 → `needs-login`; 4002 e quedas comuns → backoff do bundle; 4003 → atraso de manutenção 5/10/15 min.
- supera: "4001 = sessão duplicada" (plano: Task 20; design: Login)
- source: packages/worker/GAME.md (seções 3.3, 4.4 e 9.2)

### D-04 Login no jogo via interface TokenProvider
- status: vigente (implementada)
- escopo: packages/worker/src/auth
- decisão: estratégia trocável. O solver Turnstile (2captcha-compatível, `TurnstileTaskProxyless`, sitekey `0x4AAAAAADkKBnFEMDt0MGBM`) é a estratégia primária para obter tokens novos e o token colado (`sessionStorage['pokeweb:tokens']`) é o fallback. Em runtime a ordem é stored → solver → needs-login. Refresh via `/api/auth/refresh`; tokens renovados aparecem no `/health` e o control-plane os grava no central. Contas com 2FA → needs-login.
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Login); docs/plans/2026-10-11-multiacc-pokeidle-plan.md (Task 19); packages/worker/GAME.md (seção 9.1); README.md (Cadastrar contas)

### D-05 Dados 100% na central
- status: vigente
- escopo: sistema
- decisão: zero banco local; usuários, contas, tokens e releases ficam no Postgres central atrás da API. O volume local `mpw-data` guarda só estado da instalação (`session.json`, `settings.json`, `rollback.json`).
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Requisitos consolidados; Riscos: "decisão do usuário: sem banco local"); docs/plans/2026-10-11-multiacc-pokeidle-plan.md (Tasks 9 e 15); README.md (Parar)

### D-06 Central hospedada no k8s tcgreaper
- status: vigente (implementada)
- escopo: apps/central-api, infra
- decisão: a central oficial roda no cluster `tcgreaper`, namespace `pokeidle`, em `https://pokeidle.ayresigo.dev` (k8s/base com Kustomize, Traefik, cert-manager, NetworkPolicy, CronJob de pg_dump), usando o banco `pokeidle` no Postgres compartilhado `postgres.tcgtracker.svc.cluster.local`. A VPS via `docker-compose.central.yml` fica como alternativa documentada.
- supera: "VPS do admin" (design; plano)
- source: README.md (Para o admin: central no Kubernetes (tcgreaper); Para o admin: central numa VPS (alternativa))

### D-07 Registry ghcr.io/ayresigo
- status: vigente (implementada)
- escopo: release/packaging
- decisão: imagens `ghcr.io/ayresigo/mpw-*` públicas; repositório GitHub `ayresigo/pokeidle-plus`.
- supera: placeholder `ghcr.io/<owner>` (plano: Tasks 15, 26 e 28)
- source: README.md (Para o admin: publicar uma versão)

### D-08 Gestão de usuários via /admin/users
- status: vigente (implementada; adição posterior ao design)
- escopo: apps/central-api, apps/control-plane, apps/web
- decisão: admin cria usuários, ativa/desativa, redefine senha e muda o papel pela página Usuários. Revogação efetiva na próxima renovação (até 15 min). Ninguém desativa nem rebaixa a si mesmo, e o sistema nunca fica sem admin ativo. Sem DELETE. Página desabilitada em modo offline. O CI usa um admin dedicado `ci-release`.
- source: README.md (Cadastrar amigos)

### D-09 Orquestração dinâmica via Docker API
- status: vigente
- escopo: apps/control-plane
- decisão: workers criados via dockerode como `mpw-worker-<accountId>` com labels (`mpw.managed=true`, `mpw.account-id`), fora do compose; backoff de restart exponencial (1m → 15m) gerenciado pelo control-plane; o compose declara apenas `web` e `control-plane`. A interface `ContainerOrchestrator` é o ponto de extensão para Swarm/K8s.
- source: docs/plans/2026-10-11-multiacc-pokeidle-design.md (Orquestração); docs/plans/2026-10-11-multiacc-pokeidle-plan.md (Tasks 11 e 12); README.md (Parar)

### D-10 Sem cmid no WS
- status: vigente (implementada; pendente de confirmação com conta real)
- escopo: packages/worker
- decisão: o worker não envia `cmid`, porque inventar fingerprint seria burlar o limite por máquina. Envia `Origin: <GAME_URL>` e o UA padrão do undici.
- source: packages/worker/GAME.md (seção 9.2)
