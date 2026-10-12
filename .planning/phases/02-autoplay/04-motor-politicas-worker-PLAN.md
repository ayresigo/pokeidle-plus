---
phase: 02-autoplay
plan: 04
type: execute
wave: 4
depends_on: [02, 03]
fase1_independent: false
external_gate: "Só executar DEPOIS do merge da Fase 1 em packages/worker/src/game/ (loop.ts, client.ts); fazer rebase antes."
files_modified:
  - packages/worker/src/game/compras.ts
  - packages/worker/src/game/vendas.ts
  - packages/worker/src/game/metricas.ts
  - packages/worker/src/game/loop.ts
  - packages/worker/src/game/client.ts
  - packages/worker/src/health.ts
  - packages/worker/src/http.ts
  - packages/worker/src/game/compras.test.ts
  - packages/worker/src/game/vendas.test.ts
  - packages/worker/src/game/loop.test.ts
  - apps/control-plane/src/workers/routes.ts
  - apps/control-plane/src/workers/routes.test.ts
  - apps/web/lib/api.ts
  - apps/web/components/AccountRow.tsx
autonomous: false
requirements: [AUTO-02, AUTO-03]
must_haves:
  truths:
    - "O worker repõe pokébolas sozinho: quando o estoque cai abaixo de ballMin, compra até ballTarget via POST /api/game/balls/buy {ballId, qty}"
    - "O worker vende loot periodicamente via /api/game/shop/sell e /api/game/flint/sell, guardando os itens em sellKeepItemIds"
    - "O worker expõe métricas de sessão no /health (kills, captures, balls, ballsBought, goldSpent, itemsSold, sessionSec) que aparecem no card do dashboard pelo SSE"
    - "As ações novas entram como módulos novos em game/ com fiação mínima no loop, sem reescrever o comportamento validado pela Fase 1"
  artifacts:
    - path: "packages/worker/src/game/compras.ts"
      provides: "política de compra de pokébolas (ballMin/ballTarget/ballId) usando balls/buy"
    - path: "packages/worker/src/game/vendas.ts"
      provides: "política de venda periódica de itens (whitelist de guardar) via shop/sell e flint/sell"
    - path: "packages/worker/src/game/metricas.ts"
      provides: "acumulador de métricas de sessão exposto ao HealthState"
  key_links:
    - from: "packages/worker/src/game/loop.ts"
      to: "packages/worker/src/game/compras.ts"
      via: "nova ação garantir-balls no criarAcoes (fiação mínima, append)"
    - from: "packages/worker/src/game/metricas.ts"
      to: "packages/worker/src/health.ts"
      via: "HealthState.setSessao(metricas) → HealthSnapshot.sessao → SSE"
---

<gate>
⚠ NÃO EXECUTAR antes do merge do CÓDIGO da Fase 1. O gate aqui é SÓ o conflito de
arquivo: este plano edita `packages/worker/src/game/` (`loop.ts`, `client.ts`),
que a Fase 1 corrige (VAL-07). NÃO depende dos ACHADOS do 6-PLAN da Fase 1 —
usa só endpoints já confirmados (`balls/buy`, `shop/sell`, `flint/sell`). As
features que dependem de achados (potions, cura, hunt otimizada, venda de pokémon,
campos extras do dashboard) ficam num plano COMPLEMENTAR futuro (ver RESEARCH
<blocked> + `phase-1-.../6-PLAN.md`), não aqui.
Pré-condição de execução: (1) o código da Fase 1 (correções em `game/`) foi
mergeado na base deste worktree; (2) rebase feito; (3) `pnpm --filter worker test`
verde na base rebaseada. Só então iniciar as tasks. Preferir SEMPRE adicionar
módulos novos (`compras.ts`, `vendas.ts`, `metricas.ts`) e tocar o mínimo em
`loop.ts`/`client.ts` (apenas registrar as novas ações e os métodos REST), sem
reescrever a lógica validada pela Fase 1.
</gate>

