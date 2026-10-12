# Phase 2: Autoplay - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning

<domain>
## Phase Boundary

As contas do jogador farmam sozinhas por 24 h: o bot caça segundo uma política de hunt, repõe pokébolas/consumíveis, vende loot, segue uma rotina e reage aos eventos do jogo, e a supervisão (estado desejado + tokens) sobrevive a reinícios do control-plane, do auto-update e do Docker. Cobre AUTO-01..AUTO-06 e SUP-01..SUP-02.

**Dentro do escopo:** política de hunt; compra de bolas/potions; venda de loot; rotina/horários; reação a eventos; configuração de autoplay por conta na UI (incluindo um dashboard de cards por conta e o fluxo de adicionar conta existente); persistência do estado desejado do supervisor e dos tokens.

**Fora do escopo (ver Deferred):** registro de conta de jogo do zero (cadastro + Turnstile + verificação de e-mail + criação de personagem); vender no mercado de jogadores; mais de 4 contas por jogador; forjar `cmid`.

**Dependência da Fase 1 (validação com conta real, em worktree paralela):** a execução do autoplay contra o jogo real depende dos achados da Fase 1. As decisões abaixo marcadas como "(condicional à Fase 1)" só se concretizam depois que a Fase 1 confirmar o comportamento real (aceite do solver, 4007 sem `cmid`, shard, formato de `field-kill`/`catch-result`/`balls`/`pokes`/`analyzer`, farm offline/`sleep-mode`, fonte dos campos do dashboard, mecanismos de cura e de venda de pokémon).

</domain>

<decisions>
## Implementation Decisions

### Política de hunt (AUTO-01)
- **D-01:** Cada conta escolhe a hunt por uma de duas vias, selecionável na UI: (a) **hunt fixa via slug** definido pelo usuário, ou (b) **"a mais otimizada"**. O método para obter/calcular a hunt "mais otimizada" fica em aberto — será tratado depois (ver Specific Ideas / depende de dados da Fase 1: `creatures.json`, `map-markers`, kills reais).
- **D-02:** Quando uma hunt para de render kills, manter o comportamento atual ("só recuperar"): `leave-hunt`+`enter-hunt` na mesma hunt; após `MAX_RECUPERACOES_RAPIDAS` (3) espaça para 1×/hora e marca `lastError`. **Não** trocar de hunt automaticamente nesta fase.
- **D-03:** Hunts elegíveis = qualquer hunt normal com `nivel > 0`, excluindo cidades e `gym_*` (comportamento atual de `escolherHuntPadrao`).

### Compra de bolas e consumíveis (AUTO-02)
- **D-04:** Comprar **uma pokébola fixa por conta** — `ballId` configurável por conta na UI (body confirmado `{ballId, qty}` em `POST /api/game/balls/buy`).
- **D-05:** Disparo de compra por **estoque mínimo configurável por conta** (default de referência ~100, de `BALL_MIN` do PokeGrid).
- **D-06:** Quantidade: **repor até um teto (estoque-alvo)** configurável, em vez de lote fixo.
- **D-07:** **Potions têm prioridade sobre pokébolas** quando o gold for limitado (líder morto → teleporte pra cidade é pior que ficar sem bola). O endpoint/mecanismo de compra de potions **não está confirmado** no GAME.md — confirmar na Fase 1 (condicional à Fase 1). `POTION_MIN` de referência = 15.

### Venda de loot (AUTO-03)
- **D-08:** **Vender tudo exceto uma whitelist de "guardar"** (configurável). Catálogo real de itens (`/game/items.json` tem `npcPrice`) ajuda a calibrar a whitelist na Fase 1.
- **D-09:** Vender **só na loja NPC**: `POST /api/game/shop/sell` (`{items:[{itemId, qty}]}`) e `POST /api/game/flint/sell` (`{itemId, qty}`) — bodies confirmados. **Não** usar o mercado de jogadores (risco de ban por trade com botter, regra oficial 09; fluxo DOM não mapeado).
- **D-10:** Venda **periódica** (em intervalo/ciclo), não por "inventário cheio" — evita depender de conhecer a capacidade do depósito.
- **D-11:** **Vender pokémon duplicados/fracos** automaticamente para liberar espaço. O critério de "fraco/duplicado" **e** o endpoint/mecanismo de venda de criatura ficam em aberto (GAME.md só confirma `shop/sell`/`flint/sell` de itens) — definir com dados da Fase 1 (`pokes`, `pokes-get`, `poke-delta`) (condicional à Fase 1).

