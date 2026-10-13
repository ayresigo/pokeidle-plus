import { randomUUID } from "node:crypto";

export interface WorkerConfig {
  accountId: string;
  gameUrl: string;
  accessToken: string | undefined;
  refreshToken: string | undefined;
  solverKey: string | undefined;
  pokeidleUser: string | undefined;
  pokeidlePass: string | undefined;
  proxyUrl: string | undefined;
  controlPlaneUrl: string | undefined;
  healthPort: number;
  solverApiUrl: string;
  turnstileSitekey: string | undefined;
  gameWsUrl: string;
  huntSlug: string | undefined;
  dispositivo: string;
}

export type WorkerEnv = Record<string, string | undefined>;

const DEFAULT_HEALTH_PORT = 3001;
const DEFAULT_SOLVER_API_URL = "https://api.2captcha.com";
const PROXY_PROTOCOLS: Record<string, true> = { "http:": true, "https:": true, "socks5:": true };
const HTTP_PROTOCOLS: Record<string, true> = { "http:": true, "https:": true };
const WS_PROTOCOLS: Record<string, true> = {
  "http:": true,
  "https:": true,
  "ws:": true,
  "wss:": true,
};
const WS_SCHEME: Record<string, string> = { "http:": "ws:", "https:": "wss:" };
const DEFAULT_WS_PATH = "/";

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: string[]) {
    super(`Configuração inválida do worker:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

function read(env: WorkerEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function validUrl(value: string, protocols: Record<string, true>): boolean {
  try {
    const url = new URL(value);
    return protocols[url.protocol] === true && url.hostname !== "";
  } catch {
    return false;
  }
}

function parsePort(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
}

function resolverWsUrl(base: string, path: string): string {
  const url = new URL(path, base);
  url.protocol = WS_SCHEME[url.protocol] ?? url.protocol;
  return url.toString();
}

export function loadConfig(env: WorkerEnv): WorkerConfig {
  const problems: string[] = [];
  const missing = (name: string) => problems.push(`${name} ausente`);

  const accountId = read(env, "ACCOUNT_ID");
  const gameUrl = read(env, "GAME_URL");
  const accessToken = read(env, "ACCESS_TOKEN");
  const refreshToken = read(env, "REFRESH_TOKEN");
  const solverKey = read(env, "SOLVER_KEY");
  const pokeidleUser = read(env, "POKEIDLE_USER");
  const pokeidlePass = read(env, "POKEIDLE_PASS");
  const proxyUrl = read(env, "PROXY_URL");
  const controlPlaneUrl = read(env, "CONTROL_PLANE_URL");
  const healthPortRaw = read(env, "HEALTH_PORT");
  const solverApiUrl = read(env, "SOLVER_API_URL")?.replace(/\/+$/, "") ?? DEFAULT_SOLVER_API_URL;
  const turnstileSitekey = read(env, "TURNSTILE_SITEKEY");
  const gameWsUrlRaw = read(env, "GAME_WS_URL");
  const gameWsPath = read(env, "GAME_WS_PATH") ?? DEFAULT_WS_PATH;
  const huntSlug = read(env, "HUNT_SLUG");
  const dispositivo = read(env, "DISPOSITIVO") ?? randomUUID();

  if (!accountId) problems.push("ACCOUNT_ID ausente");
  if (!gameUrl) problems.push("GAME_URL ausente");
  else if (!validUrl(gameUrl, HTTP_PROTOCOLS)) {
    problems.push("GAME_URL inválida (esperado URL http:// ou https://)");
  }

  if (gameWsUrlRaw && !validUrl(gameWsUrlRaw, WS_PROTOCOLS)) {
    problems.push("GAME_WS_URL inválida (esperado URL ws://, wss://, http:// ou https://)");
  }

  if (!gameWsPath.startsWith("/")) {
    problems.push("GAME_WS_PATH inválido (esperado path começando com /)");
  }

  if (solverKey) {
    if (!pokeidleUser) problems.push("POKEIDLE_USER ausente (obrigatória com SOLVER_KEY)");
    if (!pokeidlePass) problems.push("POKEIDLE_PASS ausente (obrigatória com SOLVER_KEY)");
  }

  if (accessToken && !refreshToken) {
    problems.push("REFRESH_TOKEN ausente (obrigatória com ACCESS_TOKEN)");
  } else if (refreshToken && !accessToken) {
    problems.push("ACCESS_TOKEN ausente (obrigatória com REFRESH_TOKEN)");
  } else if (!accessToken && !solverKey) {
    problems.push(
      "nenhum caminho de autenticação: defina ACCESS_TOKEN e REFRESH_TOKEN, ou SOLVER_KEY",
    );
  }

  if (proxyUrl && !validUrl(proxyUrl, PROXY_PROTOCOLS)) {
    problems.push("PROXY_URL inválida (esperado URL http://, https:// ou socks5://)");
  }

  if (!validUrl(solverApiUrl, HTTP_PROTOCOLS)) {
    problems.push("SOLVER_API_URL inválida (esperado URL http:// ou https://)");
  }

  let healthPort = DEFAULT_HEALTH_PORT;
  if (healthPortRaw) {
    const port = parsePort(healthPortRaw);
    if (port === null) problems.push("HEALTH_PORT inválida (esperado inteiro entre 1 e 65535)");
    else healthPort = port;
  }

  if (problems.length > 0 || !accountId || !gameUrl) throw new ConfigError(problems);

  return {
    accountId,
    gameUrl,
    accessToken,
    refreshToken,
    solverKey,
    pokeidleUser,
    pokeidlePass,
    proxyUrl,
    controlPlaneUrl,
    healthPort,
    solverApiUrl,
    turnstileSitekey,
    gameWsUrl: resolverWsUrl(gameWsUrlRaw ?? gameUrl, gameWsPath),
    huntSlug,
    dispositivo,
  };
}
