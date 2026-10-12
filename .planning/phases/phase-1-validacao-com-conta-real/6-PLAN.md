---
phase: 1-validacao-com-conta-real
plan: 6
type: execute
wave: 3
depends_on: [2]
files_modified:
  - packages/worker/GAME.md
  - .planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
autonomous: false
requirements: [VAL-04, VAL-06]
serves_phase_2:
  - "02-CONTEXT D-07 (endpoint/mecanismo de compra de potion — só mapear, não comprar)"
  - "02-CONTEXT D-14 (mecanismo de cura em field-teleport-city — joy-heal/use-heal)"
  - "02-CONTEXT D-11 (endpoint/mecanismo de venda de pokémon — só mapear, não vender)"
  - "02-CONTEXT D-19/D-23 (formato de analyzer/balls/pokes/poke-xp para os cards de sessão)"
  - "02-CONTEXT D-20 (campos do dashboard via GET /api/characters/me)"
  - "02-CONTEXT D-01/D-08 (catálogos estáticos items.json/creatures.json para hunt otimizada e whitelist)"
user_setup:
  - service: conta-descartavel-pokeidle
    why: "Observação read-only da mesma sessão real do 2/3-PLAN (D-03)"
    dashboard_config:
      - task: "Usar a MESMA conta descartável do 2/3-PLAN; nunca worker+navegador simultâneos (4005)"
        location: "https://poke.idleworld.online"
must_haves:
  truths:
    - "Está registrado quais campos do dashboard da Fase 2 (nível treinador, gold, diamantes, gemas, dias VIP, bônus de XP, split XP) vêm de GET /api/characters/me e quais não aparecem lá"
    - "O formato cru (sanitizado) de analyzer (seconds/balance), balls (counts), pokes/poke-xp/poke-delta está registrado"
    - "O mecanismo de cura após field-teleport-city (evento/endpoint, ex. joy-heal/use-heal) está mapeado ou marcado como não-observável — sem o worker curar"
    - "O endpoint/body de compra de potion e de venda de pokémon está mapeado a partir do bundle/DevTools — SEM executar compra/venda nem gastar gold"
    - "items.json (npcPrice) e creatures.json foram capturados read-only para calibrar whitelist (D-08) e hunt otimizada (D-01)"
  artifacts:
    - path: "packages/worker/GAME.md"
      provides: "§4.3/§8 atualizados (characters/me, heal, potion-buy, poke-sell, formatos de evento) com data e marca"
      contains: "characters/me"
    - path: ".planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md"
      provides: "Respostas REST e frames WS crus sanitizados que embasam as marcas da Fase 2"
  key_links:
    - from: "packages/worker/GAME.md §4.3/§8"
      to: ".planning/phases/02-autoplay/02-CONTEXT.md"
      via: "cada ponto condicional à Fase 1 do 02-CONTEXT fica confirmado/mapeado/não-observável com evidência"
      pattern: "characters/me|joy-heal|use-heal|npcPrice|analyzer"
---

<objective>
Capturar, na MESMA sessão de smoke da conta descartável (2/3-PLAN), as observações
**read-only** de protocolo de que a Fase 2 (autoplay) depende e que hoje estão marcadas
como "(condicional à Fase 1)" no `.planning/phases/02-autoplay/02-CONTEXT.md`. São dados
que só a sessão real revela: a fonte dos campos do dashboard (`GET /api/characters/me`),
o formato cru de `analyzer`/`balls`/`pokes`/`poke-xp` (cards de sessão), o mecanismo de
cura após `field-teleport-city`, o endpoint/body de compra de potion e de venda de
pokémon, e os catálogos estáticos `items.json`/`creatures.json`.

Purpose: Desbloquear o `/gsd-plan-phase 2` sem uma segunda sessão real: a Fase 1 já tem a
conta viva, então aproveita a janela para observar o que o autoplay precisa. Mantém o
escopo da Fase 1 em `packages/worker` (GAME.md) + `.planning/phases/phase-1-...`.

Output: GAME.md §4.3/§8 atualizados (confirmado/mapeado/não-observável + data) e
EVIDENCE.md com as respostas/frames sanitizados. NENHUMA mudança de código aqui e
NENHUMA ação que gaste gold na conta.

