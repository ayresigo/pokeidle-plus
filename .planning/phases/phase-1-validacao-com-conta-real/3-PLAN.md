---
phase: 1-validacao-com-conta-real
plan: 3
type: execute
wave: 3
depends_on: [1, 2]
files_modified:
  - packages/worker/GAME.md
  - .planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
autonomous: false
requirements: [VAL-02, VAL-03, VAL-04, VAL-05, VAL-06]
user_setup:
  - service: conta-descartavel-pokeidle
    why: "VAL-02..VAL-05 precisam de uma sessão de jogo real em hunt (D-03, D-06)"
    env_vars:
      - name: HUNT_SLUG
        source: "Slug de uma hunt que o personagem aguenta (D-06; só no .env local)"
    dashboard_config:
      - task: "Usar a mesma conta descartável do 2-PLAN; nunca worker+navegador simultâneos (4005)"
        location: "https://poke.idleworld.online"
must_haves:
  truths:
    - "Está registrado se a sessão conecta sem cmid e recebe field-init após enter-hunt"
    - "Está registrado se o shard do worker (djb2(sub)%88) é o mesmo do navegador"
    - "Em hunt real chegam field-kill reais; o formato de field-kill/catch-result/analyzer está registrado; o contador de kills/capturas sobe sem o watchdog de stall disparar à toa"
    - "Está registrado se o farm offline continua após docker stop sem sleep-mode"
    - "Estão registrados hunt-resume/enter-hunt resume:true e os close codes 4005-4009 que aparecerem"
  artifacts:
    - path: "packages/worker/GAME.md"
      provides: "Pontos de §9.2 marcados (confirmado/refutado/não-observável + data)"
      contains: "9.2"
    - path: ".planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md"
      provides: "Frames WS crus sanitizados + trechos de log/health que embasam §9.2"
  key_links:
    - from: "packages/worker/GAME.md §9.2"
      to: ".planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md"
      via: "cada marca aponta um trecho de evidência sanitizado (frame WS, log, health)"
      pattern: "confirmado|refutado|não-observável"
---

<objective>
Roteiro de smoke manual do **game loop** contra o jogo real, cobrindo VAL-02 (WS sem
`cmid`), VAL-03 (shard djb2(`sub`)%88 igual ao do navegador + `field-init`), VAL-04
(`field-kill` reais, formato dos eventos, contador subindo sem stall), VAL-05 (farm
offline após `docker stop` com/sem `sleep-mode`) e VAL-06 (retomada de hunt e close
codes 4005-4009). Cada ponto de GAME.md §9.2 vira confirmado/refutado/não-observável,
com data e evidência sanitizada em EVIDENCE.md (D-07).

Purpose: Fechar as incógnitas server-side de maior risco do §9.2 (shard real, formato
dos eventos de kill, comportamento do farm offline no drain) — base de VAL-07 e da Phase 2.

Output: GAME.md §9.2 marcado + EVIDENCE.md com os frames crus/sanitizados. Nenhuma mudança
de código aqui (correções, se houver divergência, ficam no 4-PLAN, gated por D-08).

