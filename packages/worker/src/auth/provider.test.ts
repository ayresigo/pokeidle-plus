import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { WorkerConfig } from "../config.js";
import { HealthState, type Tokens } from "../health.js";
import type { HttpFetch } from "../http.js";
import { criarJwt, respostaJson } from "./__fixtures__/jwt.js";
import {
  AuthAdiadaError,
  AuthIndisponivelError,
  AuthManager,
  LoginError,
  SolverTokenProvider,
  StoredTokenProvider,
  type TokenProvider,
} from "./provider.js";

const htmlLogin = readFileSync(new URL("./__fixtures__/login.html", import.meta.url), "utf8");
const chunkLogin = readFileSync(new URL("./__fixtures__/login-chunk.txt", import.meta.url), "utf8");

const agoraSeg = () => Math.floor(Date.now() / 1000);
const gameUrl = "https://jogo.example";
const senha = "senha-secreta-123";
const solverKey = "chave-solver-secreta-456";

const configBase: WorkerConfig = {
  accountId: "conta-1",
  gameUrl,
  accessToken: undefined,
  refreshToken: undefined,
  solverKey,
  pokeidleUser: "treinador",
  pokeidlePass: senha,
  proxyUrl: undefined,
  controlPlaneUrl: undefined,
  healthPort: 3001,
  solverApiUrl: "https://api.2captcha.com",
  turnstileSitekey: undefined,
  gameWsUrl: "wss://jogo.example/ws",
  gameWsShards: 88,
  huntSlug: undefined,
};

let gerente: AuthManager | null = null;

