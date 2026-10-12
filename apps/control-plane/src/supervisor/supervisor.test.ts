import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ContainerOrchestrator,
  ResultadoOneShot,
  WorkerConfig,
  WorkerInspect,
  WorkerStatus,
} from "../orchestrator/types.js";
import { Supervisor, calcularBackoff } from "./supervisor.js";

class FakeOrchestrator implements ContainerOrchestrator {
  workers = new Map<string, WorkerStatus>();
  startCalls: { id: string; at: number }[] = [];
  stopCalls: string[] = [];
  eventos: string[] = [];
  criados: WorkerConfig[] = [];
  inspecoes = new Map<string, WorkerInspect>();
  listCalls = 0;
  falharStart: string | null = null;
  falharCreate: string | null = null;
  manterCaido = false;

  adicionar(accountId: string, state: string): WorkerStatus {
    const worker: WorkerStatus = {
      id: `w-${accountId}`,
      accountId,
      state,
      health: "none",
      startedAt: null,
      restartCount: 0,
    };
    this.workers.set(worker.id, worker);
    return worker;
  }

  derrubar(accountId: string): void {
    const worker = this.workers.get(`w-${accountId}`);
    if (worker) worker.state = "exited";
  }

  async createWorker(cfg: WorkerConfig): Promise<string> {
    this.eventos.push(`create:${cfg.accountId}`);
    if (this.falharCreate) throw new Error(this.falharCreate);
    this.criados.push(cfg);
    const worker: WorkerStatus = {
      id: `novo-${this.criados.length}`,
      accountId: cfg.accountId,
      state: "created",
      health: "none",
      startedAt: null,
      restartCount: 0,
    };
    this.workers.set(worker.id, worker);
    return worker.id;
  }

  async startWorker(id: string): Promise<void> {
    this.eventos.push(`start:${id}`);
    this.startCalls.push({ id, at: Date.now() });
    if (this.falharStart) throw new Error(this.falharStart);
    if (this.manterCaido) return;
    const worker = this.workers.get(id);
    if (worker) {
      worker.state = "running";
      worker.startedAt = new Date();
    }
  }

  async stopWorker(id: string): Promise<void> {
    this.stopCalls.push(id);
  }

  async removeWorker(id: string): Promise<void> {
    this.eventos.push(`remove:${id}`);
    this.workers.delete(id);
  }

  async listWorkers(): Promise<WorkerStatus[]> {
    this.listCalls += 1;
    return [...this.workers.values()];
  }

  async workerLogs(): Promise<string> {
    return "";
  }
  async followLogs(): Promise<() => Promise<void>> {
    return async () => {};
  }
  async pullImage(): Promise<void> {}
  async inspectWorker(id: string): Promise<WorkerInspect> {
    this.eventos.push(`inspect:${id}`);
    return this.inspecoes.get(id) ?? { env: {}, labels: {}, image: "", imageRef: "" };
  }
  async createUpdater(): Promise<string> {
    return "updater";
  }
  async createOneShot(): Promise<string> {
    return "oneshot";
  }
  async waitOneShot(): Promise<ResultadoOneShot> {
    return { exitCode: 0, stdout: "" };
  }
  async removeOneShot(): Promise<void> {}
}

describe("calcularBackoff", () => {
  it("segue 1m→2m→5m e trava no teto de 15m", () => {
    expect(calcularBackoff(0)).toBe(0);
    expect(calcularBackoff(1)).toBe(60_000);
    expect(calcularBackoff(2)).toBe(120_000);
    expect(calcularBackoff(3)).toBe(300_000);
    expect(calcularBackoff(4)).toBe(900_000);
    expect(calcularBackoff(10)).toBe(900_000);
  });
});

