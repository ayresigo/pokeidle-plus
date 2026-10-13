import type { WorkerConfig } from "../config.js";
import type { HealthState, Tokens } from "../health.js";
import {
  criarFetch,
  descreverFalhaDeRede,
  lerJson,
  type HttpFetch,
  type RespostaHttp,
} from "../http.js";
import { lerExpiracao } from "./refresh.js";
import { buscarSitekey, resolverTurnstile, SolverError, type SolucaoTurnstile } from "./solver.js";

export interface TokenProvider {
  getTokens(): Promise<Tokens>;
}

export class AuthIndisponivelError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "AuthIndisponivelError";
  }
}

export class AuthAdiadaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "AuthAdiadaError";
  }
}

export class LoginError extends Error {
  readonly transitorio: boolean;
  constructor(mensagem: string, transitorio = false) {
    super(mensagem);
    this.name = "LoginError";
    this.transitorio = transitorio;
  }
}

export function ehTransitorio(erro: unknown): boolean {
  return (erro instanceof SolverError || erro instanceof LoginError) && erro.transitorio;
}

const CHAVES_LOGIN_TRANSITORIAS: Record<string, true> = {
  "login.turnstileFalhou": true,
  "login.muitasTentativas": true,
  "login.entrando": true,
  "login.criando": true,
};

export function ocultarSegredos(texto: string, segredos: readonly (string | undefined)[]): string {
  return segredos.reduce<string>(
    (resultado, segredo) => (segredo ? resultado.replaceAll(segredo, "***") : resultado),
    texto,
  );
}

export class StoredTokenProvider implements TokenProvider {
  constructor(private readonly config: Pick<WorkerConfig, "accessToken" | "refreshToken">) {}

  async getTokens(): Promise<Tokens> {
    const { accessToken, refreshToken } = this.config;
    if (!accessToken || !refreshToken) {
      throw new AuthIndisponivelError("ACCESS_TOKEN/REFRESH_TOKEN não configurados");
    }
    return { accessToken, refreshToken };
  }
}

export interface DependenciasSolver {
  fetchJogo: HttpFetch;
  fetchSolver: HttpFetch;
  sleep?: (ms: number) => Promise<void>;
}

export type ConfigSolver = Pick<
  WorkerConfig,
  | "gameUrl"
  | "solverKey"
  | "pokeidleUser"
  | "pokeidlePass"
  | "solverApiUrl"
  | "turnstileSitekey"
  | "dispositivo"
>;

async function loginComCaptcha(
  gameUrl: string,
  identifier: string,
  password: string,
  dispositivo: string,
  captcha: SolucaoTurnstile,
  fetch: HttpFetch,
): Promise<Tokens> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (captcha.userAgent) headers["user-agent"] = captcha.userAgent;
  let resposta: RespostaHttp;
  try {
    resposta = await fetch(new URL("/auth/entrar", gameUrl).toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: identifier,
        senha: password,
        turnstileToken: captcha.token,
        dispositivo,
      }),
    });
  } catch (erro) {
    throw new LoginError(`falha de rede no login: ${descreverFalhaDeRede(erro)}`, true);
  }
  const corpo = await lerJson(resposta);
  if (!resposta.ok) {
    const motivo =
      typeof corpo.erro === "string" && corpo.erro !== ""
        ? `: ${ocultarSegredos(corpo.erro, [password, captcha.token])}`
        : "";
    const chave = typeof corpo.erro === "string" ? corpo.erro : "";
    throw new LoginError(
      `login recusado (HTTP ${resposta.status})${motivo}`,
      resposta.status >= 500 || resposta.status === 429 || CHAVES_LOGIN_TRANSITORIAS[chave] === true,
    );
  }
  if (corpo.precisaNick === true) {
    throw new LoginError("conta sem personagem (precisaNick)");
  }
  const { token } = corpo;
  if (typeof token !== "string" || token === "") {
    throw new LoginError("resposta do login sem token");
  }
  const nick = typeof corpo.nick === "string" && corpo.nick !== "" ? corpo.nick : undefined;
  return { accessToken: token, refreshToken: token, nick };
}

export class SolverTokenProvider implements TokenProvider {
  constructor(
    private readonly config: ConfigSolver,
    private readonly deps: DependenciasSolver,
  ) {}

