# Testing Patterns

**Analysis Date:** 2026-10-12

## Test Framework

**Runner:**
- Vitest `^3.0.0` (devDependency na raiz `package.json`; `apps/web/package.json` declara `vitest ^3` próprio). Lockfile resolve 3.2.x.
- Config por pacote:
  - `apps/central-api/vitest.config.ts`: `fileParallelism: false` + `setupFiles: ["./src/test-setup.ts"]` (todos os testes compartilham um Postgres real).
  - `apps/control-plane/vitest.config.ts`: `fileParallelism: false`.
  - `packages/worker`, `packages/updater`, `apps/web`: sem config — defaults do Vitest (ambiente `node`, arquivos `**/*.test.ts`).
- E2E: Playwright `@playwright/test ^1.64.0`, config `e2e/playwright.config.ts` (Chromium, `workers: 1`, `retries: 0`, `timeout: 180_000`, `expect.timeout: 60_000`, `locale: "pt-BR"`, trace/screenshot só em falha, artefatos em `e2e/.estado/resultados`).

**Assertion Library:**
- `expect` do Vitest (`toBe`, `toEqual`, `toMatchObject`, `toHaveBeenCalledWith`, `rejects.toThrow`, `rejects.toBeInstanceOf`, `expect.poll`, `vi.waitFor`).
- `expect` do Playwright no E2E (`toBeVisible`, `toHaveURL`, `toHaveAttribute`, `expect.poll`, `expect(async () => ...).toPass()`).

**Run Commands:**
```bash
pnpm test                                                    # Todos os pacotes (pnpm -r test → vitest run em cada um)
pnpm --filter control-plane test                             # Um pacote
pnpm --filter worker exec vitest run src/game/loop.test.ts   # Um arquivo
pnpm --filter worker exec vitest                             # Watch mode
pnpm --filter central-api --filter control-plane --filter worker --filter updater exec tsc --noEmit -p tsconfig.json  # Typecheck (igual ao CI)
pnpm --filter web lint                                       # ESLint da web
pnpm e2e                                                     # Playwright (sobe Docker compose mpw-e2e)
pnpm --filter e2e e2e:down                                   # Derruba o ambiente E2E se interrompido
```
- Coverage: não configurado (sem `@vitest/coverage-*` instalado).

**Pré-requisitos por pacote:**
- `apps/central-api`: Postgres acessível em `DATABASE_URL`, com nome de banco terminando em `_dev` ou `_test` (guard em `apps/central-api/src/test-setup.ts`, que aborta a suíte caso contrário porque os testes apagam todas as tabelas). Rode `pnpm --filter central-api db:generate` e as migrações antes. O CI usa serviço `postgres:16` com banco `mpw_test` (`.github/workflows/ci.yml`). Banco local: `docker/docker-compose.dev.yml`.
- `apps/control-plane/src/orchestrator/orchestrator.test.ts`: Docker real; faz `describe.skipIf(!dockerDisponivel)` — sem daemon, os testes são pulados.
- E2E: Docker Desktop aberto, portas `3100–3102` livres, sem container `mpw-updater` de instalação real (README, seção "Rodar o E2E"). Variáveis `E2E_SKIP_BUILD=1` (reusa imagens `:e2e`) e `E2E_KEEP=1` (mantém ambiente).

## Test File Organization

**Location:**
- Co-localizados: `foo.ts` ↔ `foo.test.ts` no mesmo diretório.
- Exceções:
  - `apps/central-api/prisma/seed.test.ts` (ao lado de `prisma/seed.ts`).
  - E2E em pacote separado `e2e/` (`e2e/smoke.spec.ts` + helpers).

**Naming:**
- `*.test.ts` para Vitest. `*.spec.ts` só para Playwright (`e2e/smoke.spec.ts`; `testMatch: "smoke.spec.ts"`).
- Feature inteira de rotas da central: `<feature>.test.ts` (`apps/central-api/src/accounts/accounts.test.ts`, `auth/auth.test.ts`, `users/users.test.ts`, `releases/releases.test.ts`).
- Unitário com fake ao lado de integração real do mesmo módulo: `*.unit.test.ts` (`apps/control-plane/src/orchestrator/orchestrator.unit.test.ts`).

