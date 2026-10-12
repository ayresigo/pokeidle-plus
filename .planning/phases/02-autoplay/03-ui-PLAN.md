---
phase: 02-autoplay
plan: 03
type: execute
wave: 3
depends_on: [02]
fase1_independent: true
files_modified:
  - apps/control-plane/src/supervisor/supervisor.ts
  - apps/control-plane/src/stream/routes.ts
  - apps/control-plane/src/stream/routes.test.ts
  - apps/web/lib/conta.ts
  - apps/web/lib/api.ts
  - apps/web/components/Dashboard.tsx
  - apps/web/components/AccountRow.tsx
  - apps/web/components/AutoplayForm.tsx
  - apps/web/app/(painel)/accounts/[id]/autoplay/page.tsx
autonomous: true
requirements: [AUTO-01, AUTO-02, AUTO-03, SUP-01]
must_haves:
  truths:
    - "O painel tem uma página separada de autoplay por conta onde o usuário edita hunt, compra e venda (defaults já preenchidos, override opcional)"
    - "O dashboard mostra um card por conta com status/uptime e um resumo de sessão que renderiza os campos quando chegam pelo SSE (tolerante a ausência)"
    - "O card tem botão + (adicionar conta existente) com um ponto de entrada previsto para 'criar do zero' futuro, e COPIAR do resumo"
    - "O snapshot/update do SSE carrega o objeto sessao por conta quando o worker o reporta, sem quebrar quando ausente"
  artifacts:
    - path: "apps/web/app/(painel)/accounts/[id]/autoplay/page.tsx"
      provides: "página de configuração de autoplay por conta (GET/PATCH autoplayConfig)"
    - path: "apps/web/components/Dashboard.tsx"
      provides: "grade de cards por conta + botão + (adicionar existente)"
    - path: "apps/control-plane/src/stream/routes.ts"
      provides: "SSE snapshot/update incluindo sessao (opcional) por conta"
  key_links:
    - from: "apps/web/components/Dashboard.tsx"
      to: "apps/control-plane/src/stream/routes.ts"
      via: "SSE /events (snapshot+update) renderizado nos cards"
    - from: "apps/web/app/(painel)/accounts/[id]/autoplay/page.tsx"
      to: "apps/central-api/src/accounts/routes.ts"
      via: "lib/api.ts → control-plane repasse → PATCH/GET accounts autoplayConfig"
---

<objective>
Expor a configuração de autoplay por conta numa página separada (defaults +
override) e transformar o dashboard numa grade de cards por conta, consumindo o
SSE existente. Renderiza só os campos com fonte hoje (status, uptime e o objeto
`sessao` quando o worker o reportar — campos sem fonte ficam de fora, ver
RESEARCH <blocked>). Só web + control-plane (SSE); NENHUMA mudança em
`packages/worker/src/game/`. Depende do Plan 02 (contrato de config).
</objective>

<context>
- `.planning/phases/02-autoplay/RESEARCH.md` — contrato de config, forma do `sessao` no snapshot, pitfalls (Next.js 16). LER PRIMEIRO.
- `.planning/phases/02-autoplay/02-CONTEXT.md` — D-16/D-17/D-18 (config/UI), D-19/D-20/D-21/D-22/D-23 (dashboard).
- `apps/web/AGENTS.md` + `node_modules/next/dist/docs/` — LER antes de criar página/rota (Next.js 16 diverge).
- `apps/web/components/{Dashboard,AccountRow,AccountForm}.tsx`, `lib/{conta,api,sse,sessao}.ts` — padrões atuais.
- `apps/web/app/(painel)/accounts/{new,[id]}/page.tsx` — fluxo de conta existente.
- `apps/control-plane/src/stream/routes.ts` (SSE) e `supervisor.ts` (`lerHealth`, snapshot `jogos`).
</context>

<tasks>
<task type="auto">
  <name>Task 1: sessao no snapshot do SSE (passthrough)</name>
  <files>apps/control-plane/src/supervisor/supervisor.ts, apps/control-plane/src/stream/routes.ts, apps/control-plane/src/stream/routes.test.ts</files>
  <action>
