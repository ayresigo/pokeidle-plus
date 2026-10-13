---
gsd_state_version: '1.0'
milestone: v1.1
milestone_name: Farm autônomo
status: in_progress
last_updated: '2026-10-12T00:00:00.000Z'
last_activity: 2026-10-12
progress:
  total_phases: 3
  completed_phases: 1
  total_plans: 1
  completed_plans: 1
  percent: 33
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-12)

**Core value:** As contas do jogador farmam sozinhas no Poke Idle World, 24 horas por dia, sem intervenção manual, sem ban e sem cair em `needs-login`.
**Current focus:** Milestone v1.1 Farm autônomo — Phase 01.1 (migrar worker para pokeidle.io) inserida e prioritária; Phase 1 parcialmente executada (achados na branch validacao-real); Phase 2 com plano a refazer após a 01.1; Phase 3 entregue

## Current Position

Phase: 01.1 (Migrar worker para pokeidle.io, INSERTED) — waves 1-5 EXECUTADAS no worktree migracao-pokeidle-io
Plan: 5/6 planos concluídos (1-5); 6-PLAN (smoke real + release beta) PENDENTE, gated por confirmação do usuário (D-S1)
Status: Waves 1-5 verdes; aguardando aprovação do usuário p/ rodar a wave 6 (smoke real)
Last activity: 2026-10-13 — migração do worker p/ pokeidle.io: GAME.md fonte única, auth revisada, sharding removido, sessao.renovada→write-back, domínio migrado no repo, E2E 7/7 verde

Progress: [██░░░░░░░░] 25% (1 de 4 fases)

## Performance Metrics

**Velocity:**
- Total plans completed: 1
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 3 | 1 | 1 | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*

## Accumulated Context

### Decisions

O log completo fica em PROJECT.md (Key Decisions, D-01..D-15). As mais recentes que afetam o trabalho atual:

- [Ingest 2026-10-12]: D-11 a D-15 aprovadas pela versão implementada: 4 contas por jogador (4006 por IP, 4007 por máquina); E2E com worker real + `e2e/fake-game`; release com 5 imagens e canais `stable`/`beta` via `ci-release`; compose em `127.0.0.1` com `ALLOWED_HOSTS`/`MPW_TAG`; rollback em um clique só dos workers
- [Roadmap v1.1]: as políticas do autoplay (hunt, compras, vendas, horários, eventos) não estão decididas; saem do `/gsd-discuss-phase 2` com o usuário
- [Roadmap v1.1]: a persistência do estado desejado do supervisor (SUP-01/SUP-02) entrou na Phase 2 por ser necessária para 24 h autônomas

### Roadmap Evolution

- Phase 01.1 inserted after Phase 1: Migrar worker para pokeidle.io (URGENT). O jogo real é `https://pokeidle.io`; todo o worker e o GAME.md tinham sido feitos sobre `poke.idleworld.online`. A reescrita feita pela validação (branch `ayresigo/validacao-real`, `9750cd8`/`06341ed`) é o ponto de partida, mas só entra na main revisada pela 01.1. A Phase 2 depende agora da 01.1 e será replanejada no que depende de protocolo (as 26 decisões de produto seguem válidas).

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 01.1]: revisão da reescrita planejada em 6 waves. Robustez AUSENTE a tratar (gated por smoke, D-S3): tratamento diferenciado de close codes / sessão substituída / manutenção; reciclagem (restart-freeze/restart-resumed, do protocolo antigo). PRESENTE (só confirmar+testar): `invalidar` 1×/5 min (`INTERVALO_MINIMO_INVALIDAR_MS`, client.ts:66), backoff+jitter+teto longo, heartbeat, watchdog-stall, drain 1000. RESÍDUO a remover: sharding `GAME_WS_SHARDS`/djb2 morto no config.
- [Phase 2]: o plano atual (branch ayresigo/autoplay) usa endpoints do servidor errado; replanejar após a 01.1.
- [Phase 1/2]: uma sessão viva por conta (4005). Smoke e run de 24 h não podem usar a mesma conta ao mesmo tempo.
- [Phase 3]: o deploy no `tcgreaper` (`kubectl apply`) exige confirmação explícita do usuário.
- [Todas]: regra de segurança Docker obrigatória (PROJECT.md, Constraints). Nada de prune nem remoção por filtro/`xargs`; remover só por nome exato o que a tarefa criou. Repassar a regra a todo subagente que tocar em Docker.

## Deferred Items

Itens reconhecidos e carregados para depois (detalhe na seção Backlog do ROADMAP):

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Release | REL-01 canal beta configurável no control-plane | Backlog | v1.1 roadmap |
| Release | REL-02 tag `:stable` inexistente | Backlog | v1.1 roadmap |
| Central | CEN-01 rate limit no login/refresh | Backlog | v1.1 roadmap |
| Central | CEN-02 logger do Fastify | Backlog | v1.1 roadmap |
| Qualidade | QA-01 E2E fora do CI | Backlog | v1.1 roadmap |
| Qualidade | QA-02 helpers de teste duplicados | Backlog | v1.1 roadmap |

## Session Continuity

Last session: 2026-10-12
Stopped at: Phase 01.1 inserida após VAL-01 (jogo real = pokeidle.io); validacao-real congelada; autoplay aguardando
Resume file: None
Next: `/gsd-discuss-phase 01.1` e `/gsd-plan-phase 01.1` numa worktree nova a partir de `ayresigo/validacao-real` (com merge da main)
