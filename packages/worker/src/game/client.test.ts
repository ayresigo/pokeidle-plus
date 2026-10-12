import { once } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { WebSocketServer, type WebSocket as SocketServidor } from "ws";
import { criarJwt, respostaJson } from "../auth/__fixtures__/jwt.js";
import { AuthAdiadaError, AuthIndisponivelError } from "../auth/provider.js";
import { HealthState, type Tokens } from "../health.js";
import type { HttpFetch } from "../http.js";
import {
  GameClient,
  montarUrlWs,
  type AuthJogo,
  type OpcoesClient,
  type OuvintesSocket,
  type SocketJogo,
} from "./client.js";

interface ConexaoFake {
  socket: SocketServidor;
  url: URL;
  headers: IncomingHttpHeaders;
  mensagens: Record<string, unknown>[];
}

class ServidorJogo {
  readonly conexoes: ConexaoFake[] = [];
  aoConectar: (conexao: ConexaoFake) => void = () => {};

  private constructor(private readonly wss: WebSocketServer) {
    wss.on("connection", (socket, req) => {
      const conexao: ConexaoFake = {
        socket,
        url: new URL(req.url ?? "/", "ws://localhost"),
        headers: req.headers,
        mensagens: [],
      };
      socket.on("message", (dados) => conexao.mensagens.push(JSON.parse(String(dados))));
      this.conexoes.push(conexao);
      this.aoConectar(conexao);
    });
  }

  static async iniciar(): Promise<ServidorJogo> {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(wss, "listening");
    return new ServidorJogo(wss);
  }

  get wsUrl(): string {
    return `ws://127.0.0.1:${(this.wss.address() as AddressInfo).port}/ws`;
  }

  async conexao(indice: number): Promise<ConexaoFake> {
    await vi.waitFor(() => expect(this.conexoes.length).toBeGreaterThan(indice));
    return this.conexoes[indice]!;
  }

  emitir(conexao: ConexaoFake, mensagem: Record<string, unknown>): void {
    conexao.socket.send(JSON.stringify(mensagem));
  }

  async fechar(): Promise<void> {
    for (const { socket } of this.conexoes) socket.terminate();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.wss.close(() => resolve());
    await promise;
  }
}

const exp = () => Math.floor(Date.now() / 1000) + 3600;
const accessInicial = criarJwt(exp(), "conta-a");
const accessNovo = criarJwt(exp(), "conta-b");
const tokensIniciais: Tokens = { accessToken: accessInicial, refreshToken: "refresh-1" };
const tokensNovos: Tokens = { accessToken: accessNovo, refreshToken: "refresh-2" };

let servidor: ServidorJogo;
let health: HealthState;
let auth: AuthJogo & { getTokens: Mock; invalidar: Mock };
let fetchJogo: Mock<HttpFetch>;
let cliente: GameClient | null = null;

function criarAuth(): AuthJogo & { getTokens: Mock; invalidar: Mock } {
  let atuais = tokensIniciais;
  return {
    getTokens: vi.fn(async () => atuais),
    invalidar: vi.fn(async () => {
      atuais = tokensNovos;
      return atuais;
    }),
  };
}

function novoCliente(extra: Partial<OpcoesClient> = {}): GameClient {
  cliente = new GameClient({
    wsUrl: extra.wsUrl ?? servidor.wsUrl,
    shards: 1,
    gameUrl: "http://jogo.example",
    accountId: "conta-teste",
    auth,
    health,
    fetch: fetchJogo,
    random: () => 0,
    reconexao: { baseMs: 20, tetoMs: 100 },
    ...extra,
  });
  return cliente;
}

function semReconexao(c: GameClient, total: number): void {
  expect(c.reconexaoPendente).toBe(false);
  expect(servidor.conexoes).toHaveLength(total);
}

beforeEach(async () => {
  servidor = await ServidorJogo.iniciar();
  health = new HealthState(null);
  auth = criarAuth();
  fetchJogo = vi.fn<HttpFetch>();
});

afterEach(async () => {
  vi.useRealTimers();
  await cliente?.desconectar();
  cliente = null;
  await servidor.fechar();
});

