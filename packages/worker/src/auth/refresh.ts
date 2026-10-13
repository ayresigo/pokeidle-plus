import type { Tokens } from "../health.js";

export class RefreshIndisponivelError extends Error {
  constructor(detalhe: string) {
    super(`refresh indisponível (${detalhe})`);
    this.name = "RefreshIndisponivelError";
  }
}

export class RefreshNaoSuportadoError extends Error {
  constructor() {
    super("pokeidle não possui endpoint de refresh; novo login via solver necessário");
    this.name = "RefreshNaoSuportadoError";
  }
}

export function lerExpiracao(token: string): number | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(partes[1] ?? "", "base64url").toString("utf8"));
    const exp =
      typeof payload === "object" && payload !== null && "exp" in payload ? payload.exp : null;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function renovarTokens(): Promise<Tokens> {
  return Promise.reject(new RefreshNaoSuportadoError());
}
