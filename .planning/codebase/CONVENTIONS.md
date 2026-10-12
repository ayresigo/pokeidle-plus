# Coding Conventions

**Analysis Date:** 2026-10-12

Monorepo pnpm (`pnpm-workspace.yaml`: `apps/*`, `packages/*`, `e2e`). Todo o código é TypeScript `strict`. Os pacotes de backend (`apps/central-api`, `apps/control-plane`, `packages/worker`, `packages/updater`, `e2e`) são ESM (`"type": "module"`) e estendem `tsconfig.base.json` (`strict`, `ES2022`, `NodeNext`). `apps/web` é Next.js 16 com seu próprio `apps/web/tsconfig.json` (`moduleResolution: "bundler"`, alias `@/*`).

## Language Rule (read first)

- **Português (pt-BR) para o domínio e internals; inglês para nomes que espelham APIs externas ou contratos HTTP/Docker.** É o padrão dominante e deve ser mantido.
  - Português: funções internas (`emitirTokens`, `buscarCredenciais`, `montarEnv`, `iniciarWorker`, `pararWorker`, `calcularBackoff`, `mesclarContas`, `badgeDoStatus`), variáveis locais (`resposta`, `resultado`, `conta`, `erro`, `chamadas`), constantes (`TIMEOUT_DRENAGEM_MS`, `DRAIN_STOP_SEGUNDOS`, `PASSOS_BACKOFF`), tipos internos (`EstadoSupervisao`, `CredenciaisConta`, `ResultadoToken`), nomes de arquivo novos (`apps/control-plane/src/orchestrator/recriar.ts`, `apps/control-plane/src/central/repasse.ts`, `packages/updater/src/atualizar.ts`, `apps/web/lib/conta.ts`, `apps/web/lib/sessao.ts`).
  - Inglês: rotas e campos JSON (`/accounts/:id/credentials`, `accessToken`, `pokeidleUser`), métodos de interfaces de infraestrutura (`ContainerOrchestrator.createWorker/startWorker/listWorkers` em `apps/control-plane/src/orchestrator/types.ts`), funções de registro Fastify (`registerAuthRoutes`, `registerWorkerRoutes`), `buildApp`, `loadConfig`, `requireAuth`, `requireSession`.
  - Mensagens de erro, logs, nomes de teste e textos de UI: **sempre em pt-BR** (`{ error: "não autenticado" }`, `"central inalcançável"`, `it("retorna 401 sem sessão", ...)`).
- **Sem comentários no código.** Não há nenhum `//` nem `/** */` em `apps/*/src`, `packages/*/src`, `apps/web/{app,components,lib}` ou `e2e/*.ts`. Isso vem da convenção global registrada em `docs/plans/2026-10-11-multiacc-pokeidle-plan.md` ("sem comentários em linhas de código"). Nomes descritivos substituem comentários. Não adicione comentários.

## Naming Patterns

**Files:**
- Backend: arquivos minúsculos, uma palavra por responsabilidade, dentro de pastas por feature: `apps/control-plane/src/<feature>/{routes,store,manager,supervisor,guard,types}.ts`, `apps/central-api/src/<feature>/{routes,service,guard}.ts`.
- Teste ao lado do arquivo testado: `routes.ts` + `routes.test.ts`. Testes que cobrem a feature inteira usam o nome da feature: `apps/central-api/src/accounts/accounts.test.ts`, `apps/central-api/src/auth/auth.test.ts`.
- Teste unitário que convive com um teste de integração do mesmo módulo leva o sufixo `.unit.test.ts`: `apps/control-plane/src/orchestrator/orchestrator.unit.test.ts` (dockerode falso) ao lado de `orchestrator.test.ts` (Docker real).
- Entrypoints de processo: `server.ts` (apps Fastify), `index.ts` (`packages/worker/src/index.ts`), `main.ts` (`packages/updater/src/main.ts`).
- Web: componentes React em PascalCase em `apps/web/components/` (`AccountRow.tsx`, `Dashboard.tsx`, `UpdatePanel.tsx`); lógica pura em `apps/web/lib/` com nomes minúsculos (`api.ts`, `status.ts`, `conta.ts`, `usuario.ts`, `sse.ts`, `update.ts`).
- Next App Router: `page.tsx`, `layout.tsx`, `route.ts` em `apps/web/app/`; grupo de rotas autenticado `apps/web/app/(painel)/`.