### Rotina e horários (AUTO-04)
- **D-12:** Farm **contínuo 24h**, **dia todo** (todas as contas), **sem pausas/sessões programadas**. Mantém só o **jitter atual (10-30 s entre ações)** como humanização — sem aleatoriedade adicional de rotina nesta fase.

### Reação a eventos (AUTO-05)
- **D-13:** `sleep-mode` no drain é **condicional à Fase 1**: só enviar `{type:"sleep-mode"}` e esperar `sleep-ok` no drain **se** a VAL-05 mostrar que, sem ele, o farm offline não continua. Caso contrário, manter o fecha-direto atual (close 1000).
- **D-14:** Após `field-teleport-city` (time derrotado → cidade): **curar antes de voltar** à hunt (garantir potions/cura), para não cair em loop de derrota. O mecanismo de cura (evento/endpoint, ex. `joy-heal`/`use-heal`) **não está mapeado** — confirmar na Fase 1 (condicional à Fase 1).
- **D-15:** Manter os limites atuais dos watchdogs/backoff (stall 10 min, reciclagem máx 3, backoff 1,5 s→24 s→5 min, 4003 5/10/15 min, close codes D-03 do PROJECT). Revisar só se a sessão real da Fase 1 mostrar que algum limite é agressivo/tímido demais.

### Configuração por conta na UI
- **D-16:** Expor **todos** os parâmetros de autoplay **por conta** (hunt, compra, venda, whitelist, estoques).
- **D-17:** **Defaults sensatos + override**: conta nova já farma sem config extra; o usuário só preenche o que quiser mudar.
- **D-18:** Config de autoplay numa **aba/página separada** (dedicada por conta), não embutida no `AccountForm` atual. (Candidata a passar por `/gsd-ui-phase` para o contrato de design.)

### Dashboard de contas (cards) — UI
- **D-19:** Tela principal com **um card por conta**. Alvo de design = **mockup completo** fornecido pelo usuário (ver Specific Ideas): resumo de SESSÃO (XP e XP/h, gold, pokémon abatidos, capturas, tempo, custos de pokébolas/poções, gold gasto, lucro líquido, drops raros) + painel do TREINADOR (nível, gold, diamantes, gemas, dias VIP, Passe VIP, boosts/bônus de XP, "online") + pokémon ativo com nível.
- **D-20:** Campos cujo **fonte de dado não está confirmada** no GAME.md ficam **bloqueados até a Fase 1**: XP/h, split XP treinador vs pokémon, % de bônus (VIP/Guild/Twitch), diamantes, gemas, dias VIP/Passe, nível do treinador, "DROPS RAROS" (Boss Token, Chave, Shiny Stone, Bicicleta), nível exato do pokémon ativo. Provável fonte: `GET /api/characters/me` (campos não mapeados) e/ou eventos WS ainda não observados.
- **D-21:** Botão **`+`** → **adicionar conta existente** (fluxo atual de credenciais/tokens), **desenhado com um ponto de entrada para "criar do zero" encaixar numa fase futura**.
- **D-22:** Cards atualizam em **tempo real via SSE**, estendendo o `/events` atual (snapshot + update) com os dados de sessão por conta.
- **D-23:** Cada card tem **COPIAR** (copia o resumo da sessão) e **RESET** (zera a sessão; RESET mapeia para o WS `analyzer-clear`).

### Persistência do supervisor (SUP-01 / SUP-02)
- **D-24:** O **estado desejado** (rodando/parado) de cada worker é persistido **na central (API)**, por conta — não só em memória como hoje. (Implicação de design: novo campo/endpoint na central; alinha com D-05 do PROJECT "dados 100% na central".)
- **D-25:** No boot do control-plane (após auto-update ou reboot do Docker), **reconciliar no startup**: ler o estado desejado e o supervisor religa sozinho quem estava "running", via o poll que já existe (backoff/`degraded` normais), **sem clique**.
- **D-26:** Tokens no worker recriado (SUP-02): a **central é a fonte** — ao recriar, buscar credenciais frescas (`GET /accounts/:id/credentials`), que já recebe o write-back do refresh rotacionado. Sem cache local a envelhecer; depende de o write-back ser confiável.

