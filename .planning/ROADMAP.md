# Roadmap: PokeIdle Plus

## Overview

O v1.0 (Fundação) entregou o sistema completo: central multi-tenant no k8s, painel local que orquestra um worker por conta, release multi-arch com canais e E2E contra um jogo falso. Só que o worker nunca jogou contra o jogo real. O v1.1 (Farm autônomo) leva isso a contas farmando sozinhas por 24 h. Primeiro confirma o protocolo com uma conta real, depois implementa o comportamento autônomo e a supervisão que sobrevive a reinícios. Em paralelo, dá à central uma página raiz útil.

## Milestones

- ✅ **v1.0 Fundação** — entregue em 2026-10-12 (release `v0.0.1-beta.1`)
- 🚧 **v1.1 Farm autônomo** — Phases 1-3 (em andamento)

## Phases

**Numeração:**
- Fases inteiras (1, 2, 3): trabalho planejado do milestone
- Fases decimais (1.1, 2.1): inserções urgentes (marcadas com INSERTED)

<details>
<summary>✅ v1.0 Fundação — SHIPPED 2026-10-12 (release v0.0.1-beta.1)</summary>

**Entrega:** monorepo pnpm com `apps/central-api`, `apps/control-plane`, `apps/web`, `packages/worker`, `packages/updater`, `e2e/` e `k8s/base`. O plano de 29 tasks (+20b) em `docs/plans/2026-10-11-multiacc-pokeidle-plan.md` foi executado inteiro, mais as adições abaixo.

Etapas concluídas:
- [x] Etapa 0 — Scaffold do monorepo (Task 1)
- [x] Etapa 1 — Central API: auth JWT, AES-256-GCM, contas multi-tenant, releases, seed do admin (Tasks 2-8)
- [x] Etapa 2 — Control-plane: sessão com grace offline, `ContainerOrchestrator`/dockerode, supervisor com backoff, SSE, update manager, teste de proxy (Tasks 9-16 + 20b)
- [x] Etapa 3 — Worker Node puro: pesquisa `GAME.md`, `TokenProvider` com solver Turnstile, cliente WS com sharding e game loop (Tasks 17-20)
- [x] Etapa 4 — Painel web Next.js 16: login, dashboard, logs, formulário de conta, configurações (Tasks 21-25)
- [x] Etapa 5 — Packaging e release: compose em `127.0.0.1` com `MPW_TAG`/`ALLOWED_HOSTS`, updater, workflow com 5 imagens multi-arch e canais `stable`/`beta` (Tasks 26-28, na forma das decisões D-13/D-14)
- [x] Etapa 6 — E2E Playwright com worker real contra `e2e/fake-game` (Task 29, na forma da decisão D-12)
- [x] Gestão de usuários pelo admin (`/admin/users`, página Usuários)
- [x] Central no k8s `tcgreaper` em `https://pokeidle.ayresigo.dev` (Kustomize, Traefik, cert-manager, NetworkPolicy, backup diário)
- [x] Release `v0.0.1-beta.1` publicada (canal beta)

</details>

## 🚧 v1.1 Farm autônomo (em andamento)

**Milestone Goal:** contas farmando sozinhas por 24 h, sem intervenção, sem ban e sem cair em `needs-login`.

- [ ] **Phase 1: Validação com conta real** - Confirmar em sessão real os pontos de GAME.md §9 e ajustar o worker ao que for observado
- [ ] **Phase 2: Autoplay** - Comportamento autônomo do bot e supervisão que sobrevive a reinícios, até a run de 24 h
- [ ] **Phase 3: Página raiz da central** - `GET /` em pokeidle.ayresigo.dev responde algo útil em vez do 404

### Paralelismo e worktrees

