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
}

export type WorkerEnv = Record<string, string | undefined>;

const DEFAULT_HEALTH_PORT = 3001;
const PROXY_PROTOCOLS: Record<string, true> = { "http:": true, "https:": true, "socks5:": true };

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

function validProxy(value: string): boolean {
  try {
    const url = new URL(value);
    return PROXY_PROTOCOLS[url.protocol] === true && url.hostname !== "";
  } catch {
    return false;
  }
}

function parsePort(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
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

  if (!accountId) problems.push("ACCOUNT_ID ausente");
  if (!gameUrl) problems.push("GAME_URL ausente");

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

  if (proxyUrl && !validProxy(proxyUrl)) {
    problems.push("PROXY_URL inválida (esperado URL http://, https:// ou socks5://)");
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
  };
}
