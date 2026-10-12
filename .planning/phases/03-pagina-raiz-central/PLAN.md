---
phase: 03-pagina-raiz-central
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/central-api/src/root/routes.ts
  - apps/central-api/src/root/root.test.ts
  - apps/central-api/src/app.ts
autonomous: true
requirements: [ROOT-01, ROOT-02]
must_haves:
  truths:
    - "Quem abre GET / recebe 200 com uma página HTML em PT-BR que explica o que é o PokeIdle Plus e como começar"
    - "A página aponta para o README/repositório do GitHub"
    - "A raiz é pública (sem auth) e não mostra dados de usuários, contas, releases nem segredos"
    - "/health, /auth/*, /accounts*, /version e /admin/* mantêm o comportamento; rotas desconhecidas seguem 404"
  artifacts:
    - path: "apps/central-api/src/root/routes.ts"
      provides: "registerRootRoute(app): GET / servindo a página HTML estática"
    - path: "apps/central-api/src/root/root.test.ts"
      provides: "Teste de GET / (200, content-type text/html, conteúdo útil, sem dados sensíveis)"
  key_links:
    - from: "apps/central-api/src/app.ts"
      to: "apps/central-api/src/root/routes.ts"
      via: "registerRootRoute(app) no root, fora dos escopos autenticados"
---

<objective>
Substituir o 404 JSON padrão do Fastify em `GET /` por uma página HTML pública e
leve, em PT-BR, que explica o que é o PokeIdle Plus e como instalar, apontando
para o README do GitHub. Sem dependência nova e sem expor dados sensíveis.
Fecha ROOT-01 e ROOT-02. ROOT-03 (release + deploy no tcgreaper) fica com o
coordenador/usuário e está fora do escopo deste worktree.
</objective>

<context>
- `apps/central-api/src/app.ts` — monta o Fastify e registra `/health` + rotas.
- `apps/central-api/src/releases/routes.ts` — padrão de módulo `registerXRoutes`.
- `apps/central-api/src/app.test.ts` — padrão de teste com `buildApp()` + `inject`.
- `README.md` — texto de referência (o que é, pré-requisitos, como subir).
- Repositório: https://github.com/ayresigo/pokeidle-plus
</context>

<tasks>
<task type="auto">
  <name>Task 1: Rota raiz com página HTML</name>
  <files>apps/central-api/src/root/routes.ts, apps/central-api/src/app.ts</files>
  <action>
Criar `src/root/routes.ts` exportando `registerRootRoute(app: FastifyInstance): void`
que registra `app.get("/", ...)` devolvendo
`reply.type("text/html; charset=utf-8").send(PAGINA)`, onde `PAGINA` é uma
constante com a página HTML em PT-BR (`lang="pt-BR"`, charset utf-8, viewport):
título, uma linha do que é o PokeIdle Plus, aviso de ToS, passos resumidos de
instalação e link para `https://github.com/ayresigo/pokeidle-plus`. Sem nenhum
dado dinâmico (versão/digest, contagem de usuários, contas, segredos).
Em `app.ts`, importar e chamar `registerRootRoute(app)` no root (junto de
`/health`), fora dos escopos com `requireAuth`.
  </action>
  <verify>pnpm --filter central-api exec tsc -p tsconfig.json --noEmit</verify>
  <done>`GET /` responde 200 text/html; tsc limpo; nenhuma rota existente alterada.</done>
</task>

<task type="auto">
  <name>Task 2: Teste de GET /</name>
  <files>apps/central-api/src/root/root.test.ts</files>
  <action>
Teste Vitest no padrão de `app.test.ts` (definir JWT_SECRET/SECRETS_KEY antes de
importar `app.js`, `buildApp()` + `app.inject({ method: "GET", url: "/" })`):
asserts de statusCode 200, `content-type` começando com `text/html`, corpo
contendo "PokeIdle Plus" e o link do GitHub, e que o corpo NÃO contém marcadores
de dados sensíveis (ex.: sem "imageDigest", sem "passwordHash"). Opcional: um
assert de que uma rota desconhecida segue 404.
  </action>
  <verify>pnpm --filter central-api test</verify>
  <done>Suíte verde, com o novo teste de GET / passando.</done>
</task>
</tasks>

<verification>
- `pnpm --filter central-api exec tsc -p tsconfig.json --noEmit` limpo.
- `pnpm --filter central-api test` verde (DATABASE_URL apontando para `*_dev`).
- `GET /` → 200 text/html; `GET /rota-inexistente` → 404.
</verification>

<success_criteria>
- ROOT-01: `GET /` devolve 200 com conteúdo útil em PT-BR (o que é + como começar).
- ROOT-02: raiz pública, sem dados sensíveis; rotas existentes inalteradas; testes verdes.
- Commits conventional em PT-BR na branch do worktree.
</success_criteria>
