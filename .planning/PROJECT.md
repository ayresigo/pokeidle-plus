# PokeIdle Plus

## What This Is

PokeIdle Plus (repo `multiacc-pokeidle`, GitHub `ayresigo/pokeidle-plus`) automatiza contas do jogo **Poke Idle World** (`https://poke.idleworld.online`). Cada jogador roda na própria máquina um painel local (Next.js + control-plane Fastify via Docker Compose) que sobe um container worker por conta. Os workers jogam pelo protocolo WS/REST do jogo, sem browser. Uma central compartilhada (`https://pokeidle.ayresigo.dev`, k3s `tcgreaper`, namespace `pokeidle`) guarda usuários, contas criptografadas e releases. É feito para o admin e os amigos para quem ele cria usuários.

## Core Value

As contas do jogador farmam sozinhas no Poke Idle World, 24 horas por dia, sem intervenção manual, sem ban e sem cair em `needs-login`.

## Requirements

### Validated

<!-- Entregue no milestone v1.0 — Fundação (release v0.0.1-beta.1, 2026-10-12). -->

- ✓ Worker Node puro (WS/REST, sem browser): entra na hunt, mantém o loop, faz drain em SIGTERM, erros isolados não derrubam o loop — v1.0. Coberto por testes e pelo jogo falso do E2E; **nunca rodou contra o jogo real** (ver Active, VAL-*)
- ✓ Orquestração dinâmica via Docker API: `mpw-worker-<accountId>` com labels `mpw.managed`/`mpw.account-id`, backoff de restart 1m → 15m, `degraded` após 3 falhas, compose declara só `web` e `control-plane` — v1.0
- ✓ Proxy opcional por conta (REST e WS), com "testar proxy" mostrando o IP de saída; serve para o limite por IP (4006) e não aumenta o limite de 4 contas por jogador — v1.0
- ✓ Distribuição multiusuário: central multi-tenant (conta de outro usuário → 404), JWT de 15 min com refresh de 30 d, grace offline de 7 dias, painel em `127.0.0.1` com `ALLOWED_HOSTS` — v1.0
- ✓ Dados 100% na central: senhas, tokens e solver key em AES-256-GCM; credenciais em texto puro só em `GET /accounts/:id/credentials` e só em memória; volume local guarda só `session.json`, `settings.json`, `rollback.json` — v1.0
- ✓ Login no jogo via `TokenProvider` (stored → solver Turnstile → `needs-login`), refresh automático com write-back dos tokens na central, tokens `pokeweb:tokens` colados pela UI — v1.0
- ✓ Updates centralizados: `GET /version` no boot e a cada 6 h, modos automático e manual, rolling dos workers com drain, updater efêmero para web + control-plane, rollback em um clique dos workers, painel fixado/voltado via `MPW_TAG` — v1.0
- ✓ UI local (Next.js 16 App Router + Tailwind): login, dashboard com status/última ação/uptime/start/stop/restart, logs por SSE, formulário de conta, configurações de update — v1.0
- ✓ Gestão de usuários pelo admin (`/admin/users`): criar com senha gerada, ativar/desativar, redefinir senha, trocar papel, proteções contra ficar sem admin ativo; página desabilitada offline — v1.0
- ✓ Release: tag `v*` gera 5 imagens multi-arch (`mpw-web`, `mpw-control-plane`, `mpw-worker`, `mpw-updater`, `mpw-central-api`) em `ghcr.io/ayresigo`, canais `stable`/`beta`, registro na central com o admin `ci-release` — v1.0
- ✓ Central no k8s `tcgreaper` (Kustomize, Traefik, cert-manager, NetworkPolicy, `pg_dump` diário com 14 dias) — v1.0
- ✓ E2E Playwright: worker real contra `e2e/fake-game`, imagens locais `:e2e`, projeto `mpw-e2e` — v1.0

### Active

<!-- Milestone v1.1 — Farm autônomo. Detalhe e IDs em REQUIREMENTS.md. -->

