import { WebSocket, type Dispatcher } from "undici";
import { AuthAdiadaError } from "../auth/provider.js";
import { lerExpiracao } from "../auth/refresh.js";
import type { WorkerConfig } from "../config.js";
import type { HealthState, Tokens } from "../health.js";
import { criarDispatcher, criarFetch, descartarCorpo, lerJson, type HttpFetch } from "../http.js";

export interface AuthJogo {
  getTokens(): Promise<Tokens>;
  invalidar(): Promise<Tokens>;
}

export interface EstadoJogo {
  conectadoEm: number | null;
  huntAtual: string | null;
  huntDesde: number | null;
  huntRetomavel: string | null;
  huntCooldownAte: number | null;
  enterHuntEnviadoEm: number | null;
  ultimoKillEm: number | null;
  ultimoKill: string | null;
  kills: number;
  capturas: number;
  balls: number | null;
  itensInventario: number | null;
  ultimoAnalyzer: { seconds: number | null; balance: number | null } | null;
  restartFreeze: { frozenAt: number; restartedAt: number } | null;
  restartResumeEnviadoEm: number | null;
}

export interface HuntMapa {
  slug: string;
  nome: string;
  nivel: number;
}

export interface MotivoEncerramento {
  estado: "needs-login" | "error" | "desconectado";
  motivo: string;
}

export interface ClienteJogo {
  readonly conectado: boolean;
  readonly estado: Readonly<EstadoJogo>;
  enterHunt(slug: string, resume: boolean): void;
  leaveHunt(): void;
  restartResume(): void;
  reciclar(): boolean;
  buscarHunts(): Promise<HuntMapa[]>;
}

export interface SocketJogo {
  send(dados: string): void;
  close(codigo?: number, motivo?: string): void;
}

export interface OuvintesSocket {
  aoAbrir(): void;
  aoReceber(dados: string): void;
  aoFechar(codigo: number): void;
}

export type CriarSocket = (url: string, origem: string, ouvintes: OuvintesSocket) => SocketJogo;

export interface OpcoesClient {
  wsUrl: string;
  shards: number;
  gameUrl: string;
  auth: AuthJogo;
  health: HealthState;
  fetch: HttpFetch;
  criarSocket?: CriarSocket;
  random?: () => number;
  reconexao?: { baseMs: number; tetoMs: number };
  heartbeat?: { verificarMs: number; silencioMs: number; prazoPingMs: number };
}

const RECONEXAO_PADRAO = { baseMs: 1_500, tetoMs: 24_000 };
const FALHAS_ATE_TETO_LONGO = 5;
const TETO_LONGO_MS = 5 * 60_000;
const MANUTENCAO_INICIAL_MS = 5 * 60_000;
const MANUTENCAO_TETO_MS = 15 * 60_000;
const JITTER_MANUTENCAO = 0.2;
const INTERVALO_RECICLAGEM_MS = 60_000;
const ATRASO_MINIMO_RECICLAGEM_MS = 1_000;
const MAX_RECICLAGENS = 3;
const HEARTBEAT_PADRAO = { verificarMs: 10_000, silencioMs: 45_000, prazoPingMs: 15_000 };
const INTERVALO_MINIMO_INVALIDAR_MS = 5 * 60_000;
const TIMEOUT_DESCONEXAO_MS = 2_000;
const MARGEM_HUNT_COOLDOWN_MS = 100;
const WS_AUTH_RECUSADA = 4001;
const WS_MANUTENCAO = 4003;
const FECHAMENTOS_TERMINAIS: Record<number, MotivoEncerramento> = {
  4005: {
    estado: "needs-login",
    motivo:
      "sessão substituída por outro login (WS 4005); sem reconexão para não derrubar o outro acesso",
  },
  4006: { estado: "error", motivo: "limite de contas por IP atingido (WS 4006)" },
  4007: { estado: "error", motivo: "limite de contas por máquina atingido (WS 4007)" },
  4008: { estado: "needs-login", motivo: "personagem precisa trocar de nome no jogo (WS 4008)" },
  4009: { estado: "needs-login", motivo: "conta precisa trocar a senha no jogo (WS 4009)" },
};

function ehRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function lerSub(accessToken: string): string | null {
  try {
    const payload: unknown = JSON.parse(atob(accessToken.split(".")[1] ?? ""));
    if (payload === null) return null;
    return ehRegistro(payload) ? String(payload.sub ?? "") : "";
  } catch {
    return null;
  }
}

