import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const base = {
  ACCOUNT_ID: "conta-1",
  GAME_URL: "https://pokeidle.example",
};

const comTokens = { ...base, ACCESS_TOKEN: "access-secreto", REFRESH_TOKEN: "refresh-secreto" };

const comSolver = {
  ...base,
  SOLVER_KEY: "solver-secreta",
  POKEIDLE_USER: "treinador",
  POKEIDLE_PASS: "senha-secreta",
};

function erroDe(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (erro) {
    if (erro instanceof ConfigError) return erro;
    throw erro;
  }
  throw new Error("loadConfig deveria ter lançado ConfigError");
}

describe("loadConfig", () => {
  it("aceita só tokens e aplica defaults", () => {
    expect(loadConfig(comTokens)).toEqual({
      accountId: "conta-1",
      gameUrl: "https://pokeidle.example",
      accessToken: "access-secreto",
      refreshToken: "refresh-secreto",
      solverKey: undefined,
      pokeidleUser: undefined,
      pokeidlePass: undefined,
      proxyUrl: undefined,
      controlPlaneUrl: undefined,
      healthPort: 3001,
      solverApiUrl: "https://api.2captcha.com",
      turnstileSitekey: undefined,
      gameWsUrl: "wss://pokeidle.example/ws",
      gameWsShards: 88,
      huntSlug: undefined,
    });
  });

  it("deriva ws:// de GAME_URL http", () => {
    const config = loadConfig({ ...comTokens, GAME_URL: "http://127.0.0.1:8080" });
    expect(config.gameWsUrl).toBe("ws://127.0.0.1:8080/ws");
  });

  it("aceita GAME_WS_URL, GAME_WS_PATH, GAME_WS_SHARDS e HUNT_SLUG", () => {
    const config = loadConfig({
      ...comTokens,
      GAME_WS_URL: "wss://ws.pokeidle.example:8443",
      GAME_WS_PATH: "/socket",
      GAME_WS_SHARDS: "4",
      HUNT_SLUG: "caterpie",
    });
    expect(config.gameWsUrl).toBe("wss://ws.pokeidle.example:8443/socket");
    expect(config.gameWsShards).toBe(4);
    expect(config.huntSlug).toBe("caterpie");
  });

  it("GAME_WS_PATH sozinho troca só o path", () => {
    const config = loadConfig({ ...comTokens, GAME_WS_PATH: "/" });
    expect(config.gameWsUrl).toBe("wss://pokeidle.example/");
  });

  it.each(["ftp://x", "nao-e-url"])("rejeita GAME_WS_URL inválida %s", (url) => {
    const erro = erroDe({ ...comTokens, GAME_WS_URL: url });
    expect(erro.message).toContain("GAME_WS_URL");
  });

  it("rejeita GAME_WS_PATH sem barra inicial", () => {
    const erro = erroDe({ ...comTokens, GAME_WS_PATH: "ws" });
    expect(erro.message).toContain("GAME_WS_PATH");
  });

  it.each(["0", "abc", "2.5"])("rejeita GAME_WS_SHARDS inválido %s", (valor) => {
    const erro = erroDe({ ...comTokens, GAME_WS_SHARDS: valor });
    expect(erro.message).toContain("GAME_WS_SHARDS");
  });

  it("rejeita GAME_URL que não é URL http(s)", () => {
    const erro = erroDe({ ...comTokens, GAME_URL: "pokeidle" });
    expect(erro.message).toContain("GAME_URL inválida");
  });

  it("aceita SOLVER_API_URL e TURNSTILE_SITEKEY opcionais", () => {
    const config = loadConfig({
      ...comSolver,
      SOLVER_API_URL: "https://api.capsolver.com/",
      TURNSTILE_SITEKEY: "0x4AAAAAAAexemplo",
    });
    expect(config.solverApiUrl).toBe("https://api.capsolver.com");
    expect(config.turnstileSitekey).toBe("0x4AAAAAAAexemplo");
  });

  it.each(["ftp://solver", "nao-e-url"])("rejeita SOLVER_API_URL inválida %s", (url) => {
    const erro = erroDe({ ...comSolver, SOLVER_API_URL: url });
    expect(erro.message).toContain("SOLVER_API_URL");
  });

  it("aceita só solver com usuário e senha", () => {
    const config = loadConfig(comSolver);
    expect(config.solverKey).toBe("solver-secreta");
    expect(config.pokeidleUser).toBe("treinador");
    expect(config.pokeidlePass).toBe("senha-secreta");
    expect(config.accessToken).toBeUndefined();
    expect(config.refreshToken).toBeUndefined();
  });

  it("aceita tokens e solver juntos com opcionais", () => {
    const config = loadConfig({
      ...comTokens,
      ...comSolver,
      PROXY_URL: "socks5://proxy.local:1080",
      CONTROL_PLANE_URL: "http://control-plane:4000",
      HEALTH_PORT: "4100",
    });
    expect(config.accessToken).toBe("access-secreto");
    expect(config.solverKey).toBe("solver-secreta");
    expect(config.proxyUrl).toBe("socks5://proxy.local:1080");
    expect(config.controlPlaneUrl).toBe("http://control-plane:4000");
    expect(config.healthPort).toBe(4100);
  });

  it.each(["http://proxy:8080", "https://user:pw@proxy:8443", "socks5://proxy:1080"])(
    "aceita proxy %s",
    (proxy) => {
      expect(loadConfig({ ...comTokens, PROXY_URL: proxy }).proxyUrl).toBe(proxy);
    },
  );

  it("trata variável vazia como ausente", () => {
    const erro = erroDe({ ...comTokens, ACCOUNT_ID: "  " });
    expect(erro.message).toContain("ACCOUNT_ID");
  });

  it("exige ACCOUNT_ID e GAME_URL", () => {
    const erro = erroDe({ ACCESS_TOKEN: "a", REFRESH_TOKEN: "b" });
    expect(erro.message).toContain("ACCOUNT_ID");
    expect(erro.message).toContain("GAME_URL");
  });

  it("exige POKEIDLE_USER e POKEIDLE_PASS quando SOLVER_KEY está presente", () => {
    const erro = erroDe({ ...base, SOLVER_KEY: "solver-secreta" });
    expect(erro.message).toContain("POKEIDLE_USER");
    expect(erro.message).toContain("POKEIDLE_PASS");
  });

  it("exige POKEIDLE_PASS mesmo com POKEIDLE_USER presente", () => {
    const erro = erroDe({ ...base, SOLVER_KEY: "solver-secreta", POKEIDLE_USER: "treinador" });
    expect(erro.message).toContain("POKEIDLE_PASS");
    expect(erro.message).not.toContain("POKEIDLE_USER");
  });

  it("falha sem nenhum caminho de autenticação", () => {
    const erro = erroDe(base);
    expect(erro.message).toContain("ACCESS_TOKEN");
    expect(erro.message).toContain("REFRESH_TOKEN");
    expect(erro.message).toContain("SOLVER_KEY");
  });

  it("falha com ACCESS_TOKEN sem REFRESH_TOKEN", () => {
    const erro = erroDe({ ...base, ACCESS_TOKEN: "access-secreto" });
    expect(erro.message).toContain("REFRESH_TOKEN");
  });

  it("falha com REFRESH_TOKEN sem ACCESS_TOKEN mesmo com solver válido", () => {
    const erro = erroDe({ ...comSolver, REFRESH_TOKEN: "refresh-secreto" });
    expect(erro.message).toContain("ACCESS_TOKEN");
  });

  it.each(["ftp://proxy:21", "socks4://proxy:1080", "nao-e-url", "http://"])(
    "rejeita proxy inválido %s",
    (proxy) => {
      const erro = erroDe({ ...comTokens, PROXY_URL: proxy });
      expect(erro.message).toContain("PROXY_URL");
    },
  );

  it.each(["abc", "0", "70000", "30.5"])("rejeita HEALTH_PORT inválida %s", (porta) => {
    const erro = erroDe({ ...comTokens, HEALTH_PORT: porta });
    expect(erro.message).toContain("HEALTH_PORT");
  });

  it("lista todos os problemas de uma vez", () => {
    const erro = erroDe({
      SOLVER_KEY: "solver-secreta",
      ACCESS_TOKEN: "access-secreto",
      PROXY_URL: "ftp://x",
    });
    expect(erro.problems).toHaveLength(6);
    for (const nome of [
      "ACCOUNT_ID",
      "GAME_URL",
      "POKEIDLE_USER",
      "POKEIDLE_PASS",
      "REFRESH_TOKEN",
      "PROXY_URL",
    ]) {
      expect(erro.message).toContain(nome);
    }
  });

  it("nunca inclui valores de segredo na mensagem", () => {
    const segredos = {
      SOLVER_KEY: "valor-solver-xyz",
      ACCESS_TOKEN: "valor-access-xyz",
      POKEIDLE_PASS: "valor-senha-xyz",
      PROXY_URL: "ftp://usuario:valor-proxy-xyz@host",
      HEALTH_PORT: "valor-porta-xyz",
    };
    const erro = erroDe(segredos);
    for (const valor of Object.values(segredos)) {
      expect(erro.message).not.toContain(valor);
    }
    expect(erro.message).not.toContain("xyz");
  });
});
