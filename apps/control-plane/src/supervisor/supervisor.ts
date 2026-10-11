import { EventEmitter } from "node:events";
import type {
  ContainerOrchestrator,
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

export interface WorkerSnapshot extends WorkerStatus {
  desired: DesiredState | "none";
  backoffAtual: number;
  degraded: boolean;
  lastError: string | null;
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

export class Supervisor {
  readonly mudancas = new EventEmitter();
  private estados = new Map<string, EstadoSupervisao>();
  private ultimaLista: WorkerStatus[] = [];
  private ultimosTokens = new Map<string, TokensRenovados>();
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
  }

  desireStopped(accountId: string): void {
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

  getSnapshot(): WorkerSnapshot[] {
    return this.ultimaLista.map((worker) => {
      const estado = this.estados.get(worker.accountId);
      return {
        ...worker,
        desired: estado?.desired ?? "none",
        backoffAtual: calcularBackoff(estado?.falhas ?? 0),
        degraded: (estado?.falhas ?? 0) >= FALHAS_PARA_DEGRADED,
        lastError: estado?.lastError ?? null,
      };
    });
  }

  private async poll(): Promise<void> {
    if (this.emPoll) return;
    this.emPoll = true;
    try {
      this.ultimaLista = await this.orchestrator.listWorkers();
      for (const worker of this.ultimaLista) {
        const estado = this.estados.get(worker.accountId);
        if (!estado || estado.desired !== "running") continue;

        const caido = worker.state === "exited" || worker.state === "dead";
        if (caido) {
          estado.pollsEstaveis = 0;
          const agora = Date.now();
          if (estado.falhas === 0 || agora >= estado.proximaTentativa) {
            try {
              await this.orchestrator.startWorker(worker.id);
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
      if (this.onTokensRenovados) {
        for (const worker of this.ultimaLista) {
          if (worker.state === "running") {
            await this.verificarTokens(worker.accountId);
          }
        }
      }
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

  private async verificarTokens(accountId: string): Promise<void> {
    let corpo: { tokens?: TokensRenovados };
    try {
      const resposta = await fetch(`http://mpw-worker-${accountId}:3001/health`);
      if (!resposta.ok) return;
      corpo = (await resposta.json()) as { tokens?: TokensRenovados };
    } catch {
      return;
    }
    const tokens = corpo.tokens;
    if (!tokens?.accessToken || !tokens.refreshToken) return;
    const anterior = this.ultimosTokens.get(accountId);
    if (
      anterior &&
      anterior.accessToken === tokens.accessToken &&
      anterior.refreshToken === tokens.refreshToken
    ) {
      return;
    }
    try {
      await this.onTokensRenovados?.(accountId, tokens);
    } catch {
      return;
    }
    this.ultimosTokens.set(accountId, tokens);
  }
}