afterEach(() => {
  gerente?.parar();
  gerente = null;
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

function provedor(resultado: Tokens | Error): TokenProvider & { getTokens: Mock } {
  return {
    getTokens: vi.fn(async () => {
      if (resultado instanceof Error) throw resultado;
      return resultado;
    }),
  };
}

function solverFeliz(): Mock<HttpFetch> {
  const fila: unknown[] = [
    { errorId: 0, taskId: 99 },
    { errorId: 0, status: "processing" },
    { errorId: 0, status: "ready", solution: { token: "token-captcha", userAgent: "UA/1.0" } },
  ];
  return vi.fn<HttpFetch>(async () => respostaJson(fila.shift()));
}

function jogo(rotas: Record<string, () => Response>): Mock<HttpFetch> {
  return vi.fn<HttpFetch>(async (url) => {
    const rota = rotas[url];
    if (!rota) return new Response("not found", { status: 404 });
    return rota();
  });
}

function criarGerente(
  health: HealthState,
  opcoes: { stored: TokenProvider; solver: TokenProvider; fetchJogo?: HttpFetch },
): AuthManager {
  gerente = new AuthManager(health, {
    gameUrl,
    fetchJogo: opcoes.fetchJogo ?? jogo({}),
    stored: opcoes.stored,
    solver: opcoes.solver,
    segredos: [senha, solverKey],
  });
  return gerente;
}

describe("StoredTokenProvider", () => {
  it("devolve os tokens do config", async () => {
    const provider = new StoredTokenProvider({ accessToken: "a", refreshToken: "r" });
    await expect(provider.getTokens()).resolves.toEqual({ accessToken: "a", refreshToken: "r" });
  });

  it("sinaliza indisponibilidade sem tokens", async () => {
    const provider = new StoredTokenProvider({ accessToken: undefined, refreshToken: undefined });
    expect(await erroDe(provider.getTokens())).toBeInstanceOf(AuthIndisponivelError);
  });
});

describe("SolverTokenProvider", () => {
  it("resolve o captcha e faz login com identifier, password e captchaToken", async () => {
    const fetchSolver = solverFeliz();
    const fetchJogo = jogo({
      "https://jogo.example/api/auth/login": () =>
        respostaJson({ accessToken: "access-login", refreshToken: "refresh-login" }),
    });
    const provider = new SolverTokenProvider(
      { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" },
      { fetchJogo, fetchSolver, sleep: async () => {} },
    );

    await expect(provider.getTokens()).resolves.toEqual({
      accessToken: "access-login",
      refreshToken: "refresh-login",
    });

    expect(fetchJogo).toHaveBeenCalledTimes(1);
    expect(fetchJogo).toHaveBeenCalledWith("https://jogo.example/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "UA/1.0" },
      body: JSON.stringify({ identifier: "treinador", password: senha, captchaToken: "token-captcha" }),
    });
    expect(JSON.parse(String(fetchSolver.mock.calls[0]?.[1]?.body))).toEqual({
      clientKey: solverKey,
      task: {
        type: "TurnstileTaskProxyless",
        websiteURL: "https://jogo.example/login",
        websiteKey: "0x4AAAAAAAoverride12345",
      },
    });
  });

  it("descobre a sitekey pelo HTML e chunks quando não há override", async () => {
    const fetchSolver = solverFeliz();
    const fetchJogo = vi.fn<HttpFetch>(async (url) => {
      if (url === "https://jogo.example/login") return new Response(htmlLogin);
      if (url.endsWith("/3aqjofv7-1o3x.js")) return new Response(chunkLogin);
      if (url === "https://jogo.example/api/auth/login") {
        return respostaJson({ accessToken: "a", refreshToken: "r" });
      }
      return new Response("");
    });
    const provider = new SolverTokenProvider(configBase, {
      fetchJogo,
      fetchSolver,
      sleep: async () => {},
    });

    await provider.getTokens();

    expect(JSON.parse(String(fetchSolver.mock.calls[0]?.[1]?.body)).task.websiteKey).toBe(
      "0x4AAAAAADkKBnFEMDt0MGBM",
    );
  });

  it("recusa conta com 2FA", async () => {
    const provider = new SolverTokenProvider(
      { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" },
      {
        fetchJogo: jogo({
          "https://jogo.example/api/auth/login": () =>
            respostaJson({ twoFactor: true, twoFactorToken: "tf" }),
        }),
        fetchSolver: solverFeliz(),
        sleep: async () => {},
      },
    );

    const erro = await erroDe(provider.getTokens());

    expect(erro).toBeInstanceOf(LoginError);
    expect(erro.message).toContain("2FA");
  });

  it("login recusado traz a mensagem do jogo sem segredos", async () => {
    const provider = new SolverTokenProvider(
      { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" },
      {
        fetchJogo: jogo({
          "https://jogo.example/api/auth/login": () =>
            respostaJson({ message: `Credenciais inválidas: ${senha} / token-captcha` }, 400),
        }),
        fetchSolver: solverFeliz(),
        sleep: async () => {},
      },
    );

    const erro = await erroDe(provider.getTokens());

    expect(erro).toBeInstanceOf(LoginError);
    expect(erro.message).toContain("Credenciais inválidas");
    expect(erro.message).toContain("HTTP 400");
    expect(erro.message).not.toContain(senha);
    expect(erro.message).not.toContain("token-captcha");
  });

  it("sinaliza indisponibilidade sem SOLVER_KEY", async () => {
    const fetchSolver = solverFeliz();
    const provider = new SolverTokenProvider(
      { ...configBase, solverKey: undefined },
      { fetchJogo: jogo({}), fetchSolver },
    );

    expect(await erroDe(provider.getTokens())).toBeInstanceOf(AuthIndisponivelError);
    expect(fetchSolver).not.toHaveBeenCalled();
  });
});

describe("AuthManager", () => {
  it("usa os tokens salvos válidos sem refresh nem solver", async () => {
    const salvos = { accessToken: criarJwt(agoraSeg() + 3600), refreshToken: "refresh-salvo" };
    const health = new HealthState(salvos);
    const stored = provedor(salvos);
    const solver = provedor({ accessToken: "x", refreshToken: "y" });
    const fetchJogo = jogo({});

    const resultado = await criarGerente(health, { stored, solver, fetchJogo }).autenticar();

    expect(resultado).toEqual({ ok: true, origem: "stored" });
    expect(solver.getTokens).not.toHaveBeenCalled();
    expect(fetchJogo).not.toHaveBeenCalled();
    expect(health.snapshot().state).toBe("authenticating");
    expect(health.snapshot().tokens).toBeUndefined();
    await expect(gerente?.getTokens()).resolves.toEqual(salvos);
  });

  it("renova pelo refresh quando o access salvo expirou e publica no health", async () => {
    const salvos = { accessToken: criarJwt(agoraSeg() - 10), refreshToken: "refresh-salvo" };
    const novos = { accessToken: criarJwt(agoraSeg() + 3600), refreshToken: "refresh-novo" };
    const health = new HealthState(salvos);
    const solver = provedor({ accessToken: "x", refreshToken: "y" });
    const fetchJogo = jogo({ "https://jogo.example/api/auth/refresh": () => respostaJson(novos) });

    const resultado = await criarGerente(health, {
      stored: provedor(salvos),
      solver,
      fetchJogo,
    }).autenticar();

    expect(resultado).toEqual({ ok: true, origem: "refresh" });
    expect(JSON.parse(String(fetchJogo.mock.calls[0]?.[1]?.body))).toEqual({
      refreshToken: "refresh-salvo",
    });
    expect(solver.getTokens).not.toHaveBeenCalled();
    expect(health.snapshot().tokens).toEqual(novos);
    await expect(gerente?.getTokens()).resolves.toEqual(novos);
  });

  it("refresh 401 cai para o solver", async () => {
    const salvos = { accessToken: criarJwt(agoraSeg() - 10), refreshToken: "refresh-morto" };
    const doSolver = { accessToken: criarJwt(agoraSeg() + 3600), refreshToken: "refresh-solver" };
    const health = new HealthState(salvos);
    const solver = provedor(doSolver);

    const resultado = await criarGerente(health, {
      stored: provedor(salvos),
      solver,
      fetchJogo: jogo({
        "https://jogo.example/api/auth/refresh": () => respostaJson({ message: "expired" }, 401),
      }),
    }).autenticar();

    expect(resultado).toEqual({ ok: true, origem: "solver" });
    expect(solver.getTokens).toHaveBeenCalledTimes(1);
    expect(health.snapshot().tokens).toEqual(doSolver);
    expect(health.snapshot().lastError).toBeNull();
  });

  it("sem tokens salvos vai direto ao solver", async () => {
    const doSolver = { accessToken: criarJwt(agoraSeg() + 3600), refreshToken: "refresh-solver" };
    const health = new HealthState(null);
    const fetchJogo = jogo({});

    const resultado = await criarGerente(health, {
      stored: provedor(new AuthIndisponivelError("ACCESS_TOKEN/REFRESH_TOKEN não configurados")),
      solver: provedor(doSolver),
      fetchJogo,
    }).autenticar();

    expect(resultado).toEqual({ ok: true, origem: "solver" });
    expect(fetchJogo).not.toHaveBeenCalled();
    expect(health.snapshot().tokens).toEqual(doSolver);
  });

  it("fica em authenticating enquanto as estratégias rodam", async () => {
    const health = new HealthState(null);
    const pendente = Promise.withResolvers<Tokens>();
    const solver = { getTokens: vi.fn(() => pendente.promise) };

    const promessa = criarGerente(health, {
      stored: provedor(new AuthIndisponivelError("sem tokens")),
      solver,
    }).autenticar();
    await vi.waitFor(() => expect(solver.getTokens).toHaveBeenCalled());

    expect(health.snapshot().state).toBe("authenticating");
    pendente.resolve({ accessToken: "a", refreshToken: "r" });
    await expect(promessa).resolves.toEqual({ ok: true, origem: "solver" });
  });

  it("todas as estratégias falhando vira needs-login com erro descritivo", async () => {
    const health = new HealthState(null);

    const resultado = await criarGerente(health, {
      stored: provedor(new AuthIndisponivelError("ACCESS_TOKEN/REFRESH_TOKEN não configurados")),
      solver: provedor(new AuthIndisponivelError("SOLVER_KEY não configurada")),
    }).autenticar();

    expect(resultado.ok).toBe(false);
    const snapshot = health.snapshot();
    expect(snapshot.state).toBe("needs-login");
    expect(snapshot.lastError).toContain("ACCESS_TOKEN/REFRESH_TOKEN não configurados");
    expect(snapshot.lastError).toContain("SOLVER_KEY não configurada");
    expect(await erroDe(gerente!.getTokens())).toBeInstanceOf(AuthIndisponivelError);
  });

  it("agenda o refresh 60s antes do exp e reagenda com os tokens novos", async () => {
    vi.useFakeTimers();
    const salvos = { accessToken: criarJwt(agoraSeg() + 600), refreshToken: "refresh-1" };
    const segundo = { accessToken: criarJwt(agoraSeg() + 1200), refreshToken: "refresh-2" };
    const terceiro = { accessToken: criarJwt(agoraSeg() + 1800), refreshToken: "refresh-3" };
    const respostas = [segundo, terceiro];
    const fetchJogo = jogo({
      "https://jogo.example/api/auth/refresh": () => respostaJson(respostas.shift()),
    });
    const health = new HealthState(salvos);

    await criarGerente(health, {
      stored: provedor(salvos),
      solver: provedor(new AuthIndisponivelError("sem solver")),
      fetchJogo,
    }).autenticar();

    await vi.advanceTimersByTimeAsync(539_000);
    expect(fetchJogo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchJogo).toHaveBeenCalledTimes(1);
    expect(health.snapshot().tokens).toEqual(segundo);

    await vi.advanceTimersByTimeAsync(599_000);
    expect(fetchJogo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchJogo).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchJogo.mock.calls[1]?.[1]?.body))).toEqual({
      refreshToken: "refresh-2",
    });
    expect(health.snapshot().tokens).toEqual(terceiro);
  });

  it("refresh agendado recusado sem solver vira needs-login", async () => {
    vi.useFakeTimers();
    const salvos = { accessToken: criarJwt(agoraSeg() + 600), refreshToken: "refresh-1" };
    const health = new HealthState(salvos);

    await criarGerente(health, {
      stored: provedor(salvos),
      solver: provedor(new AuthIndisponivelError("SOLVER_KEY não configurada")),
      fetchJogo: jogo({
        "https://jogo.example/api/auth/refresh": () => respostaJson({}, 401),
      }),
    }).autenticar();
    health.setState("in-game");

    await vi.advanceTimersByTimeAsync(540_000);

    expect(health.snapshot().state).toBe("needs-login");
    expect(health.snapshot().lastError).toContain("401");
  });

  it("getTokens renova uma única vez quando o access venceu", async () => {
    vi.useFakeTimers();
    const salvos = { accessToken: criarJwt(agoraSeg() + 600), refreshToken: "refresh-1" };
    const novos = { accessToken: criarJwt(agoraSeg() + 3600), refreshToken: "refresh-2" };
    const fetchJogo = jogo({ "https://jogo.example/api/auth/refresh": () => respostaJson(novos) });
    const manager = criarGerente(new HealthState(salvos), {
      stored: provedor(salvos),
      solver: provedor(new AuthIndisponivelError("sem solver")),
      fetchJogo,
    });
    await manager.autenticar();
    vi.setSystemTime(Date.now() + 600_000);

    const [a, b] = await Promise.all([manager.getTokens(), manager.getTokens()]);

    expect(a).toEqual(novos);
    expect(b).toEqual(novos);
    expect(fetchJogo).toHaveBeenCalledTimes(1);
  });

  it("nenhum segredo aparece no health nem nas mensagens de erro", async () => {
    const salvos = { accessToken: criarJwt(agoraSeg() - 10), refreshToken: "refresh-segredo-789" };
    const health = new HealthState(null);
    const fetchJogo = jogo({
      "https://jogo.example/api/auth/refresh": () =>
        respostaJson({ message: `refresh ${salvos.refreshToken} morto` }, 401),
      "https://jogo.example/api/auth/login": () =>
        respostaJson({ message: `senha ${senha} errada, chave ${solverKey}` }, 401),
    });
    const fetchSolver = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(respostaJson({ errorId: 0, taskId: 1 }))
      .mockResolvedValueOnce(
        respostaJson({ errorId: 0, status: "ready", solution: { token: "captcha-segredo" } }),
      );
    const config = {
      ...configBase,
      accessToken: salvos.accessToken,
      refreshToken: salvos.refreshToken,
      turnstileSitekey: "0x4AAAAAAAoverride12345",
    };

    const resultado = await criarGerente(health, {
      stored: new StoredTokenProvider(config),
      solver: new SolverTokenProvider(config, { fetchJogo, fetchSolver, sleep: async () => {} }),
      fetchJogo,
    }).autenticar();

    const textos = [
      JSON.stringify(health.snapshot()),
      resultado.ok ? "" : resultado.motivo,
      (await erroDe(gerente!.getTokens())).message,
    ];
    expect(health.snapshot().state).toBe("needs-login");
    expect(health.snapshot().lastError).toContain("401");
    for (const texto of textos) {
      for (const segredo of [senha, solverKey, salvos.refreshToken, salvos.accessToken, "captcha-segredo"]) {
        expect(texto).not.toContain(segredo);
      }
    }
  });

  it("redige segredos antes de truncar mensagens longas do jogo", async () => {
    const health = new HealthState(null);
    const config = { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" };
    const fetchJogo = jogo({
      "https://jogo.example/api/auth/login": () =>
        respostaJson({ message: `${"x".repeat(180)} ${solverKey} ${"y".repeat(400)}` }, 400),
    });

    await criarGerente(health, {
      stored: new StoredTokenProvider(config),
      solver: new SolverTokenProvider(config, {
        fetchJogo,
        fetchSolver: solverFeliz(),
        sleep: async () => {},
      }),
      fetchJogo,
    }).autenticar();

    const lastError = health.snapshot().lastError ?? "";
    expect(lastError).toContain("HTTP 400");
    expect(lastError).not.toContain(solverKey.slice(0, 8));
    expect(lastError.length).toBeLessThan(800);
  });

  it("access renovado com validade curta não martela o refresh", async () => {
    vi.useFakeTimers();
    const salvos = { accessToken: criarJwt(agoraSeg() + 600), refreshToken: "refresh-1" };
    const fetchJogo = jogo({
      "https://jogo.example/api/auth/refresh": () =>
        respostaJson({ accessToken: criarJwt(agoraSeg() + 30), refreshToken: "refresh-curto" }),
    });
    const health = new HealthState(salvos);
    const manager = criarGerente(health, {
      stored: provedor(salvos),
      solver: provedor(new AuthIndisponivelError("sem solver")),
      fetchJogo,
    });
    await manager.autenticar();

    await vi.advanceTimersByTimeAsync(540_000);
    expect(fetchJogo).toHaveBeenCalledTimes(1);
    expect(health.snapshot().lastError).toContain("validade curta");

    await vi.advanceTimersByTimeAsync(100);
    await manager.getTokens();
    expect(fetchJogo).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_900);
    expect(fetchJogo).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchJogo).toHaveBeenCalledTimes(4);
  });

  it("refresh agendado com falha transitória mantém tokens e reagenda com backoff", async () => {
    vi.useFakeTimers();
    const inicio = Date.now();
    const salvos = { accessToken: criarJwt(agoraSeg() + 600), refreshToken: "refresh-1" };
    const novos = { accessToken: criarJwt(agoraSeg() + 7200), refreshToken: "refresh-2" };
    const fetchJogo = jogo({
      "https://jogo.example/api/auth/refresh": () =>
        Date.now() - inicio < 1_140_000 ? respostaJson({}, 503) : respostaJson(novos),
    });
    const health = new HealthState(salvos);
    const estados = vi.spyOn(health, "setState");
    const solver = provedor({ accessToken: "x", refreshToken: "y" });
    const manager = criarGerente(health, { stored: provedor(salvos), solver, fetchJogo });
    await manager.autenticar();

    await vi.advanceTimersByTimeAsync(560_000);
    expect(health.snapshot().lastError).toContain("nova tentativa em 30s");
    expect(await manager.getTokens()).toEqual(salvos);

    await vi.advanceTimersByTimeAsync(840_000);

    expect(solver.getTokens).not.toHaveBeenCalled();
    expect(estados).not.toHaveBeenCalledWith("needs-login");
    expect(health.snapshot().tokens).toEqual(novos);
    expect(health.snapshot().lastError).toBeNull();
    await expect(manager.getTokens()).resolves.toEqual(novos);
  });

  it("autenticar com refresh transitório não gasta solver e agenda nova tentativa", async () => {
    vi.useFakeTimers();
    const salvos = { accessToken: criarJwt(agoraSeg() - 10), refreshToken: "refresh-1" };
    const novos = { accessToken: criarJwt(agoraSeg() + 3600), refreshToken: "refresh-2" };
    const respostas = [503, 503, 503, 503];
    const fetchJogo = jogo({
      "https://jogo.example/api/auth/refresh": () => {
        const status = respostas.shift();
        return status ? respostaJson({}, status) : respostaJson(novos);
      },
    });
    const health = new HealthState(salvos);
    const solver = provedor({ accessToken: "x", refreshToken: "y" });

    const promessa = criarGerente(health, { stored: provedor(salvos), solver, fetchJogo }).autenticar();
    await vi.advanceTimersByTimeAsync(7_000);
    const resultado = await promessa;

    expect(resultado).toMatchObject({ ok: false, needsLogin: false });
    expect(health.snapshot().state).toBe("authenticating");
    expect(solver.getTokens).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(health.snapshot().tokens).toEqual(novos);
    expect(solver.getTokens).not.toHaveBeenCalled();
  });

  it("invalidar força refresh de token opaco uma única vez", async () => {
    const salvos = { accessToken: "token-opaco", refreshToken: "refresh-1" };
    const novos = { accessToken: "token-opaco-2", refreshToken: "refresh-2" };
    const fetchJogo = jogo({ "https://jogo.example/api/auth/refresh": () => respostaJson(novos) });
    const manager = criarGerente(new HealthState(salvos), {
      stored: provedor(salvos),
      solver: provedor(new AuthIndisponivelError("sem solver")),
      fetchJogo,
    });
    await manager.autenticar();
    expect(fetchJogo).not.toHaveBeenCalled();

    const [a, b] = await Promise.all([manager.invalidar(), manager.invalidar()]);

    expect(a).toEqual(novos);
    expect(b).toEqual(novos);
    expect(fetchJogo).toHaveBeenCalledTimes(1);
  });

  it("invalidar com refresh recusado segue para o solver", async () => {
    const salvos = { accessToken: "token-opaco", refreshToken: "refresh-morto" };
    const doSolver = { accessToken: "token-solver", refreshToken: "refresh-solver" };
    const solver = provedor(doSolver);
    const manager = criarGerente(new HealthState(salvos), {
      stored: provedor(salvos),
      solver,
      fetchJogo: jogo({
        "https://jogo.example/api/auth/refresh": () => respostaJson({}, 401),
      }),
    });
    await manager.autenticar();

    await expect(manager.invalidar()).resolves.toEqual(doSolver);
    expect(solver.getTokens).toHaveBeenCalledTimes(1);
  });

  it("invalidar com refresh transitório lança AuthAdiadaError e mantém os tokens", async () => {
    vi.useFakeTimers();
    const salvos = { accessToken: "token-opaco", refreshToken: "refresh-1" };
    const solver = provedor({ accessToken: "x", refreshToken: "y" });
    const health = new HealthState(salvos);
    const manager = criarGerente(health, {
      stored: provedor(salvos),
      solver,
      fetchJogo: jogo({ "https://jogo.example/api/auth/refresh": () => respostaJson({}, 503) }),
    });
    await manager.autenticar();

    const invalidacao = erroDe(manager.invalidar());
    await vi.advanceTimersByTimeAsync(7_000);
    const erro = await invalidacao;

    expect(erro).toBeInstanceOf(AuthAdiadaError);
    expect(erro).not.toBeInstanceOf(AuthIndisponivelError);
    expect(solver.getTokens).not.toHaveBeenCalled();
    expect(health.snapshot().state).not.toBe("needs-login");
    await expect(manager.getTokens()).resolves.toEqual(salvos);
  });

  it("invalidar com refresh recusado e sem solver lança AuthIndisponivelError", async () => {
    const salvos = { accessToken: "token-opaco", refreshToken: "refresh-morto" };
    const health = new HealthState(salvos);
    const manager = criarGerente(health, {
      stored: provedor(salvos),
      solver: provedor(new AuthIndisponivelError("sem solver")),
      fetchJogo: jogo({ "https://jogo.example/api/auth/refresh": () => respostaJson({}, 401) }),
    });
    await manager.autenticar();

    const erro = await erroDe(manager.invalidar());
    expect(erro).toBeInstanceOf(AuthIndisponivelError);
    expect(health.snapshot().state).toBe("needs-login");
  });

  it("autenticar concorrente compartilha o mesmo fluxo", async () => {
    const salvos = { accessToken: criarJwt(agoraSeg() + 3600), refreshToken: "refresh-1" };
    const stored = provedor(salvos);
    const manager = criarGerente(new HealthState(salvos), {
      stored,
      solver: provedor(new AuthIndisponivelError("sem solver")),
    });

    await Promise.all([manager.autenticar(), manager.autenticar()]);

    expect(stored.getTokens).toHaveBeenCalledTimes(1);
  });

  it("parar durante refresh em voo não deixa timer pendente", async () => {
    vi.useFakeTimers();
    const salvos = { accessToken: criarJwt(agoraSeg() + 600), refreshToken: "refresh-1" };
    const pendente = Promise.withResolvers<Response>();
    const fetchJogo = vi.fn<HttpFetch>(() => pendente.promise);
    const manager = criarGerente(new HealthState(salvos), {
      stored: provedor(salvos),
      solver: provedor(new AuthIndisponivelError("sem solver")),
      fetchJogo,
    });
    await manager.autenticar();
    expect(vi.getTimerCount()).toBe(1);

    const invalidacao = manager.invalidar();
    await vi.waitFor(() => expect(fetchJogo).toHaveBeenCalled());
    manager.parar();
    pendente.resolve(
      respostaJson({ accessToken: criarJwt(agoraSeg() + 3600), refreshToken: "refresh-2" }),
    );
    await invalidacao;

    expect(vi.getTimerCount()).toBe(0);
  });
});
