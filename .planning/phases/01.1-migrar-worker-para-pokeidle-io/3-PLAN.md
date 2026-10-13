---
phase: 01.1-migrar-worker-para-pokeidle-io
plan: 3
type: execute
wave: 2
depends_on: [2]
files_modified:
  - packages/worker/src/game/client.ts
  - packages/worker/src/game/client.test.ts
  - packages/worker/src/game/loop.ts
  - packages/worker/src/game/loop.test.ts
  - packages/worker/src/config.ts
  - packages/worker/src/config.test.ts
autonomous: true
requirements: [MIG-03]
must_haves:
  truths:
    - "O game loop/WS foi revisado arquivo a arquivo sobre o protocolo real (hello/welcome, hunt.select/campo/batalha/estado, ping/pong)"
    - "A robustez PRESERVADA (backoff+jitter+teto longo, heartbeat, invalidar 1x/5min, watchdog-stall, drain 1000) está confirmada e coberta por teste"
    - "O resíduo de sharding (GAME_WS_SHARDS/djb2) foi removido com evidência; o client usa wss raw"
    - "Para cada item de robustez de fechamento NÃO observado, há um gap registrado em GAME.md §9 (implementação gated vai para o Plan 6)"
  artifacts:
    - path: "packages/worker/src/game/client.ts"
      provides: "Cliente WS do pokeidle.io revisado, sem resíduo de sharding/close-codes antigos"
  key_links:
    - from: "CONTEXT.md (PRESENTE/AUSENTE/RESÍDUO)"
      to: "client.ts/loop.ts/config.ts + testes"
      via: "cada item vira confirmação+teste, limpeza, ou gap documentado"
      pattern: "describe|it|test"
---

<objective>
Revisar **arquivo a arquivo** o game loop/WS do worker no `pokeidle.io` (MIG-03, SC2), **confirmar com
teste** a robustez preservada, **remover o resíduo** de sharding e **documentar como gap** a robustez de
fechamento que depende do smoke (D-S2/D-S3). A **implementação** do tratamento conservador de fechamento
(close codes / sessão substituída / manutenção) fica no Plan 6, gated pela evidência do smoke — aqui NÃO
se inventa close code nem evento.

Purpose: game loop revisado e limpo, com a robustez conhecida coberta e os gaps nomeados.
Output: edits em `game/` + `config.ts` (limpeza de sharding), testes confirmando a robustez preservada.
</objective>

<context>
@.planning/phases/01.1-migrar-worker-para-pokeidle-io/CONTEXT.md
@.planning/phases/phase-1-validacao-com-conta-real/EVIDENCE.md
@packages/worker/src/game/client.ts
@packages/worker/src/game/loop.ts
@packages/worker/src/config.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Remover resíduo de sharding do config/WS</name>
  <files>packages/worker/src/config.ts, packages/worker/src/config.test.ts</files>
  <behavior>
    `GAME_WS_SHARDS`/`gameWsShards`/`DEFAULT_WS_SHARDS=88` e a lógica de shard em `resolverWsUrl` estão
    mortos (o client usa `wsUrl` raw). Remover: campo `gameWsShards` da interface, a env `GAME_WS_SHARDS`,
    a constante e a validação. Manter `GAME_WS_URL`/`GAME_WS_PATH` só se úteis como override do host do WS
    (default = origem de `GAME_URL` em `wss://`). Atualizar `config.test.ts` (remover casos de shards).
    Decisão em GAME.md §9: "sharding djb2 (88) / `?token` / `cmid`" → **removido-com-evidência** (não existe
    no pokeidle.io — VAL-02/03).
  </behavior>
  <action>Edit cirúrgico em config.ts; remover os testes de shards e ajustar os de WS URL. Rodar
    `pnpm --filter @pokeidle/worker test config`.</action>
  <verify><automated>pnpm --filter @pokeidle/worker test config</automated></verify>
  <done>Nenhuma referência a shards no worker; `grep -n "shard\|djb2\|GAME_WS_SHARDS" src` vazio; testes verdes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Confirmar a robustez preservada do client com teste</name>
  <files>packages/worker/src/game/client.ts, packages/worker/src/game/client.test.ts</files>
  <behavior>
    Revisar e **cobrir com teste** (fake timers + socket fake) cada item preservado, ajustando só se divergir:
    - Handshake `{t:"hello", nick, token, delta:1, dispositivo}` no `aoAbrir`; `welcome` → `in-game` +
      `hunt.select` se `huntSlug`.
    - Backoff+jitter: 5 primeiras falhas com teto 24 s, depois teto 5 min; contador zera só ao receber msg.
    - Heartbeat: ping após 45 s de silêncio; abandona após 15 s sem resposta e reconecta.
    - `invalidarLimitado`: no máximo 1× a cada 5 min (D-S5 — já presente, só garantir regressão).
    - Rejeição de token (`tratarHelloRecusado`): `AuthAdiadaError` → reconecta (transitório); senão
      needs-login (definitivo). Cobrir ambos.
    - Drain `desconectar` → `close(1000,"drain")` com timeout de 2 s.
    - Kills/contadores: `batalha/morte quem:selvagem` incrementa; `estado.dexMud` reconcilia acima do local.
  </behavior>
  <action>Edit só em divergência; focar em **adensar a cobertura** (reconexão, rejeição, heartbeat, drain)
    de volta ao nível v1.0. Sem comentários em linhas de código. Rodar `pnpm --filter @pokeidle/worker test client`.</action>
  <verify><automated>pnpm --filter @pokeidle/worker test client</automated></verify>
  <done>Cada item preservado tem teste reproduzindo-o; divergências corrigidas; client verde.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Confirmar o loop (garantir-hunt + watchdog-stall) e o drain</name>
  <files>packages/worker/src/game/loop.ts, packages/worker/src/game/loop.test.ts</files>
  <behavior>
    - `garantirHunt`: `hunt.select` com prazo `campo.init` de 10 s; após 3 entradas sem `campo.init`,
      lastError "HUNT_SLUG inválido ou hunt ignorada". Cobrir inclusive o `aviso` de slug inválido do jogo.
    - `watchdog-stall`: 10 min sem kill → `hunt.select` de recuperação; após 3 recuperações, espaça para 1 h
      e lastError "sem kills há Nmin"; um kill zera. Cobrir com fake timers.
    - `drenar`: para o loop (timeout), desconecta o client (close 1000), para o auth, fecha o health.
    - Decisão em §9: watchdog-stall → **preservado-adaptado** (caminho de 10 min nunca exercitado ao vivo;
      o smoke confirma que não dispara à toa).
  </behavior>
  <action>Edit só em divergência; reforçar testes de watchdog/hunt/drain. Rodar `pnpm --filter @pokeidle/worker test loop`.</action>
  <verify><automated>pnpm --filter @pokeidle/worker test loop</automated></verify>
  <done>Loop/watchdog/drain cobertos; loop verde.</done>
