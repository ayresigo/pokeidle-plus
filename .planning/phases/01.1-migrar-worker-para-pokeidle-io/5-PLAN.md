---
phase: 01.1-migrar-worker-para-pokeidle-io
plan: 5
type: execute
wave: 3
depends_on: [2, 3, 4]
files_modified:
  - packages/worker/src/auth/provider.test.ts
  - packages/worker/src/auth/solver.test.ts
  - packages/worker/src/auth/refresh.test.ts
  - packages/worker/src/game/client.test.ts
  - packages/worker/src/game/loop.test.ts
  - packages/worker/src/config.test.ts
  - packages/worker/src/health.test.ts
autonomous: true
requirements: [MIG-04]
must_haves:
  truths:
    - "A cobertura de testes do worker (auth + game loop) voltou ao nível do v1.0: reconexão, rejeição, drain, watchdog, com fake timers e socket/ws local"
    - "A suíte do worker está verde e não regrediu em número de testes relevante vs baseline"
  artifacts:
    - path: "packages/worker/src/game/client.test.ts"
      provides: "Cenários de reconexão/rejeição/heartbeat/drain cobrindo a robustez migrada"
  key_links:
    - from: "robustez preservada (Plans 2/3)"
      to: "casos de teste"
      via: "cada mecanismo de robustez tem ao menos um caso que o exercita"
      pattern: "describe|it|test"
---

<objective>
Fechar MIG-04 / SC3: **recuperar a cobertura de testes do worker ao nível do v1.0** para auth e game loop
(reconexão, rejeição de token, drain, watchdog) com fake timers e servidor ws local, e deixar a **suíte
verde**. Baseline atual: 134 testes (8 arquivos). O v1.0 tinha ~175; a reescrita encolheu a cobertura.

NOTA: os testes de **close codes / sessão substituída / manutenção** reais vêm no Plan 6 (gated pelo smoke),
porque dependem dos sinais observados. Aqui cobrimos o que já está implementado/confirmado nos Plans 2/3.

Purpose: rede de segurança de testes de volta ao nível do v1.0.
Output: testes adensados; `pnpm --filter @pokeidle/worker test` verde; gate de cobertura documentado.
</objective>

<context>
@.planning/phases/01.1-migrar-worker-para-pokeidle-io/CONTEXT.md
@packages/worker/src/game/client.ts
@packages/worker/src/game/loop.ts
@packages/worker/src/auth/provider.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Adensar testes de game loop/WS (reconexão, heartbeat, drain, watchdog)</name>
  <files>packages/worker/src/game/client.test.ts, packages/worker/src/game/loop.test.ts</files>
  <behavior>
    Cobrir, com fake timers e socket fake/ws local, os cenários que o v1.0 cobria e que faltam hoje:
    - Reconexão: escalonamento do backoff (5 falhas → teto 24 s; depois teto 5 min); jitter; contador zera
      ao receber msg; não reconecta após `encerrar`.
    - Heartbeat: ping após silêncio; abandono após timeout; recuperação ao chegar pong/msg.
    - Rejeição de token: transitório (`AuthAdiadaError` → reconecta) vs definitivo (needs-login);
      `invalidarLimitado` no máximo 1×/5 min.
    - Drain: `desconectar` fecha com 1000 e respeita o timeout; loop `drenar` coordena parada.
    - Watchdog-stall: recuperação após 10 min; espaçamento após 3; kill zera.
  </behavior>
  <action>Escrever os casos faltantes (não duplicar os existentes); sem comentários em linhas de código.
    Rodar `pnpm --filter @pokeidle/worker test client loop`.</action>
  <verify><automated>pnpm --filter @pokeidle/worker test client loop</automated></verify>
  <done>Cenários de robustez do WS/loop cobertos; client+loop verdes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Adensar testes de auth/config/health</name>
  <files>packages/worker/src/auth/provider.test.ts, packages/worker/src/auth/solver.test.ts, packages/worker/src/auth/refresh.test.ts, packages/worker/src/config.test.ts, packages/worker/src/health.test.ts</files>
  <behavior>
    - Auth: todos os ramos de `loginComCaptcha` (sucesso/precisaNick/HTTP não-ok/rede), `buscarSitekey`,
      re-login via solver quando o access expira, needs-login quando o solver falha, sem segredo em log.
    - Config: caminhos de auth mutuamente exclusivos; `DISPOSITIVO` default; sem resíduo de shards.
    - Health: `/health` reflete `in-game`/`needs-login`/`error` + contadores + lastError.
  </behavior>
  <action>Completar os casos faltantes. Rodar `pnpm --filter @pokeidle/worker test`.</action>
  <verify><automated>pnpm --filter @pokeidle/worker test</automated></verify>
  <done>Auth/config/health cobertos ao nível do v1.0; suíte verde.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Gate de cobertura</name>
  <files>(verificação)</files>
  <behavior>Suíte do worker verde; nº de testes ≥ baseline (134) e cobrindo cada mecanismo de robustez
    PRESERVADO listado no CONTEXT. Registrar no SUMMARY a tabela mecanismo→teste.</behavior>
  <action>Rodar `pnpm --filter @pokeidle/worker test` e `pnpm --filter @pokeidle/worker typecheck` (se existir).</action>
  <verify><automated>pnpm --filter @pokeidle/worker test</automated></verify>
  <done>Suíte verde; tabela mecanismo→teste no SUMMARY.</done>
</task>

</tasks>

<verification>
- `pnpm --filter @pokeidle/worker test` verde, com os cenários de reconexão/rejeição/drain/watchdog presentes.
</verification>

<success_criteria>
- MIG-04 / SC3: cobertura de auth + game loop ao nível do v1.0; suíte verde.
</success_criteria>

<output>
Criar `.planning/phases/01.1-migrar-worker-para-pokeidle-io/5-SUMMARY.md` (tabela mecanismo→teste; nº de testes
antes/depois).
</output>