export function montarUrlWs(base: string, accessToken: string, shards: number): string {
  const sub = shards > 1 ? lerSub(accessToken) : null;
  let url = base;
  if (sub !== null) {
    let hash = 5381;
    for (let i = 0; i < sub.length; i += 1) hash = ((hash << 5) + hash + sub.charCodeAt(i)) | 0;
    const indice = Math.abs(hash) % shards;
    if (indice > 0) {
      const alvo = new URL(base);
      if (alvo.pathname && alvo.pathname !== "/") {
        alvo.pathname = `${alvo.pathname.replace(/\/$/, "")}${indice}`;
      } else {
        const padrao = alvo.protocol === "wss:" || alvo.protocol === "https:" ? 443 : 80;
        alvo.port = String(Number(alvo.port || padrao) + indice);
      }
      url = alvo.toString().replace(/\/$/, "");
    }
  }
  return `${url}?token=${encodeURIComponent(accessToken)}&v=2`;
}

export function criarSocketUndici(dispatcher: Dispatcher | undefined): CriarSocket {
  return (url, origem, ouvintes) => {
    const socket = new WebSocket(url, { dispatcher, headers: { Origin: origem } });
    socket.addEventListener("open", () => ouvintes.aoAbrir());
    socket.addEventListener("message", (evento) => {
      if (typeof evento.data === "string") ouvintes.aoReceber(evento.data);
    });
    socket.addEventListener("close", (evento) => ouvintes.aoFechar(evento.code));
    return socket;
  };
}

export class GameClient implements ClienteJogo {
  readonly encerrado: Promise<MotivoEncerramento>;
  private readonly dados: EstadoJogo = {
    conectadoEm: null,
    huntAtual: null,
    huntDesde: null,
    huntRetomavel: null,
    huntCooldownAte: null,
    enterHuntEnviadoEm: null,
    ultimoKillEm: null,
    ultimoKill: null,
    kills: 0,
    capturas: 0,
    balls: null,
    itensInventario: null,
    ultimoAnalyzer: null,
    restartFreeze: null,
    restartResumeEnviadoEm: null,
  };
  private readonly fim = Promise.withResolvers<MotivoEncerramento>();
  private readonly criarSocket: CriarSocket;
  private socket: SocketJogo | null = null;
  private socketFechado: Promise<void> | null = null;
  private aberto = false;
  private abrindo = false;
  private reciclando = false;
  private iniciado = false;
  private final: MotivoEncerramento | null = null;
  private tentativas = 0;
  private manutencoes = 0;
  private reciclagens = 0;
  private ultimaReciclagemEm: number | null = null;
  private atrasoReciclagem = ATRASO_MINIMO_RECICLAGEM_MS;
  private ultimoFrozenAt: unknown = null;
  private ultimaMensagemEm = 0;
  private pingEm = 0;
  private ultimoInvalidarEm: number | null = null;
  private timerReconexao: NodeJS.Timeout | undefined;
  private timerHeartbeat: NodeJS.Timeout | undefined;

  constructor(private readonly opcoes: OpcoesClient) {
    this.encerrado = this.fim.promise;
    this.criarSocket = opcoes.criarSocket ?? criarSocketUndici(undefined);
  }

  get conectado(): boolean {
    return this.aberto;
  }

  get estado(): Readonly<EstadoJogo> {
    return this.dados;
  }

  get reconexaoPendente(): boolean {
    return this.timerReconexao !== undefined || this.abrindo;
  }

  conectar(): void {
    if (this.iniciado || this.final) return;
    this.iniciado = true;
    void this.abrir();
  }

  async desconectar(): Promise<void> {
    this.encerrar({ estado: "desconectado", motivo: "desconectado pelo worker" });
    const socket = this.socket;
    const fechado = this.socketFechado;
    this.socket = null;
    this.socketFechado = null;
    this.aberto = false;
    if (!socket || !fechado) return;
    const prazo = Promise.withResolvers<void>();
    const timer = setTimeout(prazo.resolve, TIMEOUT_DESCONEXAO_MS);
    socket.close(1000, "drain");
    await Promise.race([fechado, prazo.promise]);
    clearTimeout(timer);
  }

  enterHunt(slug: string, resume: boolean): void {
    this.enviar({ type: "enter-hunt", slug, resume });
    this.dados.enterHuntEnviadoEm = Date.now();
  }

  leaveHunt(): void {
    this.enviar({ type: "leave-hunt" });
    this.dados.huntAtual = null;
    this.dados.huntDesde = null;
  }

