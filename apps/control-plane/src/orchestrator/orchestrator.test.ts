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

  it(
    "inspectWorker devolve env própria, labels e digest do repositório",
    async () => {
      const conta = accountId();
      const id = await orchestrator.createWorker({
        accountId: conta,
        imageRef: IMAGEM,
        env: { FOO: "bar", COM_IGUAL: "a=b" },
        labels: { "minha-label": "x" },
        cmd: ["sleep", "3600"],
      });
      criados.push(id);

      const inspecao = await orchestrator.inspectWorker(id);

      expect(inspecao.env).toEqual({ FOO: "bar", COM_IGUAL: "a=b" });
      expect(inspecao.labels).toMatchObject({
        "minha-label": "x",
        "mpw.managed": "true",
        "mpw.account-id": conta,
      });
      expect(inspecao.image).toMatch(/^alpine@sha256:[0-9a-f]{64}$/);
      expect(inspecao.imageRef).toBe(IMAGEM);
    },
    60_000,
  );

  it(
    "createUpdater cria mpw-updater com TARGET_TAG e socket, fora do listWorkers",
    async () => {
      const id = await orchestrator.createUpdater({
        imageRef: IMAGEM,
        targetTag: "9.9.9",
      });
      criados.push(id);

      const inspecao = await docker.getContainer(id).inspect();
      expect(inspecao.Name).toBe("/mpw-updater");
      expect(inspecao.Config.Env).toContain("TARGET_TAG=9.9.9");
      expect(inspecao.HostConfig.Binds).toContain(
        "/var/run/docker.sock:/var/run/docker.sock",
      );
      const workers = await orchestrator.listWorkers();
      expect(workers.map((w: WorkerStatus) => w.id)).not.toContain(id);
    },
    60_000,
  );

  it(
    "one-shot: roda, captura stdout e exit code 0, e é removido",
    async () => {
      const id = await orchestrator.createOneShot(IMAGEM, ["echo", "ok"]);
      criados.push(id);

      const resultado = await orchestrator.waitOneShot(id, 20_000);
      expect(resultado).toEqual({ exitCode: 0, stdout: "ok\n" });
      const workers = await orchestrator.listWorkers();
      expect(workers.map((w: WorkerStatus) => w.id)).not.toContain(id);

      await orchestrator.removeOneShot(id);
      await expect(docker.getContainer(id).inspect()).rejects.toMatchObject({
        statusCode: 404,
      });
    },
    60_000,
  );

  it(
    "one-shot: devolve exit code diferente de zero",
    async () => {
      const id = await orchestrator.createOneShot(IMAGEM, ["sh", "-c", "echo falhou >&2; exit 3"]);
      criados.push(id);

      const resultado = await orchestrator.waitOneShot(id, 20_000);
      expect(resultado).toEqual({ exitCode: 3, stdout: "" });

      await orchestrator.removeOneShot(id);
      await expect(docker.getContainer(id).inspect()).rejects.toMatchObject({
        statusCode: 404,
      });
    },
    60_000,
  );

  it(
    "one-shot: estoura timeout e remove container ainda rodando",
    async () => {
      const id = await orchestrator.createOneShot(IMAGEM, ["sleep", "60"]);
      criados.push(id);

      await expect(orchestrator.waitOneShot(id, 1_000)).rejects.toThrow(/timeout/);
      expect((await docker.getContainer(id).inspect()).State.Running).toBe(true);

      await orchestrator.removeOneShot(id);
      await expect(docker.getContainer(id).inspect()).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(orchestrator.removeOneShot(id)).resolves.toBeUndefined();
    },
    60_000,
  );
});
