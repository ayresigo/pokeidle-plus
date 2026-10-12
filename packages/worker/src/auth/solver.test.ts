import { readFileSync } from "node:fs";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { HttpFetch } from "../http.js";
import { respostaJson } from "./__fixtures__/jwt.js";
import {
  SolverError,
  descobrirSitekey,
  extrairSitekey,
  listarChunks,
  resolverTurnstile,
} from "./solver.js";

const htmlLogin = readFileSync(new URL("./__fixtures__/login.html", import.meta.url), "utf8");
const chunkLogin = readFileSync(new URL("./__fixtures__/login-chunk.txt", import.meta.url), "utf8");
const sitekeyReal = "0x4AAAAAADkKBnFEMDt0MGBM";
const clientKey = "chave-solver-segredo";
const alvo = { websiteURL: "https://jogo.example/login", websiteKey: sitekeyReal };

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
        websiteURL: "https://jogo.example/login",
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

describe("extrairSitekey", () => {
  it("lê data-sitekey do HTML", () => {
    expect(
      extrairSitekey('<div class="cf-turnstile" data-sitekey="0x4AAAAAAAabcdefghijklmn"></div>'),
    ).toBe("0x4AAAAAAAabcdefghijklmn");
  });

  it("lê a sitekey literal do chunk real do login", () => {
    expect(extrairSitekey(chunkLogin)).toBe(sitekeyReal);
  });

  it("não encontra sitekey no HTML real do login", () => {
    expect(extrairSitekey(htmlLogin)).toBeNull();
  });
});

describe("listarChunks", () => {
  it("lista os chunks JS referenciados pelo HTML real, sem repetição", () => {
    const chunks = listarChunks(htmlLogin);
    expect(chunks).toContain("/_next/static/chunks/3aqjofv7-1o3x.js");
    expect(chunks).toHaveLength(13);
    expect(new Set(chunks).size).toBe(chunks.length);
  });
});

describe("descobrirSitekey", () => {
  it("procura nos chunks quando o HTML real não tem a sitekey", async () => {
    const fetch = vi.fn<HttpFetch>(async (url) => {
      if (url === "https://jogo.example/login") return new Response(htmlLogin);
      if (url === "https://jogo.example/_next/static/chunks/3aqjofv7-1o3x.js") {
        return new Response(chunkLogin);
      }
      return new Response("console.log(0x4000)");
    });

    await expect(descobrirSitekey("https://jogo.example", fetch)).resolves.toBe(sitekeyReal);
    const urls = fetch.mock.calls.map(([url]) => url);
    expect(urls[0]).toBe("https://jogo.example/login");
    expect(urls.at(-1)).toBe("https://jogo.example/_next/static/chunks/3aqjofv7-1o3x.js");
  });

  it("usa o data-sitekey do HTML sem baixar chunks", async () => {
    const fetch = vi.fn<HttpFetch>(
      async () =>
        new Response(
          '<div data-sitekey="0x4AAAAAAAabcdefghijklmn"></div><script src="/_next/static/chunks/a.js"></script>',
        ),
    );

    await expect(descobrirSitekey("https://jogo.example", fetch)).resolves.toBe(
      "0x4AAAAAAAabcdefghijklmn",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falha com erro descritivo quando não encontra", async () => {
    const fetch = vi.fn<HttpFetch>(async () => new Response("<html></html>"));

    const erro = await erroDe(descobrirSitekey("https://jogo.example", fetch));

    expect(erro).toBeInstanceOf(SolverError);
    expect(erro.message).toContain("TURNSTILE_SITEKEY");
  });

  it("falha quando /login não responde 200", async () => {
    const resposta = new Response("challenge", { status: 403 });
    const fetch = vi.fn<HttpFetch>(async () => resposta);

    const erro = await erroDe(descobrirSitekey("https://jogo.example", fetch));

    expect(erro.message).toContain("HTTP 403");
    expect(resposta.bodyUsed).toBe(true);
  });
});