**Functions:**
- camelCase. Funções exportadas de infraestrutura/contrato em inglês (`buildApp`, `registerXRoutes`, `loadConfig`, `startHealthServer`, `requireJwtSecret`); funções de domínio em português (`criarAuthManager`, `criarGameClient`, `atualizar`, `planejarRecriacao`, `validarConta`, `formatarUptime`).
- Fábricas usam o prefixo `criar*` (`criarFetch`, `criarDispatcher`, `criarAcoes`, `criarGameClient`); leitores defensivos usam `ler*` (`lerJson`, `lerPerfil`, `lerExpiracao`, `lerMensagemDeErro`).
- Predicados retornando boolean: `estaRodando`, `ehRegistro`, `hostPermitido`, `origemPermitida`, `containerExiste`.

**Variables:**
- camelCase, em português para estado local (`resposta`, `resultado`, `atualizado`, `removido`, `salvo`, `encerrando`).
- Constantes de módulo em SCREAMING_SNAKE_CASE, **com unidade no sufixo**: `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_MS`, `GRACE_MS`, `MARGEM_EXPIRACAO_MS`, `TIMEOUT_DRENAGEM_MS`, `DRAIN_STOP_SEGUNDOS`, `STOP_TIMEOUT_SEGUNDOS`.
- Números longos com separador: `10_000`, `900_000`, `180_000`.
- Respostas de erro reutilizadas viram constantes: `const ERRO_CREDENCIAIS = { error: "credenciais inválidas" };` (`apps/central-api/src/auth/routes.ts`), `const ERRO_NAO_ENCONTRADA = { error: "conta não encontrada" };` (`apps/central-api/src/accounts/routes.ts`).
- Labels/nomes Docker como constantes exportadas: `LABEL_MANAGED = "mpw.managed"`, `LABEL_ACCOUNT = "mpw.account-id"`, `NOME_UPDATER = "mpw-updater"` (`apps/control-plane/src/orchestrator/orchestrator.ts`), `LABEL_ROLE = "mpw.role"` (`packages/updater/src/atualizar.ts`).

**Types:**
- `interface` para formas de objeto; `type` para uniões, aliases e callbacks.
- PascalCase. Contratos exportados em inglês quando refletem payloads/APIs (`WorkerConfig`, `WorkerStatus`, `TokenPair`, `WorkerSnapshot`, `UpdateStatus`); tipos de domínio em português (`ResultadoToken`, `EstadoJogo`, `MotivoEncerramento`, `LinhaConta`, `TomBadge`, `OpcoesAtualizacao`, `MotorDocker`).
- Dependências injetadas em rotas: `interface XDeps` (`WorkersDeps` em `apps/control-plane/src/workers/routes.ts`); opções: `XOpts`/`OpcoesX` (`BuildAppOpts`, `RequireSessionOpts`, `OpcoesClient`, `OpcoesAtualizacao`).
- Uniões de string literal para estados: `type DesiredState = "running" | "stopped"`, `type FaseJogo = "booting" | "authenticating" | "in-game" | "needs-login" | "error"` (`apps/web/lib/api.ts`).
- Uniões discriminadas para resultados: `ResultadoToken = { token: string; offline: false } | { token: null; offline: boolean }` (`apps/control-plane/src/session/store.ts`); `ResultadoAuth` com `ok` (`packages/worker/src/auth/provider.ts`).
- `Record<K, V>` como lookup estático no lugar de `switch` para mapeamentos: `CLASSE_TOM: Record<TomBadge, string>` (`apps/web/components/AccountRow.tsx`), `FECHAMENTOS_TERMINAIS: Record<number, MotivoEncerramento>` (`packages/worker/src/game/client.ts`).
- Augmentation de Fastify via `declare module "fastify"` no arquivo do guard (`apps/central-api/src/auth/guard.ts`, `apps/control-plane/src/auth/guard.ts`).

## Code Style

**Formatting:**
- Nenhum formatter configurado (sem `.prettierrc`, `biome.json` ou `.editorconfig`). Siga o estilo observado manualmente:
  - Aspas duplas; ponto e vírgula sempre; indentação de 2 espaços.
  - Vírgula final em literais, parâmetros e argumentos multilinha.
  - Linhas até ~100–120 colunas; quebre chamadas longas com um argumento por linha.
  - `if` de uma linha sem chaves é aceito para guard clauses curtas (`if (!worker) return;`, `if (erro.statusCode !== 304) throw erro;`).
  - Objetos de schema JSON Fastify terminam com `as const`.

**Linting:**
- Só `apps/web` tem ESLint: `apps/web/eslint.config.mjs` (flat config com `eslint-config-next/core-web-vitals` + `eslint-config-next/typescript`). Rodar: `pnpm --filter web lint`.
- Backend não tem linter; a barreira é `tsc --noEmit` em `strict` (CI: `.github/workflows/ci.yml`, passo "Typecheck").
- Não há `any`, `@ts-ignore`, `@ts-expect-error` nem `eslint-disable` no código. Use `unknown` + narrowing; casts só via `as` pontual em fronteiras (JSON parse, `as unknown as Docker` em fakes de teste).

