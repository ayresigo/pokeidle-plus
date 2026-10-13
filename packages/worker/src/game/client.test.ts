import { once } from "node:events";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { WebSocketServer, type WebSocket as SocketServidor } from "ws";
import { criarJwt } from "../auth/__fixtures__/jwt.js";
import { AuthAdiadaError, AuthIndisponivelError } from "../auth/provider.js";
import { HealthState, type Tokens } from "../health.js";
import {
  GameClient,
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
    return `ws://127.0.0.1:${(this.wss.address() as AddressInfo).port}/`;
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

function tokenComNick(nick: string): string {
  const payload = Buffer.from(JSON.stringify({ nick, contaId: 1, exp: exp() })).toString(
    "base64url",
  );
  return `${payload}.assinatura`;
}

const accessInicial = tokenComNick("treino-fake");
const accessNovo = tokenComNick("treino-fake-nova");
const tokensIniciais: Tokens = { accessToken: accessInicial, refreshToken: "refresh-1" };
const tokensNovos: Tokens = { accessToken: accessNovo, refreshToken: "refresh-2" };

let servidor: ServidorJogo;
let health: HealthState;
let auth: AuthJogo & { getTokens: Mock; invalidar: Mock; adotar: Mock; nick: Mock };
let cliente: GameClient | null = null;

function criarAuth(): AuthJogo & { getTokens: Mock; invalidar: Mock; adotar: Mock; nick: Mock } {
  let atuais = tokensIniciais;
  let nickAtual: string | null = "treino-fake";
  return {
    getTokens: vi.fn(async () => atuais),
    invalidar: vi.fn(async () => {
      atuais = tokensNovos;
      return atuais;
    }),
    adotar: vi.fn((t: Tokens) => {
      atuais = t;
      if (t.nick) nickAtual = t.nick;
    }),
    nick: vi.fn(() => nickAtual),
  };
}

function novoCliente(extra: Partial<OpcoesClient> = {}): GameClient {
  cliente = new GameClient({
    wsUrl: extra.wsUrl ?? servidor.wsUrl,
    gameUrl: "https://jogo.example",
    accountId: "conta-teste",
    dispositivo: "disp-1",
    huntSlug: "bellsprout",
    auth,
    health,
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
});

afterEach(async () => {
  vi.useRealTimers();
  await cliente?.desconectar();
  cliente = null;
  await servidor.fechar();
});

describe("GameClient: handshake e eventos", () => {
  it("abre, envia hello e só vira in-game no welcome, então pede a hunt", async () => {
    health.setState("authenticating");
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);

    expect(conexao.headers.origin).toBe("https://jogo.example");
    await vi.waitFor(() =>
      expect(conexao.mensagens[0]).toMatchObject({
        t: "hello",
        nick: "treino-fake",
        delta: 1,
        dispositivo: "disp-1",
      }),
    );
    expect(health.snapshot().state).toBe("authenticating");
    expect(c.conectado).toBe(false);

    servidor.emitir(conexao, { t: "welcome", estado: {} });
    await vi.waitFor(() => expect(health.snapshot().state).toBe("in-game"));
    expect(c.conectado).toBe(true);
    await vi.waitFor(() =>
      expect(conexao.mensagens).toContainEqual({ t: "hunt.select", slug: "bellsprout" }),
    );
  });

  it("campo.init entra na hunt; batalha/morte conta kills e publica no /health", async () => {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);

    servidor.emitir(conexao, { t: "welcome", estado: {} });
    servidor.emitir(conexao, { t: "campo.init", slug: "bellsprout", mapa: {}, mobs: [], heroi: {} });
    servidor.emitir(conexao, {
      t: "batalha",
      ev: [
        { k: "ataque", por: "jogador", dano: 9 },
        { k: "morte", quem: "selvagem", nome: "Bellsprout", xp: 10, ouro: 5, drops: [] },
      ],
    });
    servidor.emitir(conexao, {
      t: "batalha",
      ev: [{ k: "morte", quem: "selvagem", nome: "Bellsprout" }],
    });
    servidor.emitir(conexao, { t: "batalha", ev: [{ k: "captura", nome: "Bellsprout" }] });

    await vi.waitFor(() => expect(c.estado.kills).toBe(2));
    expect(c.estado.huntAtual).toBe("bellsprout");
    expect(c.estado.huntDesde).toEqual(expect.any(Number));
    expect(c.estado.ultimoKill).toBe("Bellsprout");
    expect(c.estado.ultimoKillEm).toEqual(expect.any(Number));
    expect(c.estado.capturas).toBe(1);
    expect(health.snapshot().kills).toBe(2);
    expect(health.snapshot().capturas).toBe(1);
  });

  it("morte do herói não conta; campo de alta frequência é ignorado; aviso vira lastError", async () => {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { t: "welcome", estado: {} });

    servidor.emitir(conexao, { t: "batalha", ev: [{ k: "morte", quem: "heroi", nome: "x" }] });
    servidor.emitir(conexao, { t: "campo", seq: 1, heroi: {}, mobs: [], alvo: null, fora: [] });
    servidor.emitir(conexao, {
      t: "batalha",
      ev: [{ k: "aviso", msg: '"xpto" não é uma área caçável' }],
    });

    await vi.waitFor(() =>
      expect(health.snapshot().lastError).toContain("não é uma área caçável"),
    );
    expect(c.estado.kills).toBe(0);
  });

  it("morte e captura logam sem segredo e publicam contadores no /health", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { t: "welcome", estado: {} });

    servidor.emitir(conexao, { t: "batalha", ev: [{ k: "morte", quem: "selvagem", nome: "Bellsprout" }] });
    servidor.emitir(conexao, { t: "batalha", ev: [{ k: "morte", quem: "selvagem", nome: "Weedle" }] });
    servidor.emitir(conexao, { t: "batalha", ev: [{ k: "captura", nome: "Bellsprout" }] });

    await vi.waitFor(() => expect(health.snapshot().kills).toBe(2));
    expect(health.snapshot().capturas).toBe(1);

    const linhas = log.mock.calls.map((chamada) => String(chamada[0]));
    expect(linhas.some((linha) => linha.includes("morte"))).toBe(true);
    expect(linhas.some((linha) => linha.includes("captura"))).toBe(true);
    expect(linhas.join("\n")).not.toContain(accessInicial);
    log.mockRestore();
  });

  it("estado.dexMud reconcilia contadores autoritativos acima do contador local", async () => {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { t: "welcome", estado: {} });

    servidor.emitir(conexao, { t: "estado", estado: { dexMud: { "1": { k: 5, c: 1 } } } });
    servidor.emitir(conexao, { t: "batalha", ev: [{ k: "morte", quem: "selvagem", nome: "x" }] });
    servidor.emitir(conexao, { t: "estado", estado: { dexMud: { "1": { k: 9, c: 1 } } } });

    await vi.waitFor(() => expect(c.estado.kills).toBe(4));
    expect(health.snapshot().kills).toBe(4);
  });

  it("selecionarHunt manual vira hunt.select", async () => {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { t: "welcome", estado: {} });
    await vi.waitFor(() =>
      expect(conexao.mensagens).toContainEqual({ t: "hunt.select", slug: "bellsprout" }),
    );

    c.selecionarHunt("caterpie");
    expect(c.estado.huntSelectEnviadoEm).toEqual(expect.any(Number));
    await vi.waitFor(() =>
      expect(conexao.mensagens).toContainEqual({ t: "hunt.select", slug: "caterpie" }),
    );
  });

  it("comando sem conexão aberta falha", () => {
    const c = novoCliente();
    expect(() => c.selecionarHunt("x")).toThrow("desconectado");
  });

  it("sessao.renovada adota o token; após a queda o 2º hello leva o renovado", async () => {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { t: "welcome", estado: {} });
    await vi.waitFor(() => expect(health.snapshot().state).toBe("in-game"));

    servidor.emitir(conexao, { t: "sessao.renovada", token: "token-renovado-ws" });
    await vi.waitFor(() =>
      expect(auth.adotar).toHaveBeenCalledWith({
        accessToken: "token-renovado-ws",
        refreshToken: "token-renovado-ws",
      }),
    );

    conexao.socket.close(1012, "restart");
    const segunda = await servidor.conexao(1);
    await vi.waitFor(() =>
      expect(segunda.mensagens[0]).toMatchObject({ t: "hello", token: "token-renovado-ws" }),
    );
  });

  it("hunt: config HUNT_SLUG tem prioridade sobre estado.huntSlug", async () => {
    const c = novoCliente({ huntSlug: "caterpie" });
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { t: "welcome", estado: { huntSlug: "doServidor" } });
    await vi.waitFor(() =>
      expect(conexao.mensagens).toContainEqual({ t: "hunt.select", slug: "caterpie" }),
    );
    expect(c.huntAlvo).toBe("caterpie");
  });

  it("hunt: sem config usa estado.huntSlug do welcome", async () => {
    const c = novoCliente({ huntSlug: undefined });
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { t: "welcome", estado: { huntSlug: "doServidor" } });
    await vi.waitFor(() =>
      expect(conexao.mensagens).toContainEqual({ t: "hunt.select", slug: "doServidor" }),
    );
    expect(c.huntAlvo).toBe("doServidor");
  });

  it("hunt: sem config e sem estado.huntSlug usa o default bellsprout", async () => {
    const c = novoCliente({ huntSlug: undefined });
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { t: "welcome", estado: {} });
    await vi.waitFor(() =>
      expect(conexao.mensagens).toContainEqual({ t: "hunt.select", slug: "bellsprout" }),
    );
    expect(c.huntAlvo).toBe("bellsprout");
  });
});