Estender o estado por conta do supervisor (`EstadoJogo` em `supervisor.ts`, hoje
`{state,lastAction,lastError}`) com `sessao?: {kills, captures, balls,
ballsBought, goldSpent, itemsSold, sessionSec}` e retê-lo entre polls. `lerHealth`
preenche `sessao` a partir do `/health` do worker quando presente (forward-compat:
hoje o worker não emite; vem no Plan 04). Incluir em `getSnapshot` e no
`snapshot`/`update` do SSE. Tolerante a ausência (sem `sessao` → omitido).
Teste: snapshot com e sem sessao.
  </action>
  <verify>pnpm --filter control-plane test</verify>
  <done>SSE carrega sessao quando existe; não quebra quando ausente; suíte verde.</done>
</task>

<task type="auto">
  <name>Task 2: Cliente de API da config de autoplay (web)</name>
  <files>apps/web/lib/conta.ts, apps/web/lib/api.ts</files>
  <action>
Adicionar o tipo `AutoplayConfig` + defaults no front e funções em `api.ts` para
ler/gravar `autoplayConfig` da conta. Leitura: listar `/accounts` e filtrar por
id (padrão atual do `AccountForm`, que já faz `find(c.id)`) — o `publico()` passa
a trazer `autoplayConfig` (Plans 01/02); NÃO existe GET singular. Gravação: PATCH
`/accounts/:id` com o `autoplayConfig` parcial. Seguir o padrão de chamadas/erros
já em `api.ts`/`conta.ts`.
  </action>
  <verify>pnpm --filter web exec tsc -p tsconfig.json --noEmit</verify>
  <done>Funções de GET/PATCH da config tipadas; tsc limpo.</done>
</task>

<task type="auto">
  <name>Task 3: Página de autoplay por conta</name>
  <files>apps/web/components/AutoplayForm.tsx, apps/web/app/(painel)/accounts/[id]/autoplay/page.tsx</files>
  <action>
Criar a página separada `accounts/[id]/autoplay` com `AutoplayForm`: campos
huntSlug (vazio = automático), ballId, ballMin, ballTarget, sellEnabled,
sellKeepItemIds (lista), sellIntervalSec — com defaults pré-preenchidos (override
opcional, D-17). Salvar via `api.ts` (Task 2); oferecer reiniciar o worker se
estava rodando (padrão do `AccountForm` atual). Seguir App Router/Next 16 e o
estilo existente. Campos bloqueados (potions, hunt otimizada) NÃO aparecem.
  </action>
  <verify>pnpm --filter web exec tsc -p tsconfig.json --noEmit && pnpm --filter web run build</verify>
  <done>Página carrega, edita e salva a config; build OK.</done>
</task>

<task type="auto">
  <name>Task 4: Dashboard em grade de cards</name>
  <files>apps/web/components/Dashboard.tsx, apps/web/components/AccountRow.tsx</files>
  <action>
Transformar o dashboard numa grade de cards (1 por conta) consumindo o SSE atual.
Cada card: nome/label, status (state/lastError/degraded/backoff como hoje),
uptime, link para a página de autoplay, start/stop/restart, e um bloco "Sessão"
que renderiza os campos de `sessao` QUANDO presentes (kills, capturas, bolas,
comprados, gold gasto, itens vendidos, tempo) — ausente → placeholder "sem dados
ainda". Botão COPIAR copia o resumo textual da sessão. Botão + no topo leva a
`accounts/new` (adicionar existente), com o ponto de entrada "criar do zero"
previsto (desabilitado/anotado, ACC-01 futuro). Botão RESET presente na UI mas
sua ação de backend (analyzer-clear) fica no Plan 04 — deixar desabilitado com
tooltip "disponível após o motor de autoplay". Pokémon ativo e campos sem fonte
(XP/h, diamantes, VIP, drops raros) NÃO entram agora (RESEARCH <blocked>).
  </action>
  <verify>pnpm --filter web exec tsc -p tsconfig.json --noEmit && pnpm --filter web run build</verify>
  <done>Grade de cards renderiza status + sessão (quando houver) e o +; build OK.</done>
</task>
</tasks>

<verification>
- `pnpm --filter control-plane test` verde; `tsc --noEmit` + `build` do web OK.
- Smoke: abrir o painel → grade de cards; abrir a página de autoplay → editar/salvar config; card mostra "sem dados ainda" na sessão (até o Plan 04).
</verification>

<success_criteria>
- Página de autoplay por conta (defaults+override, página separada — D-18).
- Dashboard em cards via SSE com os campos disponíveis; + para adicionar existente; COPIAR funcional.
- Nenhuma mudança em `packages/worker/src/game/`. Commits conventional PT-BR na branch.
</success_criteria>