NOTA DE EXECUÇÃO: roda na MESMA conta descartável do 2-PLAN, em sessões curtas e
sequenciais, alternando worker e navegador (nunca simultâneos na mesma conta: 4005).
A instrumentação de kills do 1-PLAN já deve estar aplicada, para evidenciar o contador
subindo pelos logs/`/health` sem depender de uma sessão paralela de navegador.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/phase-1-validacao-com-conta-real/CONTEXT.md
@.planning/phases/phase-1-validacao-com-conta-real/1-RESEARCH.md
@packages/worker/GAME.md
@packages/worker/src/game/client.ts
@packages/worker/src/game/loop.ts
@packages/worker/src/index.ts
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 1: WS sem cmid, shard e field-init — VAL-02, VAL-03</name>
  <what-built>Observação da conexão WS autenticada e comparação de shard com o navegador.</what-built>
  <how-to-verify>
    1. Com o worker em `in-game` na conta descartável: confirmar que ele abre `wss://…/ws[N]?token=…&v=2`
       SEM `cmid` e a sessão se mantém (recebe `field-init` após `enter-hunt <slug>` →
       `/health.lastAction` vira "garantir-hunt: em hunt <slug>"). Se fechar 4007, ver o ponto de §9.2
       já registrado no 2-PLAN (Task 3) e tratar como bloqueio (Bloco 3 da pesquisa).
    2. Shard: calcular `abs(djb2(sub))%88` a partir do `sub` do JWT do `accessToken` (fórmula de
       `montarUrlWs`/`lerSub`, já coberta por client.test.ts — NÃO reimplementar à mão no worker).
       Para o do navegador: com o worker PARADO, numa sub-sessão, DevTools → Network → WS → ver o path do
       upgrade (`/ws` = shard 0, `/wsN` = shard N). Comparar. Igual → VAL-03 confirmado; divergente →
       anotar como input do 4-PLAN (corrigir cálculo ou overrides GAME_WS_URL/GAME_WS_PATH/GAME_WS_SHARDS).
    3. Marcar em GAME.md §9.2 "Sessão autenticada no shard" e "Sem cmid" + data; evidência (path do WS,
       sanitizada) em EVIDENCE.md.
  </how-to-verify>
  <resume-signal>Digite "registrado" com §9.2 shard/cmid/field-init marcado, ou descreva a divergência (input do 4-PLAN).</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: field-kill reais, formato dos eventos e retomada — VAL-04, VAL-06</name>
  <what-built>Observação dos kills reais pelos logs/health (1-PLAN) e captura do formato cru dos eventos.</what-built>
  <how-to-verify>
    KILLS / CONTADOR (VAL-04):
    1. Com o worker em hunt, os logs do worker (instrumentação do 1-PLAN) devem mostrar `field-kill` reais e
       `curl /health` deve mostrar `kills`/`capturas` subindo, com `lastAction` permanecendo "em hunt <slug>"
       e SEM `lastError` "hunt <slug> sem kills há <N>min" (watchdog de stall, loop.ts:138) — evidencia kills
       chegando sem o watchdog disparar à toa.
    FORMATO CRU DOS EVENTOS (VAL-04):
    2. Com o worker PARADO, numa sub-sessão do navegador, DevTools → Network → WS → Messages: copiar frames
       crus de `field-kill`, `catch-result`, `analyzer` (e `field-init`/`balls` se aparecerem). Comparar os
       campos reais com os que o worker lê: `field-kill.speciesName`, `catch-result.success`,
       `analyzer.seconds`/`analyzer.balance`, `balls.counts` (client.ts switch ~521-591). Divergência de
       nome/estrutura de campo → input do 4-PLAN.
    RETOMADA DE HUNT (VAL-06):
    3. Reiniciar o worker rápido (hunt ainda em andamento) e confirmar `hunt-resume` seguido de `enter-hunt`
       com `resume:true` sem zerar progresso (client.ts ~540-541; loop.ts ~112).
    4. Marcar em GAME.md §9.2 "Mensagens ao abrir", "Formato de eventos", "Retomada de hunt" + data; colar
       os frames SANITIZADOS (sem token/identifier) em EVIDENCE.md.
  </how-to-verify>
  <resume-signal>Digite "registrado" com §9.2 kills/formato/retomada marcado, ou descreva a divergência (input do 4-PLAN).</resume-signal>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Drain / farm offline com docker stop e close codes — VAL-05, VAL-06</name>
  <what-built>Observação do drain de produção (docker stop) e do farm offline; registro de close codes.</what-built>
  <how-to-verify>
    SUB-ROTEIRO VAL-05 (farm offline sem sleep-mode):
    1. Baseline server-side: com o worker PARADO, numa sub-sessão do navegador em `/play`, anotar
       gold/capturas/tempo de sessão (ou o `analyzer`: seconds/balance). FECHAR a aba.
    2. Subir o worker como container (D-05) publicando a porta de `/health`; deixar em `in-game` numa janela
       curta; confirmar kills chegando (logs/health do 1-PLAN).
    3. Drain de produção: `docker stop --time 30 <nome-exato-do-container>` (SIGTERM → drain até 20s →
       close 1000). NUNCA `prune`/filtro/`xargs`; parar só o container do smoke pelo nome exato. Observar nos
       logs "drenando" e, se for o caso, "ação em andamento não terminou em 20s".
    4. Janela de espera offline (ex.: 15-30 min) com a conta SEM nenhuma sessão viva.
    5. Reabrir SÓ para ler (não jogar): comparar gold/capturas/tempo com o baseline. Subiu → farm offline
       continua SEM sleep-mode → GAME.md §9.2 "Drain sem sleep-mode" = confirmado + data. NÃO subiu → anotar
       como input do 4-PLAN (correção: drain passa a enviar sleep-mode e esperar sleep-ok).
    CLOSE CODES 4005-4009 (VAL-06):
    6. Provocar/observar os close codes que aparecerem (ex.: 4005 logando a mesma conta noutro lugar) e
       conferir o estado resultante no `/health` (4005/4008/4009 → needs-login; 4006/4007 → error; sempre sem
       reconectar em loop). Marcar em GAME.md §9.2 "Códigos de close" com os códigos observados + data.
    7. Evidência sanitizada (log de drenagem, `/health`, código de close) em EVIDENCE.md.
  </how-to-verify>
  <resume-signal>Digite "registrado" com §9.2 drain/close codes marcado, ou descreva a divergência (input do 4-PLAN).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WS do jogo → worker | Frames crus de field-init/field-kill/catch-result/analyzer |
