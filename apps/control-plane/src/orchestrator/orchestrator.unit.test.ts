import type Docker from "dockerode";
import { describe, expect, it } from "vitest";
import { DockerOrchestrator, NOME_UPDATER } from "./orchestrator.js";

function erroHttp(statusCode: number): Error {
  return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });
}

function quadroDeLog(texto: string): Buffer {
  const corpo = Buffer.from(texto, "utf8");
  const cabecalho = Buffer.alloc(8);
  cabecalho.writeUInt8(2, 0);
  cabecalho.writeUInt32BE(corpo.length, 4);
  return Buffer.concat([cabecalho, corpo]);
}

interface DockerFake {
  docker: Docker;
  chamadas: string[];
  criados: Docker.ContainerCreateOptions[];
  inspects: Record<string, unknown>;
  logs: Record<string, Buffer>;
  falhasCreate404: number;
}

function criarDockerFake(): DockerFake {
  const fake: DockerFake = {
    docker: undefined as unknown as Docker,
    chamadas: [],
    criados: [],
    inspects: {},
    logs: {},
    falhasCreate404: 0,
  };
  fake.docker = {
    async createContainer(opcoes: Docker.ContainerCreateOptions) {
      fake.chamadas.push(`create:${opcoes.name ?? opcoes.Image}`);
      if (fake.falhasCreate404 > 0) {
        fake.falhasCreate404 -= 1;
        throw erroHttp(404);
      }
      fake.criados.push(opcoes);
      return { id: `id-${fake.criados.length}` };
    },
    async pull(ref: string) {
      fake.chamadas.push(`pull:${ref}`);
      return "stream";
    },
    modem: {
      followProgress(_stream: unknown, concluir: (erro: Error | null) => void) {
        concluir(null);
      },
    },
    getContainer(nome: string) {
      return {
        async inspect() {
          fake.chamadas.push(`inspect:${nome}`);
          const info = fake.inspects[nome];
          if (info === undefined) throw erroHttp(404);
          return info;
        },
        async remove(opcoes?: { force?: boolean }) {
          fake.chamadas.push(`remove:${nome}:${opcoes?.force === true ? "force" : ""}`);
          if (fake.inspects[nome] === undefined) throw erroHttp(404);
          delete fake.inspects[nome];
        },
        async logs(opcoes: { tail?: number }) {
          fake.chamadas.push(`logs:${nome}:${opcoes.tail}`);
          return fake.logs[nome] ?? Buffer.alloc(0);
        },
      };
    },
  } as unknown as Docker;
  return fake;
}

function inspectUpdater(estado: { Status: string; Running: boolean; ExitCode: number }) {
  return {
    Id: "updater-id",
    Config: { Env: ["PATH=/usr/bin", "TARGET_TAG=1.1.0"] },
    State: estado,
  };
}

describe("DockerOrchestrator (dockerode fake)", () => {
  it("createWorker baixa a imagem quando o create devolve 404 e tenta de novo", async () => {
    const fake = criarDockerFake();
    fake.falhasCreate404 = 1;
    const orchestrator = new DockerOrchestrator(fake.docker, "mpw");

    const id = await orchestrator.createWorker({
      accountId: "acc1",
      imageRef: "ghcr.io/x/mpw-worker:1.1.0",
      env: { FOO: "bar" },
    });

    expect(fake.chamadas).toEqual([
      "inspect:mpw-worker-acc1",
      "create:mpw-worker-acc1",
      "pull:ghcr.io/x/mpw-worker:1.1.0",
      "create:mpw-worker-acc1",
    ]);
    expect(id).toBe("id-1");
    expect(fake.criados[0]).toMatchObject({
      name: "mpw-worker-acc1",
      Image: "ghcr.io/x/mpw-worker:1.1.0",
      HostConfig: { NetworkMode: "mpw" },
    });
  });

  it("createUpdater substitui o mpw-updater anterior e cria sem AutoRemove, com TARGET_TAG e socket", async () => {
    const fake = criarDockerFake();
    fake.inspects[NOME_UPDATER] = inspectUpdater({ Status: "exited", Running: false, ExitCode: 0 });
    const orchestrator = new DockerOrchestrator(fake.docker, "mpw");

    await orchestrator.createUpdater({ imageRef: "ghcr.io/x/mpw-updater:1.1.0", targetTag: "1.1.0" });

    expect(fake.chamadas).toEqual([`remove:${NOME_UPDATER}:force`, `create:${NOME_UPDATER}`]);
    expect(fake.criados[0]).toEqual({
      name: NOME_UPDATER,
      Image: "ghcr.io/x/mpw-updater:1.1.0",
      Env: ["TARGET_TAG=1.1.0"],
      Labels: { "mpw.managed": "false" },
      HostConfig: {
        AutoRemove: false,
        Binds: ["/var/run/docker.sock:/var/run/docker.sock"],
        NetworkMode: "mpw",
      },
    });
  });

  it("inspectUpdater sem container devolve null", async () => {
    const fake = criarDockerFake();
    const orchestrator = new DockerOrchestrator(fake.docker);

    expect(await orchestrator.inspectUpdater()).toBeNull();
  });

  it("inspectUpdater de updater encerrado lê exit code, TARGET_TAG e as últimas 20 linhas de log", async () => {
    const fake = criarDockerFake();
    fake.inspects[NOME_UPDATER] = inspectUpdater({ Status: "exited", Running: false, ExitCode: 1 });
    fake.logs["updater-id"] = quadroDeLog("[updater] falha ao atualizar web\n");
    const orchestrator = new DockerOrchestrator(fake.docker);

    expect(await orchestrator.inspectUpdater()).toEqual({
      status: "exited",
      exitCode: 1,
      targetTag: "1.1.0",
      logs: "[updater] falha ao atualizar web\n",
    });
    expect(fake.chamadas).toContain("logs:updater-id:20");
  });

  it("inspectUpdater de updater rodando não lê logs", async () => {
    const fake = criarDockerFake();
    fake.inspects[NOME_UPDATER] = inspectUpdater({ Status: "running", Running: true, ExitCode: 0 });
    const orchestrator = new DockerOrchestrator(fake.docker);

    expect(await orchestrator.inspectUpdater()).toMatchObject({ status: "running", logs: "" });
    expect(fake.chamadas.some((c) => c.startsWith("logs:"))).toBe(false);
  });

  it("removeUpdater remove só o mpw-updater e tolera ausência", async () => {
    const fake = criarDockerFake();
    fake.inspects[NOME_UPDATER] = inspectUpdater({ Status: "exited", Running: false, ExitCode: 1 });
    const orchestrator = new DockerOrchestrator(fake.docker);

    await orchestrator.removeUpdater();
    await expect(orchestrator.removeUpdater()).resolves.toBeUndefined();

    expect(fake.chamadas).toEqual([`remove:${NOME_UPDATER}:force`, `remove:${NOME_UPDATER}:force`]);
  });
});