- **Phase 3 é independente.** Mexe só em `apps/central-api` (e no `newTag` de `k8s/base`). Pode ser discutida, planejada e executada em worktree própria a qualquer momento, em paralelo com as outras.
- **Phase 2 começa a discussão já.** `/gsd-discuss-phase 2` pode rodar em paralelo à Phase 1. SUP-01 e SUP-02 (`apps/control-plane`) não dependem do jogo real e podem ser planejados e executados em worktree paralela à Phase 1.
- **Execução do autoplay contra o jogo real espera a Phase 1.** AUTO-01..AUTO-06 dependem dos achados da Phase 1: aceite do solver, `cmid`/4007, shard, formato dos eventos de kill, comportamento do drain e do `sleep-mode`. Se a Phase 1 encontrar um bloqueio (por exemplo, 4007 sem `cmid` ou token do solver recusado), a Phase 2 é replanejada antes de executar.
- **Conflito de arquivos:** as Phases 1 e 2 alteram `packages/worker/src/game/`. As correções da Phase 1 entram primeiro; worktrees da Phase 2 fazem rebase depois delas.
- **Conta real:** o jogo aceita uma sessão viva por conta (logar em outro lugar → 4005). Smoke da Phase 1 e testes/run de 24 h da Phase 2 não podem usar a mesma conta ao mesmo tempo.

### Phase 1: Validação com conta real
**Goal**: O worker comprovadamente funciona contra o jogo real. Cada ponto de `packages/worker/GAME.md` §9 está confirmado ou refutado com evidência, e o worker está ajustado ao comportamento observado.
**Depends on**: Nothing (primeira fase do v1.1; precisa de uma conta real fornecida pelo usuário)
**Requirements**: VAL-01, VAL-02, VAL-03, VAL-04, VAL-05, VAL-06, VAL-07
**Success Criteria** (what must be TRUE):
  1. O usuário roda o worker com a própria conta real, e GAME.md §9.1 registra com data e evidência se o `captchaToken` do solver Turnstile foi aceito no login. Se foi recusado, a conta entra pelos tokens colados e, sem token válido, o worker cai em `needs-login` com motivo claro.
  2. Com a conta real, o worker conecta sem `cmid` no shard calculado e recebe `field-init` na hunt. Se o servidor fechar com 4007, a conta aparece em `error` com esse motivo e o worker não fica reconectando.
  3. Durante a sessão real, os logs do worker mostram `field-kill` reais e o contador de kills/capturas subindo, sem o watchdog de stall disparar.
  4. Depois de parar a conta pelo painel (drain), está registrado se o farm offline continua. Se só continua com `sleep-mode`, o drain passa a enviá-lo e o farm offline é confirmado de novo.
  5. Todo item de GAME.md §9 está marcado como confirmado, refutado ou não observável. Cada divergência virou correção no worker, com teste que reproduz o comportamento real e suíte verde.
**Plans**: 5 plans
- [ ] 1-PLAN.md — Instrumentação de observabilidade de kills (não gated; pré-condição de VAL-04/SC3)
- [ ] 2-PLAN.md — Smoke manual de auth/sessão (VAL-01, VAL-02, VAL-06 auth)
- [ ] 3-PLAN.md — Smoke manual de game loop, kills, shard e drain (VAL-02..VAL-06)
- [ ] 4-PLAN.md — Correções no worker gated por evidência (VAL-01..VAL-07)
- [ ] 5-PLAN.md — Gate final: §9 marcado + suíte do worker verde (VAL-07)

### Phase 2: Autoplay
**Goal**: As contas do jogador farmam sozinhas por 24 h: o bot caça, repõe pokébolas e consumíveis, vende loot, segue uma rotina e reage aos eventos do jogo, e a supervisão sobrevive a reinícios. As políticas concretas (hunt, compras, vendas, horários, eventos) são decididas com o usuário no `/gsd-discuss-phase 2`.
**Depends on**: Phase 1 (só para executar contra o jogo real; discussão, planejamento e SUP-01/SUP-02 podem andar em paralelo)
**Requirements**: AUTO-01, AUTO-02, AUTO-03, AUTO-04, AUTO-05, AUTO-06, SUP-01, SUP-02
**Success Criteria** (what must be TRUE):
  1. Até 4 contas reais do jogador rodam 24 h seguidas sem nenhum clique, sem `needs-login`, `error`, ban ou aviso do jogo, e o relatório da run mostra kills/capturas subindo durante toda a janela.
  2. Ao longo das 24 h, nenhuma conta para de capturar por falta de pokébolas ou consumíveis nem trava com inventário cheio: compras e vendas acontecem sozinhas e aparecem no relatório.
  3. Cada conta caça na hunt dada pela política acordada e troca ou se recupera sozinha quando a hunt para de render. Eventos que interrompem o farm (freeze, cooldown, teleporte para a cidade, manutenção) se resolvem sem ação do usuário.
  4. A rotina diária acordada (sessões, pausas, Modo Soneca) é seguida e aparece nos logs, sem relogins que cancelem o farm offline.
  5. Reiniciar o control-plane (inclusive pelo auto-update) ou o Docker Desktop no meio da run não exige clique: os workers que estavam rodando voltam sozinhos com os tokens mais recentes e seguem supervisionados.