  setCity(slug: string): void {
    this.enviar({ type: "set-city", slug });
  }

  restartResume(): void {
    this.enviar({ type: "restart-resume" });
    this.dados.restartResumeEnviadoEm = Date.now();
  }

  reciclar(): boolean {
    if (!this.socket || !this.aberto) return false;
    if (this.reciclagens >= MAX_RECICLAGENS) {
      this.opcoes.health.setLastError(
        `restart não resolveu após ${MAX_RECICLAGENS} reconexões; aguardando novo restart-freeze do servidor`,
      );
      return false;
    }
    const agora = Date.now();
    const liberadoEm = (this.ultimaReciclagemEm ?? -Infinity) + INTERVALO_RECICLAGEM_MS;
    this.reciclagens += 1;
    this.atrasoReciclagem = Math.max(ATRASO_MINIMO_RECICLAGEM_MS, liberadoEm - agora);
    this.ultimaReciclagemEm = agora;
    this.reciclando = true;
    this.socket.close(1000, "reciclar");
    return true;
  }

  async buscarHunts(): Promise<HuntMapa[]> {
    const path = "/api/game/map-markers";
    const resposta = await this.opcoes.fetch(new URL(path, this.opcoes.gameUrl).toString());
    if (!resposta.ok) {
      await descartarCorpo(resposta);
      throw new Error(`HTTP ${resposta.status} em ${path}`);
    }
    const corpo = await lerJson(resposta);
    const hunts: unknown[] = Array.isArray(corpo.hunts) ? corpo.hunts : [];
    return hunts.flatMap((hunt) => {
      if (!ehRegistro(hunt) || typeof hunt.slug !== "string" || !hunt.slug) return [];
      const nome = typeof hunt.name === "string" ? hunt.name : hunt.slug;
      return [{ slug: hunt.slug, nome, nivel: Number(hunt.level) || 0 }];
    });
  }

  private async invalidarLimitado(): Promise<Tokens | null> {
    const agora = Date.now();
    if (
      this.ultimoInvalidarEm !== null &&
      agora - this.ultimoInvalidarEm < INTERVALO_MINIMO_INVALIDAR_MS
    ) {
      return null;
    }
    this.ultimoInvalidarEm = agora;
    return this.opcoes.auth.invalidar();
  }

  private enviar(mensagem: Record<string, unknown>): void {
    if (!this.socket || !this.aberto) throw new Error("ws desconectado");
    this.socket.send(JSON.stringify(mensagem));
  }

  private async abrir(): Promise<void> {
    this.timerReconexao = undefined;
    if (this.final) return;
    this.abrindo = true;
    let tokens: Tokens;
    try {
      tokens = await this.opcoes.auth.getTokens();
    } catch (erro) {
      this.abrindo = false;
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      this.encerrar({ estado: "needs-login", motivo: `sem tokens para o jogo: ${detalhe}` });
      return;
    }
    if (this.final) {
      this.abrindo = false;
      return;
    }
    const exp = lerExpiracao(tokens.accessToken);
    if (exp !== null && exp <= Date.now()) {
      this.abrindo = false;
      this.reconectarComBackoff("access expirado; aguardando renovação dos tokens");
      return;
    }
    const fechado = Promise.withResolvers<void>();
    const socket: SocketJogo = this.criarSocket(
      montarUrlWs(this.opcoes.wsUrl, tokens.accessToken, this.opcoes.shards),
      new URL(this.opcoes.gameUrl).origin,
      {
        aoAbrir: () => this.aoAbrir(socket),
        aoReceber: (dados) => {
          if (this.socket === socket) this.aoReceber(dados);
        },
        aoFechar: (codigo) => {
          fechado.resolve();
          this.aoFechar(socket, codigo);
        },
      },
    );
    this.socket = socket;
    this.socketFechado = fechado.promise;
  }

  private aoAbrir(socket: SocketJogo): void {
    if (this.socket !== socket) return;
    const agora = Date.now();
    this.abrindo = false;
    this.aberto = true;
    this.ultimaMensagemEm = agora;
    this.pingEm = 0;
    Object.assign(this.dados, {
      conectadoEm: agora,
      huntAtual: null,
      huntDesde: null,
      huntRetomavel: null,
      huntCooldownAte: null,
      enterHuntEnviadoEm: null,
      restartFreeze: null,
      restartResumeEnviadoEm: null,
    });
    this.opcoes.health.setState("in-game");
    this.opcoes.health.setLastError(null);
    this.opcoes.health.setLastAction("conectado ao jogo");
    this.enviar({ type: "restart-state" });
    this.enviar({ type: "balls-get" });
    this.armarHeartbeat(socket);
  }