<objective>
Implementar o motor de políticas do worker para COMPRA de pokébolas e VENDA de
itens, usando SÓ os endpoints confirmados no GAME.md (`balls/buy`, `shop/sell`,
`flint/sell`), e expor as métricas de sessão no `/health` para alimentar os cards
do dashboard. Fecha AUTO-02 e AUTO-03 na parte independente da Fase 1 (bolas e
itens). Potions/cura, hunt otimizada, venda de pokémon e sleep-mode ficam fora
(RESEARCH <blocked>). Depende dos Plans 02 (config/env) e 03 (SSE/cards).
</objective>

<context>
- `.planning/phases/02-autoplay/RESEARCH.md` — endpoints confirmados, contrato de `sessao`, boundary de conflito. LER PRIMEIRO.
- `.planning/phases/02-autoplay/02-CONTEXT.md` — D-04/05/06 (compra), D-08/09/10 (venda), D-23 (RESET→analyzer-clear).
- `packages/worker/GAME.md` §4.3 — bodies/respostas de `balls/buy` (`{counts, gold, bought}`), `shop/sell` (`{gold, goldGained, soldCount}`), `flint/sell` (`{sold, item, goldGained}`); `/game/items.json` (`npcPrice`).
- `packages/worker/src/game/loop.ts` — `criarAcoes` (jitter, watchdog), `estado` (kills, balls, itensInventario); `client.ts` — WS/REST, já parseia `balls`/`inventory`, tem `buscarHunts()` (padrão de chamada REST com Bearer).
- `packages/worker/src/config.ts` — já expõe ballId/ballMin/ballTarget/sell* (Plan 02).
- `packages/worker/src/health.ts` — `HealthState`/`HealthSnapshot` (adicionar `sessao`).
- `apps/control-plane/src/workers/routes.ts` — para o comando de RESET (analyzer-clear).
</context>

<tasks>
<task type="auto">
  <name>Task 0: Gate de pré-condição</name>
  <files>(nenhum)</files>
  <action>
Confirmar que a Fase 1 foi mergeada e o rebase feito; rodar `pnpm --filter worker
test` na base atual e garantir verde ANTES de prosseguir. Se a Fase 1 ainda não
mergeou, PARAR e avisar o coordenador.
  </action>
  <verify>pnpm --filter worker test</verify>
  <done>Base rebaseada com a Fase 1 e suíte verde.</done>
</task>

<task type="auto">
  <name>Task 1: Métodos REST de compra/venda no client</name>
  <files>packages/worker/src/game/client.ts, packages/worker/src/game/client.test.ts</files>
  <action>
Adicionar ao `GameClient` métodos REST (padrão do `buscarHunts`, Bearer):
`comprarBalls(ballId, qty)` → `POST /api/game/balls/buy`; `venderItens(items)` →
`POST /api/game/shop/sell`; `venderFlint(itemId, qty)` → `POST /api/game/flint/sell`.
Parsear as respostas confirmadas (counts/gold/bought; gold/goldGained/soldCount).
Erros (401/rede) tratados como os outros REST. Testes com fetch/undici mockado.
  </action>
  <verify>pnpm --filter worker test</verify>
  <done>Métodos REST cobertos por teste; suíte verde.</done>
</task>

<task type="auto">
  <name>Task 2: Política de compra de pokébolas</name>
  <files>packages/worker/src/game/compras.ts, packages/worker/src/game/compras.test.ts</files>
  <action>
Módulo novo: dado `estado.balls`, `ballId`, `ballMin`, `ballTarget`, decidir se
compra e quanto (`qty = ballTarget - balls` quando `balls < ballMin`), chamando
`client.comprarBalls`. Sem `ballId` → no-op. Atualizar métricas (ballsBought,
goldSpent a partir de `gold`/`bought`). Respeitar o jitter do loop (a ação é
agendada pelo runner). Testes: abaixo do mínimo compra até o alvo; acima não
compra; sem ballId no-op.
  </action>
  <verify>pnpm --filter worker test</verify>
  <done>Política de compra coberta; suíte verde.</done>
</task>

<task type="auto">
  <name>Task 3: Política de venda periódica de itens</name>
  <files>packages/worker/src/game/vendas.ts, packages/worker/src/game/vendas.test.ts</files>
  <action>