- [ ] Confirmar em sessão real cada ponto de `packages/worker/GAME.md` §9 (solver Turnstile, sem `cmid` vs 4007, shard, kills reais, drain/`sleep-mode`/farm offline e os demais) e ajustar o worker ao que for observado (VAL-01..07)
- [ ] Comportamento autônomo do bot: política de hunt, compra de pokébolas/consumíveis, venda de loot, rotina/horários e reação a eventos do jogo (AUTO-01..05). Decisões de produto saem do `/gsd-discuss-phase 2`
- [ ] Estado desejado dos workers e tokens renovados sobrevivem a reinícios do control-plane e do Docker (SUP-01..02)
- [ ] Contas farmando 24 h sem intervenção, sem ban e sem `needs-login` (AUTO-06, métrica do milestone)
- [ ] `GET /` em `https://pokeidle.ayresigo.dev` responde algo útil em vez do 404 JSON do Fastify (ROOT-01..03)

### Out of Scope

- Mais de 4 contas por jogador — a regra oficial (`/rules`, seção 10) deleta contas acima disso sem autorização. Proxy não muda esse limite.
- Enviar ou forjar `cmid` no WS — seria burlar o limite por máquina do jogo (D-10). Se o servidor exigir `cmid` (close 4007), isso é bloqueio, não algo a contornar.
- Browser/Playwright/Chromium no worker — o worker é Node puro WS/REST (D-01). Playwright só no E2E.
- Banco de dados local — tudo fica na central (D-05).
- Rollback em um clique do painel inteiro (web + control-plane) — escopo aprovado é um clique só para os workers; o painel volta via `MPW_TAG` (D-15).
- Suporte a 2FA nas contas do jogo — o login exige código humano; conta com 2FA cai em `needs-login` (D-04).

## Context

- **Estado atual:** milestone v1.0 entregue. Release `v0.0.1-beta.1` (canal beta) publicada em 2026-10-12; central rodando em `https://pokeidle.ayresigo.dev`. Plano histórico em `docs/plans/2026-10-11-multiacc-pokeidle-plan.md` (29 tasks + 20b, todas concluídas), design em `docs/plans/2026-10-11-multiacc-pokeidle-design.md`.
- **Mapa do código (fonte de verdade sobre o que existe):** `.planning/codebase/{STACK,INTEGRATIONS,ARCHITECTURE,STRUCTURE,CONVENTIONS,TESTING,CONCERNS}.md`. Intel dos docs: `.planning/intel/`. Conflitos resolvidos: `.planning/INGEST-CONFLICTS.md`.
- **Monorepo pnpm:** `apps/central-api` (Fastify + Prisma 7 + Postgres), `apps/control-plane` (Fastify + dockerode), `apps/web` (Next.js 16, React 19.3), `packages/worker` (Node 22, `ws` + `undici`), `packages/updater`, `e2e/` (Playwright + `e2e/fake-game`), `k8s/base`, `.github/workflows/{ci,release}.yml`.
- **O worker foi escrito sem conta real.** Protocolo, close codes, sharding (88 shards, djb2 do `sub`) e login vieram do bundle minificado de `/play` e de ferramentas de terceiros (`packages/worker/GAME.md`). Todos os testes passam, mas nada garante que o worker farme em produção. O único dado real até agora: 4001 com token falso leva a refresh/`needs-login` (2026-10-11).
- **Lacunas que bloqueiam o farm de 24 h** (CONCERNS.md): compra de balls e venda de loot não implementadas (a conta para de capturar quando as balls acabam); o estado desejado do supervisor fica só em memória, então depois de auto-update ou reboot do Docker nenhum worker volta sozinho e tokens renovados se perdem; `HUNT_SLUG` não é configurável pelo painel e a escolha automática pode ser fraca.
- **Risco assumido pelo usuário:** automação viola as regras do jogo (seção 03: macros/tools; seção 09: trade com botter → ban permanente). Mitigações atuais: jitter de 10-30 s entre ações, sem `cmid` forjado. Detecção comportamental no servidor é provável [INFERENCE do GAME.md].

## Constraints

