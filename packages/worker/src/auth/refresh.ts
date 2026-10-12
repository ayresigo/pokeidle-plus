import type { Tokens } from "../health.js";
import {
  descartarCorpo,
  descreverFalhaDeRede,
  esperar,
  lerJson,
  type HttpFetch,
  type RespostaHttp,
} from "../http.js";

export const ATRASOS_REFRESH_MS: readonly number[] = [1_000, 2_000, 4_000];

export class RefreshRecusadoError extends Error {
  readonly status: number;

  constructor(status: number, detalhe: string) {
    super(`refresh recusado pelo jogo (${detalhe})`);
    this.name = "RefreshRecusadoError";
    this.status = status;
  }
}

export class RefreshIndisponivelError extends Error {
  constructor(detalhe: string) {
    super(`refresh indisponível após ${ATRASOS_REFRESH_MS.length + 1} tentativas (${detalhe})`);
    this.name = "RefreshIndisponivelError";
  }
}

export interface OpcoesRefresh {
  gameUrl: string;
  fetch: HttpFetch;
  sleep?: (ms: number) => Promise<void>;
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

export async function renovarTokens(
  refreshToken: string,
  { gameUrl, fetch, sleep = esperar }: OpcoesRefresh,
): Promise<Tokens> {
  const url = new URL("/api/auth/refresh", gameUrl).toString();
  let ultimaFalha = "";
  for (const atraso of [0, ...ATRASOS_REFRESH_MS]) {
    if (atraso > 0) await sleep(atraso);
    let resposta: RespostaHttp;
    try {
      resposta = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
    } catch (erro) {
      ultimaFalha = `falha de rede: ${descreverFalhaDeRede(erro)}`;
      continue;
    }
    if (resposta.status >= 500 || resposta.status === 429) {
      await descartarCorpo(resposta);
      ultimaFalha = `HTTP ${resposta.status}`;
      continue;
    }
    if (!resposta.ok) {
      await descartarCorpo(resposta);
      throw new RefreshRecusadoError(resposta.status, `HTTP ${resposta.status}`);
    }
    const corpo = await lerJson(resposta);
    if (typeof corpo.accessToken !== "string" || corpo.accessToken === "") {
      throw new RefreshRecusadoError(resposta.status, "resposta sem accessToken");
    }
    return {
      accessToken: corpo.accessToken,
      refreshToken:
        typeof corpo.refreshToken === "string" && corpo.refreshToken !== ""
          ? corpo.refreshToken
          : refreshToken,
    };
  }
  throw new RefreshIndisponivelError(ultimaFalha);
}