## Import Organization

**Order:**
1. Built-ins Node com prefixo `node:` (`import { createHash } from "node:crypto";`, `import path from "node:path";`).
2. Pacotes externos (`fastify`, `@prisma/client`, `dockerode`, `undici`, `vitest`).
3. Imports relativos, em ordem alfabética de caminho (ver `apps/control-plane/src/app.ts`).

**Regras:**
- Pacotes Node ESM (`NodeNext`): imports relativos **com extensão `.js`** (`import { buildApp } from "./app.js";`).
- `e2e/`: imports relativos **com extensão `.ts`** (`allowImportingTsExtensions`, `verbatimModuleSyntax`, `erasableSyntaxOnly` em `e2e/tsconfig.json`), ex.: `import { ADMIN } from "./ambiente.ts";`. Não use `enum` nem parameter properties em `e2e/`.
- `apps/web`: imports sem extensão; use o alias `@/` entre pastas (`import { apiFetch } from "@/lib/api";`) e relativo dentro de `lib/` (`import type { Account } from "./api";`).
- Tipos: `import type { X } from "..."` quando o import inteiro é de tipo; `type` inline quando misturado (`import { criarAuthManager, type ResultadoAuth } from "./auth/provider.js";`).

**Path Aliases:**
- `@/*` → `apps/web/*` (somente web). Backends não usam aliases.

## Error Handling

**Patterns:**
- **Fail-fast de configuração no boot.** Valide env antes de servir e lance `Error` com mensagem pt-BR clara:
  ```typescript
  export function requireJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET não definido no ambiente");
    }
    if (secret.length < JWT_SECRET_MINIMO) {
      throw new Error(`JWT_SECRET precisa ter pelo menos ${JWT_SECRET_MINIMO} caracteres`);
    }
    return secret;
  }
  ```
  (`apps/central-api/src/auth/service.ts`; idem `initSecrets()` em `apps/central-api/src/crypto/secrets.ts`, chamados no topo de `buildApp()`.) No worker, `loadConfig` acumula todos os problemas e lança um `ConfigError` com a lista (`packages/worker/src/config.ts`); `index.ts` imprime a mensagem e sai com `process.exit(1)`.
- **Classes de erro tipadas para ramificar status HTTP.** Subclasses vazias ou com `name` setado; a rota traduz com `instanceof`:
  ```typescript
  } catch (err) {
    if (err instanceof ErroCredenciaisInvalidas) {
      return reply.code(401).send({ error: "credenciais inválidas" });
    }
    if (err instanceof ErroCentralInalcancavel) {
      return reply.code(503).send({ error: "central inalcançável" });
    }
    request.log.error("falha inesperada no login");
    return reply.code(502).send({ error: "falha no login" });
  }
  ```
  (`apps/control-plane/src/session/routes.ts`). Nomenclatura difere por pacote — siga a do pacote onde você está:
  - `apps/control-plane`: prefixo `Erro*` (`ErroCredenciais`, `ErroCredenciaisInvalidas`, `ErroCentralInalcancavel`).
  - `packages/worker`, `apps/web`: sufixo `*Error` com `this.name` definido (`ConfigError`, `AuthIndisponivelError`, `AuthAdiadaError`, `LoginError`, `ApiError`).
- **Falha esperada de domínio retorna `null`, não exceção:** `login`/`refresh` em `apps/central-api/src/auth/service.ts` retornam `TokenPair | null`; a rota converte `null` em 401.
- **Contrato de erro HTTP:** todo erro sai como `reply.code(N).send({ error: "<mensagem pt-BR>" })`. Códigos usados: 400 (schema), 401 (sem sessão/credencial), 403 (não-admin), 404 (não encontrado / de outro tenant), 409 (duplicata/último admin), 500 (descriptografia), 502 (falha upstream: central/orquestrador), 503 (central inalcançável em modo grace). Sucesso sem corpo: `reply.code(204).send()`.
- **Mensagens de erro nunca carregam segredos.** Respostas genéricas para falhas internas (`"falha ao criar ou iniciar worker no orquestrador"`); o worker mascara segredos com `ocultarSegredos(texto, segredos)` (`packages/worker/src/auth/provider.ts`). Testes verificam que senhas/tokens não aparecem no corpo.
- **Isolamento multi-tenant via `updateMany/deleteMany` com `{ id, userId }`** e `count === 0` → 404, em vez de buscar-e-checar (`apps/central-api/src/accounts/routes.ts`).
- **Erros do Prisma:** capture só o código conhecido e relance o resto:
  ```typescript
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return reply.code(409).send({ error: "nome de usuário já está em uso" });
  }
  throw err;
  ```
  (`apps/central-api/src/users/routes.ts`).
