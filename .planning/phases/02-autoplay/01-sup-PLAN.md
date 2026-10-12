---
phase: 02-autoplay
plan: 01
type: execute
wave: 1
depends_on: []
fase1_independent: true
files_modified:
  - apps/central-api/prisma/schema.prisma
  - apps/central-api/prisma/migrations/
  - apps/central-api/src/accounts/routes.ts
  - apps/central-api/src/accounts/accounts.test.ts
  - apps/control-plane/src/supervisor/supervisor.ts
  - apps/control-plane/src/supervisor/supervisor.test.ts
  - apps/control-plane/src/workers/routes.ts
  - apps/control-plane/src/app.ts
autonomous: true
requirements: [SUP-01, SUP-02]
must_haves:
  truths:
    - "O estado desejado (rodando/parado) de cada conta é gravado na central e sobrevive a reinício do control-plane, auto-update e reboot do Docker"
    - "Ao subir, o control-plane carrega o estado desejado da central e religa sozinho quem deveria estar rodando, sem clique, respeitando backoff/degraded"
    - "Na recriação após reinício (com tokensConhecidos vazio), o worker sobe com o refresh token mais recente buscado da central, não com um token velho"
    - "Clicar Iniciar/Parar no painel atualiza o estado desejado na central"
  artifacts:
    - path: "apps/central-api/prisma/schema.prisma"
      provides: "Account.desiredRunning Boolean @default(false) e Account.autoplayConfig Json? (migration)"
    - path: "apps/central-api/src/accounts/routes.ts"
      provides: "PUT /accounts/:id/desired-state {running} e desiredRunning incluído em GET /accounts e GET /accounts/:id/credentials"
    - path: "apps/control-plane/src/supervisor/supervisor.ts"
      provides: "persistência do desired na central + reconciliação no boot (seed de estados antes do primeiro poll)"
  key_links:
    - from: "apps/control-plane/src/app.ts"
      to: "apps/control-plane/src/supervisor/supervisor.ts"
      via: "reconciliarDoBoot() carrega desiredRunning da central no startup, antes do poll"
    - from: "apps/control-plane/src/supervisor/supervisor.ts"
      to: "apps/central-api/src/accounts/routes.ts"
      via: "repasse PUT /accounts/:id/desired-state ao desireRunning/desireStopped; GET na reconciliação"
---

<objective>
Persistir o estado desejado dos workers na central e reconciliá-lo no boot, para
as contas voltarem sozinhas após reinício do control-plane (inclusive auto-update)
e reboot do Docker, com os tokens mais recentes (SUP-01, SUP-02). Também adiciona
a coluna `autoplayConfig Json?` (consumida pelos Plans 02/03/04) na mesma migration
para evitar churn de schema. Nenhuma mudança em `packages/worker/src/game/` — fatia
independente da Fase 1.
</objective>

<context>
- `.planning/phases/02-autoplay/RESEARCH.md` — contrato compartilhado (campos, endpoints) e pitfalls. LER PRIMEIRO.
- `.planning/phases/02-autoplay/02-CONTEXT.md` — D-24/D-25/D-26.
- `apps/central-api/prisma/schema.prisma` — `model Account` atual.
- `apps/central-api/src/accounts/routes.ts` — CRUD + `PUT /accounts/:id/tokens` + `GET /accounts/:id/credentials` (padrão `registerAccountRoutes`).
- `apps/control-plane/src/supervisor/supervisor.ts` — `estados` em memória, `desireRunning/desireStopped`, `poll()`, `tokensConhecidos`, backoff/degraded.
- `apps/control-plane/src/workers/routes.ts` (`setOnTokensRenovados`, ~l.32-48) — PADRÃO de fetch autenticado interno à central (não via `FastifyReply`). O supervisor deve ganhar um fetch próprio nesse molde; `repasse.ts` (baseado em `FastifyReply`) NÃO serve para chamadas internas.
- `apps/control-plane/src/session/store.ts` — sessão persistida (grace offline) usada para autenticar na central no boot.
- `apps/control-plane/src/workers/routes.ts` — `iniciarWorker`/`montarEnv`, chama `GET /accounts/:id/credentials`.
- `apps/control-plane/src/update/manager.ts` — `pausar()/retomar()` do supervisor durante update (evitar corrida na reconciliação).
</context>

<tasks>
<task type="auto">
  <name>Task 1: Schema + migration (desiredRunning, autoplayConfig)</name>
  <files>apps/central-api/prisma/schema.prisma, apps/central-api/prisma/migrations/</files>
  <action>
Adicionar a `model Account`: `desiredRunning Boolean @default(false)` e
`autoplayConfig Json?`. Gerar migration (`prisma migrate dev --name
account_desired_e_autoplay`). Não alterar colunas existentes.
  </action>
  <verify>pnpm --filter central-api exec prisma validate && pnpm --filter central-api exec prisma generate</verify>
  <done>Schema válido, client gerado, migration criada sem tocar colunas antigas.</done>
</task>

