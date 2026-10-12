---
gsd_state_version: '1.0'
milestone: v1.1
milestone_name: Farm autônomo
status: planning
last_updated: '2026-10-12T00:00:00.000Z'
last_activity: 2026-10-12
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-12)

**Core value:** As contas do jogador farmam sozinhas no Poke Idle World, 24 horas por dia, sem intervenção manual, sem ban e sem cair em `needs-login`.
**Current focus:** Milestone v1.1 Farm autônomo — Phase 1: Validação com conta real (Phase 3 independente; discussão da Phase 2 pode começar em paralelo)

## Current Position

Phase: 1 of 3 (Validação com conta real)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-10-12 — Roadmap do v1.1 criado a partir do ingest de docs; v1.0 Fundação registrado como entregue (v0.0.1-beta.1)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

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

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: precisa de uma conta real do Poke Idle World fornecida pelo usuário (e chave de solver 2captcha-compatível para testar VAL-01). Sem ela a fase não executa.
- [Phase 2]: a execução contra o jogo real depende dos achados da Phase 1. Um 4007 sem `cmid` ou o token do solver recusado obrigam a replanejar.
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
Stopped at: ROADMAP.md, REQUIREMENTS.md, PROJECT.md e STATE.md criados pelo ingest (/gsd-ingest-docs, modo new)
Resume file: None
Next: `/gsd-discuss-phase 1` (ou `/gsd-plan-phase 1`); em paralelo `/gsd-discuss-phase 2` e, em outra worktree, `/gsd-discuss-phase 3`
