import { EventEmitter } from "node:events";
import { configDeRecriacao, envComTokens } from "../orchestrator/recriar.js";
import type {
  ContainerOrchestrator,
  WorkerConfig,
  WorkerStatus,
} from "../orchestrator/types.js";

export interface TokensRenovados {
  accessToken: string;
  refreshToken: string;
}

type CallbackTokensRenovados = (
  accountId: string,
  tokens: TokensRenovados,
) => void | Promise<void>;

export type DesiredState = "running" | "stopped";

export interface EstadoJogo {
  state: string;
  lastAction: string | null;
  lastError: string | null;
}

export interface WorkerSnapshot extends WorkerStatus {
  desired: DesiredState | "none";
  backoffAtual: number;
  degraded: boolean;
  lastError: string | null;
  jogo: EstadoJogo | null;
}

interface CorpoHealth {
  state?: unknown;
  lastAction?: unknown;
  lastError?: unknown;
  tokens?: Partial<TokensRenovados>;
}

const PASSOS_BACKOFF = [60_000, 120_000, 300_000];
const TETO_BACKOFF = 900_000;
const POLLS_PARA_ESTAVEL = 2;
const FALHAS_PARA_DEGRADED = 3;

export function calcularBackoff(falhas: number): number {
  if (falhas <= 0) return 0;
  if (falhas <= PASSOS_BACKOFF.length) return PASSOS_BACKOFF[falhas - 1];
  return TETO_BACKOFF;
}

interface EstadoSupervisao {
  desired: DesiredState;
  falhas: number;
  proximaTentativa: number;
  pollsEstaveis: number;
  lastError: string | null;
}

interface RecriacaoPendente {
  worker: WorkerStatus;
  config: WorkerConfig;
}

export class Supervisor {
  readonly mudancas = new EventEmitter();
  private estados = new Map<string, EstadoSupervisao>();
  private ultimaLista: WorkerStatus[] = [];
  private ultimosTokens = new Map<string, TokensRenovados>();
  private jogos = new Map<string, EstadoJogo>();
  private tokensObservados = new Map<string, TokensRenovados>();
  private recriacoesPendentes = new Map<string, RecriacaoPendente>();
  private pausados = new Set<string>();
  private ultimoSnapshotSerial = "[]";
  private onTokensRenovados: CallbackTokensRenovados | null = null;
  private timer: NodeJS.Timeout | null = null;
  private emPoll = false;

  constructor(
    private orchestrator: ContainerOrchestrator,
    private pollIntervalMs = 10_000,
  ) {}

  desireRunning(accountId: string): void {
    this.estados.set(accountId, {
      desired: "running",
      falhas: 0,
      proximaTentativa: 0,
      pollsEstaveis: 0,
      lastError: null,
    });
    this.recriacoesPendentes.delete(accountId);
  }