Módulo novo: a cada `sellIntervalSec` (quando `sellEnabled`), a partir do
inventário/depot lido (`estado.itensInventario`), montar a lista de itens a
vender = tudo que NÃO está em `sellKeepItemIds`, e vender via `client.venderItens`
(shop/sell) e, para itens de flint, `client.venderFlint`. Atualizar métricas
(itemsSold, goldSpent/ganho). NÃO vender pokémon (bloqueado). Testes: respeita
whitelist; só vende no intervalo; sellEnabled=false → no-op.
  </action>
  <verify>pnpm --filter worker test</verify>
  <done>Política de venda coberta; suíte verde.</done>
</task>

<task type="auto">
  <name>Task 4: Métricas de sessão no /health</name>
  <files>packages/worker/src/game/metricas.ts, packages/worker/src/health.ts, packages/worker/src/health.test.ts</files>
  <action>
Módulo `metricas.ts`: acumulador `{kills, captures, balls, ballsBought,
goldSpent, itemsSold, sessionStartedAt}`. Adicionar `sessao?` ao `HealthSnapshot`
e `HealthState.setSessao(...)`/cálculo de `sessionSec`. Testes do snapshot com
sessao.
  </action>
  <verify>pnpm --filter worker test</verify>
  <done>/health expõe sessao; suíte verde.</done>
</task>

<task type="auto">
  <name>Task 5: Fiação mínima no loop (append)</name>
  <files>packages/worker/src/game/loop.ts, packages/worker/src/game/loop.test.ts</files>
  <action>
Registrar, em `criarAcoes`, as novas ações `garantir-balls` (Task 2) e
`vender-loot` (Task 3) como ações APPEND (sem alterar as existentes). Alimentar o
acumulador de métricas com os contadores já existentes (kills/capturas/balls) e
chamar `health.setSessao` no ciclo. Minimizar o diff em `loop.ts` para reduzir
conflito com a Fase 1. Testes: as novas ações são agendadas; métricas publicadas.
  </action>
  <verify>pnpm --filter worker test</verify>
  <done>Novas ações no loop + métricas publicadas; comportamento existente intacto; suíte verde.</done>
</task>

<task type="auto">
  <name>Task 6: RESET da sessão (analyzer-clear) ponta a ponta</name>
  <files>packages/worker/src/http.ts, packages/worker/src/game/client.ts, apps/control-plane/src/workers/routes.ts</files>
  <action>
Expor no worker um comando (ex. `POST /command {type:"reset-session"}` no servidor
HTTP do worker em `http.ts`) que envia `{type:"analyzer-clear"}` pelo WS e zera o
acumulador de métricas. No control-plane, `POST /workers/:id/reset-session`
repassa ao worker (`workers/routes.ts`). No web, adicionar a chamada em
`lib/api.ts` e HABILITAR o botão RESET do card em `components/AccountRow.tsx`
(desabilitado no Plan 03). Teste do repasse e do comando.
  </action>
  <verify>pnpm --filter worker test && pnpm --filter control-plane test</verify>
  <done>RESET zera a sessão do worker ponta a ponta; suítes verdes.</done>
</task>
</tasks>

<verification>
- `pnpm --filter worker test` e `pnpm --filter control-plane test` verdes; `tsc --noEmit` limpo.
- Smoke (sem jogo real, com `e2e/fake-game` ou mock): estoque baixo → compra até o alvo; ciclo de venda respeita a whitelist; /health expõe sessao; card do dashboard mostra os números; RESET zera.
- Diff de `loop.ts`/`client.ts` revisado para confirmar que é aditivo (sem reescrever o que a Fase 1 validou).
</verification>

<success_criteria>
- AUTO-02: reposição automática de pokébolas por política (ballMin/ballTarget/ballId).
- AUTO-03: venda periódica de itens com whitelist via loja NPC.
- Métricas de sessão no /health alimentando o dashboard; RESET funcional.
- Potions/cura, hunt otimizada, venda de pokémon e sleep-mode permanecem FORA (bloqueados pela Fase 1). Commits conventional PT-BR na branch.
</success_criteria>
