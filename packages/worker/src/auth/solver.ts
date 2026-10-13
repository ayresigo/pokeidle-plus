import {
  descartarCorpo,
  descreverFalhaDeRede,
  esperar,
  lerJson,
  type HttpFetch,
  type RespostaHttp,
} from "../http.js";

export class SolverError extends Error {
  readonly transitorio: boolean;
  constructor(mensagem: string, transitorio = false) {
    super(mensagem);
    this.name = "SolverError";
    this.transitorio = transitorio;
  }
}

export interface AlvoTurnstile {
  websiteURL: string;
  websiteKey: string;
}

export interface SolucaoTurnstile {
  token: string;
  userAgent?: string;
}

export interface OpcoesSolver {
  apiUrl: string;
  clientKey: string;
  fetch: HttpFetch;
  sleep?: (ms: number) => Promise<void>;
  intervaloMs?: number;
  maxConsultas?: number;
}

async function postarSolver(
  url: string,
  corpo: object,
  fetch: HttpFetch,
): Promise<Record<string, unknown>> {
  let resposta: RespostaHttp;
  try {
    resposta = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
  } catch (erro) {
    throw new SolverError(`falha de rede no solver: ${descreverFalhaDeRede(erro)}`, true);
  }
  if (!resposta.ok) {
    await descartarCorpo(resposta);
    throw new SolverError(
      `solver respondeu HTTP ${resposta.status}`,
      resposta.status >= 500 || resposta.status === 429,
    );
  }
  const dados = await lerJson(resposta);
  if (dados.errorId !== 0) {
    throw new SolverError(`solver retornou erro ${String(dados.errorCode ?? dados.errorId)}`);
  }
  return dados;
}

export async function resolverTurnstile(
  alvo: AlvoTurnstile,
  {
    apiUrl,
    clientKey,
    fetch,
    sleep = esperar,
    intervaloMs = 5_000,
    maxConsultas = 24,
  }: OpcoesSolver,
): Promise<SolucaoTurnstile> {
  const criada = await postarSolver(
    `${apiUrl}/createTask`,
    { clientKey, task: { type: "TurnstileTaskProxyless", ...alvo } },
    fetch,
  );
  const taskId = criada.taskId;
  if (typeof taskId !== "number" && typeof taskId !== "string") {
    throw new SolverError("solver não retornou taskId");
  }

  for (let consulta = 0; consulta < maxConsultas; consulta++) {
    await sleep(intervaloMs);
    const resultado = await postarSolver(`${apiUrl}/getTaskResult`, { clientKey, taskId }, fetch);
    if (resultado.status === "processing") continue;
    if (resultado.status !== "ready") {
      throw new SolverError(`status inesperado do solver: ${String(resultado.status)}`);
    }
    const solucao: Record<string, unknown> =
      typeof resultado.solution === "object" && resultado.solution !== null
        ? (resultado.solution as Record<string, unknown>)
        : {};
    const { token, userAgent } = solucao;
    if (typeof token !== "string" || token === "") {
      throw new SolverError("solver respondeu ready sem token");
    }
    return typeof userAgent === "string" && userAgent !== "" ? { token, userAgent } : { token };
  }
  throw new SolverError(`tempo esgotado aguardando o solver (${maxConsultas} consultas)`, true);
}

export async function buscarSitekey(gameUrl: string, fetch: HttpFetch): Promise<string> {
  const url = new URL("/auth/provedores", gameUrl).toString();
  let resposta: RespostaHttp;
  try {
    resposta = await fetch(url, { method: "GET" });
  } catch (erro) {
    throw new SolverError(`falha de rede ao buscar provedores: ${descreverFalhaDeRede(erro)}`, true);
  }
  if (!resposta.ok) {
    await descartarCorpo(resposta);
    throw new SolverError(
      `GET ${url} respondeu HTTP ${resposta.status}`,
      resposta.status >= 500 || resposta.status === 429,
    );
  }
  const corpo = await lerJson(resposta);
  const sitekey = corpo.turnstile;
  if (typeof sitekey !== "string" || sitekey === "") {
    throw new SolverError(
      "sitekey do Turnstile ausente em /auth/provedores; defina TURNSTILE_SITEKEY",
    );
  }
  return sitekey;
}