describe("GameClient: fechamentos e reconexão", () => {
  it("queda comum reconecta com backoff e volta a in-game", async () => {
    servidor.aoConectar = (conexao) => {
      if (servidor.conexoes.length === 1) {
        conexao.socket.once("message", () => conexao.socket.close(1012, "restart"));
      } else {
        conexao.socket.send(JSON.stringify({ t: "welcome", estado: {} }));
      }
    };
    const erros = vi.spyOn(health, "setLastError");
    const c = novoCliente();
    c.conectar();

    await servidor.conexao(1);
    expect(erros).toHaveBeenCalledWith(expect.stringContaining("ws fechado (código 1012)"));
    await vi.waitFor(() => expect(health.snapshot().state).toBe("in-game"));
    expect(c.conectado).toBe(true);
    expect(auth.invalidar).not.toHaveBeenCalled();
  });

  it("erro no handshake invalida uma vez e reconecta com o token novo", async () => {
    servidor.aoConectar = (conexao) => {
      conexao.socket.once("message", () =>
        conexao.socket.send(
          JSON.stringify(
            servidor.conexoes.length === 1
              ? { t: "erro", msg: "token recusado" }
              : { t: "welcome", estado: {} },
          ),
        ),
      );
    };
    novoCliente().conectar();

    const segunda = await servidor.conexao(1);
    await vi.waitFor(() => expect(auth.invalidar).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(segunda.mensagens[0]).toMatchObject({ token: accessNovo }));
    await vi.waitFor(() => expect(health.snapshot().state).toBe("in-game"));
  });

  it("erro no handshake de novo dentro de 5 min → needs-login sem reconectar", async () => {
    servidor.aoConectar = (conexao) => {
      conexao.socket.once("message", () =>
        conexao.socket.send(JSON.stringify({ t: "erro", msg: "token recusado" })),
      );
    };
    const c = novoCliente();
    c.conectar();

    await expect(c.encerrado).resolves.toMatchObject({ estado: "needs-login" });
    expect(auth.invalidar).toHaveBeenCalledTimes(1);
    expect(health.snapshot().state).toBe("needs-login");
    semReconexao(c, 2);
  });

  it("erro no handshake com invalidar falhando → needs-login", async () => {
    auth.invalidar.mockRejectedValueOnce(new AuthIndisponivelError("sem tokens válidos"));
    servidor.aoConectar = (conexao) => {
      conexao.socket.once("message", () =>
        conexao.socket.send(JSON.stringify({ t: "erro", msg: "token recusado" })),
      );
    };
    const c = novoCliente();
    c.conectar();

    await expect(c.encerrado).resolves.toMatchObject({ estado: "needs-login" });
    expect(health.snapshot().lastError).toContain("sem tokens válidos");
    semReconexao(c, 1);
  });

  it("erro depois do welcome vira lastError e não derruba o jogo", async () => {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { t: "welcome", estado: {} });
    await vi.waitFor(() => expect(c.conectado).toBe(true));

    servidor.emitir(conexao, { t: "erro", msg: "aviso qualquer" });
    await vi.waitFor(() => expect(health.snapshot().lastError).toContain("aviso qualquer"));
    expect(c.conectado).toBe(true);
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

  it("getTokens com AuthAdiadaError reconecta com backoff e não encerra", async () => {
    auth.getTokens.mockRejectedValueOnce(new AuthAdiadaError("renovação adiada"));
    servidor.aoConectar = (conexao) =>
      conexao.socket.send(JSON.stringify({ t: "welcome", estado: {} }));
    const c = novoCliente();
    c.conectar();
    await vi.waitFor(() => expect(health.snapshot().state).toBe("in-game"));
    expect(c.conectado).toBe(true);
    expect(health.snapshot().state).not.toBe("needs-login");
  });

  it("heartbeat: silêncio → ping {t:'ping'}; sem resposta → fecha e reconecta", async () => {
    const c = novoCliente({ heartbeat: { verificarMs: 10, silencioMs: 40, prazoPingMs: 40 } });
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { t: "welcome", estado: {} });
    await vi.waitFor(() => expect(conexao.mensagens).toContainEqual({ t: "ping" }));
    await servidor.conexao(1);
  });

  it("desconectar fecha limpo (1000), não reconecta e encerra", async () => {
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
    servidor.aoConectar = (conexao) => {
      conexao.socket.once("message", () =>
        conexao.socket.send(JSON.stringify({ t: "erro", msg: "token recusado" })),
      );
    };
    const c = novoCliente();
    c.conectar();
    await c.encerrado;
    const texto = JSON.stringify(health.snapshot());
    expect(texto).not.toContain(accessInicial);
    expect(texto).not.toContain(accessNovo);
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
      wsUrl: "ws://jogo.example/",
      gameUrl: "https://jogo.example",
      accountId: "conta-teste",
      dispositivo: "disp-1",
      huntSlug: "bellsprout",
      auth,
      health,
      random: () => 0,
      criarSocket: (url, origem, ouvintes) => {
        expect(origem).toBe("https://jogo.example");
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

  it("backoff do bundle até 5 falhas, depois teto de 5 min", async () => {
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

  it("só o welcome zera o backoff (pong/erro não zeram)", async () => {
    const c = clienteFalso();
    await iniciar(c);
    for (const [indice, atraso] of [1_500, 3_000, 6_000].entries()) {
      sockets[indice]!.abrir();
      sockets[indice]!.receber({ t: "pong" });
      sockets[indice]!.fechar(1011);
      await esperarSocket(indice + 2, atraso);
    }
    sockets[3]!.abrir();
    sockets[3]!.receber({ t: "welcome", estado: {} });
    sockets[3]!.fechar(1011);
    await esperarSocket(5, 1_500);
  });

  it("recusas/erros seguidos antes do welcome escalam o backoff (não resetam)", async () => {
    auth.invalidar.mockRejectedValue(new AuthAdiadaError("renovação adiada"));
    const c = clienteFalso();
    await iniciar(c);
    for (const [indice, atraso] of [1_500, 3_000, 6_000, 12_000, 24_000].entries()) {
      sockets[indice]!.abrir();
      sockets[indice]!.receber(
        indice % 2 === 0 ? { t: "erro", msg: "token recusado" } : { t: "erro", chave: "algo.desconhecido" },
      );
      await esperarSocket(indice + 2, atraso);
    }
    expect(health.snapshot().state).not.toBe("needs-login");
  });

  it("erro no handshake com renovação adiada reconecta com backoff e pode invalidar de novo", async () => {
    auth.invalidar.mockRejectedValueOnce(new AuthAdiadaError("refresh indisponível"));
    const c = clienteFalso();
    await iniciar(c);

    sockets[0]!.abrir();
    sockets[0]!.receber({ t: "erro", msg: "token recusado" });
    await esperarSocket(2, 1_500);
    expect(health.snapshot().state).not.toBe("needs-login");
    expect(health.snapshot().lastError).toContain("refresh indisponível");

    sockets[1]!.abrir();
    sockets[1]!.receber({ t: "erro", msg: "token recusado" });
    await vi.advanceTimersByTimeAsync(0);
    expect(auth.invalidar).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(3);
    sockets[2]!.abrir();
    expect(sockets[2]!.enviados[0]).toMatchObject({ t: "hello", token: accessNovo });
  });
});

describe("GameClient: close codes e sessão substituída (I5)", () => {
  async function emJogo(): Promise<{ c: GameClient; conexao: ConexaoFake }> {
    const c = novoCliente();
    c.conectar();
    const conexao = await servidor.conexao(0);
    servidor.emitir(conexao, { t: "welcome", estado: {} });
    await vi.waitFor(() => expect(health.snapshot().state).toBe("in-game"));
    return { c, conexao };
  }

  it("close 4001 → needs-login (sessão substituída) sem reconectar", async () => {
    const { c, conexao } = await emJogo();
    conexao.socket.close(4001, "replaced");
    await expect(c.encerrado).resolves.toMatchObject({ estado: "needs-login" });
    expect(health.snapshot().lastError).toContain("substituída");
    semReconexao(c, 1);
  });

  it("close 4003 → error (IP banido) sem reconectar", async () => {
    const { c, conexao } = await emJogo();
    conexao.socket.close(4003, "ip");
    await expect(c.encerrado).resolves.toMatchObject({ estado: "error" });
    expect(health.snapshot().state).toBe("error");
    semReconexao(c, 1);
  });

  it("close 4000 → error (conta bloqueada/banida) sem reconectar", async () => {
    const { c, conexao } = await emJogo();
    conexao.socket.close(4000, "ban");
    await expect(c.encerrado).resolves.toMatchObject({ estado: "error" });
    semReconexao(c, 1);
  });

  it("erro com chave de conta bloqueada encerra em error", async () => {
    const { c, conexao } = await emJogo();
    servidor.emitir(conexao, { t: "erro", chave: "auth.contaBanida" });
    await expect(c.encerrado).resolves.toMatchObject({ estado: "error" });
  });

  it("N quedas logo após o welcome → needs-login (backstop)", async () => {
    servidor.aoConectar = (conexao) => {
      conexao.socket.send(JSON.stringify({ t: "welcome", estado: {} }));
      conexao.socket.close(1011, "drop");
    };
    const c = novoCliente();
    c.conectar();
    await expect(c.encerrado).resolves.toMatchObject({ estado: "needs-login" });
    expect(health.snapshot().lastError).toContain("substituída");
  });

  it("erro pré-welcome com chave desconhecida fecha e reconecta (não trava, sem invalidar)", async () => {
    servidor.aoConectar = (conexao) => {
      if (servidor.conexoes.length === 1) {
        conexao.socket.once("message", () =>
          conexao.socket.send(JSON.stringify({ t: "erro", chave: "algo.desconhecido" })),
        );
      } else {
        conexao.socket.send(JSON.stringify({ t: "welcome", estado: {} }));
      }
    };
    const c = novoCliente();
    c.conectar();
    await servidor.conexao(1);
    await vi.waitFor(() => expect(health.snapshot().state).toBe("in-game"));
    expect(auth.invalidar).not.toHaveBeenCalled();
  });
});