  async getTokens(): Promise<Tokens> {
    const {
      gameUrl,
      solverKey,
      pokeidleUser,
      pokeidlePass,
      solverApiUrl,
      turnstileSitekey,
      dispositivo,
    } = this.config;
    if (!solverKey || !pokeidleUser || !pokeidlePass) {
      throw new AuthIndisponivelError("SOLVER_KEY/POKEIDLE_USER/POKEIDLE_PASS não configurados");
    }
    const websiteKey = turnstileSitekey ?? (await buscarSitekey(gameUrl, this.deps.fetchJogo));
    const captcha = await resolverTurnstile(
      { websiteURL: new URL("/app", gameUrl).toString(), websiteKey },
      {
        apiUrl: solverApiUrl,
        clientKey: solverKey,
        fetch: this.deps.fetchSolver,
        sleep: this.deps.sleep,
      },
    );
    return loginComCaptcha(
      gameUrl,
      pokeidleUser,
      pokeidlePass,
      dispositivo,
      captcha,
      this.deps.fetchJogo,
    );
  }
}

export type OrigemTokens = "stored" | "solver";

export type ResultadoAuth =
  | { ok: true; origem: OrigemTokens }
  | { ok: false; needsLogin: boolean; motivo: string };

export interface OpcoesAuthManager {
  stored: TokenProvider;
  solver: TokenProvider;
  segredos: readonly (string | undefined)[];
}

const MARGEM_REFRESH_MS = 60_000;
const PISO_REFRESH_MS = 30_000;
const TETO_RETENTATIVA_MS = 300_000;
const ATRASO_MAXIMO_TIMER_MS = 2_147_483_647;
const MAX_FALHA_CHARS = 300;
const RESULTADO_PARADO: ResultadoAuth = {
  ok: false,
  needsLogin: false,
  motivo: "autenticação parada",
};
const DESCRICAO_ORIGEM: Record<OrigemTokens, string> = {
  stored: "tokens salvos",
  solver: "solver",
};

export class AuthManager implements TokenProvider {
  private tokens: Tokens | null = null;
  private nickAtual: string | null = null;
  private timer: NodeJS.Timeout | undefined;
  private fluxo: Promise<ResultadoAuth> | null = null;
  private parado = false;
  private falhasTransitorias = 0;
  private aceitoEm = 0;

  constructor(
    private readonly health: HealthState,
    private readonly opcoes: OpcoesAuthManager,
  ) {}

  autenticar(): Promise<ResultadoAuth> {
    this.parado = false;
    return this.unico(() => this.executarAutenticacao());
  }

  async invalidar(): Promise<Tokens> {
    if (this.falhasTransitorias > 0) {
      throw new AuthAdiadaError("renovação transitória já agendada; aguardando retry");
    }
    const resultado = await this.unico(() => this.executarRenovacao());
    if (resultado.ok && this.tokens) return this.tokens;
    if (!resultado.ok && !resultado.needsLogin) throw new AuthAdiadaError(resultado.motivo);
    throw new AuthIndisponivelError(resultado.ok ? "sem tokens válidos" : resultado.motivo);
  }

  async getTokens(): Promise<Tokens> {
    if (this.fluxo) await this.fluxo;
    if (this.tokens && this.precisaRenovar(this.tokens.accessToken)) {
      await this.unico(() => this.executarRenovacao());
    }
    if (!this.tokens) {
      if (this.falhasTransitorias > 0) {
        throw new AuthAdiadaError("autenticação adiada; nova tentativa agendada");
      }
      throw new AuthIndisponivelError("sem tokens válidos (needs-login)");
    }
    return this.tokens;
  }

  nick(): string | null {
    return this.nickAtual;
  }

  adotar(tokens: Tokens): void {
    if (tokens.nick) this.nickAtual = tokens.nick;
    this.tokens = tokens;
    this.aceitoEm = Date.now();
    this.falhasTransitorias = 0;
    this.health.setTokens(tokens);
    const exp = lerExpiracao(tokens.accessToken);
    if (exp === null) {
      this.desarmar();
      return;
    }
    this.armar(Math.max(exp - MARGEM_REFRESH_MS - Date.now(), PISO_REFRESH_MS));
  }

  parar(): void {
    this.parado = true;
    this.desarmar();
  }

  private unico(executar: () => Promise<ResultadoAuth>): Promise<ResultadoAuth> {
    this.fluxo ??= executar().finally(() => {
      this.fluxo = null;
    });
    return this.fluxo;
  }

  private async executarAutenticacao(): Promise<ResultadoAuth> {
    this.health.setState("authenticating");
    this.health.setLastAction("autenticando");
    const falhas: string[] = [];
    const salvos = await this.tentar("tokens salvos", () => this.opcoes.stored.getTokens(), falhas);
    if (!salvos) return this.viaSolver(falhas);
    if (!this.expirado(salvos.accessToken)) return this.aceitar(salvos, "stored");
    return this.viaSolver(falhas);
  }