describe("montarUrlWs", () => {
  const jwt = (sub: string) => criarJwt(1, sub);

  it.each([
    ["conta", "wss://poke.idleworld.online/ws66"],
    ["64f1a2b3c4d5e6f708192a3b", "wss://poke.idleworld.online/ws56"],
    ["user-42", "wss://poke.idleworld.online/ws23"],
    ["a", "wss://poke.idleworld.online/ws86"],
  ])("shard do sub %s igual ao bundle do jogo", (sub, base) => {
    const token = jwt(sub);
    expect(montarUrlWs("wss://poke.idleworld.online/ws", token, 88)).toBe(
      `${base}?token=${encodeURIComponent(token)}&v=2`,
    );
  });

  it("sem path usa o shard na porta", () => {
    const token = jwt("conta");
    expect(montarUrlWs("ws://127.0.0.1:8000/", token, 88)).toBe(
      `ws://127.0.0.1:8066?token=${encodeURIComponent(token)}&v=2`,
    );
  });

  it("token que não é JWT ou 1 shard usa a URL base", () => {
    expect(montarUrlWs("wss://jogo.example/ws", "x", 88)).toBe("wss://jogo.example/ws?token=x&v=2");
    expect(montarUrlWs("wss://jogo.example/ws", jwt("conta"), 1)).toContain(
      "wss://jogo.example/ws?token=",
    );
  });
});

describe("GameClient: conexão", () => {
  it("conecta com o access na query, Origin do jogo e fica in-game", async () => {
    health.setState("authenticating");
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);

    expect(conexao.url.pathname).toBe("/ws");
    expect(conexao.url.searchParams.get("token")).toBe(accessInicial);
    expect(conexao.url.searchParams.get("v")).toBe("2");
    expect(conexao.url.searchParams.has("cmid")).toBe(false);
    expect(conexao.headers.origin).toBe("http://jogo.example");
    await vi.waitFor(() => expect(health.snapshot().state).toBe("in-game"));
    expect(c.conectado).toBe(true);
    await vi.waitFor(() =>
      expect(conexao.mensagens).toEqual([{ type: "restart-state" }, { type: "balls-get" }]),
    );
  });

  it("eventos do jogo atualizam o estado", async () => {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);

    servidor.emitir(conexao, { type: "hunt-resume", slug: "caterpie", name: "Caterpie" });
    servidor.emitir(conexao, { type: "field-init", slug: "caterpie", huntKey: "k1" });
    servidor.emitir(conexao, { type: "field-kill", speciesName: "Caterpie", xpGained: 10 });
    servidor.emitir(conexao, { type: "catch-result", success: true, speciesName: "Caterpie" });
    servidor.emitir(conexao, { type: "catch-result", success: false, speciesName: "Weedle" });
    servidor.emitir(conexao, {
      type: "balls",
      counts: { "1": 120, "2": "5.0" },
      expires: {},
      catalog: [{ id: 1, infinite: false }],
    });
    servidor.emitir(conexao, { type: "inventory", items: [{ itemId: 1, quantity: 3 }, {}] });
    servidor.emitir(conexao, { type: "analyzer", seconds: 600, balance: 1234 });
    servidor.emitir(conexao, {
      type: "restart-freeze",
      frozenAt: 1000,
      restartedAt: 2000,
      boosts: [{ key: "xp", pct: 50, remainingMs: 60_000 }],
    });
    servidor.emitir(conexao, { type: "evento-desconhecido", x: 1 });

    await vi.waitFor(() => expect(c.estado.restartFreeze).not.toBeNull());
    const estado = c.estado;
    expect(estado.huntAtual).toBe("caterpie");
    expect(estado.huntRetomavel).toBe("caterpie");
    expect(estado.huntDesde).toEqual(expect.any(Number));
    expect(estado.ultimoKill).toBe("Caterpie");
    expect(estado.ultimoKillEm).toEqual(expect.any(Number));
    expect(estado.kills).toBe(1);
    expect(estado.capturas).toBe(1);
    expect(estado.balls).toBe(125);
    expect(estado.itensInventario).toBe(1);
    expect(estado.ultimoAnalyzer).toEqual({ seconds: 600, balance: 1234 });
    expect(estado.restartFreeze).toEqual({ frozenAt: 1000, restartedAt: 2000 });

    servidor.emitir(conexao, { type: "field-none" });
    await vi.waitFor(() => expect(c.estado.huntAtual).toBeNull());
  });

  it("field-kill e captura logam sem segredo e publicam contadores no /health", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);

    servidor.emitir(conexao, { type: "field-kill", speciesName: "Caterpie" });
    servidor.emitir(conexao, { type: "field-kill", speciesName: "Weedle" });
    servidor.emitir(conexao, { type: "catch-result", success: true, speciesName: "Caterpie" });
    servidor.emitir(conexao, { type: "catch-result", success: false, speciesName: "Weedle" });

    await vi.waitFor(() => expect(health.snapshot().kills).toBe(2));
    expect(health.snapshot().capturas).toBe(1);

    const linhas = log.mock.calls.map((chamada) => String(chamada[0]));
    expect(linhas.some((linha) => linha.includes("field-kill"))).toBe(true);
    expect(linhas.some((linha) => linha.includes("captura"))).toBe(true);
    expect(linhas.join("\n")).not.toContain(accessInicial);
    log.mockRestore();
  });

  it("restart-freeze sem boosts ativos é ignorado como no cliente oficial", async () => {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { type: "restart-freeze", frozenAt: 1, boosts: [] });
    servidor.emitir(conexao, { type: "analyzer", seconds: 1, balance: 0 });
    await vi.waitFor(() => expect(c.estado.ultimoAnalyzer).not.toBeNull());
    expect(c.estado.restartFreeze).toBeNull();
  });

  it("field-lost e field-teleport-city saem da hunt; hunt-cooldown registra o prazo", async () => {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { type: "field-init", slug: "rattata" });
    await vi.waitFor(() => expect(c.estado.huntAtual).toBe("rattata"));
    servidor.emitir(conexao, { type: "field-lost" });
    await vi.waitFor(() => expect(c.estado.huntAtual).toBeNull());

    servidor.emitir(conexao, { type: "field-init", slug: "rattata" });
    await vi.waitFor(() => expect(c.estado.huntAtual).toBe("rattata"));
    servidor.emitir(conexao, { type: "field-teleport-city" });
    await vi.waitFor(() => expect(c.estado.huntAtual).toBeNull());

    const antes = Date.now();
    servidor.emitir(conexao, { type: "hunt-cooldown", ms: 5000 });
    await vi.waitFor(() => expect(c.estado.huntCooldownAte).not.toBeNull());
    expect(c.estado.huntCooldownAte!).toBeGreaterThanOrEqual(antes + 5000);
  });

  it("comandos documentados viram mensagens JSON com type", async () => {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);
    await vi.waitFor(() => expect(conexao.mensagens).toHaveLength(2));

    c.enterHunt("caterpie", true);
    expect(c.estado.enterHuntEnviadoEm).toEqual(expect.any(Number));
    c.leaveHunt();
    c.setCity("cerulean");
    c.restartResume();
    expect(c.estado.restartResumeEnviadoEm).toEqual(expect.any(Number));

    await vi.waitFor(() => expect(conexao.mensagens).toHaveLength(6));
    expect(conexao.mensagens.slice(2)).toEqual([
      { type: "enter-hunt", slug: "caterpie", resume: true },
      { type: "leave-hunt" },
      { type: "set-city", slug: "cerulean" },
      { type: "restart-resume" },
    ]);
  });

  it("comando sem conexão aberta falha", () => {
    const c = novoCliente();
    expect(() => c.leaveHunt()).toThrow("desconectado");
  });
});