<task type="auto">
  <name>Task 2: Endpoints de estado desejado na central</name>
  <files>apps/central-api/src/accounts/routes.ts, apps/central-api/src/accounts/accounts.test.ts</files>
  <action>
Em `registerAccountRoutes`: adicionar `PUT /accounts/:id/desired-state` (body
`{running: boolean}`, escopo do dono da conta, grava `desiredRunning`). Incluir
`desiredRunning` e `autoplayConfig` no mapper `publico()` da conta (o que
alimenta `GET /accounts` — NÃO existe `GET /accounts/:id` singular; o front
lista e filtra). Incluir também em
`GET /accounts/:id/credentials` (bruto, sem defaults). Manter 404 para conta de outro usuário (padrão
multi-tenant atual). Testes: PUT grava e GET reflete; isolamento por usuário.
  </action>
  <verify>pnpm --filter central-api test</verify>
  <done>Suíte verde com os novos testes; rotas existentes intactas.</done>
</task>

<task type="auto">
  <name>Task 3: Control-plane grava o desejado na central</name>
  <files>apps/control-plane/src/supervisor/supervisor.ts, apps/control-plane/src/app.ts, apps/control-plane/src/supervisor/supervisor.test.ts</files>
  <action>
Injetar `sessionStore` + `centralApiUrl` no construtor do `Supervisor` (via
`app.ts`) e criar nele um fetch autenticado próprio à central (molde do
`setOnTokensRenovados` em `workers/routes.ts`, usando `SessionStore.getAccessToken`
— NÃO usar `repasse.ts`/`FastifyReply`). Fazer `desireRunning(id)`/`desireStopped(id)`
persistirem o desejado via `PUT /accounts/:id/desired-state` (idempotente,
tolerante a falha transitória — logar e seguir; fonte de verdade é a central).
Teste: ao desireRunning/Stopped, o PUT é chamado com o valor certo.
  </action>
  <verify>pnpm --filter control-plane test</verify>
  <done>Supervisor persiste desired na central com fetch próprio; suíte verde.</done>
</task>

<task type="auto">
  <name>Task 4: Reconciliação no boot</name>
  <files>apps/control-plane/src/supervisor/supervisor.ts, apps/control-plane/src/app.ts, apps/control-plane/src/supervisor/supervisor.test.ts</files>
  <action>
Adicionar `reconciliarDoBoot()` no supervisor: usando a sessão persistida
(`session/store.ts`) para autenticar na central, listar as contas do usuário com
`desiredRunning`, e semear `estados` (desired=running/stopped) ANTES do primeiro
`poll()`. Chamar em `app.ts` no startup, depois de montar orchestrator/central e
antes/junto de iniciar o loop de poll; não religar durante uma janela de update
(respeitar `pausar/retomar` do manager). Sem sessão válida (offline), apenas
logar e seguir (reconcilia quando a sessão voltar). Teste: com desired=running na
central, o estado é semeado e o poll religa; com stopped, não religa.
  </action>
  <verify>pnpm --filter control-plane test</verify>
  <done>Boot semeia estados e religa quem era running, sem clique; suíte verde.</done>
</task>

<task type="auto">
  <name>Task 5: Tokens frescos da central na recriação (SUP-02)</name>
  <files>apps/control-plane/src/supervisor/supervisor.ts, apps/control-plane/src/orchestrator/recriar.ts, apps/control-plane/src/supervisor/supervisor.test.ts</files>
  <action>
No cold start, `tokensConhecidos` está vazio e o único caminho que o `poll()`
aciona é `supervisor.reiniciar`→`startWorker` — que reusa o env ANTIGO do
container (token velho) e, se o container foi REMOVIDO, nem recria (o criar-do-zero
hoje só vive em `iniciarWorker` atrás de request HTTP). Portanto: fazer o
supervisor buscar credenciais frescas da central (`GET /accounts/:id/credentials`,
via o fetch próprio da Task 3) e recriar o container ausente/parado com essas
credenciais (usando `configDeRecriacao`/`envComTokens` de `recriar.ts`) dentro do
próprio supervisor — NÃO em `iniciarWorker`, que o poll autônomo nunca chama.
Teste: cold start (sem tokensConhecidos, container removido) → recriação usa os
tokens vindos da central.
  </action>
  <verify>pnpm --filter control-plane test</verify>
  <done>Worker recriado pelo supervisor sobe com o refresh token mais recente da central; suíte verde.</done>
</task>
</tasks>

<verification>
- `pnpm --filter central-api test` e `pnpm --filter control-plane test` verdes.
- `tsc --noEmit` nos dois pacotes limpo.
- Cenário manual (smoke): subir control-plane, marcar uma conta como running,
  reiniciar o control-plane → a conta volta a running sozinha; forçar cold start
  → recriação busca tokens da central.
</verification>

<success_criteria>
- SUP-01: estado desejado na central; reconciliação no boot religa sem clique.
- SUP-02: recriação usa o refresh token mais recente da central.
- Nenhuma mudança em `packages/worker/src/game/`. Commits conventional PT-BR na branch.
</success_criteria>
