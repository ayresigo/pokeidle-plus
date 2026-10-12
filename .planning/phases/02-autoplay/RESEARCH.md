---
phase: 02-autoplay
type: research
requirements: [AUTO-01, AUTO-02, AUTO-03, AUTO-04, AUTO-05, AUTO-06, SUP-01, SUP-02]
scope_note: "Planejamento parcial — só o que INDEPENDE da Fase 1 (aprovado pelo coordenador). Itens dependentes da Fase 1 estão listados em <blocked> e não entram nos PLANs."
---

<summary>
A Fase 2 entrega autoplay autônomo e supervisão que sobrevive a reinícios. Este
plano cobre apenas as fatias que **não dependem da validação com conta real** da
Fase 1: (a) SUP-01/02 — estado desejado na central + reconciliação no boot +
central como fonte do refresh token; (b) configuração de autoplay por conta
(defaults + override) no modelo da central, no control-plane e na UI; (c)
dashboard de cards via SSE com os campos já disponíveis; (d) motor de políticas
do worker para **compra de pokébolas** e **venda de itens** usando só os
endpoints JÁ confirmados no GAME.md (`balls/buy`, `shop/sell`, `flint/sell`).

**Boundary de conflito com a Fase 1:** a Fase 1 altera `packages/worker/src/game/`
(`loop.ts`, `client.ts`). Tudo que toca o game client/loop vai para a **Wave 2**
(Plan 04) e só executa **depois do merge da Fase 1**, com rebase. As Waves 1
(Plans 01-03) não tocam `packages/worker/src/game/` e podem executar em paralelo
à Fase 1.
</summary>

<findings>

### Modelo da central (`apps/central-api/prisma/schema.prisma`)
`model Account` hoje: `id, userId, label, pokeidleUser, pokeidlePassEnc,
accessTokenEnc?, refreshTokenEnc?, proxyUrl?, solverKeyEnc?, createdAt`.
Falta: estado desejado (SUP-01) e configuração de autoplay. Rotas em
`accounts/routes.ts`: CRUD + `PUT /accounts/:id/tokens` (write-back do refresh,
chamado pelo control-plane) e `GET /accounts/:id/credentials` (descriptografa e
devolve tudo; é por onde o control-plane injeta env no worker). Padrão de
feature: pasta `src/<feature>/` com `registerXRoutes(app, prisma)` + teste
co-localizado; Prisma 7; migrations em `prisma/migrations`.

### Control-plane supervisão (`apps/control-plane/src/supervisor/supervisor.ts`)
`Supervisor.estados: Map<accountId, {desired: "running"|"stopped", backoff,
degraded, falhas, ...}>` — **só em memória**, perdido no reinício.
`desireRunning()/desireStopped()` setam o desejado; `poll()` (10s) religa quem
está `running` com backoff (`PASSOS_BACKOFF=[60,120,300]s`, teto 900s, degraded
após 3 falhas). `lerHealth()` lê `http://mpw-worker-<id>:3001/health`, popula
`jogos` (state/lastAction/lastError) e dispara write-back de tokens
(`verificarTokens` → `onTokensRenovados`). Recriação com tokens via
`orchestrator/recriar.ts` (`configDeRecriacao`, `envComTokens`) usando
`supervisor.tokensConhecidos` (memória). `update/manager.ts` persiste em
`DATA_DIR` (`settings.json`, `rollback.json`) — mas **não** o estado desejado.
`workers/routes.ts` `iniciarWorker` busca credenciais na central
(`GET /accounts/:id/credentials`) e monta env (`montarEnv`). `central/repasse.ts`
faz as chamadas autenticadas do painel para a central. `stream/routes.ts` expõe
`GET /events` (SSE: `snapshot` + `update`).

### Worker (`packages/worker/src/`)
- `config.ts` `loadConfig(env)` → `WorkerConfig` (lê `HUNT_SLUG`, credenciais,
  proxy, overrides de WS). **Não** é `game/` — adicionar novas chaves de env aqui
  é aditivo e de baixo risco de conflito com a Fase 1.
- `health.ts` `HealthState`/`HealthSnapshot` (`state, lastAction, lastError,
  uptimeSec, tokens?`) + servidor `/health:3001`. Expor métricas de sessão novas
  = adicionar campo `sessao` ao snapshot (aditivo em `health.ts`), **mas** quem
  alimenta os números é o `loop.ts`/`client.ts` (game/) — por isso a emissão de
  métricas fica na **Wave 2**.
- `game/loop.ts` / `game/client.ts` — loop de ações (jitter, watchdog, drain) e
  cliente WS/REST. `client.ts` já **lê** `balls` e `inventory` (eventos WS) e
  conta `field-kill`/`catch-result`. **Não** compra nem vende hoje. Endpoints
  confirmados (GAME.md §4.3): `POST /api/game/balls/buy {ballId, qty}`,
  `POST /api/game/shop/sell {items:[{itemId,qty}]}`,
  `POST /api/game/flint/sell {itemId, qty}`. Catálogo estático `/game/items.json`
  (`npcPrice`). Tudo com Bearer.

### Web (`apps/web/`)
`components/{Dashboard,AccountRow,AccountForm}.tsx`, `lib/{conta,api,sessao,sse}.ts`.
Dashboard consome SSE `/events` (via `lib/sse.ts`). `AccountForm` tem label,
pokeidleUser/Pass, proxyUrl (+ testar proxy), solverKey, access/refreshToken
(colar `pokeweb:tokens`). Config de jogo (hunt, bolas, venda) **não existe** na
UI. Next.js 16 App Router — ler `node_modules/next/dist/docs/` antes de mexer
(ver `apps/web/AGENTS.md`).

