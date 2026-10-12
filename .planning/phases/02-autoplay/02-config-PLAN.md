---
phase: 02-autoplay
plan: 02
type: execute
wave: 2
depends_on: [01]
fase1_independent: true
files_modified:
  - apps/central-api/src/accounts/routes.ts
  - apps/central-api/src/accounts/accounts.test.ts
  - apps/control-plane/src/workers/routes.ts
  - apps/control-plane/src/workers/routes.test.ts
  - apps/control-plane/src/orchestrator/recriar.ts
  - packages/worker/src/config.ts
  - packages/worker/src/config.test.ts
autonomous: true
requirements: [AUTO-01, AUTO-02, AUTO-03]
must_haves:
  truths:
    - "Cada conta tem uma configuração de autoplay (huntSlug, ballId, ballMin, ballTarget, sellEnabled, sellKeepItemIds, sellIntervalSec) persistida na central, com defaults aplicados em código"
    - "A central aceita gravar/ler autoplayConfig via account CRUD; conta antiga sem config continua válida (defaults)"
    - "O control-plane injeta a config como env ao criar/recriar o worker; o worker lê as novas chaves em loadConfig"
    - "A injeção de env também vale na recriação (update e religamento)"
  artifacts:
    - path: "packages/worker/src/config.ts"
      provides: "WorkerConfig estendido: ballId, ballMin, ballTarget, sellEnabled, sellKeepItemIds, sellIntervalSec (+ huntSlug já existente), com defaults"
    - path: "apps/control-plane/src/workers/routes.ts"
      provides: "montarEnv injeta BALL_ID/BALL_MIN/BALL_TARGET/SELL_* a partir de autoplayConfig"
    - path: "apps/central-api/src/accounts/routes.ts"
      provides: "autoplayConfig aceito em POST/PATCH e normalizado com defaults na leitura"
  key_links:
    - from: "apps/control-plane/src/workers/routes.ts"
      to: "packages/worker/src/config.ts"
      via: "env BALL_*/SELL_*/HUNT_SLUG → loadConfig → WorkerConfig"
    - from: "apps/central-api/src/accounts/routes.ts"
      to: "apps/control-plane/src/workers/routes.ts"
      via: "GET /accounts/:id/credentials devolve autoplayConfig consumido por montarEnv"
---

<objective>
Modelar e plumbar a configuração de autoplay por conta (defaults + override) da
central até o env do worker, SEM implementar as ações de compra/venda (isso é o
Plan 04). Entrega o contrato de config pronto para o motor de políticas consumir.
`config.ts` é do worker mas NÃO é `game/` — mudança aditiva, baixo risco de
conflito com a Fase 1. Depende do Plan 01 (coluna `autoplayConfig`).
</objective>

<context>
- `.planning/phases/02-autoplay/RESEARCH.md` — forma de `autoplayConfig`, chaves de env e defaults. LER PRIMEIRO.
- `.planning/phases/02-autoplay/02-CONTEXT.md` — D-01/D-03 (hunt), D-04/D-05/D-06 (compra), D-08/D-09/D-10 (venda), D-16/D-17 (config por conta, defaults+override).
- `apps/central-api/src/accounts/routes.ts` — CRUD + credentials (já devolve autoplayConfig bruto após Plan 01).
- `apps/control-plane/src/workers/routes.ts` — `montarEnv` (hoje injeta ACCOUNT_ID, GAME_URL, POKEIDLE_*, CONTROL_PLANE_URL, + tokens/solver/proxy).
- `apps/control-plane/src/orchestrator/recriar.ts` — `configDeRecriacao`/`envComTokens` (recriação precisa repassar o mesmo env).
- `packages/worker/src/config.ts` — `loadConfig(env)`; `huntSlug` já lido.
</context>

<tasks>
<task type="auto">
  <name>Task 1: Tipo + defaults de autoplayConfig (central)</name>
  <files>apps/central-api/src/accounts/routes.ts, apps/central-api/src/accounts/accounts.test.ts</files>
  <action>
Definir o tipo `AutoplayConfig` e `AUTOPLAY_DEFAULTS` (RESEARCH §contrato) num
módulo compartilhável da central. Aceitar `autoplayConfig` (parcial) em
`POST /accounts` e `PATCH /accounts/:id`, validando tipos/ranges (ballMin>=0,
ballTarget>=ballMin, sellIntervalSec>0, sellKeepItemIds: string[]). Na leitura
(GET), mesclar com defaults no mapper `publico()` (ver Plan 01). ATENÇÃO: os
schemas da central usam `additionalProperties:false` — estender
`propriedadesConta` (o schema de body de POST/PATCH) para aceitar o objeto
`autoplayConfig`, senão o Fastify rejeita o campo. Teste: PATCH parcial grava e
GET devolve mesclado; conta antiga (null) retorna defaults.
  </action>
  <verify>pnpm --filter central-api test</verify>
  <done>Config persiste/normaliza com defaults; suíte verde.</done>
</task>

<task type="auto">
  <name>Task 2: montarEnv injeta a config no worker</name>
  <files>apps/control-plane/src/workers/routes.ts, apps/control-plane/src/orchestrator/recriar.ts, apps/control-plane/src/workers/routes.test.ts</files>
  <action>
Em `montarEnv`, ler `autoplayConfig` de `GET /accounts/:id/credentials` (vem
BRUTO, sem defaults — Plan 01 T2) e APLICAR `AUTOPLAY_DEFAULTS` aqui antes de
injetar, para o worker nunca receber `BALL_MIN`/`BALL_TARGET`/etc. indefinidos.
Injetar:
`HUNT_SLUG` (se definido), `BALL_ID`, `BALL_MIN`, `BALL_TARGET`, `SELL_ENABLED`,
`SELL_KEEP_ITEM_IDS` (CSV), `SELL_INTERVAL_SEC`. Garantir que `configDeRecriacao`/
`envComTokens` repassem essas mesmas chaves na recriação. Teste: env resultante
contém as chaves com os valores da config.
  </action>
  <verify>pnpm --filter control-plane test</verify>
  <done>Env de criação e recriação carrega a config; suíte verde.</done>
</task>

<task type="auto">
  <name>Task 3: Worker lê as novas chaves de env</name>
  <files>packages/worker/src/config.ts, packages/worker/src/config.test.ts</files>
  <action>
Estender `WorkerConfig` e `loadConfig` com `ballId?`, `ballMin` (default 100),
`ballTarget` (default 500), `sellEnabled` (default true), `sellKeepItemIds`
(default [], parse de CSV), `sellIntervalSec` (default 600). Validar ranges como
na central; valores ausentes caem no default. NÃO tocar `game/`. Teste: env
preenchido → config; env ausente → defaults; CSV parseado.
  </action>
  <verify>pnpm --filter worker test</verify>
  <done>loadConfig entrega a config de autoplay com defaults; suíte verde.</done>
</task>
</tasks>

<verification>
- `pnpm --filter central-api test`, `pnpm --filter control-plane test`, `pnpm --filter worker test` verdes.
- `tsc --noEmit` limpo nos três pacotes.
- Sanidade: criar/editar conta com config parcial → credentials reflete; env do container carrega BALL_*/SELL_*.
</verification>

<success_criteria>
- Config de autoplay por conta (defaults+override) persistida e plumbada até o env do worker.
- Nenhuma ação de compra/venda implementada aqui (fica no Plan 04).
- Nenhuma mudança em `packages/worker/src/game/`. Commits conventional PT-BR na branch.
</success_criteria>
