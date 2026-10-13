import { WebSocket, type Dispatcher } from "undici";
import { AuthAdiadaError } from "../auth/provider.js";
import { lerExpiracao } from "../auth/refresh.js";
import type { WorkerConfig } from "../config.js";
import type { HealthState, Tokens } from "../health.js";
import { criarDispatcher } from "../http.js";

export interface AuthJogo {
  getTokens(): Promise<Tokens>;
  invalidar(): Promise<Tokens>;
  adotar(tokens: Tokens): void;
  nick(): string | null;
}

export interface EstadoJogo {
  conectadoEm: number | null;
  huntAtual: string | null;
  huntDesde: number | null;
  huntSelectEnviadoEm: number | null;
  ultimoKillEm: number | null;
  ultimoKill: string | null;
  kills: number;
  capturas: number;
}

export interface MotivoEncerramento {
  estado: "needs-login" | "error" | "desconectado";
  motivo: string;
}

export interface ClienteJogo {
  readonly conectado: boolean;
  readonly estado: Readonly<EstadoJogo>;
  readonly huntAlvo: string | null;
  selecionarHunt(slug: string): void;
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
  gameUrl: string;
  accountId: string;
  dispositivo: string;
  huntSlug: string | undefined;
  auth: AuthJogo;
  health: HealthState;
  criarSocket?: CriarSocket;
  random?: () => number;
  reconexao?: { baseMs: number; tetoMs: number };
  heartbeat?: { verificarMs: number; silencioMs: number; prazoPingMs: number };
}

const RECONEXAO_PADRAO = { baseMs: 1_500, tetoMs: 24_000 };
const FALHAS_ATE_TETO_LONGO = 5;
const TETO_LONGO_MS = 5 * 60_000;
const HEARTBEAT_PADRAO = { verificarMs: 10_000, silencioMs: 45_000, prazoPingMs: 15_000 };
const INTERVALO_MINIMO_INVALIDAR_MS = 5 * 60_000;
const TIMEOUT_DESCONEXAO_MS = 2_000;
const HUNT_PADRAO = "bellsprout";
const JANELA_POS_WELCOME_MS = 60_000;
const MAX_QUEDAS_POS_WELCOME = 4;
const FECHAMENTOS_TERMINAIS: Record<number, MotivoEncerramento> = {
  4000: { estado: "error", motivo: "conta bloqueada/banida pelo servidor (close 4000)" },
  4001: { estado: "needs-login", motivo: "sessão substituída: conta aberta em outro lugar? (close 4001)" },
  4003: { estado: "error", motivo: "IP banido pelo servidor (close 4003)" },
};
const CHAVES_CONTA_BLOQUEADA: Record<string, MotivoEncerramento> = {
  "auth.contaBanida": { estado: "error", motivo: "conta banida" },
  "auth.contaExcluida": { estado: "error", motivo: "conta excluída" },
  "auth.ipBanido": { estado: "error", motivo: "IP banido" },
  "login.contaBanida": { estado: "error", motivo: "conta banida" },
  "login.ipBanido": { estado: "error", motivo: "IP banido" },
};
const CHAVES_RECUSA_TOKEN: Record<string, true> = {
  "auth.sessaoInvalida": true,
  "auth.precisaLogin": true,
  "login.credenciaisInvalidas": true,
  "login.turnstileFalhou": true,
  "login.falhou": true,
};

function ehRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function somarDex(dex: Record<string, unknown>): { kills: number; capturas: number } {
  let kills = 0;
  let capturas = 0;
  for (const entrada of Object.values(dex)) {
    if (!ehRegistro(entrada)) continue;
    kills += Math.max(0, Math.floor(Number(entrada.k)) || 0);
    capturas += Math.max(0, Math.floor(Number(entrada.c)) || 0);
  }
  return { kills, capturas };
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
    huntSelectEnviadoEm: null,
    ultimoKillEm: null,
    ultimoKill: null,
    kills: 0,
    capturas: 0,
  };
  private readonly fim = Promise.withResolvers<MotivoEncerramento>();
  private readonly criarSocket: CriarSocket;
  private socket: SocketJogo | null = null;
  private socketFechado: Promise<void> | null = null;
  private aberto = false;
  private emJogo = false;
  private abrindo = false;
  private iniciado = false;
  private final: MotivoEncerramento | null = null;
  private tentativas = 0;
  private tokenHello: string | null = null;
  private baselineDex: { kills: number; capturas: number } | null = null;
  private ultimaMensagemEm = 0;
  private pingEm = 0;
  private ultimoInvalidarEm: number | null = null;
  private timerReconexao: NodeJS.Timeout | undefined;
  private timerHeartbeat: NodeJS.Timeout | undefined;
  private alvoHunt: string | null = null;
  private welcomeEm = 0;
  private quedasPosWelcome = 0;

  constructor(private readonly opcoes: OpcoesClient) {
    this.encerrado = this.fim.promise;
    this.criarSocket = opcoes.criarSocket ?? criarSocketUndici(undefined);
  }

  get conectado(): boolean {
    return this.emJogo;
  }

  get estado(): Readonly<EstadoJogo> {
    return this.dados;
  }

  get reconexaoPendente(): boolean {
    return this.timerReconexao !== undefined || this.abrindo;
  }

  get huntAlvo(): string | null {
    return this.alvoHunt;
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
    this.emJogo = false;
    if (!socket || !fechado) return;
    const prazo = Promise.withResolvers<void>();
    const timer = setTimeout(prazo.resolve, TIMEOUT_DESCONEXAO_MS);
    socket.close(1000, "drain");
    await Promise.race([fechado, prazo.promise]);
    clearTimeout(timer);
  }

  selecionarHunt(slug: string): void {
    this.enviar({ t: "hunt.select", slug });
    this.dados.huntSelectEnviadoEm = Date.now();
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
      if (erro instanceof AuthAdiadaError) {
        this.reconectarComBackoff(`autenticação adiada: ${detalhe}`);
        return;
      }
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
    this.tokenHello = tokens.accessToken;
    const fechado = Promise.withResolvers<void>();
    const socket: SocketJogo = this.criarSocket(this.opcoes.wsUrl, new URL(this.opcoes.gameUrl).origin, {
      aoAbrir: () => this.aoAbrir(socket),
      aoReceber: (dados) => {
        if (this.socket === socket) this.aoReceber(dados);
      },
      aoFechar: (codigo) => {
        fechado.resolve();
        this.aoFechar(socket, codigo);
      },
    });
    this.socket = socket;
    this.socketFechado = fechado.promise;
  }

  private aoAbrir(socket: SocketJogo): void {
    if (this.socket !== socket) return;
    const agora = Date.now();
    this.abrindo = false;
    this.aberto = true;
    this.emJogo = false;
    this.ultimaMensagemEm = agora;
    this.pingEm = 0;
    Object.assign(this.dados, { huntAtual: null, huntDesde: null, huntSelectEnviadoEm: null });
    const nick = this.opcoes.auth.nick();
    this.enviar({
      t: "hello",
      nick: nick ?? "",
      token: this.tokenHello ?? "",
      delta: 1,
      dispositivo: this.opcoes.dispositivo,
    });
    this.armarHeartbeat(socket);
  }

  private aoFechar(socket: SocketJogo, codigo: number): void {
    if (this.socket !== socket) return;
    const eraEmJogo = this.emJogo;
    const welcomeEm = this.welcomeEm;
    this.socket = null;
    this.socketFechado = null;
    this.aberto = false;
    this.emJogo = false;
    this.abrindo = false;
    clearInterval(this.timerHeartbeat);
    if (this.final) return;
    const terminal = FECHAMENTOS_TERMINAIS[codigo];
    if (terminal) {
      this.encerrar({ estado: terminal.estado, motivo: terminal.motivo });
      return;
    }
    if (eraEmJogo && welcomeEm > 0 && Date.now() - welcomeEm < JANELA_POS_WELCOME_MS) {
      this.quedasPosWelcome += 1;
      if (this.quedasPosWelcome >= MAX_QUEDAS_POS_WELCOME) {
        this.encerrar({
          estado: "needs-login",
          motivo: `sessão possivelmente substituída (conta aberta em outro lugar?): ${this.quedasPosWelcome} quedas logo após o welcome`,
        });
        return;
      }
    }
    this.reconectarComBackoff(`ws fechado (código ${codigo})`);
  }

  private async tratarHelloRecusado(msg: string): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.socketFechado = null;
    this.aberto = false;
    this.emJogo = false;
    this.abrindo = true;
    clearInterval(this.timerHeartbeat);
    socket?.close(1000, "reauth");
    let novos: Tokens | null;
    try {
      novos = await this.invalidarLimitado();
    } catch (erro) {
      this.abrindo = false;
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      if (erro instanceof AuthAdiadaError) {
        this.ultimoInvalidarEm = null;
        this.reconectarComBackoff(`login recusado pelo jogo (${msg}) e renovação adiada: ${detalhe}`);
        return;
      }
      this.encerrar({ estado: "needs-login", motivo: `login recusado pelo jogo (${msg}): ${detalhe}` });
      return;
    }
    this.abrindo = false;
    if (!novos) {
      this.encerrar({
        estado: "needs-login",
        motivo: `login recusado pelo jogo de novo (${msg}); aguardando login manual`,
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
      atrasoMs >= 60_000 ? `${Math.round(atrasoMs / 60_000)} min` : `${Math.round(atrasoMs / 1000)}s`;
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
        socket.send('{"t":"ping"}');
      }
    }, verificarMs);
  }

  private abandonar(socket: SocketJogo): void {
    this.socket = null;
    this.socketFechado = null;
    this.aberto = false;
    this.emJogo = false;
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
    if (
      this.quedasPosWelcome > 0 &&
      this.welcomeEm > 0 &&
      Date.now() - this.welcomeEm >= JANELA_POS_WELCOME_MS
    ) {
      this.quedasPosWelcome = 0;
    }
    const e = this.dados;
    switch (m.t) {
      case "welcome":
        this.aoWelcome(m);
        return;
      case "campo.init":
        if (typeof m.slug !== "string") return;
        e.huntAtual = m.slug;
        e.huntDesde = this.ultimaMensagemEm;
        e.huntSelectEnviadoEm = null;
        return;
      case "campo":
        return;
      case "batalha":
        this.processarBatalha(m.ev);
        return;
      case "estado":
        this.processarEstado(m.estado);
        return;
      case "erro":
        this.aoErro(m);
        return;
      case "sessao.renovada":
        if (typeof m.token === "string" && m.token) {
          this.tokenHello = m.token;
          this.opcoes.auth.adotar({ accessToken: m.token, refreshToken: m.token });
        }
        return;
      case "pong":
        return;
    }
  }

  private aoWelcome(m: Record<string, unknown>): void {
    this.emJogo = true;
    this.welcomeEm = Date.now();
    this.dados.conectadoEm = Date.now();
    this.opcoes.health.setState("in-game");
    this.opcoes.health.setLastError(null);
    this.opcoes.health.setLastAction("em jogo (welcome)");
    const estado = ehRegistro(m.estado) ? m.estado : null;
    const doServidor =
      estado && typeof estado.huntSlug === "string" && estado.huntSlug ? estado.huntSlug : null;
    this.alvoHunt = this.opcoes.huntSlug ?? doServidor ?? HUNT_PADRAO;
    this.selecionarHunt(this.alvoHunt);
  }

  private processarBatalha(ev: unknown): void {
    if (!Array.isArray(ev)) return;
    for (const item of ev) {
      if (!ehRegistro(item)) continue;
      const nome = typeof item.nome === "string" ? item.nome : null;
      if (item.k === "morte" && item.quem === "selvagem") this.registrarKill(nome);
      else if (item.k === "captura") this.registrarCaptura(nome);
      else if (item.k === "aviso" && typeof item.msg === "string") {
        this.opcoes.health.setLastError(`jogo: ${item.msg}`);
      }
    }
  }

  private registrarKill(nome: string | null): void {
    const e = this.dados;
    e.ultimoKillEm = Date.now();
    e.ultimoKill = nome;
    e.kills += 1;
    console.log(`worker ${this.opcoes.accountId}: morte ${nome ?? "selvagem"} (kills ${e.kills})`);
    this.opcoes.health.setContadores({ kills: e.kills, capturas: e.capturas });
  }

  private registrarCaptura(nome: string | null): void {
    const e = this.dados;
    e.capturas += 1;
    console.log(`worker ${this.opcoes.accountId}: captura ${nome ?? "selvagem"} (capturas ${e.capturas})`);
    this.opcoes.health.setContadores({ kills: e.kills, capturas: e.capturas });
  }

  private processarEstado(estado: unknown): void {
    if (!ehRegistro(estado) || !ehRegistro(estado.dexMud)) return;
    const total = somarDex(estado.dexMud);
    if (!this.baselineDex) {
      this.baselineDex = total;
      return;
    }
    const e = this.dados;
    const kills = Math.max(e.kills, total.kills - this.baselineDex.kills);
    const capturas = Math.max(e.capturas, total.capturas - this.baselineDex.capturas);
    if (kills === e.kills && capturas === e.capturas) return;
    e.kills = kills;
    e.capturas = capturas;
    this.opcoes.health.setContadores({ kills, capturas });
  }

  private aoErro(m: Record<string, unknown>): void {
    const chave = typeof m.chave === "string" ? m.chave : null;
    const msg =
      chave ??
      (typeof m.msg === "string" ? m.msg : typeof m.erro === "string" ? m.erro : "erro do servidor");
    const bloqueada = chave ? CHAVES_CONTA_BLOQUEADA[chave] : undefined;
    if (bloqueada) {
      this.encerrar({ estado: bloqueada.estado, motivo: `jogo: ${bloqueada.motivo} (${chave})` });
      return;
    }
    if (!this.emJogo) {
      if (!chave || CHAVES_RECUSA_TOKEN[chave]) {
        void this.tratarHelloRecusado(msg);
        return;
      }
      this.opcoes.health.setLastError(`jogo (pré-welcome, chave desconhecida): ${msg}`);
      this.socket?.close(1000, "erro-pre-welcome");
      return;
    }
    this.opcoes.health.setLastError(`jogo: ${msg}`);
  }
}

export function criarGameClient(config: WorkerConfig, auth: AuthJogo, health: HealthState): GameClient {
  return new GameClient({
    wsUrl: config.gameWsUrl,
    gameUrl: config.gameUrl,
    accountId: config.accountId,
    dispositivo: config.dispositivo,
    huntSlug: config.huntSlug,
    auth,
    health,
    criarSocket: criarSocketUndici(criarDispatcher(config.proxyUrl)),
  });
}