### Claude's Discretion
- Formato exato de persistência (schema do campo de estado desejado na central; forma do payload SSE estendido).
- Frequência/estrutura do relatório da run de 24 h (AUTO-06), desde que mostre estado por conta, kills, capturas, compras, vendas e reinícios.
- Detalhes de layout/estilo do dashboard e da página de config (refináveis em `/gsd-ui-phase`).
- Como calcular a "hunt mais otimizada" (D-01), dentro das fontes disponíveis após a Fase 1.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Protocolo do jogo (fonte de verdade sobre WS/REST)
- `packages/worker/GAME.md` §4.3 — Endpoints REST confirmados: `balls/buy`, `shop/sell`, `flint/sell`, `map-markers` (público), `depot`, `characters/me`, estáticos `items.json`/`creatures.json`.
- `packages/worker/GAME.md` §4.4 — WebSocket: eventos recebidos/enviados (`analyzer`, `analyzer-clear`, `field-kill`, `catch-result`, `balls`, `pokes`, `sleep-mode`/`sleep-ok`, `field-teleport-city`, `hunt-cooldown`, `restart-freeze`), close codes 4001-4009, sharding, heartbeat/backoff.
- `packages/worker/GAME.md` §5 — Loop idle (escolher hunt, capturar, curar, reabastecer, vender, interrupções, farm offline/Modo Soneca; `BALL_MIN=100`, `POTION_MIN=15`).
- `packages/worker/GAME.md` §8 — Desconhecidos (bodies de `use-heal`/`joy-heal`/venda de pokémon; create-character/verify-email; formato completo de eventos).
- `packages/worker/GAME.md` §9.2 — Pontos de verificação do game loop (hunt sem slug, sem `cmid`, drain sem `sleep-mode`, compra/venda fora da task — "falta definir a política").

