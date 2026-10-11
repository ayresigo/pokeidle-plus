import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type {
  ContainerOrchestrator,
  LogLineCallback,
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

interface OrchestratorFake extends ContainerOrchestrator {
  workers: WorkerStatus[];
  logsPorId: Record<string, string>;
  seguidores: Map<string, LogLineCallback>;
}

function criarOrchestratorFake(): OrchestratorFake {
  const fake: OrchestratorFake = {
    workers: [],
    logsPorId: {},
    seguidores: new Map(),
    createWorker: vi.fn(async () => "container-1"),
    startWorker: vi.fn(async () => {}),
    stopWorker: vi.fn(async () => {}),
    removeWorker: vi.fn(async () => {}),
    listWorkers: vi.fn(async () => fake.workers),
    workerLogs: vi.fn(async (id: string) => fake.logsPorId[id] ?? ""),
    pullImage: vi.fn(async () => {}),
    followLogs: vi.fn(async (id: string, onLine: LogLineCallback) => {
      fake.seguidores.set(id, onLine);
      return async () => {
        fake.seguidores.delete(id);
      };
    }),
  };
  return fake;
}

function workerRodando(accountId: string, id: string): WorkerStatus {
  return {
    id,
    accountId,
    state: "running",
    health: "healthy",
    startedAt: new Date("2026-10-11T10:00:00Z"),
    restartCount: 0,
  };
}

interface EventoSse {
  event: string | null;
  data: string;
}

class LeitorSse {
  readonly eventos: EventoSse[] = [];
  private buffer = "";

  constructor(
    resposta: Response,
    private sinal: AbortSignal,
  ) {
    void this.consumir(resposta);
  }

  private async consumir(resposta: Response): Promise<void> {
    try {
      const reader = resposta.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = this.buffer.indexOf("\n\n")) >= 0) {
          const bruto = this.buffer.slice(0, idx);
          this.buffer = this.buffer.slice(idx + 2);
          let event: string | null = null;
          const linhasData: string[] = [];
          for (const linha of bruto.split("\n")) {
            if (linha.startsWith("event:")) event = linha.slice(6).trim();
            if (linha.startsWith("data:")) linhasData.push(linha.slice(5).trim());
          }
          if (linhasData.length > 0) {
            this.eventos.push({ event, data: linhasData.join("\n") });
          }
        }
      }
    } catch (erro) {
      if (!this.sinal.aborted) throw erro;
    }
  }

  async proximo(predicado: (e: EventoSse) => boolean): Promise<EventoSse> {
    await vi.waitFor(
      () => {
        if (!this.eventos.some(predicado)) {
          throw new Error(`aguardando evento; recebidos: ${JSON.stringify(this.eventos)}`);
        }
      },
      { timeout: 4000, interval: 5 },
    );
    return this.eventos.find(predicado)!;
  }
}

