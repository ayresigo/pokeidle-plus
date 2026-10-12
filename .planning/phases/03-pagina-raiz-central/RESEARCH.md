---
phase: 03-pagina-raiz-central
type: research
requirements: [ROOT-01, ROOT-02, ROOT-03]
---

<summary>
A central (`apps/central-api`) é um Fastify 5 + Prisma. Hoje `GET /` cai no
handler 404 padrão do Fastify (JSON `{"message":"Route GET:/ not found",...}`),
porque só existem `/health` e as rotas autenticadas (`/auth/*`, `/accounts*`,
`/version`, `/admin/*`). A Fase 3 adiciona uma rota pública `GET /` que devolve
200 com uma página HTML leve em PT-BR explicando o que é o PokeIdle Plus e como
começar, apontando para o README do GitHub. Sem dependência nova: a HTML é uma
string servida com `reply.type(...).send(...)`.
</summary>

<findings>

### Como as rotas são montadas
`apps/central-api/src/app.ts` monta o Fastify e registra `/health` direto no
root, depois chama `registerAuthRoutes`, `registerAccountRoutes`,
`registerReleaseRoutes`, `registerUserRoutes`. As rotas protegidas vivem dentro
de `app.register(async (escopo) => { escopo.addHook("preHandler", requireAuth); ... })`
(ver `releases/routes.ts`). Logo, uma rota pública é registrada **fora** desses
escopos autenticados — basta um `app.get("/")` no root, como `/health`.

### Convenção de módulos
Cada feature é uma pasta em `src/<feature>/` com `routes.ts` exportando
`registerXRoutes(app, prisma)` e um teste co-localizado `<feature>.test.ts`.
A rota raiz não usa Prisma; o registrador recebe só `app`.

### Content-type / HTML no Fastify 5
Fastify infere `application/json` por padrão. Para HTML:
`reply.type("text/html; charset=utf-8").send(html)`. Nenhum plugin novo.

### Testes
Vitest com `fileParallelism: false` e `setupFiles: ./src/test-setup.ts`.
O setup carrega `.env` e exige `DATABASE_URL` terminando em `_dev`/`_test`
(as tabelas são apagadas nos testes). O teste de `GET /` segue o padrão de
`app.test.ts`: `buildApp()` + `app.inject(...)`, sem tocar no banco. Variáveis
`JWT_SECRET`/`SECRETS_KEY` precisam estar definidas antes de importar `app.js`
(ver topo de `app.test.ts`), porque `buildApp()` chama `requireJwtSecret()` e
`initSecrets()`.

### Dados sensíveis
A página é estática e pública: nada de versão com digest, contagem de usuários,
contas, segredos. Só texto institucional + link para o repositório
`https://github.com/ayresigo/pokeidle-plus`.
</findings>

<pitfalls>
- Registrar `GET /` dentro de um escopo com `requireAuth` quebraria ROOT-02
  (raiz precisa ser pública). Registrar no root, junto de `/health`.
- Não alterar o handler 404 global: as rotas desconhecidas devem continuar 404.
- O teste não deve depender do banco (não há DB no `app.inject` de `/`), mas o
  `test-setup` ainda roda; `DATABASE_URL` precisa existir e terminar em `_dev`.
</pitfalls>

<decisions>
- **Formato:** HTML leve inline (preferência explícita do usuário na tarefa),
  sem dependência nova, sem template engine.
- **Conteúdo:** o que é o PokeIdle Plus, aviso de ToS, como instalar (resumo) e
  link para o README/repositório do GitHub. Nenhum dado dinâmico ou sensível.
</decisions>