  private aoFechar(socket: SocketJogo, codigo: number): void {
    if (this.socket !== socket) return;
    const reciclando = this.reciclando;
    this.socket = null;
    this.socketFechado = null;
    this.aberto = false;
    this.abrindo = false;
    this.reciclando = false;
    clearInterval(this.timerHeartbeat);
    if (this.final) return;
    if (codigo === WS_AUTH_RECUSADA) {
      void this.tratarAuthRecusada();
      return;
    }
    const terminal = FECHAMENTOS_TERMINAIS[codigo];
    if (terminal) {
      this.encerrar(terminal);
      return;
    }
    if (reciclando) {
      this.opcoes.health.setLastAction("reciclando a conexão com o jogo");
      this.timerReconexao = setTimeout(() => void this.abrir(), this.atrasoReciclagem);
      return;
    }
    if (codigo === WS_MANUTENCAO) {
      this.manutencoes += 1;
      const base = Math.min(
        MANUTENCAO_TETO_MS,
        MANUTENCAO_INICIAL_MS * 2 ** (this.manutencoes - 1),
      );
      const sorteio = (this.opcoes.random ?? Math.random)();
      this.agendarReconexao(
        "servidor em manutenção (WS 4003)",
        base - Math.floor(sorteio * base * JITTER_MANUTENCAO),
      );
      return;
    }
    this.reconectarComBackoff(`ws fechado (código ${codigo})`);
  }

  private async tratarAuthRecusada(): Promise<void> {
    this.abrindo = true;
    let novos: Tokens | null;
    try {
      novos = await this.invalidarLimitado();
    } catch (erro) {
      this.abrindo = false;
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      if (erro instanceof AuthAdiadaError) {
        this.ultimoInvalidarEm = null;
        this.reconectarComBackoff(
          `token recusado pelo jogo (WS 4001) e renovação adiada: ${detalhe}`,
        );
        return;
      }
      this.encerrar({
        estado: "needs-login",
        motivo: `token recusado pelo jogo (WS 4001) e renovação falhou: ${detalhe}`,
      });
      return;
    }
    this.abrindo = false;
    if (!novos) {
      this.encerrar({
        estado: "needs-login",
        motivo:
          "token recusado pelo jogo (WS 4001) de novo após invalidar; aguardando login manual",
      });
      return;
    }
    void this.abrir();
  }

  private reconectarComBackoff(motivo: string): void {
    this.tentativas += 1;
    const { baseMs, tetoMs } = this.opcoes.reconexao ?? RECONEXAO_PADRAO;
    const base = baseMs * 2 ** (this.tentativas - 1);
    const sorteio = (this.opcoes.random ?? Math.random)();
    if (this.tentativas <= FALHAS_ATE_TETO_LONGO) {
      const limitado = Math.min(tetoMs, base);
      this.agendarReconexao(motivo, limitado + Math.floor(sorteio * limitado));
      return;
    }
    this.agendarReconexao(motivo, Math.min(TETO_LONGO_MS, base + Math.floor(sorteio * base)));
  }

  private agendarReconexao(motivo: string, atrasoMs: number): void {
    if (this.final) return;
    const quando =
      atrasoMs >= 60_000
        ? `${Math.round(atrasoMs / 60_000)} min`
        : `${Math.round(atrasoMs / 1000)}s`;
    this.opcoes.health.setLastError(`${motivo}; próxima tentativa em ${quando}`);
    this.timerReconexao = setTimeout(() => void this.abrir(), atrasoMs);
  }

  private armarHeartbeat(socket: SocketJogo): void {
    const { verificarMs, silencioMs, prazoPingMs } = this.opcoes.heartbeat ?? HEARTBEAT_PADRAO;
    clearInterval(this.timerHeartbeat);
    this.timerHeartbeat = setInterval(() => {
      if (this.socket !== socket || !this.aberto) return;
      const agora = Date.now();
      if (this.pingEm) {
        if (this.ultimaMensagemEm >= this.pingEm) this.pingEm = 0;
        else if (agora - this.pingEm > prazoPingMs) this.abandonar(socket);
        return;
      }
      if (agora - this.ultimaMensagemEm > silencioMs) {
        this.pingEm = agora;
        socket.send('{"type":"ping"}');
      }
    }, verificarMs);
  }