### Contrato compartilhado (fonte única entre os PLANs)
Campos novos de `Account` (SUP + autoplay):
- `desiredRunning Boolean @default(false)` — SUP-01 (estado desejado).
- `autoplayConfig Json?` — configuração de autoplay (forma abaixo); JSON para
  evoluir sem migration a cada campo novo (potions etc. entram depois). Defaults
  aplicados em código (não no banco).

Forma de `autoplayConfig` (campos liberados agora; defaults sugeridos):
```
{
  huntSlug?: string | null,      // null = escolha automática atual (fallback)
  ballId?: string | null,        // bola fixa; null = compra desativada até definir
  ballMin: number = 100,         // estoque mínimo que dispara compra
  ballTarget: number = 500,      // repor até este alvo
  sellEnabled: boolean = true,   // venda periódica de itens
  sellKeepItemIds: string[] = [],// whitelist de itens a GUARDAR (não vender)
  sellIntervalSec: number = 600  // periodicidade da venda
}
```
Env injetado pelo control-plane no worker (aditivo em `montarEnv`/`config.ts`):
`HUNT_SLUG` (já existe), `BALL_ID`, `BALL_MIN`, `BALL_TARGET`, `SELL_ENABLED`,
`SELL_KEEP_ITEM_IDS` (CSV), `SELL_INTERVAL_SEC`.
Endpoints novos na central: `PUT /accounts/:id/desired-state {running:boolean}`;
`autoplayConfig` incluído em `GET /accounts/:id/credentials`, em `GET /accounts`,
e aceito em `POST /accounts`/`PATCH /accounts/:id`.
Snapshot SSE (control-plane) ganha, por conta, o objeto `sessao` (opcional,
preenchido só quando o worker o reporta na Wave 2): `{kills, captures, balls,
ballsBought, goldSpent, itemsSold, sessionSec}`.
</findings>

<pitfalls>
- **Conflito com a Fase 1:** NÃO editar `packages/worker/src/game/loop.ts` nem
  `client.ts` nas Waves 1. O motor de políticas (Plan 04) entra como módulo(s)
  NOVO(s) em `packages/worker/src/game/` e só a fiação mínima no `loop.ts` —
  executar depois do merge da Fase 1, com rebase.
- **Tokens no cold start (SUP-02):** após reinício do control-plane,
  `supervisor.tokensConhecidos` está vazio; a recriação precisa cair na central
  (`GET /accounts/:id/credentials`) para pegar o refresh token mais recente
  (write-back já grava lá). Garantir esse fallback, senão o worker sobe com token
  velho e cai em `needs-login`.
- **Reconciliação no boot:** ao subir, o control-plane deve carregar
  `desiredRunning` da central e semear `estados` ANTES do primeiro `poll()`, para
  religar sozinho sem clique. Evitar corrida com o update manager (que já
  pausa/retoma o supervisor).
- **Defaults + override:** defaults aplicados em código (não no banco) para conta
  antiga sem `autoplayConfig` continuar válida; UI só grava o que o usuário mudou.
- **Dashboard sem fonte:** só renderizar os campos com fonte (status/uptime agora;
  kills/captures/balls/custos quando a Wave 2 emitir). Campos sem fonte (XP/h,
  diamantes, gemas, VIP, drops raros, nível do treinador) ficam de fora até a
  Fase 1 (ver <blocked>).
- **Migration:** `autoplayConfig Json?` + `desiredRunning Boolean` numa única
  migration (Plan 01) evita churn; Plans 02/03/04 não mexem no schema.
- **Next.js 16:** ler `apps/web/AGENTS.md` e `node_modules/next/dist/docs/` antes
  de criar página/rota nova.
</pitfalls>

<decisions>
Rastreando `02-CONTEXT.md` (D-01..D-26). Entram agora:
- SUP: estado desejado na central (D-24), reconciliar no boot (D-25), central é a
  fonte do refresh token (D-26).
- Config por conta: tudo por conta (D-16), defaults + override (D-17), página
  separada (D-18).
- Compra: ballId fixo por conta (D-04), mínimo configurável (D-05), repor até alvo
  (D-06) — SÓ pokébolas por enquanto.
- Venda: tudo exceto whitelist (D-08), só loja NPC `shop/sell`/`flint/sell` (D-09),
  periódica (D-10) — SÓ itens por enquanto.
- Hunt: slug fixo ou automático atual (D-01 parte não-otimizada, D-03) — exposto
  na config; a seleção "mais otimizada" fica bloqueada.
- Dashboard de cards via SSE (D-19/D-22), COPIAR/RESET (D-23), `+` adiciona
  existente com gancho futuro (D-21) — só campos com fonte (D-20).
</decisions>

<blocked>
Fora deste plano, dependente da Fase 1 (NÃO planejar/executar agora):
- **Hunt "mais otimizada"** (D-01): precisa de dados reais (`creatures.json`,
  kills por hunt) para definir o cálculo.
- **Poções/cura** (D-07, D-14): endpoint/mecanismo de compra de potion e de cura
  (`joy-heal`/`use-heal`) não confirmados (GAME.md §8).
- **Venda de pokémon duplicados/fracos** (D-11): endpoint/critério não mapeados.
- **sleep-mode no drain** (D-13): condicional à VAL-05.
- **Campos do dashboard sem fonte** (D-20): XP/h, XP treinador×pokémon, % bônus
  (VIP/Guild/Twitch), diamantes, gemas, dias VIP/Passe, nível do treinador, drops
  raros, nível exato do pokémon ativo — provável `GET /api/characters/me`, campos
  não mapeados.
- **Run de aceite de 24 h (AUTO-06)** e qualquer execução do autoplay contra o
  jogo real: dependem da Fase 1.
- **Registro de conta do zero (ACC-01)**: backlog, fase própria.
</blocked>
