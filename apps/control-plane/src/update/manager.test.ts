import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type {
  ContainerOrchestrator,
  UpdaterConfig,
  WorkerConfig,
  WorkerInspect,
  WorkerStatus,
} from "../orchestrator/types.js";
import { SessionStore } from "../session/store.js";
import type { TokensRenovados } from "../supervisor/supervisor.js";
import { type ControleSupervisor, UpdateManager } from "./manager.js";

const REPO_WORKER = "ghcr.io/multiacc-pokeidle/mpw-worker";
const REPO_UPDATER = "ghcr.io/multiacc-pokeidle/mpw-updater";
const DIGEST_ANTIGO = `${REPO_WORKER}@sha256:velho`;
const DIGEST_NOVO = `${REPO_WORKER}@sha256:novo`;

function fabricarJwt(expSegundos: number): string {
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ exp: expSegundos })}.assinatura-falsa`;
}

const EXPIRA_EM_UM_ANO = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
const TOKEN_VALIDO = fabricarJwt(EXPIRA_EM_UM_ANO);

interface OrchestratorFake extends ContainerOrchestrator {
  eventos: string[];
  workers: WorkerStatus[];
  inspecoes: Record<string, WorkerInspect>;
  criados: WorkerConfig[];
  updaters: UpdaterConfig[];
  falharPull: boolean;
  falharCreate: ((cfg: WorkerConfig) => boolean) | null;
  rollbackAoCriarUpdater: string | null;
}

function criarOrchestratorFake(dir: string): OrchestratorFake {
  const fake: OrchestratorFake = {
    eventos: [],
    workers: [],
    inspecoes: {},
    criados: [],
    updaters: [],
    falharPull: false,
    falharCreate: null,
    rollbackAoCriarUpdater: null,
    createWorker: vi.fn(async (cfg: WorkerConfig) => {
      if (fake.falharCreate?.(cfg)) {
        fake.eventos.push(`createWorkerFalhou:${cfg.accountId}`);
        throw new Error(`docker recusou criar ${cfg.accountId}`);
      }
      fake.criados.push(cfg);
      fake.eventos.push(`createWorker:${cfg.accountId}`);
      return `novo-${fake.criados.length}`;
    }),
    startWorker: vi.fn(async (id: string) => {
      fake.eventos.push(`startWorker:${id}`);
    }),
    stopWorker: vi.fn(async (id: string) => {
      fake.eventos.push(`stopWorker:${id}`);
    }),
    removeWorker: vi.fn(async (id: string) => {
      fake.eventos.push(`removeWorker:${id}`);
    }),
    listWorkers: vi.fn(async () => fake.workers),
    workerLogs: vi.fn(async () => ""),
    followLogs: vi.fn(async () => async () => {}),
    pullImage: vi.fn(async (ref: string) => {
      fake.eventos.push(`pullImage:${ref}`);
      if (fake.falharPull) throw new Error("registry indisponível");
    }),
    inspectWorker: vi.fn(async (id: string) => {
      fake.eventos.push(`inspectWorker:${id}`);
      const insp = fake.inspecoes[id];
      if (!insp) throw new Error(`container desconhecido: ${id}`);
      return insp;
    }),
    createUpdater: vi.fn(async (cfg: UpdaterConfig) => {
      fake.updaters.push(cfg);
      fake.eventos.push(`createUpdater:${cfg.imageRef}`);
      try {
        fake.rollbackAoCriarUpdater = await readFile(
          path.join(dir, "rollback.json"),
          "utf8",
        );
      } catch {
        fake.rollbackAoCriarUpdater = null;
      }
      return "updater-1";
    }),
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

function inspecaoPadrao(accountId: string): WorkerInspect {
  return {
    env: {
      ACCOUNT_ID: accountId,
      GAME_URL: "https://jogo.test",
      POKEIDLE_USER: `user-${accountId}`,
      POKEIDLE_PASS: "senha-secreta",
      ACCESS_TOKEN: `access-velho-${accountId}`,
      REFRESH_TOKEN: `refresh-velho-${accountId}`,
    },
    labels: {
      "mpw.managed": "true",
      "mpw.account-id": accountId,
      "minha-label": accountId,
    },
    image: DIGEST_ANTIGO,
    imageRef: `${REPO_WORKER}:1.0.0`,
  };
}

function criarSupervisorFake(
  eventos: string[],
  tokens: Record<string, TokensRenovados> = {},
): ControleSupervisor {
  return {
    pausar: (accountId: string) => {
      eventos.push(`pausar:${accountId}`);
    },
    retomar: (accountId: string) => {
      eventos.push(`retomar:${accountId}`);
    },
    tokensConhecidos: (accountId: string) => tokens[accountId] ?? null,
  };
}

interface StubRedeOpts {
  versao: string;
  sequenciaSaude?: Record<string, { state: string }[]>;
  statusCentral?: number;
}

interface ChamadaRede {
  url: string;
  authorization: string | null;
}

function stubFetchRede(eventos: string[], opcoes: StubRedeOpts): ChamadaRede[] {
  const chamadas: ChamadaRede[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const headers = new Headers(init?.headers);
      chamadas.push({ url: u, authorization: headers.get("authorization") });
      if (u.includes("/version")) {
        if (opcoes.statusCentral) {
          return new Response(JSON.stringify({ error: "x" }), { status: opcoes.statusCentral });
        }
        return new Response(
          JSON.stringify({ version: opcoes.versao, imageDigest: null, changelog: "" }),
          { status: 200 },
        );
      }
      if (u.includes(":3001/health")) {
        const conta = /mpw-worker-(.+):3001/.exec(u)?.[1] ?? "";
        const sequencia = opcoes.sequenciaSaude?.[conta];
        const corpo = (sequencia && sequencia.length > 1 ? sequencia.shift() : sequencia?.[0]) ?? {
          state: "in-game",
        };
        eventos.push(`health:${conta}:${corpo.state}`);
        return new Response(JSON.stringify(corpo), { status: 200 });
      }
      throw new Error(`url inesperada no stub: ${u}`);
    }),
  );
  return chamadas;
}

function criarManager(
  dir: string,
  orchestrator: OrchestratorFake,
  parciais?: Partial<ConstructorParameters<typeof UpdateManager>[0]>,
): UpdateManager {
  const sessionStore = new SessionStore(dir, "http://central.test");
  sessionStore.definirAccess(TOKEN_VALIDO);
  return new UpdateManager({
    dataDir: dir,
    centralApiUrl: "http://central.test",
    sessionStore,
    orchestrator,
    supervisor: criarSupervisorFake(orchestrator.eventos),
    workerImage: `${REPO_WORKER}:1.0.0`,
    currentVersion: "1.0.0",
    healthPollMs: 5,
    ...parciais,
  });
}

describe("UpdateManager", () => {
  let dir: string;
  let orchestrator: OrchestratorFake;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "update-manager-test-"));
    orchestrator = criarOrchestratorFake(dir);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("consulta /version do canal stable com Bearer da sessão", async () => {
    const chamadas = stubFetchRede(orchestrator.eventos, { versao: "1.0.0" });
    const manager = criarManager(dir, orchestrator);

    await manager.checkForUpdate();

    expect(chamadas).toEqual([
      { url: "http://central.test/version?channel=stable", authorization: `Bearer ${TOKEN_VALIDO}` },
    ]);
  });

  it("rolling recria um worker por vez, só tocando no próximo após o anterior saudável", async () => {
    orchestrator.workers = [workerRodando("acc1", "w1"), workerRodando("acc2", "w2")];
    orchestrator.inspecoes = { w1: inspecaoPadrao("acc1"), w2: inspecaoPadrao("acc2") };
    stubFetchRede(orchestrator.eventos, {
      versao: "1.1.0",
      sequenciaSaude: {
        acc1: [{ state: "booting" }, { state: "booting" }, { state: "in-game" }],
      },
    });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: true });

    await manager.checkForUpdate();

    expect(orchestrator.eventos).toEqual([
      `pullImage:${REPO_WORKER}:1.1.0`,
      "inspectWorker:w1",
      "inspectWorker:w2",
      "pausar:acc1",
      "stopWorker:w1",
      "removeWorker:w1",
      "createWorker:acc1",
      "startWorker:novo-1",
      "health:acc1:booting",
      "health:acc1:booting",
      "health:acc1:in-game",
      "retomar:acc1",
      "pausar:acc2",
      "stopWorker:w2",
      "removeWorker:w2",
      "createWorker:acc2",
      "startWorker:novo-2",
      "health:acc2:in-game",
      "retomar:acc2",
      `pullImage:${REPO_UPDATER}:1.1.0`,
      `createUpdater:${REPO_UPDATER}:1.1.0`,
      "startWorker:updater-1",
    ]);
    expect(orchestrator.criados[0]).toMatchObject({
      accountId: "acc1",
      imageRef: `${REPO_WORKER}:1.1.0`,
      env: inspecaoPadrao("acc1").env,
    });
    expect(orchestrator.criados[0].labels).toEqual({ "minha-label": "acc1" });
    expect(orchestrator.criados[1]).toMatchObject({
      accountId: "acc2",
      imageRef: `${REPO_WORKER}:1.1.0`,
      env: inspecaoPadrao("acc2").env,
    });
    expect((await manager.getStatus()).state).toBe("idle");
  });

  it("worker recriado recebe os tokens renovados conhecidos pelo supervisor", async () => {
    orchestrator.workers = [workerRodando("acc1", "w1"), workerRodando("acc2", "w2")];
    orchestrator.inspecoes = { w1: inspecaoPadrao("acc1"), w2: inspecaoPadrao("acc2") };
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator, {
      autoUpdateEnv: true,
      supervisor: criarSupervisorFake(orchestrator.eventos, {
        acc1: { accessToken: "access-novo", refreshToken: "refresh-novo" },
      }),
    });

    await manager.checkForUpdate();

    expect(orchestrator.criados[0].env).toEqual({
      ...inspecaoPadrao("acc1").env,
      ACCESS_TOKEN: "access-novo",
      REFRESH_TOKEN: "refresh-novo",
    });
    expect(orchestrator.criados[1].env).toEqual(inspecaoPadrao("acc2").env);
  });

  it("worker que não fica saudável no timeout volta para a imagem antiga e aborta o rolling", async () => {
    orchestrator.workers = [workerRodando("acc1", "w1"), workerRodando("acc2", "w2")];
    orchestrator.inspecoes = { w1: inspecaoPadrao("acc1"), w2: inspecaoPadrao("acc2") };
    stubFetchRede(orchestrator.eventos, {
      versao: "1.1.0",
      sequenciaSaude: { acc1: [{ state: "booting" }] },
    });
    const manager = criarManager(dir, orchestrator, {
      autoUpdateEnv: true,
      healthTimeoutMs: 30,
    });

    await manager.checkForUpdate();

    expect(orchestrator.eventos.filter((e) => !e.startsWith("health:"))).toEqual([
      `pullImage:${REPO_WORKER}:1.1.0`,
      "inspectWorker:w1",
      "inspectWorker:w2",
      "pausar:acc1",
      "stopWorker:w1",
      "removeWorker:w1",
      "createWorker:acc1",
      "startWorker:novo-1",
      "stopWorker:novo-1",
      "removeWorker:novo-1",
      "createWorker:acc1",
      "startWorker:novo-2",
      "retomar:acc1",
    ]);
    expect(orchestrator.criados.map((c) => c.imageRef)).toEqual([
      `${REPO_WORKER}:1.1.0`,
      DIGEST_ANTIGO,
    ]);
    expect(orchestrator.criados[1].env).toEqual(inspecaoPadrao("acc1").env);
    expect(orchestrator.updaters).toHaveLength(0);
    const status = await manager.getStatus();
    expect(status.state).toBe("update_failed");
    expect(status.lastError).toContain("acc1");
    const rollback = JSON.parse(await readFile(path.join(dir, "rollback.json"), "utf8")) as {
      digestAnterior: string;
    };
    expect(rollback.digestAnterior).toBe(DIGEST_ANTIGO);
  });

  it("falha no create do worker 2 recria-o com a imagem antiga e aborta sem updater", async () => {
    orchestrator.workers = [workerRodando("acc1", "w1"), workerRodando("acc2", "w2")];
    orchestrator.inspecoes = { w1: inspecaoPadrao("acc1"), w2: inspecaoPadrao("acc2") };
    orchestrator.falharCreate = (cfg) =>
      cfg.accountId === "acc2" && cfg.imageRef === `${REPO_WORKER}:1.1.0`;
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: true });

    await manager.checkForUpdate();

    expect(orchestrator.eventos.slice(orchestrator.eventos.indexOf("pausar:acc2"))).toEqual([
      "pausar:acc2",
      "stopWorker:w2",
      "removeWorker:w2",
      "createWorkerFalhou:acc2",
      "createWorker:acc2",
      "startWorker:novo-2",
      "retomar:acc2",
    ]);
    expect(orchestrator.criados[1]).toMatchObject({
      accountId: "acc2",
      imageRef: DIGEST_ANTIGO,
      env: inspecaoPadrao("acc2").env,
      labels: { "minha-label": "acc2" },
    });
    expect(orchestrator.updaters).toHaveLength(0);
    const status = await manager.getStatus();
    expect(status.state).toBe("update_failed");
    expect(status.lastError).toBe("docker recusou criar acc2");
  });

  it("falha também na compensação registra os dois erros no lastError sem expor env", async () => {
    orchestrator.workers = [workerRodando("acc1", "w1")];
    orchestrator.inspecoes = { w1: inspecaoPadrao("acc1") };
    orchestrator.falharCreate = () => true;
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: true });

    await manager.checkForUpdate();

    expect(orchestrator.eventos).toContain("retomar:acc1");
    const status = await manager.getStatus();
    expect(status.state).toBe("update_failed");
    expect(status.lastError).toContain("docker recusou criar acc1");
    expect(status.lastError).toMatch(/compensação.*docker recusou criar acc1/);
    expect(status.lastError).not.toContain("senha-secreta");
    expect(status.lastError).not.toContain("refresh-velho");
  });

  it("retry após rolling parcial preserva o rollback.json com o digest original", async () => {
    orchestrator.workers = [workerRodando("acc1", "w1"), workerRodando("acc2", "w2")];
    orchestrator.inspecoes = { w1: inspecaoPadrao("acc1"), w2: inspecaoPadrao("acc2") };
    orchestrator.falharCreate = (cfg) =>
      cfg.accountId === "acc2" && cfg.imageRef === `${REPO_WORKER}:1.1.0`;
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator);
    await manager.checkForUpdate();
    expect(await manager.applyUpdate()).toBe("falhou");
    const original = await readFile(path.join(dir, "rollback.json"), "utf8");

    orchestrator.falharCreate = null;
    orchestrator.workers = [workerRodando("acc1", "novo-1"), workerRodando("acc2", "novo-2")];
    orchestrator.inspecoes = {
      "novo-1": { ...inspecaoPadrao("acc1"), image: DIGEST_NOVO, imageRef: `${REPO_WORKER}:1.1.0` },
      "novo-2": { ...inspecaoPadrao("acc2"), imageRef: DIGEST_ANTIGO },
    };
    expect(await manager.applyUpdate()).toBe("ok");

    expect(await readFile(path.join(dir, "rollback.json"), "utf8")).toBe(original);
    expect(JSON.parse(original)).toMatchObject({ versaoAnterior: "1.0.0", digestAnterior: DIGEST_ANTIGO });
  });

  it("digestAnterior ignora workers que já estão na imagem nova", async () => {
    orchestrator.workers = [workerRodando("acc1", "w1"), workerRodando("acc2", "w2")];
    orchestrator.inspecoes = {
      w1: { ...inspecaoPadrao("acc1"), image: DIGEST_NOVO, imageRef: `${REPO_WORKER}:1.1.0` },
      w2: inspecaoPadrao("acc2"),
    };
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: true });

    await manager.checkForUpdate();

    expect(JSON.parse(orchestrator.rollbackAoCriarUpdater ?? "")).toMatchObject({
      digestAnterior: DIGEST_ANTIGO,
    });
  });

  it("rollback.json de uma versão anterior à atual é substituído", async () => {
    await writeFile(
      path.join(dir, "rollback.json"),
      JSON.stringify({ versaoAnterior: "0.9.0", digestAnterior: `${REPO_WORKER}@sha256:muito-velho`, ts: "2026-01-01T00:00:00.000Z" }),
    );
    orchestrator.workers = [workerRodando("acc1", "w1")];
    orchestrator.inspecoes = { w1: inspecaoPadrao("acc1") };
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: true });

    await manager.checkForUpdate();

    expect(JSON.parse(orchestrator.rollbackAoCriarUpdater ?? "")).toMatchObject({
      versaoAnterior: "1.0.0",
      digestAnterior: DIGEST_ANTIGO,
    });
  });

  it("falha no pull aborta sem tocar em workers nem updater e expõe update_failed", async () => {
    orchestrator.workers = [workerRodando("acc1", "w1")];
    orchestrator.inspecoes = { w1: inspecaoPadrao("acc1") };
    orchestrator.falharPull = true;
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: true });

    await manager.checkForUpdate();

    expect(orchestrator.eventos).toEqual([`pullImage:${REPO_WORKER}:1.1.0`]);
    expect(orchestrator.criados).toHaveLength(0);
    expect(orchestrator.updaters).toHaveLength(0);
    await expect(readFile(path.join(dir, "rollback.json"), "utf8")).rejects.toThrow();
    const status = await manager.getStatus();
    expect(status.state).toBe("update_failed");
    expect(status.lastError).toContain("registry indisponível");
    expect(status.updateAvailable).toBe(true);
  });

  it("update_failed continua exposto após novo check sem auto-update", async () => {
    orchestrator.falharPull = true;
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator);
    await manager.checkForUpdate();
    expect(await manager.applyUpdate()).toBe("falhou");

    await manager.checkForUpdate();

    const status = await manager.getStatus();
    expect(status.state).toBe("update_failed");
    expect(status.lastError).toContain("registry indisponível");
  });

  it("grava rollback.json antes de criar o updater", async () => {
    orchestrator.workers = [workerRodando("acc1", "w1")];
    orchestrator.inspecoes = { w1: inspecaoPadrao("acc1") };
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: true });

    await manager.checkForUpdate();

    expect(orchestrator.rollbackAoCriarUpdater).not.toBeNull();
    const dados = JSON.parse(orchestrator.rollbackAoCriarUpdater ?? "") as {
      versaoAnterior: string;
      digestAnterior: string;
      ts: string;
    };
    expect(dados.versaoAnterior).toBe("1.0.0");
    expect(dados.digestAnterior).toBe(DIGEST_ANTIGO);
    expect(Number.isNaN(Date.parse(dados.ts))).toBe(false);
  });

  it("sobe updater efêmero com TARGET_TAG e imagem própria, sem criá-lo como worker", async () => {
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: true });

    await manager.checkForUpdate();

    expect(orchestrator.updaters).toEqual([
      { imageRef: `${REPO_UPDATER}:1.1.0`, targetTag: "1.1.0" },
    ]);
    expect(orchestrator.criados).toHaveLength(0);
    expect(orchestrator.eventos).toEqual([
      `pullImage:${REPO_WORKER}:1.1.0`,
      `pullImage:${REPO_UPDATER}:1.1.0`,
      `createUpdater:${REPO_UPDATER}:1.1.0`,
      "startWorker:updater-1",
    ]);
  });

  it("mesma versão é no-op", async () => {
    stubFetchRede(orchestrator.eventos, { versao: "1.0.0" });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: true });

    await manager.checkForUpdate();

    expect(orchestrator.eventos).toEqual([]);
    const status = await manager.getStatus();
    expect(status.updateAvailable).toBe(false);
    expect(status.latestVersion).toBe("1.0.0");
    expect(status.state).toBe("idle");
    expect(status.lastCheck).not.toBeNull();
  });

  it("central sem release no canal (404) não indica atualização nem erro", async () => {
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0", statusCentral: 404 });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: true });

    await manager.checkForUpdate();

    expect(orchestrator.eventos).toEqual([]);
    const status = await manager.getStatus();
    expect(status.updateAvailable).toBe(false);
    expect(status.latestVersion).toBeNull();
    expect(status.lastError).toBeNull();
  });

  it("falha de auth no check só registra lastError e nunca toca em workers", async () => {
    orchestrator.workers = [workerRodando("acc1", "w1")];
    const chamadas = stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = new UpdateManager({
      dataDir: dir,
      centralApiUrl: "http://central.test",
      sessionStore: new SessionStore(dir, "http://central.test"),
      orchestrator,
      supervisor: criarSupervisorFake(orchestrator.eventos),
      workerImage: `${REPO_WORKER}:1.0.0`,
      currentVersion: "1.0.0",
      autoUpdateEnv: true,
    });

    await manager.checkForUpdate();

    expect(chamadas).toEqual([]);
    expect(orchestrator.eventos).toEqual([]);
    expect(orchestrator.stopWorker).not.toHaveBeenCalled();
    const status = await manager.getStatus();
    expect(status.state).toBe("idle");
    expect(status.lastError).toContain("sem sessão");
    expect(status.lastCheck).not.toBeNull();
  });

  it("settings.json desligado tem precedência sobre AUTO_UPDATE=true da env", async () => {
    await writeFile(path.join(dir, "settings.json"), JSON.stringify({ autoUpdate: false }));
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: true });

    await manager.checkForUpdate();

    expect(orchestrator.eventos).toEqual([]);
    const status = await manager.getStatus();
    expect(status.updateAvailable).toBe(true);
    expect(status.autoUpdate).toBe(false);
    expect(status.state).toBe("idle");
  });

  it("settings.json ligado tem precedência sobre AUTO_UPDATE ausente da env", async () => {
    await writeFile(path.join(dir, "settings.json"), JSON.stringify({ autoUpdate: true }));
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: false });

    await manager.checkForUpdate();

    expect(orchestrator.eventos[0]).toBe(`pullImage:${REPO_WORKER}:1.1.0`);
    expect((await manager.getStatus()).autoUpdate).toBe(true);
  });

  it("setAutoUpdate preserva outras chaves de settings.json", async () => {
    await writeFile(path.join(dir, "settings.json"), JSON.stringify({ outra: 1 }));
    const manager = criarManager(dir, orchestrator);

    await manager.setAutoUpdate(true);

    expect(JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"))).toEqual({
      outra: 1,
      autoUpdate: true,
    });
  });

  it("rollback recria workers com o digest anterior e limpa rollback.json", async () => {
    await writeFile(
      path.join(dir, "rollback.json"),
      JSON.stringify({ versaoAnterior: "1.0.0", digestAnterior: DIGEST_ANTIGO, ts: new Date().toISOString() }),
    );
    orchestrator.workers = [workerRodando("acc1", "w1"), workerRodando("acc2", "w2")];
    orchestrator.inspecoes = { w1: inspecaoPadrao("acc1"), w2: inspecaoPadrao("acc2") };
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator);

    expect(await manager.rollback()).toBe("ok");

    expect(orchestrator.eventos).toEqual([
      `pullImage:${DIGEST_ANTIGO}`,
      "inspectWorker:w1",
      "inspectWorker:w2",
      "pausar:acc1",
      "stopWorker:w1",
      "removeWorker:w1",
      "createWorker:acc1",
      "startWorker:novo-1",
      "health:acc1:in-game",
      "retomar:acc1",
      "pausar:acc2",
      "stopWorker:w2",
      "removeWorker:w2",
      "createWorker:acc2",
      "startWorker:novo-2",
      "health:acc2:in-game",
      "retomar:acc2",
    ]);
    expect(orchestrator.criados.map((c) => c.imageRef)).toEqual([DIGEST_ANTIGO, DIGEST_ANTIGO]);
    expect(orchestrator.criados[0].env).toEqual(inspecaoPadrao("acc1").env);
    expect(orchestrator.updaters).toHaveLength(0);
    await expect(readFile(path.join(dir, "rollback.json"), "utf8")).rejects.toThrow();
    expect((await manager.getStatus()).state).toBe("idle");
  });

  it("rollback com falha no pull mantém rollback.json e expõe o erro", async () => {
    await writeFile(
      path.join(dir, "rollback.json"),
      JSON.stringify({ versaoAnterior: "1.0.0", digestAnterior: DIGEST_ANTIGO, ts: new Date().toISOString() }),
    );
    orchestrator.workers = [workerRodando("acc1", "w1")];
    orchestrator.falharPull = true;
    const manager = criarManager(dir, orchestrator);

    expect(await manager.rollback()).toBe("falhou");

    expect(orchestrator.eventos).toEqual([`pullImage:${DIGEST_ANTIGO}`]);
    await expect(readFile(path.join(dir, "rollback.json"), "utf8")).resolves.toContain(DIGEST_ANTIGO);
    const status = await manager.getStatus();
    expect(status.state).toBe("update_failed");
    expect(status.lastError).toContain("registry indisponível");
  });

  it("rollback sem rollback.json não toca em nada", async () => {
    const manager = criarManager(dir, orchestrator);

    expect(await manager.rollback()).toBe("sem_rollback");
    expect(orchestrator.eventos).toEqual([]);
  });

  it("check periódico dispara no intervalo configurado", async () => {
    vi.useFakeTimers();
    const chamadas = stubFetchRede(orchestrator.eventos, { versao: "1.0.0" });
    const manager = criarManager(dir, orchestrator, { checkIntervalMs: 6 * 3600 * 1000 });
    const chamadasVersao = () => chamadas.filter((c) => c.url.includes("/version")).length;

    manager.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(chamadasVersao()).toBe(1);

    await vi.advanceTimersByTimeAsync(6 * 3600 * 1000 - 2);
    expect(chamadasVersao()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(chamadasVersao()).toBe(2);

    await vi.advanceTimersByTimeAsync(6 * 3600 * 1000);
    expect(chamadasVersao()).toBe(3);

    manager.stop();
    await vi.advanceTimersByTimeAsync(6 * 3600 * 1000);
    expect(chamadasVersao()).toBe(3);
  });

  it("update manual via applyUpdate aplica a versão descoberta no último check", async () => {
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator, { autoUpdateEnv: false });

    await manager.checkForUpdate();
    expect(orchestrator.eventos).toEqual([]);

    expect(await manager.applyUpdate()).toBe("ok");
    expect(orchestrator.updaters).toEqual([
      { imageRef: `${REPO_UPDATER}:1.1.0`, targetTag: "1.1.0" },
    ]);
  });

  it("applyUpdate sem atualização disponível não toca em nada", async () => {
    stubFetchRede(orchestrator.eventos, { versao: "1.0.0" });
    const manager = criarManager(dir, orchestrator);

    await manager.checkForUpdate();

    expect(await manager.applyUpdate()).toBe("sem_atualizacao");
    expect(orchestrator.eventos).toEqual([]);
  });

  it("applyUpdate durante outro update retorna ocupado", async () => {
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    const manager = criarManager(dir, orchestrator);
    await manager.checkForUpdate();

    const primeiro = manager.applyUpdate();
    const segundo = await manager.applyUpdate();

    expect(segundo).toBe("ocupado");
    expect(await primeiro).toBe("ok");
    expect(orchestrator.updaters).toHaveLength(1);
  });
});

describe("rotas /update", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessionStore: SessionStore;
  let updateManager: UpdateManager;
  let orchestrator: OrchestratorFake;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "update-routes-test-"));
    orchestrator = criarOrchestratorFake(dir);
    const built = buildApp({
      dataDir: dir,
      centralApiUrl: "http://central.test",
      orchestrator,
      workerImage: `${REPO_WORKER}:1.0.0`,
      currentVersion: "1.0.0",
      autoUpdate: false,
    });
    app = built.app;
    sessionStore = built.sessionStore;
    updateManager = built.updateManager;
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

  it("GET /update/status exige sessão", async () => {
    const resposta = await app.inject({ method: "GET", url: "/update/status" });
    expect(resposta.statusCode).toBe(401);
    expect(orchestrator.eventos).toEqual([]);
  });

  it("GET /update/status retorna o estado atual", async () => {
    sessionStore.definirAccess(TOKEN_VALIDO);
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    await updateManager.checkForUpdate();

    const resposta = await app.inject({ method: "GET", url: "/update/status" });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      updateAvailable: true,
      autoUpdate: false,
      state: "idle",
      lastError: null,
    });
    expect(typeof resposta.json().lastCheck).toBe("string");
  });

  it("GET /update/status funciona com central fora (grace)", async () => {
    await semearGrace();

    const resposta = await app.inject({ method: "GET", url: "/update/status" });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ currentVersion: "1.0.0", state: "idle" });
  });

  it("POST /update/settings persiste em settings.json e tem precedência", async () => {
    sessionStore.definirAccess(TOKEN_VALIDO);

    const resposta = await app.inject({
      method: "POST",
      url: "/update/settings",
      payload: { autoUpdate: true },
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ autoUpdate: true });
    const gravado = JSON.parse(
      await readFile(path.join(dir, "settings.json"), "utf8"),
    ) as { autoUpdate: boolean };
    expect(gravado.autoUpdate).toBe(true);
    expect((await updateManager.getStatus()).autoUpdate).toBe(true);
  });

  it("POST /update/settings com corpo inválido retorna 400", async () => {
    sessionStore.definirAccess(TOKEN_VALIDO);

    const resposta = await app.inject({
      method: "POST",
      url: "/update/settings",
      payload: { autoUpdate: "sim" },
    });

    expect(resposta.statusCode).toBe(400);
    await expect(readFile(path.join(dir, "settings.json"), "utf8")).rejects.toThrow();
  });

  it("POST /update/settings com central fora retorna 503", async () => {
    await semearGrace();

    const resposta = await app.inject({
      method: "POST",
      url: "/update/settings",
      payload: { autoUpdate: true },
    });

    expect(resposta.statusCode).toBe(503);
    await expect(readFile(path.join(dir, "settings.json"), "utf8")).rejects.toThrow();
  });

  it("POST /update/apply dispara o update da versão descoberta", async () => {
    sessionStore.definirAccess(TOKEN_VALIDO);
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    await updateManager.checkForUpdate();

    const resposta = await app.inject({ method: "POST", url: "/update/apply" });

    expect(resposta.statusCode).toBe(200);
    expect(orchestrator.updaters).toEqual([
      { imageRef: `${REPO_UPDATER}:1.1.0`, targetTag: "1.1.0" },
    ]);
  });

  it("POST /update/apply com falha de pull retorna 502 com status update_failed", async () => {
    sessionStore.definirAccess(TOKEN_VALIDO);
    stubFetchRede(orchestrator.eventos, { versao: "1.1.0" });
    await updateManager.checkForUpdate();
    orchestrator.falharPull = true;

    const resposta = await app.inject({ method: "POST", url: "/update/apply" });

    expect(resposta.statusCode).toBe(502);
    expect(resposta.json().status).toMatchObject({
      state: "update_failed",
      lastError: "registry indisponível",
    });
  });

  it("POST /update/apply sem atualização disponível retorna 400", async () => {
    sessionStore.definirAccess(TOKEN_VALIDO);
    stubFetchRede(orchestrator.eventos, { versao: "1.0.0" });
    await updateManager.checkForUpdate();

    const resposta = await app.inject({ method: "POST", url: "/update/apply" });

    expect(resposta.statusCode).toBe(400);
    expect(orchestrator.eventos).toEqual([]);
  });

  it("POST /update/apply com central fora retorna 503 sem tocar em workers", async () => {
    await semearGrace();
    orchestrator.workers = [workerRodando("acc1", "w1")];

    const resposta = await app.inject({ method: "POST", url: "/update/apply" });

    expect(resposta.statusCode).toBe(503);
    expect(orchestrator.eventos).toEqual([]);
  });

  it("POST /update/rollback funciona com central fora (grace)", async () => {
    await semearGrace();
    await writeFile(
      path.join(dir, "rollback.json"),
      JSON.stringify({ versaoAnterior: "1.0.0", digestAnterior: DIGEST_ANTIGO, ts: new Date().toISOString() }),
    );

    const resposta = await app.inject({ method: "POST", url: "/update/rollback" });

    expect(resposta.statusCode).toBe(200);
    expect(orchestrator.eventos).toEqual([`pullImage:${DIGEST_ANTIGO}`]);
    await expect(readFile(path.join(dir, "rollback.json"), "utf8")).rejects.toThrow();
  });

  it("POST /update/rollback sem rollback.json retorna 404", async () => {
    sessionStore.definirAccess(TOKEN_VALIDO);

    const resposta = await app.inject({ method: "POST", url: "/update/rollback" });

    expect(resposta.statusCode).toBe(404);
    expect(orchestrator.eventos).toEqual([]);
  });
});
