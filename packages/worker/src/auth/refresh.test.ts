import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpFetch } from "../http.js";
import { criarJwt, respostaJson } from "./__fixtures__/jwt.js";
import {
  RefreshIndisponivelError,
  RefreshRecusadoError,
  lerExpiracao,
  renovarTokens,
} from "./refresh.js";

const gameUrl = "https://jogo.example";
const refreshAntigo = "refresh-antigo-segredo";

afterEach(() => {
  vi.useRealTimers();
});

async function erroDe(promessa: Promise<unknown>): Promise<Error> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof Error) return erro;
    throw erro;
  }
  throw new Error("deveria ter falhado");
}

describe("lerExpiracao", () => {
  it("lê o exp do payload do JWT em milissegundos", () => {
    expect(lerExpiracao(criarJwt(1_800_000_000))).toBe(1_800_000_000_000);
  });

  it.each(["nao-e-jwt", "a.b.c", `x.${Buffer.from('{"sub":"s"}').toString("base64url")}.y`])(
    "retorna null para %s",
    (token) => {
      expect(lerExpiracao(token)).toBeNull();
    },
  );
});

describe("renovarTokens", () => {
  it("faz POST em /api/auth/refresh com o refreshToken", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(
      respostaJson({ accessToken: "access-novo", refreshToken: "refresh-novo" }),
    );

    const tokens = await renovarTokens(refreshAntigo, { gameUrl, fetch });

    expect(fetch).toHaveBeenCalledWith("https://jogo.example/api/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: refreshAntigo }),
    });
    expect(tokens).toEqual({ accessToken: "access-novo", refreshToken: "refresh-novo" });
  });

  it("mantém o refreshToken atual quando o jogo não rotaciona", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(respostaJson({ accessToken: "access-novo" }));

    const tokens = await renovarTokens(refreshAntigo, { gameUrl, fetch });

    expect(tokens).toEqual({ accessToken: "access-novo", refreshToken: refreshAntigo });
  });

  it("401 é recusa definitiva, sem retentativa", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(respostaJson({ message: "invalid" }, 401));

    const erro = await erroDe(renovarTokens(refreshAntigo, { gameUrl, fetch }));

    expect(erro).toBeInstanceOf(RefreshRecusadoError);
    expect((erro as RefreshRecusadoError).status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("resposta sem accessToken é recusa", async () => {
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(respostaJson({}));

    const erro = await erroDe(renovarTokens(refreshAntigo, { gameUrl, fetch }));

    expect(erro).toBeInstanceOf(RefreshRecusadoError);
  });

  it("refaz em 5xx com backoff de 1s, 2s e 4s", async () => {
    vi.useFakeTimers();
    const inicio = Date.now();
    const instantes: number[] = [];
    const fetch = vi.fn<HttpFetch>(async () => {
      instantes.push(Date.now() - inicio);
      return instantes.length < 4
        ? respostaJson({}, 503)
        : respostaJson({ accessToken: "access-novo", refreshToken: "refresh-novo" });
    });

    const promessa = renovarTokens(refreshAntigo, { gameUrl, fetch });
    await vi.advanceTimersByTimeAsync(7_000);

    await expect(promessa).resolves.toEqual({
      accessToken: "access-novo",
      refreshToken: "refresh-novo",
    });
    expect(instantes).toEqual([0, 1_000, 3_000, 7_000]);
  });

  it("consome o corpo das respostas descartadas", async () => {
    vi.useFakeTimers();
    const respostas = [respostaJson({}, 503), respostaJson({}, 401)];
    const fila = [...respostas];
    const fetch = vi.fn<HttpFetch>(async () => fila.shift() ?? respostaJson({}, 500));

    const promessa = erroDe(renovarTokens(refreshAntigo, { gameUrl, fetch }));
    await vi.advanceTimersByTimeAsync(1_000);
    await promessa;

    expect(respostas.map((r) => r.bodyUsed)).toEqual([true, true]);
  });

  it("desiste após as retentativas em erro de rede", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<HttpFetch>().mockRejectedValue(
      new TypeError(`fetch failed ${refreshAntigo}`, { cause: { code: "ECONNREFUSED" } }),
    );

    const promessa = erroDe(renovarTokens(refreshAntigo, { gameUrl, fetch }));
    await vi.advanceTimersByTimeAsync(7_000);
    const erro = await promessa;

    expect(erro).toBeInstanceOf(RefreshIndisponivelError);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(erro.message).toContain("ECONNREFUSED");
    expect(erro.message).not.toContain(refreshAntigo);
  });

  it("não espera mais que 1s antes da segunda tentativa", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<HttpFetch>().mockResolvedValue(respostaJson({}, 502));

    const promessa = erroDe(renovarTokens(refreshAntigo, { gameUrl, fetch }));
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6_000);

    const erro = await promessa;
    expect(erro).toBeInstanceOf(RefreshIndisponivelError);
    expect(erro.message).toContain("HTTP 502");
  });

  it("nenhum token aparece nas mensagens de erro", async () => {
    const fetch = vi
      .fn<HttpFetch>()
      .mockResolvedValue(respostaJson({ message: `token ${refreshAntigo} inválido` }, 401));

    const erro = await erroDe(renovarTokens(refreshAntigo, { gameUrl, fetch }));

    expect(erro.message).not.toContain(refreshAntigo);
  });
});
