import { fetch, ProxyAgent, Socks5ProxyAgent, type Dispatcher } from "undici";

export interface RequisicaoHttp {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface RespostaHttp {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type HttpFetch = (url: string, init?: RequisicaoHttp) => Promise<RespostaHttp>;

export function criarDispatcher(proxyUrl: string | undefined): Dispatcher | undefined {
  if (!proxyUrl) return undefined;
  return new URL(proxyUrl).protocol === "socks5:"
    ? new Socks5ProxyAgent(proxyUrl)
    : new ProxyAgent(proxyUrl);
}

export const TIMEOUT_HTTP_MS = 15_000;

export function criarFetch(proxyUrl?: string, timeoutMs = TIMEOUT_HTTP_MS): HttpFetch {
  const dispatcher = criarDispatcher(proxyUrl);
  return (url, init) => fetch(url, { ...init, dispatcher, signal: AbortSignal.timeout(timeoutMs) });
}

export async function descartarCorpo(resposta: RespostaHttp): Promise<void> {
  await resposta.text().catch(() => {});
}

export function descreverFalhaDeRede(erro: unknown): string {
  const causa = erro instanceof Error ? erro.cause : undefined;
  const codigo =
    typeof causa === "object" && causa !== null && "code" in causa ? String(causa.code) : null;
  return codigo ?? (erro instanceof Error ? erro.name : "erro desconhecido");
}

export async function lerJson(resposta: RespostaHttp): Promise<Record<string, unknown>> {
  try {
    const corpo = await resposta.json();
    return typeof corpo === "object" && corpo !== null ? (corpo as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function esperar(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
