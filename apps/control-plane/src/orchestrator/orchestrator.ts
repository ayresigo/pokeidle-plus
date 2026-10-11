import Docker from "dockerode";
import type { ContainerOrchestrator, WorkerConfig, WorkerStatus } from "./types.js";

export const LABEL_MANAGED = "mpw.managed";
export const LABEL_ACCOUNT = "mpw.account-id";

const ANO_ZERO = "0001-01-01T00:00:00Z";

function demuxLogs(bruto: Buffer): string {
  const partes: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= bruto.length) {
    const tamanho = bruto.readUInt32BE(offset + 4);
    if (offset + 8 + tamanho > bruto.length) break;
    partes.push(bruto.subarray(offset + 8, offset + 8 + tamanho));
    offset += 8 + tamanho;
  }
  if (partes.length === 0) return bruto.toString("utf8");
  return Buffer.concat(partes).toString("utf8");
}

export class DockerOrchestrator implements ContainerOrchestrator {
  constructor(
    private readonly docker: Docker = new Docker(),
    private readonly network?: string,
  ) {}

  async createWorker(cfg: WorkerConfig): Promise<string> {
    const nome = `mpw-worker-${cfg.accountId}`;
    const existente = await this.docker
      .getContainer(nome)
      .inspect()
      .catch(() => null);
    if (existente) {
      throw new Error(
        `worker já existe para a conta ${cfg.accountId} (container ${nome})`,
      );
    }

    const container = await this.docker.createContainer({
      name: nome,
      Image: cfg.imageRef,
      Cmd: cfg.cmd,
      Env: Object.entries(cfg.env).map(([k, v]) => `${k}=${v}`),
      Labels: {
        ...cfg.labels,
        [LABEL_MANAGED]: "true",
        [LABEL_ACCOUNT]: cfg.accountId,
      },
      HostConfig: {
        AutoRemove: false,
        ...(this.network ? { NetworkMode: this.network } : {}),
      },
    });
    return container.id;
  }

  async startWorker(id: string): Promise<void> {
    await this.docker
      .getContainer(id)
      .start()
      .catch((erro: { statusCode?: number }) => {
        if (erro.statusCode !== 304) throw erro;
      });
  }

  async stopWorker(id: string, timeoutSec: number): Promise<void> {
    await this.docker
      .getContainer(id)
      .stop({ t: timeoutSec })
      .catch((erro: { statusCode?: number }) => {
        if (erro.statusCode !== 304 && erro.statusCode !== 404) throw erro;
      });
  }

  async removeWorker(id: string): Promise<void> {
    await this.docker
      .getContainer(id)
      .remove()
      .catch((erro: { statusCode?: number }) => {
        if (erro.statusCode !== 404) throw erro;
      });
  }

  async listWorkers(): Promise<WorkerStatus[]> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [`${LABEL_MANAGED}=true`] },
    });
    return Promise.all(
      containers.map(async (resumo) => {
        const info = await this.docker.getContainer(resumo.Id).inspect();
        const startedAt = info.State.StartedAt;
        return {
          id: info.Id,
          accountId: info.Config.Labels?.[LABEL_ACCOUNT] ?? "",
          state: info.State.Status,
          health: info.State.Health?.Status ?? "unknown",
          startedAt:
            startedAt && startedAt !== ANO_ZERO ? new Date(startedAt) : null,
          restartCount: info.RestartCount,
        };
      }),
    );
  }

  async workerLogs(id: string, tail: number): Promise<string> {
    const bruto = (await this.docker.getContainer(id).logs({
      stdout: true,
      stderr: true,
      tail,
      follow: false,
    })) as unknown as Buffer;
    return demuxLogs(bruto);
  }

  async pullImage(ref: string): Promise<void> {
    const stream = await this.docker.pull(ref);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (erro) =>
        erro ? reject(erro) : resolve(),
      );
    });
  }
}