  desireStopped(accountId: string): void {
    this.recriacoesPendentes.delete(accountId);
    const atual = this.estados.get(accountId);
    if (atual) {
      atual.desired = "stopped";
    } else {
      this.estados.set(accountId, {
        desired: "stopped",
        falhas: 0,
        proximaTentativa: 0,
        pollsEstaveis: 0,
        lastError: null,
      });
    }
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setOnTokensRenovados(callback: CallbackTokensRenovados): void {
    this.onTokensRenovados = callback;
  }

  pausar(accountId: string): void {
    this.pausados.add(accountId);
  }

  retomar(accountId: string): void {
    this.pausados.delete(accountId);
  }

  tokensConhecidos(accountId: string): TokensRenovados | null {
    return this.tokensObservados.get(accountId) ?? null;
  }

  getSnapshot(): WorkerSnapshot[] {
    return this.ultimaLista.map((worker) => {
      const estado = this.estados.get(worker.accountId);
      return {
        ...worker,
        desired: estado?.desired ?? "none",
        backoffAtual: calcularBackoff(estado?.falhas ?? 0),
        degraded: (estado?.falhas ?? 0) >= FALHAS_PARA_DEGRADED,
        lastError: estado?.lastError ?? null,
        jogo: this.jogos.get(worker.accountId) ?? null,
      };
    });
  }

  private async poll(): Promise<void> {
    if (this.emPoll) return;
    this.emPoll = true;
    try {
      const lista = await this.orchestrator.listWorkers();
      const presentes = new Set(lista.map((worker) => worker.accountId));
      for (const [accountId, pendente] of this.recriacoesPendentes) {
        if (!presentes.has(accountId)) lista.push(pendente.worker);
      }
      this.ultimaLista = lista;
      for (const worker of this.ultimaLista) {
        const estado = this.estados.get(worker.accountId);
        if (!estado || estado.desired !== "running" || this.pausados.has(worker.accountId)) {
          continue;
        }

        const caido =
          worker.state === "exited" ||
          worker.state === "dead" ||
          (worker.state === "created" && this.recriacoesPendentes.has(worker.accountId));
        if (caido) {
          estado.pollsEstaveis = 0;
          const agora = Date.now();
          if (estado.falhas === 0 || agora >= estado.proximaTentativa) {
            try {
              await this.reiniciar(worker, !presentes.has(worker.accountId));
              estado.lastError = null;
            } catch (err) {
              estado.lastError =
                err instanceof Error ? err.message : String(err);
            }
            estado.falhas += 1;
            estado.proximaTentativa =
              agora + calcularBackoff(estado.falhas);
          }
        } else if (worker.state === "running") {
          this.recriacoesPendentes.delete(worker.accountId);
          estado.pollsEstaveis += 1;
          if (
            estado.pollsEstaveis >= POLLS_PARA_ESTAVEL &&
            (estado.falhas > 0 || estado.lastError !== null)
          ) {
            estado.falhas = 0;
            estado.proximaTentativa = 0;
            estado.lastError = null;
          }
        }
      }
      const jogos = new Map<string, EstadoJogo>();
      for (const worker of this.ultimaLista) {
        if (worker.state !== "running") continue;
        const corpo = await this.lerHealth(worker.accountId);
        if (!corpo) continue;
        if (typeof corpo.state === "string") {
          jogos.set(worker.accountId, {
            state: corpo.state,
            lastAction: typeof corpo.lastAction === "string" ? corpo.lastAction : null,
            lastError: typeof corpo.lastError === "string" ? corpo.lastError : null,
          });
        }
        await this.verificarTokens(worker.accountId, corpo.tokens);
      }
      this.jogos = jogos;
      const snapshot = this.getSnapshot();
      const serial = JSON.stringify(snapshot);
      if (serial !== this.ultimoSnapshotSerial) {
        this.ultimoSnapshotSerial = serial;
        this.mudancas.emit("update", snapshot);
      }
    } finally {
      this.emPoll = false;
    }
  }

  private async reiniciar(worker: WorkerStatus, ausente: boolean): Promise<void> {
    const { accountId } = worker;
    const tokens = this.tokensConhecidos(accountId);
    const pendente = this.recriacoesPendentes.get(accountId);
    if (pendente && ausente) {
      await this.criarEIniciar(accountId, {
        ...pendente.config,
        env: envComTokens(pendente.config.env, tokens),
      });
      return;
    }
    if (tokens) {
      const inspecao = await this.orchestrator.inspectWorker(worker.id);
      if (
        inspecao.env.ACCESS_TOKEN !== tokens.accessToken ||
        inspecao.env.REFRESH_TOKEN !== tokens.refreshToken
      ) {
        const config = configDeRecriacao(accountId, inspecao, inspecao.image, tokens);
        await this.orchestrator.removeWorker(worker.id);
        this.recriacoesPendentes.set(accountId, { worker: { ...worker }, config });
        await this.criarEIniciar(accountId, config);
        return;
      }
    }
    await this.orchestrator.startWorker(worker.id);
    this.recriacoesPendentes.delete(accountId);
  }

  private async criarEIniciar(accountId: string, config: WorkerConfig): Promise<void> {
    const id = await this.orchestrator.createWorker(config);
    await this.orchestrator.startWorker(id);
    this.recriacoesPendentes.delete(accountId);
  }

  private async lerHealth(accountId: string): Promise<CorpoHealth | null> {
    try {
      const resposta = await fetch(`http://mpw-worker-${accountId}:3001/health`);
      if (!resposta.ok) return null;
      return (await resposta.json()) as CorpoHealth;
    } catch {
      return null;
    }
  }

  private async verificarTokens(
    accountId: string,
    tokens: Partial<TokensRenovados> | undefined,
  ): Promise<void> {
    if (!this.onTokensRenovados) return;
    if (!tokens?.accessToken || !tokens.refreshToken) return;
    const novos = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    this.tokensObservados.set(accountId, novos);
    const anterior = this.ultimosTokens.get(accountId);
    if (
      anterior &&
      anterior.accessToken === novos.accessToken &&
      anterior.refreshToken === novos.refreshToken
    ) {
      return;
    }
    try {
      await this.onTokensRenovados(accountId, novos);
    } catch {
      return;
    }
    this.ultimosTokens.set(accountId, novos);
  }
}