describe("Supervisor", () => {
  let orch: FakeOrchestrator;
  let sup: Supervisor;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.setSystemTime(0);
    orch = new FakeOrchestrator();
    sup = new Supervisor(orch, 10_000);
  });

  afterEach(() => {
    sup.stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function tick(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  it("reinicia worker crashed desejado-running com backoff 1m→2m→5m→15m e trava no teto", async () => {
    orch.manterCaido = true;
    orch.adicionar("acc1", "exited");
    sup.desireRunning("acc1");
    sup.start();
    await tick(0);
    expect(orch.startCalls.map((c) => c.at)).toEqual([0]);

    await tick(60_000);
    expect(orch.startCalls.map((c) => c.at)).toEqual([0, 60_000]);

    await tick(120_000);
    expect(orch.startCalls.map((c) => c.at)).toEqual([0, 60_000, 180_000]);

    await tick(300_000);
    expect(orch.startCalls.map((c) => c.at)).toEqual([
      0, 60_000, 180_000, 480_000,
    ]);

    await tick(900_000);
    expect(orch.startCalls.map((c) => c.at)).toEqual([
      0, 60_000, 180_000, 480_000, 1_380_000,
    ]);

    await tick(900_000);
    expect(orch.startCalls.map((c) => c.at)).toEqual([
      0, 60_000, 180_000, 480_000, 1_380_000, 2_280_000,
    ]);

    const snap = sup.getSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].backoffAtual).toBe(900_000);
  });

  it("marca degraded somente após 3 falhas consecutivas", async () => {
    orch.manterCaido = true;
    orch.adicionar("acc1", "exited");
    sup.desireRunning("acc1");
    sup.start();
    await tick(0);
    expect(sup.getSnapshot()[0].degraded).toBe(false);

    await tick(60_000);
    expect(sup.getSnapshot()[0].degraded).toBe(false);

    await tick(120_000);
    expect(orch.startCalls).toHaveLength(3);
    expect(sup.getSnapshot()[0].degraded).toBe(true);
    expect(sup.getSnapshot()[0].backoffAtual).toBe(300_000);
  });

  it("reseta backoff após restart estável por 2 polls e reinicia imediato em nova queda", async () => {
    orch.adicionar("acc1", "exited");
    sup.desireRunning("acc1");
    sup.start();
    await tick(0);
    expect(orch.startCalls).toHaveLength(1);
    expect(sup.getSnapshot()[0].backoffAtual).toBe(60_000);

    await tick(10_000);
    expect(sup.getSnapshot()[0].backoffAtual).toBe(60_000);

    await tick(10_000);
    expect(sup.getSnapshot()[0].backoffAtual).toBe(0);
    expect(sup.getSnapshot()[0].degraded).toBe(false);
    expect(sup.getSnapshot()[0].lastError).toBeNull();

    orch.derrubar("acc1");
    await tick(10_000);
    expect(orch.startCalls).toHaveLength(2);
    expect(orch.startCalls[1].at).toBe(30_000);
    expect(sup.getSnapshot()[0].backoffAtual).toBe(60_000);
  });

  it("não reinicia worker sem desejo registrado nem com desejo stopped", async () => {
    orch.adicionar("sem-desejo", "exited");
    orch.adicionar("parado", "exited");
    orch.adicionar("vivo", "running");
    sup.desireStopped("parado");
    sup.desireStopped("vivo");
    sup.start();
    await tick(0);
    await tick(120_000);

    expect(orch.startCalls).toHaveLength(0);
    expect(orch.stopCalls).toHaveLength(0);

    const snap = sup.getSnapshot();
    expect(snap.find((w) => w.accountId === "sem-desejo")?.desired).toBe(
      "none",
    );
    expect(snap.find((w) => w.accountId === "parado")?.desired).toBe(
      "stopped",
    );
  });

  it("stop() cancela o timer e não agenda novos polls", async () => {
    orch.adicionar("acc1", "exited");
    sup.desireRunning("acc1");
    sup.start();
    await tick(0);
    const polls = orch.listCalls;
    sup.stop();

    await tick(120_000);
    expect(orch.listCalls).toBe(polls);
    expect(orch.startCalls).toHaveLength(1);
  });

  it("snapshot mescla listWorkers com estado do supervisor e registra lastError", async () => {
    orch.falharStart = "falha ao iniciar";
    orch.adicionar("acc1", "dead");
    sup.desireRunning("acc1");
    sup.start();
    await tick(0);

    const snap = sup.getSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      id: "w-acc1",
      accountId: "acc1",
      state: "dead",
      desired: "running",
      backoffAtual: 60_000,
      degraded: false,
      lastError: "falha ao iniciar",
    });
  });

  it("desireRunning após stopped faz fresh start sem herdar backoff/degraded/lastError", async () => {
    orch.falharStart = "falha ao iniciar";
    orch.adicionar("acc1", "exited");
    sup.desireRunning("acc1");
    sup.start();
    await tick(0);
    await tick(60_000);
    await tick(120_000);
    expect(sup.getSnapshot()[0].degraded).toBe(true);
    expect(sup.getSnapshot()[0].lastError).toBe("falha ao iniciar");

    sup.desireStopped("acc1");
    sup.desireRunning("acc1");

    const limpo = sup.getSnapshot()[0];
    expect(limpo.backoffAtual).toBe(0);
    expect(limpo.degraded).toBe(false);
    expect(limpo.lastError).toBeNull();

    await tick(10_000);
    expect(orch.startCalls[3].at).toBe(190_000);
    expect(sup.getSnapshot()[0].backoffAtual).toBe(60_000);
  });

  it("snapshot é vazio antes do primeiro poll", () => {
    expect(sup.getSnapshot()).toEqual([]);
  });

  it("conta pausada com container exited não é reiniciada até ser retomada", async () => {
    orch.adicionar("acc1", "exited");
    sup.desireRunning("acc1");
    sup.pausar("acc1");
    sup.start();
    await tick(0);
    await tick(10_000);
    expect(orch.startCalls).toHaveLength(0);

    sup.retomar("acc1");
    await tick(10_000);
    expect(orch.startCalls.map((c) => c.at)).toEqual([20_000]);
  });

  it("tokensConhecidos expõe os tokens do /health mesmo se o write-back falhar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            state: "in-game",
            tokens: { accessToken: "access-novo", refreshToken: "refresh-novo" },
          }),
          { status: 200 },
        ),
      ),
    );
    sup.setOnTokensRenovados(async () => {
      throw new Error("central fora do ar");
    });
    orch.adicionar("acc1", "running");
    expect(sup.tokensConhecidos("acc1")).toBeNull();

    sup.start();
    await tick(0);

    expect(sup.tokensConhecidos("acc1")).toEqual({
      accessToken: "access-novo",
      refreshToken: "refresh-novo",
    });
    expect(sup.tokensConhecidos("outra")).toBeNull();
  });

  describe("restart de crash com tokens renovados", () => {
    const TOKENS_NOVOS = { accessToken: "access-novo", refreshToken: "refresh-novo" };

    function inspecaoCom(accessToken: string, refreshToken: string): WorkerInspect {
      return {
        env: {
          ACCOUNT_ID: "acc1",
          ACCESS_TOKEN: accessToken,
          REFRESH_TOKEN: refreshToken,
          SOLVER_KEY: "chave",
        },
        labels: {
          "mpw.managed": "true",
          "mpw.account-id": "acc1",
          "minha-label": "acc1",
        },
        image: "ghcr.io/multiacc-pokeidle/mpw-worker@sha256:atual",
        imageRef: "ghcr.io/multiacc-pokeidle/mpw-worker:1.0.0",
      };
    }

    async function observarTokensECrashar(): Promise<void> {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(JSON.stringify({ state: "in-game", tokens: TOKENS_NOVOS }), {
            status: 200,
          }),
        ),
      );
      sup.setOnTokensRenovados(async () => {});
      orch.adicionar("acc1", "running");
      sup.desireRunning("acc1");
      sup.start();
      await tick(0);
      expect(sup.tokensConhecidos("acc1")).toEqual(TOKENS_NOVOS);
      orch.eventos = [];
      orch.derrubar("acc1");
    }

    it("recria o container com os tokens conhecidos quando diferem da env atual", async () => {
      orch.inspecoes.set("w-acc1", inspecaoCom("access-velho", "refresh-velho"));
      await observarTokensECrashar();

      await tick(10_000);

      expect(orch.eventos).toEqual([
        "inspect:w-acc1",
        "remove:w-acc1",
        "create:acc1",
        "start:novo-1",
      ]);
      expect(orch.criados).toEqual([
        {
          accountId: "acc1",
          imageRef: "ghcr.io/multiacc-pokeidle/mpw-worker@sha256:atual",
          env: {
            ACCOUNT_ID: "acc1",
            ACCESS_TOKEN: "access-novo",
            REFRESH_TOKEN: "refresh-novo",
            SOLVER_KEY: "chave",
          },
          labels: { "minha-label": "acc1" },
        },
      ]);
      expect(orch.startCalls.map((c) => c.id)).not.toContain("w-acc1");
      expect(sup.getSnapshot()[0]).toMatchObject({ backoffAtual: 60_000, lastError: null });
    });

    it("sem tokens conhecidos reinicia o mesmo container via startWorker", async () => {
      orch.inspecoes.set("w-acc1", inspecaoCom("access-velho", "refresh-velho"));
      orch.adicionar("acc1", "exited");
      sup.desireRunning("acc1");
      sup.start();
      await tick(0);

      expect(orch.eventos).toEqual(["start:w-acc1"]);
      expect(orch.criados).toHaveLength(0);
    });

    it("com tokens conhecidos iguais aos da env reinicia o mesmo container", async () => {
      orch.inspecoes.set("w-acc1", inspecaoCom("access-novo", "refresh-novo"));
      await observarTokensECrashar();

      await tick(10_000);

      expect(orch.eventos).toEqual(["inspect:w-acc1", "start:w-acc1"]);
      expect(orch.criados).toHaveLength(0);
    });

    it("falha no create conta no backoff e a recriação é retentada após o backoff", async () => {
      orch.inspecoes.set("w-acc1", inspecaoCom("access-velho", "refresh-velho"));
      await observarTokensECrashar();
      orch.falharCreate = "docker recusou criar";

      await tick(10_000);

      expect(orch.eventos).toEqual(["inspect:w-acc1", "remove:w-acc1", "create:acc1"]);
      expect(sup.getSnapshot()[0]).toMatchObject({
        accountId: "acc1",
        backoffAtual: 60_000,
        lastError: "docker recusou criar",
      });

      await tick(10_000);
      expect(orch.eventos).toHaveLength(3);
      expect(sup.getSnapshot()).toHaveLength(1);
      expect(sup.getSnapshot()[0]).toMatchObject({ accountId: "acc1", backoffAtual: 60_000 });

      orch.falharCreate = null;
      await tick(50_000);

      expect(orch.eventos.slice(3)).toEqual(["create:acc1", "start:novo-1"]);
      expect(orch.criados[0].env).toMatchObject({
        ACCESS_TOKEN: "access-novo",
        REFRESH_TOKEN: "refresh-novo",
      });
      expect(sup.getSnapshot()[0]).toMatchObject({ backoffAtual: 120_000, lastError: null });
    });

    it("start falho após recriar retenta iniciando o container novo", async () => {
      orch.inspecoes.set("w-acc1", inspecaoCom("access-velho", "refresh-velho"));
      await observarTokensECrashar();
      orch.falharStart = "falha ao iniciar";

      await tick(10_000);
      expect(orch.eventos).toEqual([
        "inspect:w-acc1",
        "remove:w-acc1",
        "create:acc1",
        "start:novo-1",
      ]);
      orch.inspecoes.set("novo-1", inspecaoCom("access-novo", "refresh-novo"));
      orch.falharStart = null;

      await tick(60_000);

      expect(orch.eventos.slice(4)).toEqual(["inspect:novo-1", "start:novo-1"]);
      expect(orch.criados).toHaveLength(1);
    });
  });
});