- **Segurança Docker (obrigatória):** nunca `docker system/volume/image prune`; nunca `docker rm`/`rmi`/`volume rm` sobre listagem filtrada (`-a`, `dangling`, `$(docker ... -q)`, `xargs`); remover só o que a própria tarefa criou, por nome exato; nada destrutivo sem confirmação explícita. Repassar a regra a todo subagente que tocar em Docker. Motivo: incidente anterior de perda de volumes.
- **Cluster:** nenhum `kubectl` que altere o `tcgreaper` sem confirmação explícita do usuário. Deploy da central = bump de `newTag` em `k8s/base/kustomization.yaml` + `kubectl --context tcgreaper apply -k k8s/base`, feito pelo usuário ou com aval dele.
- **Regras do jogo:** no máximo 4 contas por jogador; uma sessão viva por conta (logar em outro lugar → 4005); relogar em menos de ~5 min cancela o farm offline (Modo Soneca).
- **Runtime alvo:** Docker Desktop (Windows/WSL 2) e Docker em Linux/macOS nas máquinas dos usuários; central no k3s `tcgreaper`, namespace `pokeidle`, banco `pokeidle` no Postgres compartilhado `postgres.tcgtracker.svc.cluster.local`.
- **Stack:** pnpm 9, TypeScript strict (ES2022, NodeNext), Node 22, Vitest. Next.js 16 diverge do conhecido: ler `node_modules/next/dist/docs/` antes de mexer em `apps/web` (ver `apps/web/AGENTS.md`).
- **Convenções:** documentação e mensagens em PT-BR; sem comentários em linhas de código; TDD com commit verde por task; Windows-first; testes de integração com Docker fazem skip gracioso sem daemon.
- **Protocolo do jogo como dependência frágil:** sitekey, shards, paths do WS e bodies REST vêm do bundle do jogo e podem mudar a cada deploy. Todo achado novo vai para `packages/worker/GAME.md` com fonte; mudanças no worker sempre junto com `client.test.ts`/`provider.test.ts`.
- **Conta real:** a validação contra o jogo exige uma conta real fornecida pelo usuário; nenhum agente cria contas no jogo.

## Key Decisions

<decisions>
Nenhuma decisão é LOCKED: não há ADR ingerido. As decisões abaixo estão vigentes e implementadas. Só mudam por decisão explícita do usuário (por exemplo, uma ADR futura). D-11 a D-15 resolvem os 5 WARNINGS de `.planning/INGEST-CONFLICTS.md`, aprovados pelo usuário em 2026-10-12 pela versão implementada.