- **Tolerância a códigos Docker idempotentes** com `.catch` que só engole o status esperado (`apps/control-plane/src/orchestrator/orchestrator.ts`):
  ```typescript
  .catch((erro: { statusCode?: number }) => {
    if (erro.statusCode !== 304 && erro.statusCode !== 404) throw erro;
  });
  ```
- **Normalização de `unknown`:** `err instanceof Error ? err.message : String(err)` (ou helper `mensagemDeErro` em `packages/updater/src/atualizar.ts`).
- **Best-effort explícito:** `catch {}` vazio só onde a falha é irrelevante (logout no central em `apps/control-plane/src/session/store.ts`, `process.loadEnvFile(".env")` nos `server.ts`). `.catch(() => {})` para limpeza.
- **Promises fire-and-forget** são marcadas com `void` (`void sessionStore.atualizarPerfil();`, `setInterval(() => void this.poll(), ...)`).
- **Single-flight** para operações concorrentes: `this.refreshEmAndamento ??= this.renovar().finally(() => { this.refreshEmAndamento = null; });` (`apps/control-plane/src/session/store.ts`).
- Web: `apiFetch` lança `ApiError(status, mensagem)` lendo `{ error }` do corpo; componentes exibem `falha instanceof ApiError ? falha.message : "control-plane inalcançável"` (`apps/web/lib/api.ts`, `apps/web/components/AccountRow.tsx`).

## Logging

**Framework:** `console` nos processos sem Fastify; logger do Fastify (`request.log`/`app.log`) nas rotas.

**Patterns:**
- `apps/central-api/src/app.ts` e `apps/control-plane/src/app.ts` criam `Fastify()` **sem a opção `logger`**, então `request.log.*`/`app.log.*` não emitem nada por padrão [INFERENCE: comportamento padrão do Fastify com `logger` ausente]. Mantenha as chamadas `request.log.error({ accountId }, "falha ao iniciar worker")` como estão; para ver logs seria preciso habilitar `logger` no `buildApp`.
- Ao logar em rotas, passe contexto estruturado não sensível (`{ accountId }`), nunca o erro com env/credenciais (`apps/control-plane/src/workers/routes.ts` deliberadamente não loga `err`).
- Worker: `console.log`/`console.error` com prefixo `worker ${config.accountId}: ...` (`packages/worker/src/index.ts`) — esses logs são lidos pelo SSE de logs da UI e pelo E2E (`"worker <id>: autenticado via stored"`).
- Updater: prefixo `[updater] ` e logger injetável `opts.log` (`packages/updater/src/atualizar.ts`).
- Fake game do E2E: prefixo `fake-game: ` (`e2e/fake-game/server.ts`).
- Mensagens de log em pt-BR.

## Comments

**When to Comment:**
- Nunca. Não há comentários de linha nem blocos no código-fonte nem nos testes. Expresse intenção via nomes de função/constante e nomes de teste descritivos.

**JSDoc/TSDoc:**
- Não utilizado.

## Function Design

**Size:** Funções curtas e focadas; módulos grandes concentram-se em classes com estado (`packages/worker/src/game/client.ts` 611 linhas, `apps/control-plane/src/update/manager.ts` 424, `apps/control-plane/src/supervisor/supervisor.ts` 296). Helpers privados ficam no escopo do módulo ou como funções internas da função `registerXRoutes` (closures sobre `deps`, ex.: `buscarCredenciais`, `montarEnv`, `iniciarWorker` em `apps/control-plane/src/workers/routes.ts`).

**Parameters:**
- Dependências explícitas por injeção, nunca singletons globais:
  - Rotas: `registerXRoutes(app: FastifyInstance, deps)` onde `deps` é um objeto tipado (`WorkersDeps`) ou o recurso direto (`prisma`, `sessionStore`).
  - Composition root: `buildApp(opts?: BuildAppOpts)` resolve `opts?.x ?? process.env.X ?? default` e instancia tudo (`apps/control-plane/src/app.ts`). Retorna `{ app, sessionStore, supervisor, updateManager }` para testes e `server.ts`.
  - Classes recebem colaboradores no construtor com parameter properties: `constructor(private readonly docker: Docker = new Docker(), private readonly network?: string) {}`.
  - Relógio, aleatoriedade, sleep, fetch e socket são injetáveis para teste: `HealthState(tokens, agora = () => Date.now())`, `runGameLoop(..., { random })`, `OpcoesClient.fetch/criarSocket/random`, `OpcoesAtualizacao.dormir/agora/log`, `DependenciasSolver.sleep`.