describe("GameClient: fechamentos", () => {
  it("4001 → invalidar uma vez e reconecta com o token novo", async () => {
    servidor.aoConectar = (conexao) => {
      if (servidor.conexoes.length === 1) conexao.socket.close(4001, "unauthorized");
    };
    novoCliente().conectar();

    const segunda = await servidor.conexao(1);
    expect(auth.invalidar).toHaveBeenCalledTimes(1);
    expect(segunda.url.searchParams.get("token")).toBe(accessNovo);
    await vi.waitFor(() => expect(health.snapshot().state).toBe("in-game"));
  });

  it("4001 de novo dentro de 5 min → needs-login sem reconectar", async () => {
    servidor.aoConectar = (conexao) => conexao.socket.close(4001, "unauthorized");
    const c = novoCliente();
    c.conectar();

    await expect(c.encerrado).resolves.toMatchObject({ estado: "needs-login" });
    expect(auth.invalidar).toHaveBeenCalledTimes(1);
    expect(health.snapshot().state).toBe("needs-login");
    expect(health.snapshot().lastError).toContain("4001");
    semReconexao(c, 2);
  });

  it("4001 com invalidar falhando → needs-login", async () => {
    auth.invalidar.mockRejectedValueOnce(new AuthIndisponivelError("sem tokens válidos"));
    servidor.aoConectar = (conexao) => conexao.socket.close(4001, "unauthorized");
    const c = novoCliente();
    c.conectar();

    await expect(c.encerrado).resolves.toMatchObject({ estado: "needs-login" });
    expect(health.snapshot().lastError).toContain("sem tokens válidos");
    semReconexao(c, 1);
  });

  it("4005 (sessão substituída) → needs-login sem reconectar nem invalidar", async () => {
    servidor.aoConectar = (conexao) => conexao.socket.close(4005, "replaced");
    const c = novoCliente();
    c.conectar();

    await expect(c.encerrado).resolves.toMatchObject({ estado: "needs-login" });
    expect(health.snapshot().state).toBe("needs-login");
    expect(health.snapshot().lastError).toContain("4005");
    expect(auth.invalidar).not.toHaveBeenCalled();
    semReconexao(c, 1);
  });

  it.each([
    [4006, "error", "IP"],
    [4007, "error", "máquina"],
    [4008, "needs-login", "nome"],
    [4009, "needs-login", "senha"],
  ])("close %i → %s sem reconectar", async (codigo, estado, trecho) => {
    servidor.aoConectar = (conexao) => conexao.socket.close(codigo, "x");
    const c = novoCliente();
    c.conectar();

    await expect(c.encerrado).resolves.toMatchObject({ estado });
    expect(health.snapshot().state).toBe(estado);
    expect(health.snapshot().lastError).toContain(trecho);
    semReconexao(c, 1);
  });

  it("queda comum reconecta com backoff e volta a in-game", async () => {
    servidor.aoConectar = (conexao) => {
      if (servidor.conexoes.length === 1) {
        conexao.socket.once("message", () => conexao.socket.close(1012, "restart"));
      }
    };
    const erros = vi.spyOn(health, "setLastError");
    const c = novoCliente();
    c.conectar();

    await servidor.conexao(1);
    expect(erros).toHaveBeenCalledWith(expect.stringContaining("ws fechado (código 1012)"));
    await vi.waitFor(() => expect(c.conectado).toBe(true));
    expect(health.snapshot().state).toBe("in-game");
    expect(auth.invalidar).not.toHaveBeenCalled();
  });

  it("servidor fora do ar não derruba o cliente: continua tentando", async () => {
    const urlFora = servidor.wsUrl;
    await servidor.fechar();
    const c = novoCliente({ wsUrl: urlFora });
    c.conectar();
    await vi.waitFor(() => expect(auth.getTokens.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(health.snapshot().state).not.toBe("needs-login");
    servidor = await ServidorJogo.iniciar();
  });

  it("access expirado não conecta e aguarda renovação", async () => {
    auth.getTokens.mockResolvedValue({ accessToken: criarJwt(1, "conta"), refreshToken: "r" });
    const c = novoCliente();
    c.conectar();
    await vi.waitFor(() => expect(health.snapshot().lastError).toContain("expirado"));
    expect(servidor.conexoes).toHaveLength(0);
    expect(c.conectado).toBe(false);
  });

  it("getTokens sem tokens → needs-login", async () => {
    auth.getTokens.mockRejectedValue(new Error("sem tokens válidos (needs-login)"));
    const c = novoCliente();
    c.conectar();
    await expect(c.encerrado).resolves.toMatchObject({ estado: "needs-login" });
    expect(health.snapshot().state).toBe("needs-login");
  });

  it("heartbeat: silêncio → ping; sem resposta → fecha e reconecta", async () => {
    const c = novoCliente({ heartbeat: { verificarMs: 10, silencioMs: 40, prazoPingMs: 40 } });
    c.conectar();
    const conexao = await servidor.conexao(0);
    await vi.waitFor(() => expect(conexao.mensagens).toContainEqual({ type: "ping" }));
    await servidor.conexao(1);
  });

  it("desconectar fecha limpo, não reconecta e encerra", async () => {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);
    const fechamento = once(conexao.socket, "close");

    await c.desconectar();
    await expect(fechamento).resolves.toEqual([1000, expect.anything()]);
    await expect(c.encerrado).resolves.toMatchObject({ estado: "desconectado" });
    expect(c.conectado).toBe(false);
    semReconexao(c, 1);
    cliente = null;
  });

  it("nunca expõe o access token em lastError/lastAction", async () => {
    servidor.aoConectar = (conexao) => conexao.socket.close(4001, "unauthorized");
    const c = novoCliente();
    c.conectar();
    await c.encerrado;
    const texto = JSON.stringify(health.snapshot());
    expect(texto).not.toContain(accessInicial);
    expect(texto).not.toContain(accessNovo);
  });
});

describe("GameClient: REST", () => {
  const hunts = {
    map: { w: 1, h: 1 },
    hunts: [
      { slug: "cerulean", name: "Cerulean", level: 0 },
      { slug: "bulbasaur", name: "Bulbasaur", level: 20 },
      { slug: "caterpie", name: "Caterpie", level: 1 },
      { name: "sem slug" },
    ],
  };

  it("buscarHunts lê map-markers sem Authorization, como o cliente oficial", async () => {
    fetchJogo.mockResolvedValue(respostaJson(hunts));
    const c = novoCliente();

    await expect(c.buscarHunts()).resolves.toEqual([
      { slug: "cerulean", nome: "Cerulean", nivel: 0 },
      { slug: "bulbasaur", nome: "Bulbasaur", nivel: 20 },
      { slug: "caterpie", nome: "Caterpie", nivel: 1 },
    ]);
    expect(fetchJogo).toHaveBeenCalledWith("http://jogo.example/api/game/map-markers");
    expect(auth.getTokens).not.toHaveBeenCalled();
    expect(auth.invalidar).not.toHaveBeenCalled();
  });

  it("erro HTTP vira exceção com status", async () => {
    fetchJogo.mockResolvedValue(respostaJson({}, 503));
    await expect(novoCliente().buscarHunts()).rejects.toThrow("HTTP 503");
  });
});

class SocketFalso implements SocketJogo {
  readonly enviados: Record<string, unknown>[] = [];
  fechadoCom: number | null = null;
  fecharAutomatico = true;

  constructor(
    readonly url: string,
    private readonly ouvintes: OuvintesSocket,
  ) {}

  send(dados: string): void {
    this.enviados.push(JSON.parse(dados));
  }

  close(codigo = 1005): void {
    this.fechadoCom = codigo;
    if (this.fecharAutomatico) queueMicrotask(() => this.ouvintes.aoFechar(codigo));
  }

  abrir(): void {
    this.ouvintes.aoAbrir();
  }

  fechar(codigo: number): void {
    this.ouvintes.aoFechar(codigo);
  }

  receber(mensagem: Record<string, unknown>): void {
    this.ouvintes.aoReceber(JSON.stringify(mensagem));
  }
}

describe("GameClient: política de reconexão (fake timers)", () => {
  let sockets: SocketFalso[];

  function clienteFalso(): GameClient {
    sockets = [];
    vi.useFakeTimers();
    cliente = new GameClient({
      wsUrl: "ws://jogo.example/ws",
      shards: 1,
      gameUrl: "http://jogo.example",
      accountId: "conta-teste",
      auth,
      health,
      fetch: fetchJogo,
      random: () => 0,
      criarSocket: (url, origem, ouvintes) => {
        expect(origem).toBe("http://jogo.example");
        const socket = new SocketFalso(url, ouvintes);
        sockets.push(socket);
        return socket;
      },
    });
    return cliente;
  }

  async function iniciar(c: GameClient): Promise<void> {
    c.conectar();
    await vi.advanceTimersByTimeAsync(0);
  }

  async function esperarSocket(total: number, atrasoMs: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(atrasoMs - 1);
    expect(sockets).toHaveLength(total - 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(total);
  }

  it("handshake falhando: backoff do bundle até 5 falhas, depois teto de 5 min", async () => {
    const c = clienteFalso();
    await iniciar(c);
    const atrasos = [
      1_500, 3_000, 6_000, 12_000, 24_000, 48_000, 96_000, 192_000, 300_000, 300_000,
    ];
    for (const [indice, atraso] of atrasos.entries()) {
      sockets[indice]!.fechar(1006);
      await esperarSocket(indice + 2, atraso);
    }
    expect(health.snapshot().lastError).toBe(
      "ws fechado (código 1006); próxima tentativa em 5 min",
    );
  });

  it("abrir sem nenhuma mensagem não zera o backoff; mensagem do servidor zera", async () => {
    const c = clienteFalso();
    await iniciar(c);
    for (const [indice, atraso] of [1_500, 3_000, 6_000].entries()) {
      sockets[indice]!.abrir();
      sockets[indice]!.fechar(1011);
      await esperarSocket(indice + 2, atraso);
    }
    sockets[3]!.abrir();
    sockets[3]!.receber({ type: "balls", counts: {} });
    sockets[3]!.fechar(1011);
    await esperarSocket(5, 1_500);
  });

  it("4003 (manutenção): 5, 10 e 15 min, com teto de 15 min", async () => {
    const c = clienteFalso();
    await iniciar(c);
    for (const [indice, atraso] of [300_000, 600_000, 900_000, 900_000].entries()) {
      sockets[indice]!.abrir();
      sockets[indice]!.fechar(4003);
      expect(health.snapshot().lastError).toBe(
        `servidor em manutenção (WS 4003); próxima tentativa em ${atraso / 60_000} min`,
      );
      await esperarSocket(indice + 2, atraso);
    }
  });

  it("4001 com renovação adiada reconecta com backoff e pode invalidar de novo", async () => {
    auth.invalidar.mockRejectedValueOnce(new AuthAdiadaError("refresh indisponível"));
    const c = clienteFalso();
    await iniciar(c);

    sockets[0]!.fechar(4001);
    await esperarSocket(2, 1_500);
    expect(health.snapshot().state).not.toBe("needs-login");
    expect(health.snapshot().lastError).toContain("refresh indisponível");

    sockets[1]!.fechar(4001);
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.invalidar).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(3);
    expect(sockets[2]!.url).toContain(encodeURIComponent(accessNovo));
  });

  it("reciclar: no máximo 1 a cada 60s e para após 3 sem resolver até um freeze novo", async () => {
    const c = clienteFalso();
    await iniciar(c);
    sockets[0]!.abrir();
    sockets[0]!.receber({
      type: "restart-freeze",
      frozenAt: 10,
      restartedAt: 20,
      boosts: [{ key: "xp", pct: 1, remainingMs: 1_000 }],
    });
    c.restartResume();

    sockets[0]!.receber({ type: "restart-resumed" });
    expect(c.estado.restartFreeze).toBeNull();
    expect(c.estado.restartResumeEnviadoEm).toBeNull();
    await esperarSocket(2, 1_000);

    sockets[1]!.abrir();
    sockets[1]!.receber({ type: "restart-resumed" });
    await esperarSocket(3, 59_000);

    sockets[2]!.abrir();
    sockets[2]!.receber({ type: "restart-resumed" });
    await esperarSocket(4, 1_000);

    sockets[3]!.abrir();
    expect(c.reciclar()).toBe(false);
    expect(sockets[3]!.fechadoCom).toBeNull();
    expect(health.snapshot().lastError).toContain("3 reconexões");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sockets).toHaveLength(4);

    sockets[3]!.receber({
      type: "restart-freeze",
      frozenAt: 99,
      restartedAt: 100,
      boosts: [{ key: "xp", pct: 1, remainingMs: 1_000 }],
    });
    expect(c.reciclar()).toBe(true);
    expect(sockets[3]!.fechadoCom).toBe(1000);
    await esperarSocket(5, 29_000);
    expect(auth.invalidar).not.toHaveBeenCalled();
  });

  it("field-init ou field-kill zeram a contagem de reciclagens", async () => {
    const c = clienteFalso();
    await iniciar(c);
    for (let indice = 0; indice < 3; indice += 1) {
      sockets[indice]!.abrir();
      sockets[indice]!.receber({ type: "field-kill", speciesName: "Rattata" });
      expect(c.reciclar()).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
    }
    sockets[3]!.abrir();
    sockets[3]!.receber({ type: "field-init", slug: "rattata" });
    expect(c.reciclar()).toBe(true);
  });

  it("close terminal durante a reciclagem vence: 4005 → needs-login sem reconectar", async () => {
    const c = clienteFalso();
    await iniciar(c);
    sockets[0]!.abrir();
    sockets[0]!.fecharAutomatico = false;
    expect(c.reciclar()).toBe(true);
    sockets[0]!.fechar(4005);

    await expect(c.encerrado).resolves.toMatchObject({ estado: "needs-login" });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(sockets).toHaveLength(1);
    expect(c.reconexaoPendente).toBe(false);
  });

  it("4001 durante a reciclagem passa pelo invalidar", async () => {
    const c = clienteFalso();
    await iniciar(c);
    sockets[0]!.abrir();
    sockets[0]!.fecharAutomatico = false;
    c.reciclar();
    sockets[0]!.fechar(4001);
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.invalidar).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(2);
  });
});