| navegador (DevTools) ↔ conta | Sub-sessão só com o worker parado (4005) |
| frames WS → EVIDENCE.md | Frames podem conter token na query do upgrade; sanitizar |
| worker container ↔ docker | docker stop só por nome exato |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-3-01 | Information Disclosure | frame WS / URL de upgrade colado em EVIDENCE.md (token na query) | mitigate | Sanitizar `?token=` e qualquer identifier para `<redacted>` antes de colar |
| T-3-02 | Denial of Service (auto) | worker (container) + navegador na mesma conta (4005) | mitigate | Alternar; fechar a aba antes de subir o container; ler baseline rápido e sair |
| T-3-03 | Tampering | `docker prune`/filtro apagando containers alheios | mitigate | Só `docker stop --time 30 <nome-exato>`; proibido prune/xargs/filtro (regra do projeto) |
| T-3-04 | Repudiation/abuse | farm/estado da conta durante a janela offline | accept | Conta descartável (D-03); smoke só observa, não joga na sub-sessão de leitura |
</threat_model>

<verification>
- GAME.md §9.2 (shard, sem cmid, headers, mensagens ao abrir, retomada, hunt inválida, formato de eventos,
  drain sem sleep-mode, close codes, reconexão) têm marca + data onde foram exercitados.
- EVIDENCE.md tem os frames crus sanitizados e trechos de log/health; `grep` por token/identifier não retorna segredo.
</verification>

<success_criteria>
- Está registrado se a sessão conecta sem cmid no shard calculado e recebe field-init.
- Em hunt real, logs/`/health` mostram field-kill e o contador subindo sem o watchdog disparar à toa.
- Está registrado se o farm offline continua após `docker stop` sem sleep-mode (e, se não, a correção vira input do 4-PLAN).
- hunt-resume/resume:true e os close codes 4005-4009 observados estão registrados.
- Divergências observadas estão anotadas como input do 4-PLAN (gated por D-08).
</success_criteria>

<output>
Após concluir, criar `.planning/phases/phase-1-validacao-com-conta-real/3-SUMMARY.md`
(listando os pontos de §9.2 marcados e quais divergências alimentam o 4-PLAN).
</output>