**Plans**: TBD

### Phase 3: Página raiz da central
**Goal**: Quem abre `https://pokeidle.ayresigo.dev/` entende o que é o PokeIdle Plus e como começar, em vez de receber o 404 JSON do Fastify. Página HTML simples ou JSON informativo: o formato é decidido no `/gsd-plan-phase 3`.
**Depends on**: Nothing (independente das Phases 1 e 2)
**Requirements**: ROOT-01, ROOT-02, ROOT-03
**Success Criteria** (what must be TRUE):
  1. Um visitante que abre `https://pokeidle.ayresigo.dev/` recebe 200 com conteúdo útil (o que é o PokeIdle Plus e como instalar ou começar).
  2. A raiz é pública e não mostra dados de usuários, contas, releases internas nem segredos.
  3. `/health`, `/version`, `/auth/*`, `/accounts*` e `/admin/*` seguem com o mesmo comportamento para painéis instalados e para o CI, com os testes da central verdes.
  4. A nova versão está no ar no `tcgreaper`, com o deploy (`newTag` + `kubectl apply`) feito pelo usuário ou com a confirmação explícita dele.
**Plans**: TBD
**UI hint**: yes

## Progress

**Ordem de execução:** Phase 1 → Phase 2. A Phase 3 entra em qualquer ponto. Decimais (1.1, 2.1) ficam entre os inteiros.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Validação com conta real | v1.1 | 0/5 | Not started | - |
| 2. Autoplay | v1.1 | 0/TBD | Not started | - |
| 3. Página raiz da central | v1.1 | 0/TBD | Not started | - |

## 📋 Backlog (sem fase atribuída)

Concerns relevantes de `.planning/codebase/CONCERNS.md` que nenhuma das 3 fases cobre. Registrados aqui sem virar fase; promover com `/gsd-insert-phase` ou num próximo milestone. IDs em REQUIREMENTS.md (v2).

- **REL-01 — Canal beta configurável no control-plane:** `UpdateManager.checkForUpdate()` sempre consulta `GET /version?channel=stable` (`apps/control-plane/src/update/manager.ts`). Painéis com `MPW_TAG=beta` nunca recebem updates beta.
- **REL-02 — Tag `:stable` inexistente:** a única release é `v0.0.1-beta.1`, então `docker compose pull` com o `.env.example` padrão (`MPW_TAG=stable`) falha com manifest unknown. Workaround atual: `MPW_TAG=beta`.
- **CEN-01 — Rate limit na central:** `POST /auth/login` e `/auth/refresh` expostos na internet sem rate limit, lockout ou limite de tamanho da senha (argon2 com pod de 256Mi). Arquivos: `apps/central-api/src/auth/routes.ts`, `k8s/base/ingress.yaml`.
- **CEN-02 — Logger do Fastify:** `Fastify()` sem `logger` em `apps/central-api/src/app.ts` e `apps/control-plane/src/app.ts`. Todo `request.log.error` é descartado e erros 500 não deixam rastro.
- **QA-01 — E2E fora do CI:** `e2e/smoke.spec.ts` só roda localmente; `ci.yml`/`release.yml` não o executam nem fazem typecheck de `e2e/`.
- **QA-02 — Helpers de teste duplicados:** `fabricarJwt` em 9 arquivos do control-plane, `criarOrchestratorFake`/`workerRodando` em 4, `limparBanco`/`seedUser` em 5 da central.

Os outros concerns (segurança do painel local e do `docker.sock`, semver das releases, recriação com env antigo, imagens de runtime inchadas, instrução `xargs docker rm` no README etc.) continuam em `.planning/codebase/CONCERNS.md`.
