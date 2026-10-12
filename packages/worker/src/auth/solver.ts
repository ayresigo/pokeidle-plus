import {
  descartarCorpo,
  descreverFalhaDeRede,
  esperar,
  lerJson,
  type HttpFetch,
  type RespostaHttp,
} from "../http.js";

export class SolverError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "SolverError";
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
    throw new SolverError(`falha de rede no solver: ${descreverFalhaDeRede(erro)}`);
  }
  if (!resposta.ok) {
    await descartarCorpo(resposta);
    throw new SolverError(`solver respondeu HTTP ${resposta.status}`);
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
  throw new SolverError(`tempo esgotado aguardando o solver (${maxConsultas} consultas)`);
}

export function extrairSitekey(texto: string): string | null {
  const atributo = /data-sitekey=["']([^"']+)["']/.exec(texto);
  if (atributo?.[1]) return atributo[1];
  return /["'](0x4AAAAAA[\w-]{10,})["']/.exec(texto)?.[1] ?? null;
}

export function listarChunks(html: string): string[] {
  return [...new Set(html.match(/\/_next\/static\/chunks\/[\w.~-]+\.js/g) ?? [])];
}

async function baixarTexto(url: string, fetch: HttpFetch): Promise<string> {
  let resposta: RespostaHttp;
  try {
    resposta = await fetch(url, { method: "GET" });
  } catch (erro) {
    throw new SolverError(`falha de rede ao baixar ${url}: ${descreverFalhaDeRede(erro)}`);
  }
  if (!resposta.ok) {
    await descartarCorpo(resposta);
    throw new SolverError(`GET ${url} respondeu HTTP ${resposta.status}`);
  }
  return resposta.text();
}

export async function descobrirSitekey(gameUrl: string, fetch: HttpFetch): Promise<string> {
  const html = await baixarTexto(new URL("/login", gameUrl).toString(), fetch);
  const doHtml = extrairSitekey(html);
  if (doHtml) return doHtml;

  for (const chunk of listarChunks(html)) {
    const sitekey = extrairSitekey(await baixarTexto(new URL(chunk, gameUrl).toString(), fetch));
    if (sitekey) return sitekey;
  }
  throw new SolverError(
    "sitekey do Turnstile não encontrada em /login nem nos chunks JS; defina TURNSTILE_SITEKEY",
  );
}
