import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type WorkerState = "booting" | "authenticating" | "in-game" | "needs-login" | "error";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  nick?: string;
}

export interface HealthSnapshot {
  state: WorkerState;
  lastAction: string | null;
  lastError: string | null;
  uptimeSec: number;
  kills: number;
  capturas: number;
  tokens?: Tokens;
}

export class HealthState {
  private state: WorkerState = "booting";
  private lastAction: string | null = null;
  private lastError: string | null = null;
  private kills = 0;
  private capturas = 0;
  private tokens: Tokens | null;
  private readonly startedAt: number;

  constructor(
    private readonly initialTokens: Tokens | null,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = initialTokens;
    this.startedAt = now();
  }

  setState(state: WorkerState): void {
    this.state = state;
  }

  setLastAction(action: string): void {
    this.lastAction = action;
  }

  setLastError(error: string | null): void {
    this.lastError = error;
  }

  setTokens(tokens: Tokens): void {
    this.tokens = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  setContadores(contadores: { kills: number; capturas: number }): void {
    this.kills = contadores.kills;
    this.capturas = contadores.capturas;
  }

  private renewedTokens(): Tokens | null {
    if (!this.tokens) return null;
    const initial = this.initialTokens;
    if (
      initial &&
      initial.accessToken === this.tokens.accessToken &&
      initial.refreshToken === this.tokens.refreshToken
    ) {
      return null;
    }
    return { ...this.tokens };
  }

  snapshot(): HealthSnapshot {
    const snapshot: HealthSnapshot = {
      state: this.state,
      lastAction: this.lastAction,
      lastError: this.lastError,
      uptimeSec: Math.floor((this.now() - this.startedAt) / 1000),
      kills: this.kills,
      capturas: this.capturas,
    };
    const tokens = this.renewedTokens();
    if (tokens) snapshot.tokens = tokens;
    return snapshot;
  }
}

export interface HealthServer {
  port: number;
  close(): Promise<void>;
}

export function startHealthServer(
  health: HealthState,
  port: number,
  host = "0.0.0.0",
): Promise<HealthServer> {
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(health.snapshot()));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const { promise, resolve, reject } = Promise.withResolvers<HealthServer>();
  server.once("error", reject);
  server.listen(port, host, () => {
    server.off("error", reject);
    resolve({
      port: (server.address() as AddressInfo).port,
      close: () => {
        const closed = Promise.withResolvers<void>();
        server.close((err) => (err ? closed.reject(err) : closed.resolve()));
        server.closeAllConnections();
        return closed.promise;
      },
    });
  });
  return promise;
}