  private abandonar(socket: SocketJogo): void {
    this.socket = null;
    this.socketFechado = null;
    this.aberto = false;
    this.reciclando = false;
    this.pingEm = 0;
    clearInterval(this.timerHeartbeat);
    socket.close();
    this.reconectarComBackoff("servidor sem resposta ao ping");
  }

  private encerrar(motivo: MotivoEncerramento): void {
    if (this.final) return;
    this.final = motivo;
    this.abrindo = false;
    clearTimeout(this.timerReconexao);
    this.timerReconexao = undefined;
    clearInterval(this.timerHeartbeat);
    if (motivo.estado !== "desconectado") {
      this.opcoes.health.setState(motivo.estado);
      this.opcoes.health.setLastError(motivo.motivo);
      this.opcoes.health.setLastAction("jogo encerrado sem reconexão");
    }
    this.fim.resolve(motivo);
  }

  private aoReceber(texto: string): void {
    this.ultimaMensagemEm = Date.now();
    let m: unknown;
    try {
      m = JSON.parse(texto);
    } catch {
      return;
    }
    if (!ehRegistro(m)) return;
    this.tentativas = 0;
    this.manutencoes = 0;
    const agora = this.ultimaMensagemEm;
    const e = this.dados;
    switch (m.type) {
      case "field-init":
        if (typeof m.slug !== "string") return;
        e.huntAtual = m.slug;
        e.huntDesde = agora;
        e.enterHuntEnviadoEm = null;
        e.huntCooldownAte = null;
        this.reciclagens = 0;
        return;
      case "field-none":
      case "field-lost":
      case "field-teleport-city":
        e.huntAtual = null;
        e.huntDesde = null;
        return;
      case "hunt-cooldown":
        e.huntCooldownAte = agora + Math.max(0, Number(m.ms) || 0) + MARGEM_HUNT_COOLDOWN_MS;
        e.enterHuntEnviadoEm = null;
        return;
      case "hunt-resume":
        if (typeof m.slug === "string" && m.slug) e.huntRetomavel = m.slug;
        return;
      case "field-kill":
        e.ultimoKillEm = agora;
        e.ultimoKill = typeof m.speciesName === "string" ? m.speciesName : null;
        e.kills += 1;
        this.reciclagens = 0;
        return;
      case "catch-result":
        if (m.success === true) e.capturas += 1;
        return;
      case "balls":
        if (typeof m.counts !== "object" || m.counts === null) return;
        e.balls = Object.values(m.counts).reduce<number>(
          (total, valor) => total + (Math.floor(Number(valor)) || 0),
          0,
        );
        return;
      case "inventory":
        if (!Array.isArray(m.items)) return;
        e.itensInventario = m.items.filter(
          (item: unknown) => ehRegistro(item) && Number(item.quantity) > 0,
        ).length;
        return;
      case "analyzer":
        e.ultimoAnalyzer = {
          seconds: typeof m.seconds === "number" && Number.isFinite(m.seconds) ? m.seconds : null,
          balance: typeof m.balance === "number" && Number.isFinite(m.balance) ? m.balance : null,
        };
        return;
      case "restart-freeze": {
        const boosts: unknown[] = Array.isArray(m.boosts) ? m.boosts : [];
        const ativos = boosts.filter(
          (boost) =>
            ehRegistro(boost) && typeof boost.key === "string" && Number(boost.remainingMs) > 0,
        );
        if (ativos.length === 0) return;
        if (m.frozenAt !== this.ultimoFrozenAt) {
          this.ultimoFrozenAt = m.frozenAt;
          this.reciclagens = 0;
        }
        e.restartFreeze = {
          frozenAt: Number(m.frozenAt) || agora,
          restartedAt: Number(m.restartedAt) || agora,
        };
        return;
      }
      case "restart-resumed":
        e.restartFreeze = null;
        e.restartResumeEnviadoEm = null;
        this.reciclar();
        return;
    }
  }
}

export function criarGameClient(
  config: WorkerConfig,
  auth: AuthJogo,
  health: HealthState,
): GameClient {
  return new GameClient({
    wsUrl: config.gameWsUrl,
    shards: config.gameWsShards,
    gameUrl: config.gameUrl,
    auth,
    health,
    fetch: criarFetch(config.proxyUrl),
    criarSocket: criarSocketUndici(criarDispatcher(config.proxyUrl)),
  });
}