- Mais de 3 parâmetros → objeto de opções (`drenar({ loop, client, auth, server, timeoutMs })`).
- `Pick<WorkerConfig, ...>` para declarar só o subconjunto de config que a unidade usa (`packages/worker/src/auth/provider.ts`).

**Return Values:**
- Tipos de retorno explícitos em funções exportadas e métodos públicos (`Promise<void>`, `Promise<TokenPair | null>`).
- `null` (não `undefined`) para "ausente" em dados de domínio e respostas (`lastError: string | null`, `proxyUrl: string | null`); `undefined` reservado a campos opcionais de config/env (`WorkerConfig.accessToken: string | undefined`).
- Spread condicional para campos opcionais: `...(perfil !== null && { username: perfil.username })`.
- Respostas públicas passam por um mapeador que remove segredos (`publico(account)` em `apps/central-api/src/accounts/routes.ts`).

## Module Design

**Exports:**
- Somente named exports em código de backend e componentes web (`export function AccountRow`, `export class Supervisor`). `export default` apenas onde o framework exige: páginas/layouts Next (`apps/web/app/**/page.tsx`), configs (`vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`) e `globalSetup`/`globalTeardown` do Playwright.
- Route handlers Next exportam o mesmo handler sob vários verbos: `export { encaminhar as GET, encaminhar as POST, ... }` (`apps/web/app/cp/[...path]/route.ts`).
- Interfaces de porta para infraestrutura externa, com implementação concreta separada: `ContainerOrchestrator` (`apps/control-plane/src/orchestrator/types.ts`) ← `DockerOrchestrator`; `MotorDocker` (`packages/updater/src/atualizar.ts`) ← `motorDockerode` (`packages/updater/src/docker.ts`); `HttpFetch` (`packages/worker/src/http.ts`).

**Barrel Files:**
- Não utilizados. Importe diretamente do arquivo que define o símbolo.

## Framework-Specific Conventions

**Fastify (`apps/central-api`, `apps/control-plane`):**
- Uma função `registerXRoutes` por feature, chamada em `buildApp()`. `GET /health` registrado em `buildApp`.
- Validação por JSON Schema declarado como constante `as const` + generics de tipo na rota:
  ```typescript
  app.post<{ Body: LoginBody }>("/auth/login", { schema: schemaLogin }, async (request, reply) => { ... });
  ```
  `apps/central-api` desliga coerção (`ajv: { customOptions: { coerceTypes: false } }`); `apps/control-plane/src/session/routes.ts` usa `additionalProperties: false` e limites `minLength/maxLength`.
- Autenticação: `preHandler: requireAuth` / `requireAdmin` (central) ou `app.requireSession({ precisaCentral: true })` (control-plane). Para proteger um grupo, use `app.register(async (escopo) => { escopo.addHook("preHandler", requireAuth); ... })`.
- Limpeza de recursos em `app.addHook("onClose", ...)` (`prisma.$disconnect()`, `supervisor.stop()`).

**Prisma (`apps/central-api`):**
- `new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })`. Segredos persistidos como `Bytes` com sufixo `Enc` (`pokeidlePassEnc`) cifrados por `encrypt()` de `apps/central-api/src/crypto/secrets.ts`.

**React / Next (`apps/web`):**
- Componentes interativos começam com `"use client";`. Páginas são finas e delegam a um componente (`apps/web/app/(painel)/page.tsx` → `<Dashboard />`).
- Estado local com `useState`; efeitos com flag `ativo` para ignorar respostas após unmount (`apps/web/components/Dashboard.tsx`). Contexto de sessão via `use(SessaoContext)` (`apps/web/lib/sessao.ts`).
- Toda chamada HTTP passa por `apiFetch` (`apps/web/lib/api.ts`), que prefixa `/cp` e redireciona para `/login` em 401.
- Tailwind por classes inline; strings de classe repetidas viram constantes (`const BOTAO = "rounded border ..."`).
- Lógica de apresentação (badges, validação de formulário, parsing SSE) vive em funções puras em `apps/web/lib/` para ser testável sem DOM.
- Ler `apps/web/AGENTS.md`: a versão do Next tem APIs diferentes; consulte `node_modules/next/dist/docs/` antes de escrever código Next.

---

*Convention analysis: 2026-10-12*