**Structure:**
```
apps/central-api/
├── vitest.config.ts
├── prisma/seed.test.ts
└── src/
    ├── test-setup.ts               # guard de banco *_dev/*_test
    ├── app.test.ts / prisma.test.ts
    └── <feature>/<feature>.test.ts # auth, accounts, users, releases, crypto/secrets
apps/control-plane/src/
├── app.test.ts
└── <feature>/{routes,store,manager,supervisor,guard,orchestrator}.test.ts
packages/worker/src/
├── {config,health,http}.test.ts
├── auth/{provider,refresh,solver}.test.ts
├── auth/__fixtures__/{jwt.ts,login.html,login-chunk.txt}
└── game/{client,loop}.test.ts
packages/updater/src/
├── {atualizar,recriacao}.test.ts
└── fixtures.ts                     # inspect Docker realista
apps/web/
├── lib/{api,conta,status,sse,update,usuario}.test.ts
└── app/cp/[...path]/route.test.ts
e2e/
├── playwright.config.ts, global-setup.ts, global-teardown.ts, down.ts
├── smoke.spec.ts, ambiente.ts, docker.ts, docker-compose.e2e.yml
└── fake-game/{server.ts,token.ts}
```
- Volume: 38 arquivos Vitest + 1 spec Playwright, ~538 casos `it`/`test` (contagem por regex), ~9.800 linhas de teste para ~8.200 linhas de código.

## Test Structure

**Suite Organization:**
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";