describe("rotas de streaming sse", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessionStore: SessionStore;
  let supervisor: Supervisor;
  let orchestrator: OrchestratorFake;
  let baseUrl: string;
  let abortar: AbortController;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "stream-routes-test-"));
    orchestrator = criarOrchestratorFake();
    const built = buildApp({
      dataDir: dir,
      centralApiUrl: "http://central.test",
      orchestrator,
      supervisorPollMs: 20,
    });
    app = built.app;
    sessionStore = built.sessionStore;
    supervisor = built.supervisor;
    sessionStore.definirAccess(fabricarJwt(EM_BREVE));
    const fetchReal = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: RequestInit) => {
        const u = String(url);
        if (u.startsWith("http://127.0.0.1")) return fetchReal(u, init);
        throw new Error("sem rede");
      }),
    );
    await app.listen({ port: 0, host: "127.0.0.1" });
    const endereco = app.server.address();
    if (typeof endereco === "string" || !endereco) throw new Error("sem porta");
    baseUrl = `http://127.0.0.1:${endereco.port}`;
    abortar = new AbortController();
  });

  afterEach(async () => {
    abortar.abort();
    supervisor.stop();
    vi.unstubAllGlobals();
    await app.close();
  });

  async function conectar(url: string): Promise<{ resposta: Response; leitor: LeitorSse }> {
    const resposta = await fetch(`${baseUrl}${url}`, { signal: abortar.signal });
    return { resposta, leitor: new LeitorSse(resposta, abortar.signal) };
  }

  describe("GET /workers/:accountId/logs/stream", () => {
    it("responde 404 para worker inexistente", async () => {
      const resposta = await fetch(`${baseUrl}/workers/ninguem/logs/stream`);
      expect(resposta.status).toBe(404);
    });

    it("envia headers sse e o tail inicial como primeiros eventos", async () => {
      orchestrator.workers.push(workerRodando("conta-1", "container-1"));
      orchestrator.logsPorId["container-1"] = "linha-um\nlinha-dois\n";

      const { resposta, leitor } = await conectar("/workers/conta-1/logs/stream");

      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("content-type")).toContain("text/event-stream");
      expect(orchestrator.workerLogs).toHaveBeenCalledWith("container-1", 200);

      const primeiro = await leitor.proximo((e) => e.data.includes("linha-um"));
      const segundo = await leitor.proximo((e) => e.data.includes("linha-dois"));
      expect(JSON.parse(primeiro.data).line).toBe("linha-um");
      expect(JSON.parse(segundo.data).line).toBe("linha-dois");
      expect(JSON.parse(primeiro.data).ts).toBeTruthy();
    });

    it("emite novas linhas do follow e limpa o seguidor ao desconectar", async () => {
      orchestrator.workers.push(workerRodando("conta-1", "container-1"));

      const { leitor } = await conectar("/workers/conta-1/logs/stream");
      await expect
        .poll(() => orchestrator.seguidores.size, { timeout: 2000 })
        .toBe(1);

      const emitir = orchestrator.seguidores.get("container-1")!;
      emitir("nova-linha", new Date("2026-10-11T11:00:00Z"));
      const evento = await leitor.proximo((e) => e.data.includes("nova-linha"));
      expect(JSON.parse(evento.data).line).toBe("nova-linha");

      abortar.abort();
      await expect
        .poll(() => orchestrator.seguidores.size, { timeout: 2000 })
        .toBe(0);
    });

    it("abort durante o await do tail ainda limpa o follow", async () => {
      orchestrator.workers.push(workerRodando("conta-1", "container-1"));
      let resolverTail!: (valor: string) => void;
      const pararSpy = vi.fn(async () => {
        orchestrator.seguidores.delete("container-1");
      });
      orchestrator.workerLogs = vi.fn(
        () => new Promise<string>((resolve) => { resolverTail = resolve; }),
      );
      orchestrator.followLogs = vi.fn(async (id: string, onLine: LogLineCallback) => {
        orchestrator.seguidores.set(id, onLine);
        return pararSpy;
      });

      const conexao = conectar("/workers/conta-1/logs/stream");
      await vi.waitFor(() => {
        expect(orchestrator.workerLogs).toHaveBeenCalled();
      });
      abortar.abort();
      resolverTail("linha-tardia\n");
      await conexao.catch(() => {});

      await vi.waitFor(
        () => {
          expect(pararSpy).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );
      expect(orchestrator.seguidores.size).toBe(0);
    });

    it("followLogs rejeitando após hijack destrói o socket sem pendurar", async () => {
      orchestrator.workers.push(workerRodando("conta-1", "container-1"));
      orchestrator.followLogs = vi.fn(async () => {
        throw new Error("docker indisponível");
      });

      const resultado = await fetch(`${baseUrl}/workers/conta-1/logs/stream`, {
        signal: abortar.signal,
      })
        .then(async (resposta) => {
          expect(resposta.status).toBe(200);
          await resposta.text();
          return "completou";
        })
        .catch(() => "erro");
      expect(resultado).toBe("erro");
      expect(orchestrator.seguidores.size).toBe(0);
    });
  });

  describe("GET /events", () => {
    it("envia snapshot inicial e update quando o snapshot muda, com cleanup ao fechar", async () => {
      supervisor.start();
      const { resposta, leitor } = await conectar("/events");

      expect(resposta.headers.get("content-type")).toContain("text/event-stream");
      const snapshot = await leitor.proximo((e) => e.event === "snapshot");
      expect(JSON.parse(snapshot.data)).toEqual([]);

      orchestrator.workers.push(workerRodando("conta-9", "container-9"));
      const update = await leitor.proximo(
        (e) => e.event === "update" && e.data.includes("conta-9"),
      );
      const lista = JSON.parse(update.data);
      expect(lista[0].accountId).toBe("conta-9");

      abortar.abort();
      await expect
        .poll(() => supervisor.mudancas.listenerCount("update"), { timeout: 2000 })
        .toBe(0);
    });

    it("exige sessão", async () => {
      const outra = await buildApp({ dataDir: dir, orchestrator }).app.inject({
        method: "GET",
        url: "/events",
      });
      expect(outra.statusCode).toBe(401);
    });
  });
});
