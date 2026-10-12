# SYNTHESIS — entrada para gsd-roadmapper

Gerado por gsd-doc-synthesizer em 2026-10-12. Modo: new. Projeto: PokeIdle Plus (multiacc-pokeidle).

## Docs sintetizados: 4
- SPEC (2): docs/plans/2026-10-11-multiacc-pokeidle-design.md (precedência 0), packages/worker/GAME.md (precedência 1)
- DOC (2): docs/plans/2026-10-11-multiacc-pokeidle-plan.md (precedência 2), README.md (precedência 3)
- ADR: 0 · PRD: 0 · UNKNOWN: 0
- Classificações: .planning/intel/classifications/*.json (todas com confiança alta e override de manifest)

## Grafo de cross_refs
Acíclico. Arestas internas: plan → design, plan → GAME.md, design → GAME.md (profundidade máxima 2). Refs externas (URLs, arquivos do repo, AGENTS.md) não entram no ciclo.

## Decisões
- LOCKED: 0 (nenhum ADR ingerido)
- Vigentes, não-LOCKED: 10 (D-01 a D-10) em intel/decisions.md. Fontes: design, GAME.md, plan, README.

## Requisitos: 9 (derivados de SPEC; nenhum PRD ingerido)
REQ-automacao-total, REQ-escala-orquestracao-dinamica, REQ-proxy-por-conta [WARNING], REQ-distribuicao-multiusuario, REQ-updates-centralizados [WARNING], REQ-dados-centralizados, REQ-login-jogo-tokenprovider, REQ-ui-local, REQ-gestao-usuarios (do README)

## Constraints: 18
- design (10): api-contract 1, schema 1, protocol 2, nfr 6
- GAME.md (8): api-contract 2, protocol 4, nfr 2
- Total por tipo: api-contract 3, schema 1, protocol 6, nfr 8

## Context: 17 tópicos (plan: 8, README: 9) em intel/context.md

## Conflitos: 0 blockers, 5 warnings (nenhuma variante de PRD; divergências de precedência que pedem aprovação), 9 auto-resolvidos
- WARNINGS (precisam de aprovação do usuário antes de rotear): limite de multi-conta (IP vs jogador), estratégia de E2E, pipeline de release, contrato do compose distribuído, escopo do rollback em um clique
- INFO: worker Node puro; WebSocket nativo; close codes 4001/4005; central no k8s tcgreaper; registry ghcr.io/ayresigo; dados 100% na central; TokenProvider; /admin/users; Next.js 16
- Detalhes: .planning/INGEST-CONFLICTS.md

## Notas para o roadmapper
- O projeto já tem implementação extensa (apps/central-api, apps/control-plane, apps/web, packages/worker, packages/updater, e2e/, k8s/base). O plano por tasks (docs/plans/...-plan.md) é histórico; trate o roadmap como evolução a partir do estado implementado.
- Trabalho aberto já identificado nos docs: verificações manuais com conta real (constraints.md C-game-08); política de compra de balls e venda de loot (GAME.md 9.2); eventual `sleep-mode` no drain; gap de rollback do painel inteiro se o WARNING for resolvido mantendo o requisito.

## Arquivos de intel
- .planning/intel/decisions.md
- .planning/intel/requirements.md
- .planning/intel/constraints.md
- .planning/intel/context.md
- .planning/INGEST-CONFLICTS.md
