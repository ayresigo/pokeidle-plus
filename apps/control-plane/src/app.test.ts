import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type { ContainerOrchestrator } from "./orchestrator/types.js";

function orchestratorFake(): ContainerOrchestrator {
  return {
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
    inspectUpdater: vi.fn(async () => null),
    removeUpdater: vi.fn(async () => {}),
    createOneShot: vi.fn(async () => "oneshot"),
    waitOneShot: vi.fn(async () => ({ exitCode: 0, stdout: "" })),
    removeOneShot: vi.fn(async () => {}),
  };
}

async function versaoAtual(): Promise<string> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "app-test-"));
  const { app, updateManager } = buildApp({ dataDir, orchestrator: orchestratorFake() });
  const status = await updateManager.getStatus();
  await app.close();
  return status.currentVersion;
}

describe("buildApp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("responde GET /health com status ok", async () => {
    const { app } = buildApp();
    const resposta = await app.inject({ method: "GET", url: "/health" });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("usa APP_VERSION embutida na imagem como versão atual", async () => {
    vi.stubEnv("CURRENT_VERSION", "");
    vi.stubEnv("APP_VERSION", "1.2.3");
    expect(await versaoAtual()).toBe("1.2.3");
  });

  it("CURRENT_VERSION explícita tem precedência sobre APP_VERSION", async () => {
    vi.stubEnv("CURRENT_VERSION", "9.9.9");
    vi.stubEnv("APP_VERSION", "1.2.3");
    expect(await versaoAtual()).toBe("9.9.9");
  });

  it("cai para dev sem nenhuma versão definida", async () => {
    vi.stubEnv("CURRENT_VERSION", "");
    vi.stubEnv("APP_VERSION", "");
    expect(await versaoAtual()).toBe("dev");
  });

  it("deriva imagens de worker e updater de IMAGE_REGISTRY", async () => {
    vi.stubEnv("IMAGE_REGISTRY", "registry.local/eu");
    vi.stubEnv("WORKER_IMAGE", "");
    const orchestrator = orchestratorFake();
    const dataDir = await mkdtemp(path.join(tmpdir(), "app-test-"));
    const { app, updateManager } = buildApp({ dataDir, orchestrator });
    const interno = updateManager as unknown as { repoWorker: string; repoUpdater: string };
    expect(interno.repoWorker).toBe("registry.local/eu/mpw-worker");
    expect(interno.repoUpdater).toBe("registry.local/eu/mpw-updater");
    await app.close();
  });

  async function imagemDoWorker(): Promise<string> {
    const dataDir = await mkdtemp(path.join(tmpdir(), "app-test-"));
    const { app, updateManager } = buildApp({ dataDir, orchestrator: orchestratorFake() });
    const interno = updateManager as unknown as { opts: { workerImage: string } };
    await app.close();
    return interno.opts.workerImage;
  }

  it("sem WORKER_IMAGE usa o worker da mesma versão do control-plane", async () => {
    vi.stubEnv("IMAGE_REGISTRY", "registry.local/eu");
    vi.stubEnv("WORKER_IMAGE", "");
    vi.stubEnv("CURRENT_VERSION", "");
    vi.stubEnv("APP_VERSION", "1.3.0");
    expect(await imagemDoWorker()).toBe("registry.local/eu/mpw-worker:1.3.0");
  });

  it("sem WORKER_IMAGE em dev usa o worker :stable", async () => {
    vi.stubEnv("IMAGE_REGISTRY", "registry.local/eu");
    vi.stubEnv("WORKER_IMAGE", "");
    vi.stubEnv("CURRENT_VERSION", "");
    vi.stubEnv("APP_VERSION", "");
    expect(await imagemDoWorker()).toBe("registry.local/eu/mpw-worker:stable");
  });

  it("WORKER_IMAGE explícita tem precedência", async () => {
    vi.stubEnv("WORKER_IMAGE", "meu/worker:x");
    vi.stubEnv("APP_VERSION", "1.3.0");
    expect(await imagemDoWorker()).toBe("meu/worker:x");
  });
});
