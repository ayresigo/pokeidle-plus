import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type ResultadoToken =
  | { token: string; offline: false }
  | { token: null; offline: boolean };

interface SessaoPersistida {
  refreshToken: string;
  obtainedAt: string;
}

const GRACE_MS = 7 * 24 * 3600 * 1000;
const MARGEM_EXPIRACAO_MS = 30 * 1000;

function decodificarExp(jwt: string): number {
  const payload = jwt.split(".")[1];
  const decodificado = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp: number };
  return decodificado.exp * 1000;
}

export class SessionStore {
  private accessToken: string | null = null;
  private accessExpiraEm = 0;
  private refreshToken: string | null = null;
  private obtainedAt: number | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly centralApiUrl: string,
  ) {}

  private get caminhoSessao(): string {
    return path.join(this.dataDir, "session.json");
  }

  async init(): Promise<void> {
    let conteudo: string;
    try {
      conteudo = await readFile(this.caminhoSessao, "utf8");
    } catch {
      return;
    }
    let sessao: SessaoPersistida;
    try {
      sessao = JSON.parse(conteudo) as SessaoPersistida;
    } catch {
      console.warn(`session.json corrompido; ignorando e iniciando sem sessão`);
      await rm(this.caminhoSessao, { force: true });
      return;
    }
    this.refreshToken = sessao.refreshToken;
    this.obtainedAt = new Date(sessao.obtainedAt).getTime();
  }

  async login(username: string, password: string): Promise<void> {
    const resposta = await fetch(`${this.centralApiUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!resposta.ok) {
      throw new Error(`login falhou: ${resposta.status}`);
    }
    const tokens = (await resposta.json()) as { accessToken: string; refreshToken: string };
    this.definirAccess(tokens.accessToken);
    this.refreshToken = tokens.refreshToken;
    this.obtainedAt = Date.now();
    await this.persistir();
  }

  definirAccess(accessToken: string): void {
    this.accessToken = accessToken;
    this.accessExpiraEm = decodificarExp(accessToken);
  }

  private refreshEmAndamento: Promise<ResultadoToken> | null = null;

  async getAccessToken(): Promise<ResultadoToken> {
    if (this.accessToken !== null && Date.now() < this.accessExpiraEm - MARGEM_EXPIRACAO_MS) {
      return { token: this.accessToken, offline: false };
    }
    if (this.refreshToken === null) {
      return { token: null, offline: false };
    }
    this.refreshEmAndamento ??= this.renovar().finally(() => {
      this.refreshEmAndamento = null;
    });
    return this.refreshEmAndamento;
  }

  private async renovar(): Promise<ResultadoToken> {
    let resposta: Response;
    try {
      resposta = await fetch(`${this.centralApiUrl}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
    } catch {
      return this.centralInalcançavel();
    }
    if (resposta.status >= 500) {
      return this.centralInalcançavel();
    }
    if (resposta.status === 401) {
      await this.limpar();
      return { token: null, offline: false };
    }
    if (!resposta.ok) {
      return { token: null, offline: false };
    }

    const tokens = (await resposta.json()) as { accessToken: string; refreshToken: string };
    this.definirAccess(tokens.accessToken);
    this.refreshToken = tokens.refreshToken;
    this.obtainedAt = Date.now();
    await this.persistir();
    return { token: tokens.accessToken, offline: false };
  }

  private centralInalcançavel(): ResultadoToken {
    if (this.obtainedAt !== null && Date.now() - this.obtainedAt < GRACE_MS) {
      return { token: null, offline: true };
    }
    return { token: null, offline: false };
  }

  async logout(): Promise<void> {
    if (this.refreshToken !== null) {
      try {
        await fetch(`${this.centralApiUrl}/auth/logout`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        });
      } catch {
      }
    }
    await this.limpar();
  }

  private async limpar(): Promise<void> {
    this.accessToken = null;
    this.accessExpiraEm = 0;
    this.refreshToken = null;
    this.obtainedAt = null;
    await rm(this.caminhoSessao, { force: true });
  }

  private async persistir(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const sessao: SessaoPersistida = {
      refreshToken: this.refreshToken as string,
      obtainedAt: new Date(this.obtainedAt as number).toISOString(),
    };
    await writeFile(this.caminhoSessao, JSON.stringify(sessao, null, 2));
  }
}
