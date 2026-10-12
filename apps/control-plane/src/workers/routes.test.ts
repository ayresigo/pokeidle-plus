import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type {
  ContainerOrchestrator,
  WorkerConfig,
  WorkerStatus,
} from "../orchestrator/types.js";
import type { SessionStore } from "../session/store.js";
import type { Supervisor } from "../supervisor/supervisor.js";

function fabricarJwt(expSegundos: number): string {
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ exp: expSegundos })}.assinatura-falsa`;
}

const EM_BREVE = Math.floor(Date.now() / 1000) + 3600;

interface CredenciaisFake {
  pokeidleUser: string;
  pokeidlePass: string;
  accessToken: string | null;
  refreshToken: string | null;
  solverKey: string | null;
  proxyUrl: string | null;
}

const CREDENCIAIS_COMPLETAS: CredenciaisFake = {
  pokeidleUser: "treinador01",
  pokeidlePass: "senha-super-secreta",
  accessToken: "token-jogo-a",
  refreshToken: "token-jogo-r",
  solverKey: "chave-solver-x",
  proxyUrl: "http://proxy:8080",
};

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
    startWorker: vi.fn(async () => {
      fake.ordemChamadas.push("startWorker");
    }),
    stopWorker: vi.fn(async () => {
      fake.ordemChamadas.push("stopWorker");
    }),
    removeWorker: vi.fn(async () => {
      fake.ordemChamadas.push("removeWorker");
    }),
    listWorkers: vi.fn(async () => fake.workers),
    workerLogs: vi.fn(async () => ""),
    followLogs: vi.fn(async () => async () => {}),
    pullImage: vi.fn(async () => {}),
    inspectWorker: vi.fn(async () => ({ env: {}, labels: {}, image: "", imageRef: "" })),
    createUpdater: vi.fn(async () => "updater"),
    createOneShot: vi.fn(async () => "oneshot"),
    waitOneShot: vi.fn(async () => ({ exitCode: 0, stdout: "" })),
    removeOneShot: vi.fn(async () => {}),
  };
  return fake;
}

function workerRodando(accountId: string, id: string): WorkerStatus {
  return {
    id,
    accountId,
    state: "running",
    health: "healthy",
    startedAt: new Date(),
    restartCount: 0,
  };
}

interface ChamadaFetch {
  url: string;
  init?: RequestInit;
}

interface StubCentralOpts {
  credenciais?: CredenciaisFake;
  statusCredenciais?: number;
  saudeWorkers?: Record<string, unknown>;
}

function stubFetchCentral(opcoes: StubCentralOpts): ChamadaFetch[] {
  const chamadas: ChamadaFetch[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      chamadas.push({ url: u, init });
      if (u.endsWith("/credentials")) {
        if (opcoes.statusCredenciais && opcoes.statusCredenciais !== 200) {
          return new Response("erro", { status: opcoes.statusCredenciais });
        }
        return new Response(JSON.stringify(opcoes.credenciais ?? CREDENCIAIS_COMPLETAS), {
          status: 200,
        });
      }
      if (u.endsWith("/tokens") && init?.method === "PUT") {
        return new Response(null, { status: 204 });
      }
      if (u.includes(":3001/health")) {
        const conta = /mpw-worker-(.+):3001/.exec(u)?.[1] ?? "";
        const corpo = opcoes.saudeWorkers?.[conta] ?? { state: "in-game" };
        return new Response(JSON.stringify(corpo), { status: 200 });
      }
      throw new Error(`url inesperada no stub: ${u}`);
    }),
  );
  return chamadas;
}

describe("rotas de workers", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessionStore: SessionStore;
  let supervisor: Supervisor;
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
    sessionStore = built.sessionStore;
    supervisor = built.supervisor;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await app.close();
  });

  async function semearGrace() {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "session.json"),
      JSON.stringify({ refreshToken: "refresh-abc", obtainedAt: new Date().toISOString() }),
    );
    await sessionStore.init();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("central fora do ar")));
  }

  describe("POST /workers/:accountId/start", () => {
    it("monta env completa, cria e inicia worker e marca desireRunning", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      const chamadas = stubFetchCentral({ credenciais: CREDENCIAIS_COMPLETAS });
      const desejo = vi.spyOn(supervisor, "desireRunning");

      const resposta = await app.inject({
        method: "POST",
        url: "/workers/conta-1/start",
      });

      expect(resposta.statusCode).toBe(200);
      expect(orchestrator.criados).toHaveLength(1);
      const cfg = orchestrator.criados[0];
      expect(cfg.accountId).toBe("conta-1");
      expect(cfg.imageRef).toBe("ghcr.io/multiacc-pokeidle/mpw-worker:stable");
      expect(cfg.env).toEqual({
        ACCOUNT_ID: "conta-1",
        GAME_URL: "https://jogo.test",
        POKEIDLE_USER: "treinador01",
        POKEIDLE_PASS: "senha-super-secreta",
        ACCESS_TOKEN: "token-jogo-a",
        REFRESH_TOKEN: "token-jogo-r",
        SOLVER_KEY: "chave-solver-x",
        PROXY_URL: "http://proxy:8080",
        CONTROL_PLANE_URL: "http://cp.test:4000",
      });
      expect(orchestrator.startWorker).toHaveBeenCalledWith("container-1");
      expect(desejo).toHaveBeenCalledWith("conta-1");

      const chamadaCredenciais = chamadas.find((c) => c.url.endsWith("/credentials"));
      expect(chamadaCredenciais?.url).toBe("http://central.test/accounts/conta-1/credentials");
      expect(chamadaCredenciais?.init?.headers).toMatchObject({
        authorization: expect.stringMatching(/^Bearer /),
      });
    });

    it("omite variáveis opcionais quando credenciais são null", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      stubFetchCentral({
        credenciais: {
          pokeidleUser: "treinador01",
          pokeidlePass: "senha-super-secreta",
          accessToken: null,
          refreshToken: null,
          solverKey: null,
          proxyUrl: null,
        },
      });

      const resposta = await app.inject({ method: "POST", url: "/workers/conta-1/start" });

      expect(resposta.statusCode).toBe(200);
      const env = orchestrator.criados[0].env;
      expect(env).toEqual({
        ACCOUNT_ID: "conta-1",
        GAME_URL: "https://jogo.test",
        POKEIDLE_USER: "treinador01",
        POKEIDLE_PASS: "senha-super-secreta",
        CONTROL_PLANE_URL: "http://cp.test:4000",
      });
      expect(env).not.toHaveProperty("ACCESS_TOKEN");
      expect(env).not.toHaveProperty("REFRESH_TOKEN");
      expect(env).not.toHaveProperty("SOLVER_KEY");
      expect(env).not.toHaveProperty("PROXY_URL");
    });

    it("não expõe credenciais nem env na resposta HTTP", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      stubFetchCentral({ credenciais: CREDENCIAIS_COMPLETAS });

      const resposta = await app.inject({ method: "POST", url: "/workers/conta-1/start" });

      expect(resposta.statusCode).toBe(200);
      for (const segredo of [
        "senha-super-secreta",
        "token-jogo-a",
        "token-jogo-r",
        "chave-solver-x",
        "proxy:8080",
      ]) {
        expect(resposta.body).not.toContain(segredo);
      }
    });

    it("retorna 401 sem sessão", async () => {
      const resposta = await app.inject({ method: "POST", url: "/workers/conta-1/start" });
      expect(resposta.statusCode).toBe(401);
      expect(orchestrator.criados).toHaveLength(0);
    });

    it("retorna 503 em grace (precisaCentral)", async () => {
      await semearGrace();
      const resposta = await app.inject({ method: "POST", url: "/workers/conta-1/start" });
      expect(resposta.statusCode).toBe(503);
      expect(orchestrator.criados).toHaveLength(0);
    });

    it("retorna 502 sem criar worker quando o central falha em /credentials", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      stubFetchCentral({ statusCredenciais: 500 });

      const resposta = await app.inject({ method: "POST", url: "/workers/conta-1/start" });

      expect(resposta.statusCode).toBe(502);
      expect(resposta.json().error).toContain("credenciais");
      expect(orchestrator.criados).toHaveLength(0);
      expect(orchestrator.startWorker).not.toHaveBeenCalled();
    });
  });

  describe("POST /workers/:accountId/stop", () => {
    it("é idempotente: worker inexistente retorna 204", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      stubFetchCentral({});
      const desejo = vi.spyOn(supervisor, "desireStopped");

      const resposta = await app.inject({ method: "POST", url: "/workers/conta-9/stop" });

      expect(resposta.statusCode).toBe(204);
      expect(orchestrator.stopWorker).not.toHaveBeenCalled();
      expect(orchestrator.removeWorker).not.toHaveBeenCalled();
      expect(desejo).toHaveBeenCalledWith("conta-9");
    });

    it("drena com timeout de 30s e remove worker existente", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      stubFetchCentral({});
      orchestrator.workers.push(workerRodando("conta-1", "container-x"));

      const resposta = await app.inject({ method: "POST", url: "/workers/conta-1/stop" });

      expect(resposta.statusCode).toBe(204);
      expect(orchestrator.stopWorker).toHaveBeenCalledWith("container-x", 30);
      expect(orchestrator.removeWorker).toHaveBeenCalledWith("container-x");
    });

    it("retorna 401 sem sessão", async () => {
      const resposta = await app.inject({ method: "POST", url: "/workers/conta-1/stop" });
      expect(resposta.statusCode).toBe(401);
    });

    it("funciona em grace (rota default)", async () => {
      await semearGrace();
      const resposta = await app.inject({ method: "POST", url: "/workers/conta-9/stop" });
      expect(resposta.statusCode).toBe(204);
    });
  });

  describe("POST /workers/:accountId/restart", () => {
    it("executa stop seguido de start, em ordem", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      stubFetchCentral({ credenciais: CREDENCIAIS_COMPLETAS });
      orchestrator.workers.push(workerRodando("conta-1", "container-antigo"));

      const resposta = await app.inject({ method: "POST", url: "/workers/conta-1/restart" });

      expect(resposta.statusCode).toBe(200);
      expect(orchestrator.stopWorker).toHaveBeenCalledWith("container-antigo", 30);
      expect(orchestrator.ordemChamadas).toEqual([
        "stopWorker",
        "removeWorker",
        "createWorker",
        "startWorker",
      ]);
      expect(orchestrator.criados).toHaveLength(1);
    });

    it("retorna 503 em grace (precisaCentral)", async () => {
      await semearGrace();
      const resposta = await app.inject({ method: "POST", url: "/workers/conta-1/restart" });
      expect(resposta.statusCode).toBe(503);
      expect(orchestrator.criados).toHaveLength(0);
    });
  });

  describe("GET /workers/status", () => {
    it("retorna snapshot do supervisor", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      const resposta = await app.inject({ method: "GET", url: "/workers/status" });
      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual([]);
    });

    it("funciona em grace (rota default)", async () => {
      await semearGrace();
      const resposta = await app.inject({ method: "GET", url: "/workers/status" });
      expect(resposta.statusCode).toBe(200);
    });

    it("retorna 401 sem sessão", async () => {
      const resposta = await app.inject({ method: "GET", url: "/workers/status" });
      expect(resposta.statusCode).toBe(401);
    });
  });

  describe("write-back de tokens renovados", () => {
    it("persiste tokens novos do /health do worker via PUT no central", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      const chamadas = stubFetchCentral({
        saudeWorkers: {
          "conta-1": {
            state: "in-game",
            tokens: { accessToken: "novo-token-a", refreshToken: "novo-token-r" },
          },
        },
      });
      orchestrator.workers.push(workerRodando("conta-1", "container-de-conta-1"));
      supervisor.desireRunning("conta-1");

      vi.useFakeTimers();
      supervisor.start();
      await vi.advanceTimersByTimeAsync(1);

      const put = chamadas.find(
        (c) => c.url.endsWith("/accounts/conta-1/tokens") && c.init?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(put?.init?.headers).toMatchObject({
        authorization: expect.stringMatching(/^Bearer /),
        "content-type": "application/json",
      });
      expect(JSON.parse(String(put?.init?.body))).toEqual({
        accessToken: "novo-token-a",
        refreshToken: "novo-token-r",
      });
    });

    it("retenta PUT no poll seguinte quando o central falha", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      let putsTentados = 0;
      const corpos: unknown[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: unknown, init?: RequestInit) => {
          const u = String(url);
          if (u.endsWith("/tokens") && init?.method === "PUT") {
            putsTentados += 1;
            corpos.push(JSON.parse(String(init.body)));
            return new Response(null, { status: putsTentados === 1 ? 500 : 204 });
          }
          if (u.includes(":3001/health")) {
            return new Response(
              JSON.stringify({
                state: "in-game",
                tokens: { accessToken: "novo-token-a", refreshToken: "novo-token-r" },
              }),
              { status: 200 },
            );
          }
          throw new Error(`url inesperada no stub: ${u}`);
        }),
      );
      orchestrator.workers.push(workerRodando("conta-1", "container-de-conta-1"));
      supervisor.desireRunning("conta-1");

      vi.useFakeTimers();
      supervisor.start();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(putsTentados).toBe(2);
      expect(corpos).toEqual([
        { accessToken: "novo-token-a", refreshToken: "novo-token-r" },
        { accessToken: "novo-token-a", refreshToken: "novo-token-r" },
      ]);
    });

    it("não repete PUT quando tokens não mudam entre polls", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      const chamadas = stubFetchCentral({
        saudeWorkers: {
          "conta-1": {
            state: "in-game",
            tokens: { accessToken: "novo-token-a", refreshToken: "novo-token-r" },
          },
        },
      });
      orchestrator.workers.push(workerRodando("conta-1", "container-de-conta-1"));
      supervisor.desireRunning("conta-1");

      vi.useFakeTimers();
      supervisor.start();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(10_000);

      const puts = chamadas.filter(
        (c) => c.url.endsWith("/tokens") && c.init?.method === "PUT",
      );
      expect(puts).toHaveLength(1);
    });
  });
});