| ID | Decisão | Motivo | Resultado |
|----|---------|--------|-----------|
| D-01 | Worker Node puro WS/REST em `node:22-slim` (`ws` + `undici`), ~50 MB por conta, sem Playwright/Chromium, sem credencial da central, config por env, `/health` local, logs JSON, drain em SIGTERM | Mais leve e mais estável que browser; o jogo é server-authoritative | ✓ Implementado — ⚠️ falta validar com conta real |
| D-02 | Protocolo: WebSocket nativo JSON `{type}` em `wss://poke.idleworld.online/ws{shard}` (88 shards, djb2 do `sub`), token na query `?token=<access>&v=2`, REST `/api/*` com Bearer. Não é Socket.IO | Lido do bundle de `/play`; `/socket.io/` falha no upgrade | ✓ Implementado — ⚠️ shard a confirmar |
| D-03 | Close codes: 4001 token recusado (refresh no máximo 1×/5 min, depois `needs-login`); 4005 replaced → `needs-login`; 4006/4007 → `error`; 4008/4009 → `needs-login`; 4002 e quedas → backoff; 4003 → espera de 5/10/15 min | Semântica do bundle (GAME.md §3.3, §4.4, §9.2) | ✓ 4001 comprovado em produção; demais a confirmar |
| D-04 | Login via `TokenProvider`: em runtime stored → solver Turnstile (2captcha-compatível, `TurnstileTaskProxyless`) → `needs-login`; token colado como fallback; 2FA → `needs-login` | Turnstile bloqueia login 100% automático; estratégia trocável | ✓ Implementado — ⚠️ aceite do token do solver a confirmar |
| D-05 | Dados 100% na central; volume local só com estado da instalação | Decisão do usuário: sem banco local | ✓ |
| D-06 | Central oficial no k8s `tcgreaper`, namespace `pokeidle`, `https://pokeidle.ayresigo.dev`; VPS via `docker-compose.central.yml` como alternativa | Infra existente do admin | ✓ |
| D-07 | Registry `ghcr.io/ayresigo/mpw-*`, imagens públicas; repo `ayresigo/pokeidle-plus` | Usuários fazem pull sem `docker login` | ✓ |
| D-08 | Gestão de usuários via `/admin/users` (sem DELETE); revogação efetiva em até 15 min; ninguém se desativa ou se rebaixa; nunca sem admin ativo | Admin distribui acesso para amigos | ✓ |
| D-09 | Orquestração dinâmica via dockerode, workers fora do compose, backoff 1m → 15m no control-plane; `ContainerOrchestrator` é o ponto de extensão | Escala sem teto artificial | ✓ |
| D-10 | Worker não envia `cmid`; manda `Origin: <GAME_URL>` e o UA padrão do undici | Inventar fingerprint seria burlar o limite por máquina | — Pendente: confirmar se o servidor aceita ou fecha com 4007 |
| D-11 | Limite multi-conta: o produto promete no máximo 4 contas por jogador (regra oficial). O servidor fecha com 4006 (por IP) e 4007 (por máquina). Proxy por conta é opcional e só ajuda no 4006 | Regra oficial prevê deleção acima de 4; proxy não resolve 4007 | ✓ Aprovado 2026-10-12 |
| D-12 | E2E: worker real contra `e2e/fake-game`, Playwright, `e2e/docker-compose.e2e.yml`, projeto `mpw-e2e`, imagens `:e2e`. A seção Testes do design (`mpw-worker-mock`) e a Task 29 ficam superadas | Testa o worker de verdade sem tocar o jogo real | ✓ Aprovado 2026-10-12 |
| D-13 | Release: 5 imagens multi-arch (amd64/arm64), canais `stable`/`beta` (tag com pré-release vai para `beta`), registro na central com o admin dedicado `ci-release` (`CENTRAL_ADMIN_USERNAME`/`PASSWORD`, variable `CENTRAL_API_URL`). Task 28 superada | É o que está em `.github/workflows/release.yml` | ✓ Aprovado 2026-10-12 |
| D-14 | Compose distribuído: painel publicado só em `127.0.0.1:3000`, aceito como `localhost`/`127.0.0.1`/`[::1]` mais `ALLOWED_HOSTS`; versão por `MPW_TAG`; registry por `IMAGE_REGISTRY`. Task 26 superada | O painel controla o Docker socket; expor na rede seria regressão de segurança | ✓ Aprovado 2026-10-12 |
| D-15 | Rollback em um clique vale só para os workers (`POST /update/rollback`, `rollback.json`). O painel inteiro volta desligando o auto-update, ajustando `MPW_TAG` e rodando `docker compose pull && docker compose up -d` | Escopo entregue; recriar o painel por dentro diverge do Compose | ✓ Aprovado 2026-10-12 |
</decisions>

## Evolution

Este documento muda nas transições de fase e nos fechamentos de milestone.

**Depois de cada fase** (via `/gsd-transition`):
1. Requisito invalidado? → Out of Scope, com o motivo
2. Requisito validado? → Validated, com a referência da fase
3. Requisito novo? → Active
4. Decisão nova? → Key Decisions
5. "What This Is" ainda está certo? → atualizar se mudou

**Depois de cada milestone** (via `/gsd-complete-milestone`):
1. Revisão completa de todas as seções
2. Core Value ainda é a prioridade certa?
3. Out of Scope: os motivos ainda valem?
4. Atualizar Context com o estado atual

---
*Last updated: 2026-10-12 after ingest de docs (/gsd-ingest-docs, modo new); milestone v1.1 iniciado*
