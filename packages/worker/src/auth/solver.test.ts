import { describe, expect, it, vi, type Mock } from "vitest";
import type { HttpFetch } from "../http.js";
import { respostaJson } from "./__fixtures__/jwt.js";
import { SolverError, buscarSitekey, resolverTurnstile } from "./solver.js";

const sitekeyReal = "0x4AAAAAAEccJgXg19_AZoDr";
const clientKey = "chave-solver-segredo";
const alvo = { websiteURL: "https://jogo.example/app", websiteKey: sitekeyReal };

function solverStub(respostas: unknown[]): Mock<HttpFetch> {
  const fila = [...respostas];
  return vi.fn<HttpFetch>(async () => respostaJson(fila.shift()));
}

function corpoDe(fetch: Mock<HttpFetch>, chamada: number): unknown {
  return JSON.parse(String(fetch.mock.calls[chamada]?.[1]?.body));
}

async function erroDe(promessa: Promise<unknown>): Promise<Error> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof Error) return erro;
    throw erro;
  }
  throw new Error("deveria ter falhado");
}

describe("resolverTurnstile", () => {
  it("cria a tarefa e consulta o resultado até ficar pronto", async () => {
    const fetch = solverStub([
      { errorId: 0, taskId: 72345678901 },
      { errorId: 0, status: "processing" },
      { errorId: 0, status: "processing" },
      { errorId: 0, status: "ready", solution: { token: "token-captcha", userAgent: "UA/1.0" } },
    ]);
    const sleep = vi.fn(async (_ms: number) => {});

    const resultado = await resolverTurnstile(alvo, {
      apiUrl: "https://api.2captcha.com",
      clientKey,
      fetch,
      sleep,
    });

    expect(resultado).toEqual({ token: "token-captcha", userAgent: "UA/1.0" });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.2captcha.com/createTask",
      "https://api.2captcha.com/getTaskResult",
      "https://api.2captcha.com/getTaskResult",
      "https://api.2captcha.com/getTaskResult",
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(corpoDe(fetch, 0)).toEqual({
      clientKey,
      task: {
        type: "TurnstileTaskProxyless",
        websiteURL: "https://jogo.example/app",
        websiteKey: sitekeyReal,
      },
    });
    expect(corpoDe(fetch, 1)).toEqual({ clientKey, taskId: 72345678901 });
    expect(sleep.mock.calls).toEqual([[5_000], [5_000], [5_000]]);
  });

  it("usa a base configurada para serviços compatíveis", async () => {
    const fetch = solverStub([
      { errorId: 0, taskId: "abc" },
      { errorId: 0, status: "ready", solution: { token: "t" } },
    ]);

    const resultado = await resolverTurnstile(alvo, {
      apiUrl: "https://api.capsolver.com",
      clientKey,
      fetch,
      sleep: async () => {},
    });

    expect(resultado).toEqual({ token: "t" });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://api.capsolver.com/createTask");
    expect(corpoDe(fetch, 1)).toEqual({ clientKey, taskId: "abc" });
  });

  it("falha quando createTask retorna errorId diferente de zero", async () => {
    const fetch = solverStub([
      {
        errorId: 1,
        errorCode: "ERROR_KEY_DOES_NOT_EXIST",
        errorDescription: `chave ${clientKey} inválida`,
      },
    ]);

    const erro = await erroDe(
      resolverTurnstile(alvo, { apiUrl: "https://api.2captcha.com", clientKey, fetch }),
    );

    expect(erro).toBeInstanceOf(SolverError);
    expect(erro.message).toContain("ERROR_KEY_DOES_NOT_EXIST");
    expect(erro.message).not.toContain(clientKey);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falha quando getTaskResult retorna errorId diferente de zero", async () => {
    const fetch = solverStub([
      { errorId: 0, taskId: 1 },
      { errorId: 0, status: "processing" },
      {
        errorId: 12,
        errorCode: "ERROR_CAPTCHA_UNSOLVABLE",
        errorDescription: "Workers could not solve the Captcha",
      },
    ]);

    const erro = await erroDe(
      resolverTurnstile(alvo, {
        apiUrl: "https://api.2captcha.com",
        clientKey,
        fetch,
        sleep: async () => {},
      }),
    );

    expect(erro).toBeInstanceOf(SolverError);
    expect(erro.message).toContain("ERROR_CAPTCHA_UNSOLVABLE");
  });

  it("desiste depois do número máximo de consultas", async () => {
    const fetch = solverStub([
      { errorId: 0, taskId: 1 },
      { errorId: 0, status: "processing" },
      { errorId: 0, status: "processing" },
    ]);

    const erro = await erroDe(
      resolverTurnstile(alvo, {
        apiUrl: "https://api.2captcha.com",
        clientKey,
        fetch,
        sleep: async () => {},
        maxConsultas: 2,
      }),
    );

    expect(erro).toBeInstanceOf(SolverError);
    expect(erro.message).toContain("tempo esgotado");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("falha quando a resposta pronta não tem token", async () => {
    const fetch = solverStub([
      { errorId: 0, taskId: 1 },
      { errorId: 0, status: "ready", solution: {} },
    ]);

    const erro = await erroDe(
      resolverTurnstile(alvo, {
        apiUrl: "https://api.2captcha.com",
        clientKey,
        fetch,
        sleep: async () => {},
      }),
    );

    expect(erro).toBeInstanceOf(SolverError);
  });

  it("não vaza a chave em erro HTTP nem de rede", async () => {
    const http = vi.fn<HttpFetch>(async () => new Response(`key=${clientKey}`, { status: 500 }));
    const rede = vi.fn<HttpFetch>().mockRejectedValue(new TypeError(`fetch failed ${clientKey}`));

    for (const fetch of [http, rede]) {
      const erro = await erroDe(
        resolverTurnstile(alvo, { apiUrl: "https://api.2captcha.com", clientKey, fetch }),
      );
      expect(erro).toBeInstanceOf(SolverError);
      expect(erro.message).not.toContain(clientKey);
    }
  });

  it("consome o corpo de resposta HTTP de erro do solver", async () => {
    const resposta = new Response("erro", { status: 502 });
    const fetch = vi.fn<HttpFetch>(async () => resposta);

    await erroDe(resolverTurnstile(alvo, { apiUrl: "https://api.2captcha.com", clientKey, fetch }));

    expect(resposta.bodyUsed).toBe(true);
  });
});

describe("buscarSitekey", () => {
  it("lê o campo turnstile de /auth/provedores", async () => {
    const fetch = vi.fn<HttpFetch>(async () =>
      respostaJson({ google: true, discord: true, confirmacaoEmail: true, turnstile: sitekeyReal }),
    );

    await expect(buscarSitekey("https://jogo.example", fetch)).resolves.toBe(sitekeyReal);
    expect(fetch).toHaveBeenCalledWith("https://jogo.example/auth/provedores", { method: "GET" });
  });

  it("falha com erro descritivo quando não há turnstile", async () => {
    const fetch = vi.fn<HttpFetch>(async () => respostaJson({ google: true }));

    const erro = await erroDe(buscarSitekey("https://jogo.example", fetch));

    expect(erro).toBeInstanceOf(SolverError);
    expect(erro.message).toContain("TURNSTILE_SITEKEY");
  });

  it("falha quando /auth/provedores não responde 200", async () => {
    const resposta = new Response("challenge", { status: 403 });
    const fetch = vi.fn<HttpFetch>(async () => resposta);

    const erro = await erroDe(buscarSitekey("https://jogo.example", fetch));

    expect(erro).toBeInstanceOf(SolverError);
    expect(erro.message).toContain("HTTP 403");
    expect(resposta.bodyUsed).toBe(true);
  });
});
