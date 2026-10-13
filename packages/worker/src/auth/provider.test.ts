import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { WorkerConfig } from "../config.js";
import { HealthState, type Tokens } from "../health.js";
import type { HttpFetch } from "../http.js";
import { criarJwt, respostaJson } from "./__fixtures__/jwt.js";
import {
  AuthAdiadaError,
  AuthIndisponivelError,
  AuthManager,
  ehTransitorio,
  LoginError,
  SolverTokenProvider,
  StoredTokenProvider,
  type TokenProvider,
} from "./provider.js";
import { SolverError } from "./solver.js";

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
  huntSlug: undefined,
  dispositivo: "dispositivo-fixo-123",
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
  opcoes: { stored: TokenProvider; solver: TokenProvider },
): AuthManager {
  gerente = new AuthManager(health, {
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
  it("resolve o captcha e faz login no /auth/entrar com id, senha, turnstileToken e dispositivo", async () => {
    const fetchSolver = solverFeliz();
    const fetchJogo = jogo({
      "https://jogo.example/auth/entrar": () =>
        respostaJson({
          nick: "Ash",
          token: "token-opaco-login",
          provedor: "local",
          precisaNick: false,
          termosVersao: "2024-01",
        }),
    });
    const provider = new SolverTokenProvider(
      { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" },
      { fetchJogo, fetchSolver, sleep: async () => {} },
    );

    await expect(provider.getTokens()).resolves.toEqual({
      accessToken: "token-opaco-login",
      refreshToken: "token-opaco-login",
      nick: "Ash",
    });

    expect(fetchJogo).toHaveBeenCalledTimes(1);
    expect(fetchJogo).toHaveBeenCalledWith("https://jogo.example/auth/entrar", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "UA/1.0" },
      body: JSON.stringify({
        id: "treinador",
        senha,
        turnstileToken: "token-captcha",
        dispositivo: "dispositivo-fixo-123",
      }),
    });
    expect(JSON.parse(String(fetchSolver.mock.calls[0]?.[1]?.body))).toEqual({
      clientKey: solverKey,
      task: {
        type: "TurnstileTaskProxyless",
        websiteURL: "https://jogo.example/app",
        websiteKey: "0x4AAAAAAAoverride12345",
      },
    });
  });

  it("busca a sitekey em /auth/provedores quando não há override", async () => {
    const fetchSolver = solverFeliz();
    const fetchJogo = jogo({
      "https://jogo.example/auth/provedores": () =>
        respostaJson({ google: true, discord: true, turnstile: "0x4AAAAAAEccJgXg19_AZoDr" }),
      "https://jogo.example/auth/entrar": () =>
        respostaJson({ token: "token-opaco", precisaNick: false }),
    });
    const provider = new SolverTokenProvider(configBase, {
      fetchJogo,
      fetchSolver,
      sleep: async () => {},
    });

    await provider.getTokens();

    expect(JSON.parse(String(fetchSolver.mock.calls[0]?.[1]?.body)).task.websiteKey).toBe(
      "0x4AAAAAAEccJgXg19_AZoDr",
    );
  });

  it("recusa conta sem personagem (precisaNick)", async () => {
    const provider = new SolverTokenProvider(
      { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" },
      {
        fetchJogo: jogo({
          "https://jogo.example/auth/entrar": () =>
            respostaJson({ token: "token-opaco", precisaNick: true }),
        }),
        fetchSolver: solverFeliz(),
        sleep: async () => {},
      },
    );

    const erro = await erroDe(provider.getTokens());

    expect(erro).toBeInstanceOf(LoginError);
    expect(erro.message).toContain("precisaNick");
  });

  it("login recusado traz o erro do jogo sem segredos", async () => {
    const provider = new SolverTokenProvider(
      { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" },
      {
        fetchJogo: jogo({
          "https://jogo.example/auth/entrar": () =>
            respostaJson({ erro: `login.turnstileFalhou ${senha} / token-captcha` }, 400),
        }),
        fetchSolver: solverFeliz(),
        sleep: async () => {},
      },
    );

    const erro = await erroDe(provider.getTokens());

    expect(erro).toBeInstanceOf(LoginError);
    expect(erro.message).toContain("login.turnstileFalhou");
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
  const opaco = { accessToken: "token-opaco", refreshToken: "token-opaco" };

  it("usa os tokens salvos válidos sem acionar o solver", async () => {
    const health = new HealthState(opaco);
    const stored = provedor(opaco);
    const solver = provedor({ accessToken: "x", refreshToken: "y" });

    const resultado = await criarGerente(health, { stored, solver }).autenticar();

    expect(resultado).toEqual({ ok: true, origem: "stored" });
    expect(solver.getTokens).not.toHaveBeenCalled();
    expect(health.snapshot().state).toBe("authenticating");
    expect(health.snapshot().tokens).toBeUndefined();
    await expect(gerente?.getTokens()).resolves.toEqual(opaco);
  });

  it("sem tokens salvos autentica via solver e publica autenticado via solver", async () => {
    const doSolver = { accessToken: "token-solver", refreshToken: "token-solver" };
    const health = new HealthState(null);
    const solver = provedor(doSolver);

    const resultado = await criarGerente(health, {
      stored: provedor(new AuthIndisponivelError("ACCESS_TOKEN/REFRESH_TOKEN não configurados")),
      solver,
    }).autenticar();

    expect(resultado).toEqual({ ok: true, origem: "solver" });
    expect(health.snapshot().tokens).toEqual(doSolver);
    expect(health.snapshot().lastAction).toBe("autenticado via solver");
    expect(health.snapshot().lastError).toBeNull();
  });

  it("token salvo expirado sem refresh cai para o solver", async () => {
    const salvos = { accessToken: criarJwt(agoraSeg() - 10), refreshToken: "refresh-expirado" };
    const doSolver = { accessToken: "token-solver", refreshToken: "token-solver" };
    const health = new HealthState(salvos);
    const solver = provedor(doSolver);

    const resultado = await criarGerente(health, {
      stored: provedor(salvos),
      solver,
    }).autenticar();

    expect(resultado).toEqual({ ok: true, origem: "solver" });
    expect(solver.getTokens).toHaveBeenCalledTimes(1);
    expect(health.snapshot().tokens).toEqual(doSolver);
    expect(health.snapshot().lastError).toBeNull();
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

  it("fica em authenticating enquanto o solver roda", async () => {
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

  it("invalidar re-loga pelo solver quando o token é rejeitado", async () => {
    const doSolver = { accessToken: "token-novo", refreshToken: "token-novo" };
    const solver = provedor(doSolver);
    const health = new HealthState(opaco);
    const manager = criarGerente(health, { stored: provedor(opaco), solver });
    await manager.autenticar();
    expect(solver.getTokens).not.toHaveBeenCalled();

    await expect(manager.invalidar()).resolves.toEqual(doSolver);
    expect(solver.getTokens).toHaveBeenCalledTimes(1);
    expect(health.snapshot().tokens).toEqual(doSolver);
    expect(health.snapshot().lastAction).toBe("autenticado via solver");
  });

  it("invalidar compartilha o fluxo e re-loga uma única vez", async () => {
    const doSolver = { accessToken: "token-novo", refreshToken: "token-novo" };
    const solver = provedor(doSolver);
    const manager = criarGerente(new HealthState(opaco), { stored: provedor(opaco), solver });
    await manager.autenticar();

    const [a, b] = await Promise.all([manager.invalidar(), manager.invalidar()]);

    expect(a).toEqual(doSolver);
    expect(b).toEqual(doSolver);
    expect(solver.getTokens).toHaveBeenCalledTimes(1);
  });

  it("invalidar sem solver disponível lança AuthIndisponivelError e vira needs-login", async () => {
    const health = new HealthState(opaco);
    const manager = criarGerente(health, {
      stored: provedor(opaco),
      solver: provedor(new AuthIndisponivelError("sem solver")),
    });
    await manager.autenticar();

    const erro = await erroDe(manager.invalidar());
    expect(erro).toBeInstanceOf(AuthIndisponivelError);
    expect(health.snapshot().state).toBe("needs-login");
  });

  it("autenticar concorrente compartilha o mesmo fluxo", async () => {
    const stored = provedor(opaco);
    const manager = criarGerente(new HealthState(opaco), {
      stored,
      solver: provedor(new AuthIndisponivelError("sem solver")),
    });

    await Promise.all([manager.autenticar(), manager.autenticar()]);

    expect(stored.getTokens).toHaveBeenCalledTimes(1);
  });

  it("nenhum segredo aparece no health nem nas mensagens de erro", async () => {
    const health = new HealthState(null);
    const config = { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" };
    const fetchJogo = jogo({
      "https://jogo.example/auth/entrar": () =>
        respostaJson({ erro: `senha ${senha} errada, chave ${solverKey}` }, 401),
    });
    const fetchSolver = vi
      .fn<HttpFetch>()
      .mockResolvedValueOnce(respostaJson({ errorId: 0, taskId: 1 }))
      .mockResolvedValueOnce(
        respostaJson({ errorId: 0, status: "ready", solution: { token: "captcha-segredo" } }),
      );

    const resultado = await criarGerente(health, {
      stored: new StoredTokenProvider(config),
      solver: new SolverTokenProvider(config, { fetchJogo, fetchSolver, sleep: async () => {} }),
    }).autenticar();

    const textos = [
      JSON.stringify(health.snapshot()),
      resultado.ok ? "" : resultado.motivo,
      (await erroDe(gerente!.getTokens())).message,
    ];
    expect(health.snapshot().state).toBe("needs-login");
    expect(health.snapshot().lastError).toContain("HTTP 401");
    for (const texto of textos) {
      for (const segredo of [senha, solverKey, "captcha-segredo"]) {
        expect(texto).not.toContain(segredo);
      }
    }
  });

  it("redige segredos antes de truncar mensagens longas do jogo", async () => {
    const health = new HealthState(null);
    const config = { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" };
    const fetchJogo = jogo({
      "https://jogo.example/auth/entrar": () =>
        respostaJson({ erro: `${"x".repeat(180)} ${solverKey} ${"y".repeat(400)}` }, 400),
    });

    await criarGerente(health, {
      stored: new StoredTokenProvider(config),
      solver: new SolverTokenProvider(config, {
        fetchJogo,
        fetchSolver: solverFeliz(),
        sleep: async () => {},
      }),
    }).autenticar();

    const lastError = health.snapshot().lastError ?? "";
    expect(lastError).toContain("HTTP 400");
    expect(lastError).not.toContain(solverKey.slice(0, 8));
    expect(lastError.length).toBeLessThan(800);
  });
});

describe("AuthManager — transitório vs definitivo (I3/I4)", () => {
  const opaco = { accessToken: "tok-opaco", refreshToken: "tok-opaco" };

  it("falha transitória do solver não vira needs-login; agenda retry", async () => {
    vi.useFakeTimers();
    try {
      const solver = {
        getTokens: vi.fn<() => Promise<Tokens>>().mockRejectedValue(
          new SolverError("falha de rede", true),
        ),
      };
      const health = new HealthState(null);
      const manager = criarGerente(health, {
        stored: provedor(new AuthIndisponivelError("sem tokens")),
        solver,
      });
      const r = await manager.autenticar();
      expect(r).toMatchObject({ ok: false, needsLogin: false });
      expect(health.snapshot().state).not.toBe("needs-login");
      expect(await erroDe(manager.getTokens())).toBeInstanceOf(AuthAdiadaError);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(solver.getTokens.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falha definitiva do solver vira needs-login", async () => {
    const solver = {
      getTokens: vi.fn<() => Promise<Tokens>>().mockRejectedValue(
        new SolverError("credencial inválida", false),
      ),
    };
    const health = new HealthState(null);
    const r = await criarGerente(health, {
      stored: provedor(new AuthIndisponivelError("sem")),
      solver,
    }).autenticar();
    expect(r).toMatchObject({ ok: false, needsLogin: true });
    expect(health.snapshot().state).toBe("needs-login");
  });

  it("login.turnstileFalhou (HTTP 400) é transitório via SolverTokenProvider", async () => {
    const provider = new SolverTokenProvider(
      { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" },
      {
        fetchJogo: jogo({
          "https://jogo.example/auth/entrar": () => respostaJson({ erro: "login.turnstileFalhou" }, 400),
        }),
        fetchSolver: solverFeliz(),
        sleep: async () => {},
      },
    );
    const erro = await erroDe(provider.getTokens());
    expect(erro).toBeInstanceOf(LoginError);
    expect(ehTransitorio(erro)).toBe(true);
  });

  it("login.credenciaisInvalidas (HTTP 401) é definitivo", async () => {
    const provider = new SolverTokenProvider(
      { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" },
      {
        fetchJogo: jogo({
          "https://jogo.example/auth/entrar": () =>
            respostaJson({ erro: "login.credenciaisInvalidas" }, 401),
        }),
        fetchSolver: solverFeliz(),
        sleep: async () => {},
      },
    );
    expect(ehTransitorio(await erroDe(provider.getTokens()))).toBe(false);
  });

  it("solver classifica errorCode: NO_SLOT/UNSOLVABLE transitório; ZERO_BALANCE/KEY definitivo", async () => {
    const comCodigo = (errorCode: string) =>
      new SolverTokenProvider(
        { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" },
        {
          fetchJogo: jogo({}),
          fetchSolver: vi.fn<HttpFetch>(async () => respostaJson({ errorId: 1, errorCode })),
          sleep: async () => {},
        },
      );
    expect(ehTransitorio(await erroDe(comCodigo("ERROR_NO_SLOT_AVAILABLE").getTokens()))).toBe(true);
    expect(ehTransitorio(await erroDe(comCodigo("ERROR_CAPTCHA_UNSOLVABLE").getTokens()))).toBe(true);
    expect(ehTransitorio(await erroDe(comCodigo("ERROR_ZERO_BALANCE").getTokens()))).toBe(false);
    expect(ehTransitorio(await erroDe(comCodigo("ERROR_KEY_DOES_NOT_EXIST").getTokens()))).toBe(false);
  });

  it("solver que nunca fica ready (timeout) é transitório", async () => {
    const provider = new SolverTokenProvider(
      { ...configBase, turnstileSitekey: "0x4AAAAAAAoverride12345" },
      {
        fetchJogo: jogo({}),
        fetchSolver: vi.fn<HttpFetch>(async (url) =>
          String(url).endsWith("/createTask")
            ? respostaJson({ errorId: 0, taskId: 1 })
            : respostaJson({ errorId: 0, status: "processing" }),
        ),
        sleep: async () => {},
      },
    );
    const erro = await erroDe(provider.getTokens());
    expect(erro).toBeInstanceOf(SolverError);
    expect(ehTransitorio(erro)).toBe(true);
  });

  it("agenda renovação antes do exp e re-loga pelo solver, reagendando", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const stored = provedor({ accessToken: criarJwt(120), refreshToken: "r" });
      const solver = provedor({ accessToken: criarJwt(240), refreshToken: "r2" });
      const manager = criarGerente(new HealthState(null), { stored, solver });
      expect(await manager.autenticar()).toEqual({ ok: true, origem: "stored" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(solver.getTokens).toHaveBeenCalledTimes(1);
      await expect(manager.getTokens()).resolves.toMatchObject({ refreshToken: "r2" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("parar() durante renovação em voo não reagenda timer", async () => {
    vi.useFakeTimers();
    try {
      const pend = Promise.withResolvers<Tokens>();
      const solver = { getTokens: vi.fn<() => Promise<Tokens>>(() => pend.promise) };
      const manager = criarGerente(new HealthState(opaco), { stored: provedor(opaco), solver });
      await manager.autenticar();
      const p = manager.invalidar().catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      manager.parar();
      pend.resolve({ accessToken: criarJwt(120), refreshToken: "r" });
      await p;
      solver.getTokens.mockClear();
      await vi.advanceTimersByTimeAsync(600_000);
      expect(solver.getTokens).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("adotar atualiza os tokens e publica no health (write-back) + nick", () => {
    const health = new HealthState({ accessToken: "a0", refreshToken: "r0" });
    const manager = criarGerente(health, { stored: provedor(opaco), solver: provedor(opaco) });
    manager.adotar({ accessToken: "a1", refreshToken: "a1", nick: "Zé" });
    expect(health.snapshot().tokens).toEqual({ accessToken: "a1", refreshToken: "a1" });
    expect(manager.nick()).toBe("Zé");
  });

  it("invalidar com renovação transitória pendente lança AuthAdiadaError sem novo solve", async () => {
    vi.useFakeTimers();
    try {
      const solver = {
        getTokens: vi.fn<() => Promise<Tokens>>().mockRejectedValue(new SolverError("rede", true)),
      };
      const manager = criarGerente(new HealthState(null), {
        stored: provedor(new AuthIndisponivelError("sem")),
        solver,
      });
      await manager.autenticar();
      expect(solver.getTokens).toHaveBeenCalledTimes(1);
      await expect(manager.invalidar()).rejects.toBeInstanceOf(AuthAdiadaError);
      expect(solver.getTokens).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
