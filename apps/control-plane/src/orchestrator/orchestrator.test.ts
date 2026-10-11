import Docker from "dockerode";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DockerOrchestrator } from "./orchestrator.js";
import type { WorkerStatus } from "./types.js";

const sonda = new Docker();
const dockerDisponivel = await sonda
  .ping()
  .then(() => true)
  .catch(() => false);

describe.skipIf(!dockerDisponivel)("DockerOrchestrator", () => {
  const docker = new Docker();
  const orchestrator = new DockerOrchestrator(docker);
  const criados: string[] = [];
  const IMAGEM = "alpine:latest";
  let seq = 0;

  beforeAll(async () => {
    await orchestrator.pullImage(IMAGEM);
  }, 180_000);

  afterEach(async () => {
    while (criados.length > 0) {
      const id = criados.pop()!;
      await docker
        .getContainer(id)
        .remove({ force: true })
        .catch(() => {});
    }
  });

  function accountId(): string {
    seq += 1;
    return `test-${Date.now()}-${seq}`;
  }

  async function criarWorker(conta: string): Promise<string> {
    const id = await orchestrator.createWorker({
      accountId: conta,
      imageRef: IMAGEM,
      env: { FOO: "bar" },
      cmd: ["sleep", "3600"],
    });
    criados.push(id);
    return id;
  }

  it(
    "ciclo create→start→running→stop→remove",
    async () => {
      const conta = accountId();
      const id = await criarWorker(conta);

      const inspecao = await docker.getContainer(id).inspect();
      expect(inspecao.Name).toBe(`/mpw-worker-${conta}`);
      expect(inspecao.Config.Labels?.["mpw.managed"]).toBe("true");
      expect(inspecao.Config.Labels?.["mpw.account-id"]).toBe(conta);
      expect(inspecao.Config.Env).toContain("FOO=bar");
      expect(inspecao.HostConfig.AutoRemove).toBe(false);
      expect(inspecao.HostConfig.RestartPolicy?.Name ?? "no").toBe("no");

      await orchestrator.startWorker(id);
      const rodando = await docker.getContainer(id).inspect();
      expect(rodando.State.Running).toBe(true);

      await orchestrator.stopWorker(id, 5);
      const parado = await docker.getContainer(id).inspect();
      expect(parado.State.Running).toBe(false);

      await orchestrator.removeWorker(id);
      criados.splice(criados.indexOf(id), 1);
      await expect(docker.getContainer(id).inspect()).rejects.toMatchObject({
        statusCode: 404,
      });
    },
    60_000,
  );

  it(
    "listWorkers filtra por label mpw.managed",
    async () => {
      const conta = accountId();
      const id = await criarWorker(conta);

      const intruso = await docker.createContainer({
        Image: IMAGEM,
        Cmd: ["sleep", "3600"],
        name: `mpw-intruso-${conta}`,
      });
      criados.push(intruso.id);

      const workers = await orchestrator.listWorkers();
      const ids = workers.map((w: WorkerStatus) => w.id);
      expect(ids).toContain(id);
      expect(ids).not.toContain(intruso.id);

      const status = workers.find((w) => w.id === id)!;
      expect(status.accountId).toBe(conta);
      expect(status.state).toBe("created");
      expect(status.restartCount).toBe(0);
      expect(status.startedAt).toBeNull();
    },
    60_000,
  );

  it(
    "workerLogs retorna saída do container",
    async () => {
      const conta = accountId();
      const marcador = `log-${conta}`;
      const id = await orchestrator.createWorker({
        accountId: conta,
        imageRef: IMAGEM,
        env: {},
        cmd: ["sh", "-c", `echo ${marcador} && echo err-${marcador} >&2 && sleep 3600`],
      });
      criados.push(id);
      await orchestrator.startWorker(id);

      await expect
        .poll(async () => orchestrator.workerLogs(id, 50), { timeout: 15_000 })
        .toContain(marcador);

      const logs = await orchestrator.workerLogs(id, 50);
      expect(logs).toContain(`err-${marcador}`);
    },
    60_000,
  );

  it(
    "createWorker com accountId duplicado falha com erro claro",
    async () => {
      const conta = accountId();
      await criarWorker(conta);

      await expect(
        orchestrator.createWorker({
          accountId: conta,
          imageRef: IMAGEM,
          env: {},
          cmd: ["sleep", "3600"],
        }),
      ).rejects.toThrow(new RegExp(`já existe.*${conta}|${conta}.*já existe`));
    },
    60_000,
  );

  it(
    "stopWorker em container parado e removeWorker inexistente são tolerantes",
    async () => {
      const conta = accountId();
      const id = await criarWorker(conta);

      await expect(orchestrator.stopWorker(id, 1)).resolves.toBeUndefined();
      await orchestrator.removeWorker(id);
      criados.splice(criados.indexOf(id), 1);
      await expect(orchestrator.removeWorker(id)).resolves.toBeUndefined();
    },
    60_000,
  );
});