LIMITE DURO (segurança): o worker NÃO compra, NÃO vende, NÃO cura e NÃO gasta gold nesta
fase. Compra de potion/ball, venda de item/pokémon e cura são **apenas mapeadas** (pelo
bundle estático e/ou por observação passiva de DevTools quando o evento acontecer
naturalmente). Nada de mercado de jogadores. A execução das ações é da Fase 2.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/phase-1-validacao-com-conta-real/CONTEXT.md
@.planning/phases/phase-1-validacao-com-conta-real/1-RESEARCH.md
@.planning/phases/02-autoplay/02-CONTEXT.md
@packages/worker/GAME.md
@packages/worker/src/game/client.ts
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 1: Campos do dashboard via GET /api/characters/me — serve 02-CONTEXT D-20</name>
  <what-built>Mapa (sanitizado) da resposta de GET /api/characters/me contra os campos do card do treinador.</what-built>
  <how-to-verify>
    1. Com a conta descartável logada (worker em `in-game` OU navegador, nunca os dois — 4005),
       capturar a resposta de `GET /api/characters/me` (Bearer): pelo DevTools → Network (resposta
       do próprio cliente ao abrir `/play`) ou por um `curl` com o access token lido do `.env` local.
    2. Mapear quais campos do mockup do card do TREINADOR (02-CONTEXT D-19/D-20) a resposta fornece:
       nível do treinador, gold, diamantes, gemas, dias VIP/Passe VIP, bônus de XP (VIP/Guild/Twitch),
       split XP treinador vs pokémon, nível do pokémon ativo, "online". Anotar quais vêm de
       `characters/me`, quais de eventos WS (`analyzer`/`pokes`/`poke-xp`) e quais NÃO aparecem em
       lugar nenhum (ficam bloqueados na Fase 2, D-20).
    3. Registrar o mapa em GAME.md §4.3 (expandir a linha de `characters/me` com os campos reais) e
       marcar em §8 ("formato completo dos eventos/characters/me") + data. Colar a resposta
       SANITIZADA (sem token/identifier/e-mail) em EVIDENCE.md.
  </how-to-verify>
  <resume-signal>Digite "registrado" com o mapa de campos do dashboard em GAME.md §4.3, ou descreva o que ficou bloqueado (D-20).</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Formato de analyzer/balls/pokes/poke-xp — serve 02-CONTEXT D-19/D-23, D-11</name>
  <what-built>Frames WS crus (sanitizados) dos eventos que alimentam os cards de sessão e o critério de venda de pokémon.</what-built>
  <how-to-verify>
    1. Com o worker PARADO, numa sub-sessão do navegador, DevTools → Network → WS → Messages: capturar
       frames crus de `analyzer` (campos `seconds`/`balance` e quaisquer outros), `balls`
       (`counts`/`expires`/`catalog.infinite`), `pokes`/`pokes-chunk` (`list` do time), `poke-xp` e
       `poke-delta` (nível/xp do pokémon ativo), e `analyzer-clear`/resposta (mapeia RESET do card, D-23).
    2. Comparar com o que o worker já lê no switch de `client.ts` (`analyzer.seconds`/`balance`,
       `balls.counts`, `pokes`) — anotar divergência de nome/estrutura como input eventual do 4-PLAN
       (gated por D-08) e como dado para a Fase 2.
    3. Registrar em GAME.md §4.3/§4.4 (campos reais confirmados) + data; frames SANITIZADOS em EVIDENCE.md.
  </how-to-verify>
  <resume-signal>Digite "registrado" com os formatos de analyzer/balls/pokes/poke-xp em GAME.md, ou descreva a divergência.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Cura (field-teleport-city) e endpoints de potion-buy / poke-sell — MAPEAR, não executar — serve 02-CONTEXT D-07/D-11/D-14</name>
  <what-built>Mapa do mecanismo de cura e dos bodies de compra de potion e venda de pokémon, sem gastar gold.</what-built>
  <how-to-verify>
    CURA (D-14):
    1. Observar um `field-teleport-city` natural (time derrotado → cidade) — pelos logs do worker e/ou
       DevTools. Mapear o que o cliente oficial faz para se recuperar: evento/endpoint de cura
       (`joy-heal`/`use-heal` constam da §4.4 como ENVIADOS, mas o payload não foi analisado — §8).
       Se a cura no Centro Pokémon (Joy) for gratuita, pode-se observar o fluxo natural pelo DevTools;
       se exigir gastar gold/potion, apenas mapear pelo bundle — NÃO executar. Marcar em GAME.md §8.
    POTION-BUY (D-07):
    2. Mapear o endpoint/body de compra de potion a partir do bundle (análogo a `POST /api/game/balls/buy`
       `{ballId, qty}`, §4.3) e/ou de um frame DevTools se o jogador comprar manualmente por decisão
       própria — o worker NÃO compra. Registrar o endpoint/body provável em GAME.md §4.3/§8 + data.
    POKE-SELL (D-11):
    3. Mapear o mecanismo de venda de pokémon (evento WS ou REST; a §4.3 só confirma `shop/sell`/`flint/sell`
       de itens). Observar `pokes`/`poke-delta` para o critério de "fraco/duplicado". Apenas mapear —
       NÃO vender. Registrar em GAME.md §8 + data.
    4. Evidência sanitizada (frames/bodies) em EVIDENCE.md. Qualquer ponto que exija ação paga fica
       marcado "não-observável sem gastar gold → confirmar na Fase 2".
  </how-to-verify>
  <resume-signal>Digite "registrado" com cura/potion-buy/poke-sell mapeados em GAME.md §8 (ou marcados não-observável), SEM ter comprado/vendido/curado via worker.</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Catálogos estáticos items.json/creatures.json — serve 02-CONTEXT D-01/D-08</name>
  <what-built>Catálogos públicos capturados read-only para calibrar whitelist de venda e hunt otimizada.</what-built>
  <how-to-verify>
    1. Baixar read-only (sem Bearer, são estáticos públicos — §4.3) `/game/items.json` (tem `npcPrice`) e
       `/game/creatures.json` (stats/golpes/loot). Um `curl`/fetch simples basta; não altera estado da conta.
    2. Anotar em GAME.md §4.3 que os catálogos foram capturados nesta data e qual a estrutura relevante
       (`npcPrice` por item para a whitelist D-08; `level`/loot por criatura para a hunt otimizada D-01).
       NÃO versionar os JSON inteiros no repo; só referenciar estrutura e campos. Resumo/estrutura em EVIDENCE.md.
  </how-to-verify>
  <resume-signal>Digite "registrado" com a estrutura de items.json/creatures.json anotada em GAME.md §4.3.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| REST/WS do jogo → observador | Respostas de characters/me e frames de analyzer/pokes podem conter dados pessoais/tokens |
