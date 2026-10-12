import { afterEach, describe, expect, it } from "vitest";
import { HealthState, startHealthServer, type HealthServer } from "./health.js";

const tokensIniciais = { accessToken: "access-1", refreshToken: "refresh-1" };

let servidor: HealthServer | null = null;

afterEach(async () => {
  await servidor?.close();
  servidor = null;
});

async function subir(estado: HealthState): Promise<string> {
  servidor = await startHealthServer(estado, 0, "127.0.0.1");
  return `http://127.0.0.1:${servidor.port}`;
}

describe("HealthState", () => {
  it("começa em booting sem ação, erro nem tokens", () => {
    const estado = new HealthState(tokensIniciais, () => 1_000);
    expect(estado.snapshot()).toEqual({
      state: "booting",
      lastAction: null,
      lastError: null,
      uptimeSec: 0,
    });
  });

  it("calcula uptime em segundos inteiros", () => {
    let agora = 10_000;
    const estado = new HealthState(null, () => agora);
    agora = 12_900;
    expect(estado.snapshot().uptimeSec).toBe(2);
  });

  it("atualiza estado, ação e erro", () => {
    const estado = new HealthState(tokensIniciais);
    estado.setState("in-game");
    estado.setLastAction("batalha iniciada");
    estado.setLastError("socket caiu");
    expect(estado.snapshot()).toMatchObject({
      state: "in-game",
      lastAction: "batalha iniciada",
      lastError: "socket caiu",
    });
    estado.setLastError(null);
    expect(estado.snapshot().lastError).toBeNull();
  });

  it("omite tokens iguais aos recebidos no env", () => {
    const estado = new HealthState(tokensIniciais);
    estado.setTokens({ ...tokensIniciais });
    expect(estado.snapshot()).not.toHaveProperty("tokens");
  });

  it("expõe tokens renovados", () => {
    const estado = new HealthState(tokensIniciais);
    estado.setTokens({ accessToken: "access-2", refreshToken: "refresh-1" });
    expect(estado.snapshot().tokens).toEqual({ accessToken: "access-2", refreshToken: "refresh-1" });
  });

  it("expõe tokens obtidos sem tokens iniciais", () => {
    const estado = new HealthState(null);
    expect(estado.snapshot()).not.toHaveProperty("tokens");
    estado.setTokens({ accessToken: "a", refreshToken: "r" });
    expect(estado.snapshot().tokens).toEqual({ accessToken: "a", refreshToken: "r" });
  });
});

describe("startHealthServer", () => {
  it("responde GET /health com o snapshot em JSON", async () => {
    const estado = new HealthState(tokensIniciais);
    estado.setLastAction("conectando");
    const url = await subir(estado);
    const resposta = await fetch(`${url}/health`);
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toContain("application/json");
    const corpo = await resposta.json();
    expect(corpo).toEqual({
      state: "booting",
      lastAction: "conectando",
      lastError: null,
      uptimeSec: expect.any(Number),
    });
    expect(corpo).not.toHaveProperty("tokens");
  });

  it("inclui tokens após renovação", async () => {
    const estado = new HealthState(tokensIniciais);
    const url = await subir(estado);
    estado.setState("authenticating");
    estado.setTokens({ accessToken: "access-2", refreshToken: "refresh-2" });
    const corpo = await (await fetch(`${url}/health?x=1`)).json();
    expect(corpo).toMatchObject({
      state: "authenticating",
      tokens: { accessToken: "access-2", refreshToken: "refresh-2" },
    });
  });

  it("responde 404 em outras rotas e métodos", async () => {
    const url = await subir(new HealthState(null));
    expect((await fetch(`${url}/`)).status).toBe(404);
    expect((await fetch(`${url}/healthz`)).status).toBe(404);
    expect((await fetch(`${url}/health`, { method: "POST" })).status).toBe(404);
  });
});