</task>

<task type="auto">
  <name>Task 4: Nomear os gaps de robustez de fechamento (sem implementar)</name>
  <files>packages/worker/GAME.md</files>
  <behavior>
    Registrar em §9, como **gap a fechar no 6-PLAN (gated por smoke)**, cada item de fechamento não observado:
    - Close codes 4001/4003/4005-4009 → hoje `aoFechar` reconecta para tudo; conservador (D-S2) será wired
      com os códigos reais que o smoke observar; não observado = gap.
    - Sessão substituída (replaced) → como o pokeidle.io sinaliza (close? `erro`? `evento`?) a confirmar.
    - Manutenção → se houver sinal próprio, adicionar backoff escalonado (5/10/15); senão backoff genérico
      cobre; a confirmar.
    - Reciclagem `restart-freeze`/`restart-resumed` → eventos do protocolo antigo; **removido-com-evidência**
      salvo se o smoke revelar equivalente.
  </behavior>
  <action>Atualizar §9 do GAME.md (apenas doc) com esses gaps apontando para o 6-PLAN. Sem código aqui.</action>
  <verify><manual>§9 lista cada gap de fechamento com o destino (Plan 6, gated).</manual></verify>
  <done>Gaps de fechamento nomeados em §9; nenhuma implementação adivinhada.</done>
</task>

</tasks>

<threat_model>
| Threat ID | Category | Component | Disposition | Mitigation |
|-----------|----------|-----------|-------------|-----------|
| T-3-01 | Elevation/abuse | reintroduzir `cmid`/sharding para "resolver" conexão | avoid | D-10/VAL-02: pokeidle.io não usa; resíduo removido |
| T-3-02 | DoS | reconectar em loop em sessão substituída | mitigate | conservador (D-S2) gated no Plan 6; gap documentado até lá |
</threat_model>

<verification>
- `pnpm --filter @pokeidle/worker test` (client+loop+config) verde.
- `grep -rn "shard\|djb2\|GAME_WS_SHARDS\|field-init\|enter-hunt\|restart-state\|balls-get\|cmid\|?token" packages/worker/src` vazio.
</verification>

<success_criteria>
- MIG-03 / SC2: game loop revisado; robustez preservada coberta; resíduo removido; gaps de fechamento nomeados (implementação gated no Plan 6).
</success_criteria>

<output>
Criar `.planning/phases/01.1-migrar-worker-para-pokeidle-io/3-SUMMARY.md` (por item: preservado+teste /
removido-com-evidência / gap→Plan 6).
</output>