### Requisitos e decisões do projeto
- `.planning/REQUIREMENTS.md` — AUTO-01..06, SUP-01..02 (resultado esperado) e Out of Scope.
- `.planning/ROADMAP.md` §"Phase 2: Autoplay" — Goal, Success Criteria, paralelismo com a Fase 1, conflito em `packages/worker/src/game/`.
- `.planning/PROJECT.md` — Key Decisions D-01..D-15 (worker Node puro, close codes, sem `cmid`, dados 100% na central), Constraints (segurança Docker, regras do jogo).
- `.planning/codebase/CONCERNS.md` — Lacunas que bloqueiam 24 h (compra/venda não implementadas; estado desejado só em memória; tokens perdidos no reinício).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/worker/src/game/loop.ts` — `criarAcoes` (ações do loop), `escolherHuntPadrao` (menor nível fora de cidades/gyms), `watchdog-stall`, `restart-freeze`, `drenar()` (drain). Ponto de extensão para as ações de compra/venda e para a lógica de "hunt otimizada".
- `packages/worker/src/game/client.ts` — `GameClient`: WS com sharding, heartbeat, backoff/reconexão, `aoReceber` (switch de eventos, já parseia `balls`/`inventory`/`analyzer`/`pokes`/kills/capturas), close codes (`FECHAMENTOS_TERMINAIS`), `buscarHunts()` (`GET /api/game/map-markers`). Compras/vendas entram como novos métodos REST aqui.
- `packages/worker/src/config.ts` — `loadConfig(env)`; hoje lê `HUNT_SLUG` e credenciais/proxy. Novos parâmetros de autoplay (ballId, mínimos, alvos, whitelist) entram aqui, injetados via env pelo control-plane.
- `packages/worker/src/health.ts` — `/health` expõe estado + tokens renovados; é o canal por onde o worker publica dados (candidato a expor métricas de sessão para o dashboard).
- `apps/control-plane/src/supervisor/supervisor.ts` — `Supervisor` com `estados` (desired running/stopped, backoff, degraded), `poll()`, write-back de tokens (`verificarTokens`/`onTokensRenovados`). Alvo central de SUP-01/02.
- `apps/control-plane/src/update/manager.ts` + `orchestrator/recriar.ts` — recriação de workers com tokens (`configDeRecriacao`, `envComTokens`), persistência em `DATA_DIR` (`settings.json`, `rollback.json`).
- `apps/web/components/{Dashboard,AccountRow,AccountForm,LogStream}.tsx` + SSE `GET /events` e `lib/conta.ts` — base do dashboard e do formulário de conta a estender.
- `apps/central-api` — `prisma/schema.prisma` `Account` (campos criptografados + `proxyUrl`); `accounts/routes.ts` `PUT /accounts/:id/tokens` (write-back) e `GET /accounts/:id/credentials`. Ponto de extensão para persistir o estado desejado (D-24).

### Established Patterns
- Compra/venda são **novas** (hoje o worker só **lê** estoque via `balls`/`inventory`); seguir o padrão REST com Bearer e o jitter de ação existente.
- Estado persistido do control-plane já vive em `DATA_DIR` (`settings.json`, `rollback.json`); o estado desejado, porém, foi decidido na **central** (D-24).
- Config do worker chega **por env** na criação do container (`montarEnv`/`configDeRecriacao`); novos parâmetros de autoplay seguem esse caminho.

### Integration Points
- Worker → central: write-back de tokens (existe) e leitura de credenciais (existe); adicionar leitura/escrita do estado desejado por conta (D-24/D-25).
- Worker → control-plane → web: métricas de sessão sobem via `/health` e saem por SSE `/events` para o dashboard (D-19/D-22).
- Novas ações de autoplay tocam `packages/worker/src/game/` — **conflito com a Fase 1**; rebase após as correções da Fase 1 (ROADMAP §Paralelismo).

</code_context>

<specifics>
## Specific Ideas

- **Mockup do card de sessão (fornecido pelo usuário):** painel "SESSÃO" com XP e **XP/h** (ex. "+137,6%"), **TREINADOR** (XP treinador, XP pokémon, Gold, Pokémon abatidos, Capturas — com taxas/h), **TEMPO** (cronômetro da sessão), **DROPS RAROS · OUTLAND** (Boss Token, Chave, Shiny Stone, Bicicleta), **CUSTOS** (Pokébolas, Poções, Gold gasto, Lucro líquido — com /h), e botões **COPIAR**/**RESET**.
- **Mockup do painel do treinador (fornecido pelo usuário):** nome + nível (ex. "rabudinho Nv 419"), barra de XP, **Gold**, **Diamante**, **Gemas**, **VIP +50% XP (dias)**, **Passe VIP (dias)**, **Boost Guild +10% XP**, **Bônus Twitch +20% XP**, status "online", **Abrir Inventário**.
- Visão do usuário para a tela: grade de cards (1 por conta) → botão **`+`** para adicionar conta existente (ou, no futuro, criar do zero) → fluxo de criação → iniciar a hunt.
- Mapeamento confirmado: resumo de sessão ↔ evento `analyzer` (`seconds`, `balance`) + contadores de kills/capturas do worker; estoque ↔ `balls`; custos ↔ ações `balls/buy`+`shop/sell` do próprio worker; pokémon ativo ↔ `pokes`/`poke-xp`. RESET ↔ `analyzer-clear`.

</specifics>

<deferred>
## Deferred Ideas

- **Registro de conta de jogo do zero** (cadastro + Turnstile + verificação de e-mail + criação de personagem) — capacidade nova, **sua própria fase futura**, a planejar **após** a Fase 1 confirmar se o token do solver é aceito. Bloqueios: Turnstile no registro (solver não comprovado), verificação de e-mail (exige integração de inbox/credenciais), fluxo `/create-character` não mapeado (GAME.md §8). Sinalizado ao coordenador para entrar no ROADMAP/REQUIREMENTS. O dashboard (D-21) já prevê o ponto de entrada.
- **Troca automática de hunt** quando a atual para de render (preferiu-se "só recuperar", D-02) — possível evolução futura.
- **Venda no mercado de jogadores** (`.mkt2-trow`) — descartada por risco de ban (regra 09) e fluxo não mapeado; só loja NPC (D-09).
- **Rotina humanizada com sessões/pausas/Modo Soneca** — preferiu-se contínuo 24h (D-12); fica como possível ajuste se a detecção comportamental do servidor exigir.

</deferred>

---

*Phase: 02-autoplay*
*Context gathered: 2026-10-12*