  private executarRenovacao(): Promise<ResultadoAuth> {
    if (!this.tokens) return this.executarAutenticacao();
    this.health.setLastAction("renovando tokens");
    return this.viaSolver([]);
  }

  private adiar(atuais: Tokens | null, motivo: string): ResultadoAuth {
    this.tokens = atuais;
    this.falhasTransitorias += 1;
    const atraso = Math.min(
      PISO_REFRESH_MS * 2 ** (this.falhasTransitorias - 1),
      TETO_RETENTATIVA_MS,
    );
    const texto = `${motivo}; nova tentativa em ${atraso / 1000}s`;
    this.health.setLastError(texto);
    this.armar(atraso);
    return { ok: false, needsLogin: false, motivo: texto };
  }

  private async viaSolver(falhas: string[]): Promise<ResultadoAuth> {
    if (this.parado) return RESULTADO_PARADO;
    let doSolver: Tokens;
    try {
      doSolver = await this.opcoes.solver.getTokens();
    } catch (erro) {
      const motivo = this.descrever("solver", erro);
      if (ehTransitorio(erro)) return this.adiar(this.tokens, [...falhas, motivo].join("; "));
      this.desarmar();
      this.tokens = null;
      this.falhasTransitorias = 0;
      const texto = `autenticação falhou: ${[...falhas, motivo].join("; ")}`;
      this.health.setState("needs-login");
      this.health.setLastError(texto);
      this.health.setLastAction("aguardando login manual");
      return { ok: false, needsLogin: true, motivo: texto };
    }
    return this.aceitar(doSolver, "solver");
  }

  private aceitar(tokens: Tokens, origem: OrigemTokens): ResultadoAuth {
    this.tokens = tokens;
    if (tokens.nick) this.nickAtual = tokens.nick;
    this.aceitoEm = Date.now();
    this.falhasTransitorias = 0;
    this.health.setTokens(tokens);
    this.health.setLastError(null);
    this.health.setLastAction(`autenticado via ${DESCRICAO_ORIGEM[origem]}`);
    const exp = lerExpiracao(tokens.accessToken);
    if (exp === null) {
      this.desarmar();
      return { ok: true, origem };
    }
    const ideal = exp - MARGEM_REFRESH_MS - Date.now();
    if (ideal < PISO_REFRESH_MS && origem !== "stored") {
      const restante = Math.round((exp - Date.now()) / 1000);
      this.health.setLastError(
        `access com validade curta (expira em ${restante}s); possível skew de relógio`,
      );
    }
    this.armar(Math.max(ideal, PISO_REFRESH_MS));
    return { ok: true, origem };
  }

  private armar(atraso: number): void {
    this.desarmar();
    if (this.parado) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.unico(() => this.executarRenovacao());
      },
      Math.min(atraso, ATRASO_MAXIMO_TIMER_MS),
    );
  }

  private desarmar(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private expirado(accessToken: string): boolean {
    const exp = lerExpiracao(accessToken);
    return exp !== null && exp - MARGEM_REFRESH_MS <= Date.now();
  }

  private precisaRenovar(accessToken: string): boolean {
    return (
      this.falhasTransitorias === 0 &&
      this.expirado(accessToken) &&
      Date.now() - this.aceitoEm >= PISO_REFRESH_MS
    );
  }

  private async tentar<T>(
    etapa: string,
    executar: () => Promise<T>,
    falhas: string[],
  ): Promise<T | null> {
    try {
      return await executar();
    } catch (erro) {
      falhas.push(this.descrever(etapa, erro));
      return null;
    }
  }

  private descrever(etapa: string, erro: unknown): string {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    const segredos = [...this.opcoes.segredos, this.tokens?.accessToken, this.tokens?.refreshToken];
    return `${etapa}: ${ocultarSegredos(mensagem, segredos).slice(0, MAX_FALHA_CHARS)}`;
  }
}

export function criarAuthManager(config: WorkerConfig, health: HealthState): AuthManager {
  const fetchJogo = criarFetch(config.proxyUrl);
  return new AuthManager(health, {
    stored: new StoredTokenProvider(config),
    solver: new SolverTokenProvider(config, { fetchJogo, fetchSolver: criarFetch() }),
    segredos: [config.pokeidlePass, config.solverKey, config.accessToken, config.refreshToken],
  });
}
