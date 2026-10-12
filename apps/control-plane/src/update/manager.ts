import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { repositorioDaImagem } from "../orchestrator/orchestrator.js";
import { configDeRecriacao } from "../orchestrator/recriar.js";
import type {
  ContainerOrchestrator,
  WorkerInspect,
  WorkerStatus,
} from "../orchestrator/types.js";
import type { SessionStore } from "../session/store.js";
import type { Supervisor } from "../supervisor/supervisor.js";

export type UpdateState =
  | "idle"
  | "checking"
  | "updating"
  | "update_failed"
  | "rolling_back";

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  autoUpdate: boolean;
  lastCheck: string | null;
  lastError: string | null;
  state: UpdateState;
}

export type ResultadoApply = "ok" | "sem_atualizacao" | "ocupado" | "falhou";
export type ResultadoRollback = "ok" | "sem_rollback" | "ocupado" | "falhou";

export type ControleSupervisor = Pick<Supervisor, "pausar" | "retomar" | "tokensConhecidos">;

export interface UpdateManagerOpts {
  dataDir: string;
  centralApiUrl: string;
  sessionStore: SessionStore;
  orchestrator: ContainerOrchestrator;
  supervisor: ControleSupervisor;
  workerImage: string;
  currentVersion: string;
  updaterImage?: string;
  autoUpdateEnv?: boolean;
  checkIntervalMs?: number;
  healthTimeoutMs?: number;
  healthPollMs?: number;
}

interface RollbackInfo {
  versaoAnterior: string;
  digestAnterior: string;
  ts: string;
}

interface AlvoRecreate {
  worker: WorkerStatus;
  inspecao: WorkerInspect;
}

const REPO_UPDATER_PADRAO = "ghcr.io/multiacc-pokeidle/mpw-updater";
const INTERVALO_PADRAO_MS = 6 * 3600 * 1000;
const HEALTH_TIMEOUT_PADRAO_MS = 60_000;
const HEALTH_POLL_PADRAO_MS = 2_000;
const DRAIN_STOP_SEGUNDOS = 30;

function mensagemDeErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class UpdateManager {
  private state: UpdateState = "idle";
  private latestVersion: string | null = null;
  private updateAvailable = false;
  private lastCheck: string | null = null;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly repoWorker: string;
  private readonly repoUpdater: string;
  private readonly caminhoSettings: string;
  private readonly caminhoRollback: string;

  constructor(private readonly opts: UpdateManagerOpts) {
    this.repoWorker = repositorioDaImagem(opts.workerImage);
    this.repoUpdater = opts.updaterImage ?? REPO_UPDATER_PADRAO;
    this.caminhoSettings = path.join(opts.dataDir, "settings.json");
    this.caminhoRollback = path.join(opts.dataDir, "rollback.json");
  }

  start(): void {
    if (this.timer) return;
    void this.checkForUpdate();
    this.timer = setInterval(
      () => void this.checkForUpdate(),
      this.opts.checkIntervalMs ?? INTERVALO_PADRAO_MS,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getStatus(): Promise<UpdateStatus> {
    return {
      currentVersion: this.opts.currentVersion,
      latestVersion: this.latestVersion,
      updateAvailable: this.updateAvailable,
      autoUpdate: await this.autoUpdateLigado(),
      lastCheck: this.lastCheck,
      lastError: this.lastError,
      state: this.state,
    };
  }

  async checkForUpdate(): Promise<void> {
    if (this.ocupado()) return;
    const falhouAntes = this.state === "update_failed";
    this.state = "checking";
    try {
      const { token, offline } = await this.opts.sessionStore.getAccessToken();
      if (token === null) {
        throw new Error(
          offline
            ? "central inalcançável para consultar versão"
            : "sem sessão válida para consultar versão",
        );
      }
      const resposta = await fetch(
        `${this.opts.centralApiUrl}/version?channel=stable`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (resposta.status === 404) {
        this.latestVersion = null;
      } else if (!resposta.ok) {
        throw new Error(`central respondeu ${resposta.status} no /version`);
      } else {
        const corpo = (await resposta.json()) as { version: string };
        this.latestVersion = corpo.version;
      }
      this.updateAvailable =
        this.latestVersion !== null && this.latestVersion !== this.opts.currentVersion;
      this.lastCheck = new Date().toISOString();
      if (falhouAntes && this.updateAvailable) {
        this.state = "update_failed";
      } else {
        this.state = "idle";
        this.lastError = null;
      }
    } catch (err) {
      this.lastCheck = new Date().toISOString();
      this.lastError = mensagemDeErro(err);
      this.state = falhouAntes ? "update_failed" : "idle";
      return;
    }
    if (this.updateAvailable && (await this.autoUpdateLigado())) {
      await this.applyUpdate();
    }
  }

  async applyUpdate(): Promise<ResultadoApply> {
    if (this.ocupado()) return "ocupado";
    if (!this.updateAvailable || this.latestVersion === null) return "sem_atualizacao";
    const tag = this.latestVersion;
    const novaImagem = `${this.repoWorker}:${tag}`;
    this.state = "updating";
    this.lastError = null;
    try {
      await this.opts.orchestrator.pullImage(novaImagem);
      const alvos = await this.inspecionarWorkers();
      await this.registrarRollback(alvos, novaImagem);
      await this.recriarEmSequencia(alvos, novaImagem);
      const imagemUpdater = `${this.repoUpdater}:${tag}`;
      await this.opts.orchestrator.pullImage(imagemUpdater);
      const updaterId = await this.opts.orchestrator.createUpdater({
        imageRef: imagemUpdater,
        targetTag: tag,
      });
      await this.opts.orchestrator.startWorker(updaterId);
      this.state = "idle";
      return "ok";
    } catch (err) {
      this.state = "update_failed";
      this.lastError = mensagemDeErro(err);
      return "falhou";
    }
  }

  async rollback(): Promise<ResultadoRollback> {
    if (this.ocupado()) return "ocupado";
    const dados = await this.lerRollback();
    if (dados === null) return "sem_rollback";
    this.state = "rolling_back";
    this.lastError = null;
    try {
      await this.opts.orchestrator.pullImage(dados.digestAnterior);
      await this.recriarEmSequencia(await this.inspecionarWorkers(), dados.digestAnterior);
      await rm(this.caminhoRollback, { force: true });
      this.state = "idle";
      return "ok";
    } catch (err) {
      this.state = "update_failed";
      this.lastError = mensagemDeErro(err);
      return "falhou";
    }
  }

  async setAutoUpdate(ligado: boolean): Promise<void> {
    const settings = (await this.lerSettings()) ?? {};
    settings.autoUpdate = ligado;
    await mkdir(this.opts.dataDir, { recursive: true });
    await writeFile(this.caminhoSettings, JSON.stringify(settings));
  }

  private ocupado(): boolean {
    return (
      this.state === "checking" ||
      this.state === "updating" ||
      this.state === "rolling_back"
    );
  }

  private async lerSettings(): Promise<Record<string, unknown> | null> {
    try {
      return JSON.parse(await readFile(this.caminhoSettings, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      return null;
    }
  }

  private async autoUpdateLigado(): Promise<boolean> {
    const settings = await this.lerSettings();
    if (typeof settings?.autoUpdate === "boolean") return settings.autoUpdate;
    return this.opts.autoUpdateEnv ?? false;
  }

  private async lerRollback(): Promise<RollbackInfo | null> {
    try {
      return JSON.parse(await readFile(this.caminhoRollback, "utf8")) as RollbackInfo;
    } catch {
      return null;
    }
  }

  private async registrarRollback(alvos: AlvoRecreate[], novaImagem: string): Promise<void> {
    const existente = await this.lerRollback();
    if (existente?.versaoAnterior === this.opts.currentVersion) return;
    const anterior = alvos.find((alvo) => alvo.inspecao.imageRef !== novaImagem);
    const rollback: RollbackInfo = {
      versaoAnterior: this.opts.currentVersion,
      digestAnterior:
        anterior?.inspecao.image ?? `${this.repoWorker}:${this.opts.currentVersion}`,
      ts: new Date().toISOString(),
    };
    await mkdir(this.opts.dataDir, { recursive: true });
    await writeFile(this.caminhoRollback, JSON.stringify(rollback));
  }

  private async inspecionarWorkers(): Promise<AlvoRecreate[]> {
    const workers = await this.opts.orchestrator.listWorkers();
    const alvos: AlvoRecreate[] = [];
    for (const worker of workers) {
      alvos.push({ worker, inspecao: await this.opts.orchestrator.inspectWorker(worker.id) });
    }
    return alvos;
  }

  private async recriarEmSequencia(alvos: AlvoRecreate[], imagem: string): Promise<void> {
    const { supervisor } = this.opts;
    for (const alvo of alvos) {
      supervisor.pausar(alvo.worker.accountId);
      try {
        await this.recriarWorker(alvo, imagem);
      } finally {
        supervisor.retomar(alvo.worker.accountId);
      }
    }
  }

  private async recriarWorker({ worker, inspecao }: AlvoRecreate, imagem: string): Promise<void> {
    const { orchestrator, supervisor } = this.opts;
    const { accountId } = worker;
    const config = configDeRecriacao(
      accountId,
      inspecao,
      imagem,
      supervisor.tokensConhecidos(accountId),
    );

    await orchestrator.stopWorker(worker.id, DRAIN_STOP_SEGUNDOS);
    await orchestrator.removeWorker(worker.id);
    let novoId: string | null = null;
    try {
      novoId = await orchestrator.createWorker(config);
      await orchestrator.startWorker(novoId);
      await this.aguardarSaudavel(accountId);
    } catch (err) {
      try {
        if (novoId !== null) {
          await orchestrator.stopWorker(novoId, DRAIN_STOP_SEGUNDOS);
          await orchestrator.removeWorker(novoId);
        }
        const restauradoId = await orchestrator.createWorker({
          ...config,
          imageRef: inspecao.image,
        });
        await orchestrator.startWorker(restauradoId);
      } catch (errCompensacao) {
        throw new Error(
          `${mensagemDeErro(err)}; compensação falhou: ${mensagemDeErro(errCompensacao)}`,
        );
      }
      throw err;
    }
  }

  private async aguardarSaudavel(accountId: string): Promise<void> {
    const timeoutMs = this.opts.healthTimeoutMs ?? HEALTH_TIMEOUT_PADRAO_MS;
    const pollMs = this.opts.healthPollMs ?? HEALTH_POLL_PADRAO_MS;
    const prazo = Date.now() + timeoutMs;
    for (;;) {
      try {
        const resposta = await fetch(`http://mpw-worker-${accountId}:3001/health`);
        if (resposta.ok) {
          const corpo = (await resposta.json()) as { state?: string };
          if (corpo.state !== undefined && corpo.state !== "booting") return;
        }
      } catch {
      }
      if (Date.now() >= prazo) {
        throw new Error(`worker ${accountId} não ficou saudável em ${timeoutMs}ms`);
      }
      const espera = Promise.withResolvers<void>();
      setTimeout(espera.resolve, pollMs);
      await espera.promise;
    }
  }
}