| frames/respostas → EVIDENCE.md | Sanitizar token/identifier/e-mail antes de colar |
| ação paga (buy/sell/heal) → conta real | Proibida nesta fase (só mapear) |
| navegador ↔ conta | Sub-sessão só com o worker parado (4005) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-6-01 | Information Disclosure | resposta de characters/me (e-mail/id) colada em EVIDENCE.md | mitigate | Sanitizar e-mail/identifier/token para `<redacted>`; registrar só nomes de campo e tipos |
| T-6-02 | Repudiation/abuse | gasto de gold ao mapear potion-buy/poke-sell/heal | mitigate | Worker nunca executa; mapeamento vem do bundle/observação passiva; ação paga → marcada não-observável e adiada à Fase 2 |
| T-6-03 | Denial of Service (auto) | navegador + worker na mesma conta (4005) | mitigate | Alternar; nunca simultâneos |
| T-6-04 | Tampering | commit acidental dos JSON de catálogo (peso/ruído) | mitigate | Não versionar items.json/creatures.json; só estrutura/campos em GAME.md/EVIDENCE.md |
</threat_model>

<verification>
- GAME.md §4.3/§8 têm as marcas de characters/me, formatos de evento, cura, potion-buy e poke-sell com data.
- EVIDENCE.md tem as respostas/frames sanitizados; `grep` por token/identifier/e-mail não retorna segredo.
- Nenhuma compra/venda/cura foi executada; nenhum gold gasto pelo worker.
</verification>

<success_criteria>
- Os pontos "(condicional à Fase 1)" do 02-CONTEXT (D-07, D-11, D-14, D-19/D-23, D-20, D-01/D-08) estão confirmados, mapeados ou marcados como não-observável-sem-gastar-gold, com evidência.
- Nenhum código do worker alterado; nenhuma ação paga na conta real.
- A Fase 2 pode planejar com esses dados sem precisar de uma nova sessão real.
</success_criteria>

<output>
Após concluir, criar `.planning/phases/phase-1-validacao-com-conta-real/6-SUMMARY.md`
(listando o que ficou confirmado/mapeado/não-observável para a Fase 2 e onde está a evidência).
</output>