describe("rotas de workers", () => {
  let dir: string;
  let app: FastifyInstance;
  let orchestrator: OrchestratorFake;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "workers-routes-test-"));
    orchestrator = criarOrchestratorFake();
    const built = buildApp({
      dataDir: dir,
      centralApiUrl: "http://central.test",
      orchestrator,
      gameUrl: "https://jogo.test",
      controlPlaneUrl: "http://cp.test:4000",
    });
    app = built.app;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await app.close();
  });

  describe("POST /workers/:accountId/start", () => {
    it("monta env completa, cria e inicia worker e marca desireRunning", async () => {
      // arrange: sessão + stub do central; act: app.inject; assert: fake + resposta
    });
  });
});
```
(`apps/control-plane/src/workers/routes.test.ts`.)

**Patterns:**
- **Nomes de teste em pt-BR**, descrevendo comportamento e resultado: `"retorna 503 em grace (precisaCentral)"`, `"PATCH em conta já deletada retorna 404 sem erro 500"`. `describe` por unidade (`"loadConfig"`, `"Supervisor"`) ou por rota (`"POST /accounts"`, `"GET /accounts/:id/credentials"`).
- **Rotas Fastify testadas via `app.inject`** sem abrir porta. Exceção: SSE precisa de socket real — `apps/control-plane/src/stream/routes.test.ts` faz `app.listen({ port: 0, host: "127.0.0.1" })` e lê com `fetch` + `AbortController`.
- **Composition root nos testes:** use `buildApp(opts)` com dependências falsas e `dataDir` em `mkdtemp`, em vez de montar Fastify à mão (`apps/control-plane/src/*/routes.test.ts`, `apps/control-plane/src/app.test.ts`).
- **Setup da central (Postgres real):** cada arquivo cria seu `PrismaClient`, define env mínima **antes** de importar `buildApp`, limpa o banco em `beforeEach` e fecha tudo em `afterAll`:
  ```typescript
  try {
    process.loadEnvFile(".env");
  } catch {
  }

  process.env.JWT_SECRET ??= "segredo-teste-auth-com-32-caracteres-no-minimo";
  process.env.SECRETS_KEY ??= "0".repeat(64);

  import { buildApp } from "../app.js";

  const app = buildApp();

  describe("accounts", () => {
    beforeEach(limparBanco);
    afterAll(async () => {
      await limparBanco();
      await app.close();
      await prisma.$disconnect();
    });
  });
  ```
  (`apps/central-api/src/accounts/accounts.test.ts`). `limparBanco` apaga em ordem de FK: `refreshToken` → `account` → `release` → `user`.
- **Teardown:** `vi.unstubAllGlobals()`, `vi.unstubAllEnvs()`, `vi.useRealTimers()`, `app.close()`, `supervisor.stop()`, fechar servidores (`servidor?.close()`) sempre em `afterEach`/`afterAll`. Variáveis de módulo resetadas para `null` após fechar.
- **Assertions de segurança obrigatórias** em rotas que lidam com segredos: serializar a resposta e garantir que nenhum segredo aparece:
  ```typescript
  for (const segredo of ["senha-super-secreta", "token-jogo-a", "token-jogo-r", "chave-solver-x", "proxy:8080"]) {
    expect(resposta.body).not.toContain(segredo);
  }
  ```
  (`apps/control-plane/src/workers/routes.test.ts`, `apps/central-api/src/accounts/accounts.test.ts`). Faça o mesmo em qualquer rota nova que toque credenciais.
- **Ordem de efeitos colaterais** é verificada registrando eventos no fake (`fake.eventos`, `fake.chamadas`, `ordemChamadas`) e comparando com `toEqual([...])`.
- **Multi-tenant:** cada rota da central tem caso "conta de outro user retorna 404" (`describe("isolamento multi-tenant")`).

## Mocking

**Framework:** Vitest (`vi.fn`, `vi.spyOn`, `vi.stubGlobal`, `vi.stubEnv`, `vi.useFakeTimers`, `vi.resetModules`). Não se usa `vi.mock` de módulos.

**Patterns:**

Fake de porta implementando a interface inteira (fake com estado + `vi.fn` para inspecionar chamadas):
```typescript
interface OrchestratorFake extends ContainerOrchestrator {
  workers: WorkerStatus[];
  criados: WorkerConfig[];
  ordemChamadas: string[];
}

function criarOrchestratorFake(): OrchestratorFake {
  const fake: OrchestratorFake = {
    workers: [],
    criados: [],
    ordemChamadas: [],
    createWorker: vi.fn(async (cfg: WorkerConfig) => {
      fake.criados.push(cfg);
      fake.ordemChamadas.push("createWorker");
      return `container-${fake.criados.length}`;
    }),
    listWorkers: vi.fn(async () => fake.workers),
    // ...todos os outros métodos de ContainerOrchestrator
  };
  return fake;
}
```
(`apps/control-plane/src/workers/routes.test.ts`; variante em classe `FakeOrchestrator implements ContainerOrchestrator` com flags `falharStart`/`falharCreate`/`manterCaido` em `apps/control-plane/src/supervisor/supervisor.test.ts`.)

Stub de `fetch` global roteando por URL e falhando alto em URL inesperada:
```typescript
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    chamadas.push({ url: u, init });
    if (u.endsWith("/credentials")) {
      return new Response(JSON.stringify(CREDENCIAIS_COMPLETAS), { status: 200 });
    }
    if (u.endsWith("/tokens") && init?.method === "PUT") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`url inesperada no stub: ${u}`);
  }),
);
```
Para simular central fora do ar: `vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))`. Quando o teste também faz requisições reais ao servidor local, delegue `127.0.0.1` ao `fetch` original (`apps/control-plane/src/stream/routes.test.ts`).

Fake de SDK de terceiro com cast duplo (só os métodos usados):
```typescript
fake.docker = {
  async createContainer(opcoes: Docker.ContainerCreateOptions) { ... },
  async pull(ref: string) { ... },
  modem: { followProgress(_stream: unknown, concluir: (erro: Error | null) => void) { concluir(null); } },
  getContainer(nome: string) { return { async inspect() { ... }, async remove() { ... } }; },
} as unknown as Docker;
```
(`apps/control-plane/src/orchestrator/orchestrator.unit.test.ts`; erros HTTP do Docker simulados com `Object.assign(new Error("HTTP 404"), { statusCode: 404 })`.)

Injeção de dependências em vez de mock de módulo (worker/updater):
```typescript
const fetchJogo: Mock<HttpFetch> = vi.fn<HttpFetch>(async (url) => rotas[url]?.() ?? new Response("not found", { status: 404 }));
new GameClient({ wsUrl, shards: 1, gameUrl, auth, health, fetch: fetchJogo, random: () => 0, reconexao: { baseMs: 20, tetoMs: 100 } });
```
(`packages/worker/src/game/client.test.ts`, `packages/worker/src/auth/provider.test.ts`; `MotorDocker` falso via `criarMotor(cenario)` em `packages/updater/src/atualizar.test.ts`.)

Env: `vi.stubEnv("CURRENT_VERSION", "")` + `vi.unstubAllEnvs()` em `afterEach` (`apps/control-plane/src/app.test.ts`, `apps/web/app/cp/[...path]/route.test.ts`). Testes que precisam reavaliar código de import-time (chave de criptografia, `JWT_SECRET`) salvam/restauram `process.env` manualmente e reimportam com `await import("./secrets.js")` ou `vi.resetModules()` (`apps/central-api/src/crypto/secrets.test.ts`, `apps/central-api/src/auth/auth.test.ts`).

Spy temporário com restauração em `finally`:
```typescript
const spy = vi.spyOn(argon2, "verify");
try {
  const res = await login("nao-existe", "qualquer");
  expect(spy).toHaveBeenCalled();
} finally {
  spy.mockRestore();
}
```

Tempo: `vi.useFakeTimers()` (ou `toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]` + `vi.setSystemTime(0)`) e avanço com `await vi.advanceTimersByTimeAsync(ms)` (`apps/control-plane/src/supervisor/supervisor.test.ts`, `packages/worker/src/game/loop.test.ts`). Prefira injetar `random`/`agora`/`dormir` quando a unidade aceita.

**What to Mock:**
- Fronteiras de rede e processo: `fetch` global (central, `/health` dos workers, jogo, 2captcha), Docker (`ContainerOrchestrator`, `MotorDocker`, `dockerode`), relógio, aleatoriedade, `window` no web (`vi.stubGlobal("window", { location: { pathname: "/", replace } })`).
- JWTs do control-plane/worker são fabricados sem assinatura (só o `exp` importa): `fabricarJwt(exp)` / `criarJwt(exp, sub)`.

**What NOT to Mock:**
- Postgres/Prisma na central: os testes usam banco real e `app.inject` ponta a ponta (inclui argon2 e AES-GCM reais).
- Sistema de arquivos: `SessionStore`/`UpdateManager` gravam de verdade em `mkdtemp(path.join(tmpdir(), "<nome>-test-"))`.
- WebSocket do jogo: `packages/worker/src/game/client.test.ts` sobe um `WebSocketServer` real (`ws`) em porta 0 (classe `ServidorJogo`).
- Servidor HTTP de health do worker: `startHealthServer(estado, 0, "127.0.0.1")` real (`packages/worker/src/health.test.ts`).
- Lógica pura (`calcularBackoff`, `mesclarContas`, `validarConta`, `extrairDadosSse`): chamada direta, sem dublês.

## Fixtures and Factories

**Test Data:**
```typescript
export function criarJwt(expSegundos: number, sub = "conta"): string {
  const [cabecalho, payload] = [{ alg: "HS256", typ: "JWT" }, { sub, exp: expSegundos }].map(
    (parte) => Buffer.from(JSON.stringify(parte)).toString("base64url"),
  );
  return `${cabecalho}.${payload}.assinatura`;
}

export function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}
```
(`packages/worker/src/auth/__fixtures__/jwt.ts`.)

- Constantes de base + overrides por spread: `const CONTA_BASE = { label, pokeidleUser, pokeidlePass }` e `criarConta(token, overrides = {})` (`apps/central-api/src/accounts/accounts.test.ts`); `const comTokens = { ...base, ACCESS_TOKEN, REFRESH_TOKEN }` (`packages/worker/src/config.test.ts`).
- Factories `seedUser(username, role)` criam usuário com `argon2.hash(..., { type: argon2.argon2id })` e fazem login via `app.inject` para devolver `accessToken`.
- Factories de status: `workerRodando(accountId, id)`, `inspecaoPadrao(accountId)`.
- Cenários declarativos: `interface Cenario { falhaPull?: string[]; saudeNova?: "healthy" | "unhealthy" | "starting"; ... }` + `criarMotor(cenario)` (`packages/updater/src/atualizar.test.ts`).
- Inspect Docker realista reutilizável: `inspectControlPlane(parciais)` em `packages/updater/src/fixtures.ts`.
- Valores secretos de teste são strings reconhecíveis (`"senha-super-secreta"`, `"token-jogo-a"`) para que assertions `not.toContain` sejam significativas.
- Parametrização: `it.each([...])("rejeita GAME_WS_SHARDS inválido %s", ...)` e `it.each(CASOS)("$method $url repassa ...", ...)`.

**Location:**
- Worker: `packages/worker/src/auth/__fixtures__/` (TS helpers + arquivos HTML/TXT capturados, lidos com `readFileSync(new URL("./__fixtures__/login.html", import.meta.url))`).
- Updater: `packages/updater/src/fixtures.ts`.
- Control-plane e central: helpers definidos no topo de cada arquivo de teste. `fabricarJwt` está duplicado em 9 arquivos de `apps/control-plane/src/**`, `criarOrchestratorFake`/`workerRodando` em 4 e `limparBanco`/`seedUser` em 5 arquivos da central. Ao criar um teste novo nesses apps, copie o helper do arquivo vizinho mais próximo (padrão vigente) ou, se for extrair, crie um `__fixtures__/` no pacote como no worker e migre todos os usuários.
- E2E: constantes de ambiente em `e2e/ambiente.ts`, token aceito pelo jogo falso em `e2e/fake-game/token.ts`.

## Coverage

**Requirements:** Nenhum limite configurado nem medido. A disciplina é TDD por task (plano em `docs/plans/2026-10-11-multiacc-pokeidle-plan.md`: "teste falhando → implementar → PASS → commit").

**View Coverage:**
```bash
pnpm --filter <pacote> exec vitest run --coverage   # exige instalar @vitest/coverage-v8 antes; não está nas dependências
```

**Lacunas observáveis:**
- Componentes React (`apps/web/components/*.tsx`) não têm testes unitários (não há jsdom/happy-dom/Testing Library); só a lógica em `apps/web/lib/` e o proxy `apps/web/app/cp/[...path]/route.ts`. A UI é coberta apenas pelo E2E.
- Sem testes para `apps/control-plane/src/update/routes.ts`, `apps/control-plane/src/orchestrator/recriar.ts`, `apps/control-plane/src/central/repasse.ts`, `packages/updater/src/docker.ts`, `packages/worker/src/index.ts` (cobertos indiretamente ou não cobertos).
- E2E não roda no CI (`.github/workflows/ci.yml` roda typecheck, `pnpm -r test`, lint e build da web; `release.yml` reusa o CI).

## Test Types

**Unit Tests:**
- Funções puras e classes com dependências injetadas: `packages/worker/src/config.test.ts`, `packages/worker/src/game/loop.test.ts`, `apps/control-plane/src/supervisor/supervisor.test.ts`, `apps/control-plane/src/orchestrator/orchestrator.unit.test.ts`, `packages/updater/src/*.test.ts`, `apps/web/lib/*.test.ts`.

**Integration Tests:**
- Central: Fastify + Prisma + Postgres reais via `app.inject` (`apps/central-api/src/**/*.test.ts`, `apps/central-api/prisma/seed.test.ts`). Serializados (`fileParallelism: false`).
- Control-plane: `buildApp` completo com orquestrador falso, `fetch` stubado e disco real em tmp (`apps/control-plane/src/*/routes.test.ts`, `update/manager.test.ts`, `session/store.test.ts`). Serializado.
- Docker real: `apps/control-plane/src/orchestrator/orchestrator.test.ts` com `alpine:latest`, `describe.skipIf(!dockerDisponivel)`, timeouts por teste (`60_000`) e `beforeAll` com `180_000`; limpa containers criados em `afterEach` com `remove({ force: true })`.
- Rede local real: WebSocket (`packages/worker/src/game/client.test.ts`), HTTP health (`packages/worker/src/health.test.ts`), SSE (`apps/control-plane/src/stream/routes.test.ts`).

**E2E Tests:**
- Playwright, um único spec serial (`test.describe.configure({ mode: "serial" })`) que compartilha `page`, `accountId` e `linha` entre testes em ordem: login → criar conta → iniciar → logs → kick 4005 → parar → release nova.
- `e2e/global-setup.ts` valida pré-condições, derruba ambiente anterior, builda imagens `ghcr.io/ayresigo/mpw-*:e2e` (salvo `E2E_SKIP_BUILD=1`), sobe `docker compose -p mpw-e2e up -d --wait` e confere o login do admin seedado. `e2e/global-teardown.ts` derruba tudo (salvo `E2E_KEEP=1`).
- Jogo falso `e2e/fake-game/server.ts` (HTTP + WS) com rota de controle `POST /__e2e/kick`.
- Seletores por papel/label acessível em pt-BR (`getByRole("button", { name: "Iniciar" })`, `getByLabel("Senha PokeIdle")`); estado de containers checado via CLI Docker (`containerExiste`, `saudeDoContainer` em `e2e/docker.ts`). Workers criados são registrados em `e2e/.estado/workers.txt` (`registrarWorker`) para limpeza por nome exato.

## Common Patterns

**Async Testing:**
```typescript
await vi.advanceTimersByTimeAsync(1499);
expect(a.executar).not.toHaveBeenCalled();
await vi.advanceTimersByTimeAsync(1);
expect(a.executar).toHaveBeenCalledTimes(1);
```
```typescript
await vi.waitFor(() => expect(this.conexoes.length).toBeGreaterThan(indice));
await expect.poll(() => orchestrator.seguidores.size, { timeout: 2000 }).toBe(1);
```
```typescript
const pendente = Promise.withResolvers<Response>();
const fetchMock = vi.fn().mockReturnValue(pendente.promise);
vi.stubGlobal("fetch", fetchMock);
const p1 = store.getAccessToken();
const p2 = store.getAccessToken();
pendente.resolve(respostaJson(200, { accessToken: novoAccess, refreshToken: "refresh-rot" }));
expect(await p1).toEqual({ token: novoAccess, offline: false });
expect(fetchMock).toHaveBeenCalledTimes(1);
```
(Controle manual de resolução para testar single-flight/corrida — `apps/control-plane/src/session/store.test.ts`.)

**Error Testing:**
```typescript
await expect(store.login("admin", "errada")).rejects.toBeInstanceOf(ErroCredenciaisInvalidas);
await expect(seedAdmin({ DATABASE_URL: databaseUrl })).rejects.toThrow("ADMIN_USERNAME e ADMIN_PASSWORD são obrigatórios");
expect(() => initSecrets()).toThrow(/SECRETS_KEY.*32/i);
await expect(docker.getContainer(id).inspect()).rejects.toMatchObject({ statusCode: 404 });
```
Quando é preciso inspecionar o erro tipado, use um helper `erroDe` que captura e devolve a instância, falhando se nada for lançado:
```typescript
function erroDe(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (erro) {
    if (erro instanceof ConfigError) return erro;
    throw erro;
  }
  throw new Error("loadConfig deveria ter lançado ConfigError");
}
```
(`packages/worker/src/config.test.ts`; variante assíncrona em `packages/worker/src/auth/provider.test.ts`.)

**HTTP Status Testing:**
```typescript
const res = await app.inject({ method: "GET", url: "/accounts", headers: authed(accessToken) });
expect(res.statusCode).toBe(401);
expect(res.json()).toEqual({ authenticated: false, offline: false });
```
Cubra para cada rota nova: sem token (401), papel errado (403), recurso de outro tenant (404), corpo inválido (400) e falha upstream (502/503) quando aplicável.

---

*Testing analysis: 2026-10-12*
