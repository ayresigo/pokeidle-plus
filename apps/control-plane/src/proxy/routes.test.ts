import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { ContainerOrchestrator, ResultadoOneShot } from "../orchestrator/types.js";
import type { SessionStore } from "../session/store.js";

function fabricarJwt(expSegundos: number): string {
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ exp: expSegundos })}.assinatura-falsa`;
}

const TOKEN = fabricarJwt(Math.floor(Date.now() / 1000) + 3600);
const PROXY = "socks5://usuario:segredo@proxy.test:1080";

interface OrchestratorFake extends ContainerOrchestrator {
  eventos: string[];
  resultado: () => Promise<ResultadoOneShot>;
}

function criarOrchestratorFake(): OrchestratorFake {
  const fake: OrchestratorFake = {
    eventos: [],
    resultado: async () => ({ exitCode: 0, stdout: "203.0.113.7" }),
    createWorker: vi.fn(async () => "w"),
    startWorker: vi.fn(async () => {}),
    stopWorker: vi.fn(async () => {}),
    removeWorker: vi.fn(async () => {}),
    listWorkers: vi.fn(async () => []),
    workerLogs: vi.fn(async () => ""),
    followLogs: vi.fn(async () => async () => {}),
    pullImage: vi.fn(async () => {}),
    inspectWorker: vi.fn(async () => ({ env: {}, labels: {}, image: "", imageRef: "" })),
    createUpdater: vi.fn(async () => "updater"),
    createOneShot: vi.fn(async () => {
      fake.eventos.push("create");
      return "oneshot-1";
    }),
    waitOneShot: vi.fn(async (id: string) => {
      fake.eventos.push(`wait:${id}`);
      return fake.resultado();
    }),
    removeOneShot: vi.fn(async (id: string) => {
      fake.eventos.push(`remove:${id}`);
    }),
  };
  return fake;
}

describe("POST /proxy/test", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessionStore: SessionStore;
  let orchestrator: OrchestratorFake;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "proxy-routes-test-"));
    orchestrator = criarOrchestratorFake();
    const built = buildApp({ dataDir: dir, centralApiUrl: "http://central.test", orchestrator });
    app = built.app;
    sessionStore = built.sessionStore;
    sessionStore.definirAccess(TOKEN);
  });

  afterEach(async () => {
    await app.close();
  });

  it("roda curl via proxy em container efêmero e devolve o ip", async () => {
    const resposta = await app.inject({
      method: "POST",
      url: "/proxy/test",
      payload: { proxyUrl: PROXY },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ ip: "203.0.113.7" });
    expect(orchestrator.createOneShot).toHaveBeenCalledWith("curlimages/curl", [
      "curl",
      "-s",
      "--max-time",
      "15",
      "-x",
      PROXY,
      "https://api.ipify.org",
    ]);
    expect(orchestrator.waitOneShot).toHaveBeenCalledWith("oneshot-1", 20_000);
    expect(orchestrator.eventos).toEqual(["create", "wait:oneshot-1", "remove:oneshot-1"]);
  });

  it("responde 502 e remove o container quando curl sai com erro", async () => {
    orchestrator.resultado = async () => ({ exitCode: 7, stdout: "" });

    const resposta = await app.inject({
      method: "POST",
      url: "/proxy/test",
      payload: { proxyUrl: PROXY },
    });

    expect(resposta.statusCode).toBe(502);
    expect(resposta.json()).toEqual({ error: "proxy não respondeu" });
    expect(orchestrator.eventos).toEqual(["create", "wait:oneshot-1", "remove:oneshot-1"]);
  });

  it("responde 502 e remove o container quando a espera estoura o timeout", async () => {
    orchestrator.resultado = async () => {
      throw new Error("container one-shot excedeu 20000ms");
    };

    const resposta = await app.inject({
      method: "POST",
      url: "/proxy/test",
      payload: { proxyUrl: PROXY },
    });

    expect(resposta.statusCode).toBe(502);
    expect(resposta.json()).toEqual({ error: "proxy não respondeu" });
    expect(orchestrator.eventos).toEqual(["create", "wait:oneshot-1", "remove:oneshot-1"]);
  });

  it("responde 502 quando a saída não é um ip", async () => {
    orchestrator.resultado = async () => ({ exitCode: 0, stdout: "<html>bloqueado</html>" });

    const resposta = await app.inject({
      method: "POST",
      url: "/proxy/test",
      payload: { proxyUrl: PROXY },
    });

    expect(resposta.statusCode).toBe(502);
    expect(orchestrator.eventos).toContain("remove:oneshot-1");
  });

  it("rejeita proxyUrl fora de http/https/socks5 com 400", async () => {
    const resposta = await app.inject({
      method: "POST",
      url: "/proxy/test",
      payload: { proxyUrl: "ftp://proxy.test:21" },
    });

    expect(resposta.statusCode).toBe(400);
    expect(orchestrator.createOneShot).not.toHaveBeenCalled();
  });

  it("responde 401 sem sessão", async () => {
    await sessionStore.logout();

    const resposta = await app.inject({
      method: "POST",
      url: "/proxy/test",
      payload: { proxyUrl: PROXY },
    });

    expect(resposta.statusCode).toBe(401);
    expect(orchestrator.createOneShot).not.toHaveBeenCalled();
  });
});
