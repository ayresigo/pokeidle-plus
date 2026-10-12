import type { NextRequest } from "next/server";

const CABECALHOS_REQUISICAO_IGNORADOS = [
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "content-length",
  "accept-encoding",
];

const CABECALHOS_RESPOSTA_IGNORADOS = [
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "content-encoding",
];

const HOSTS_LOCAIS = ["localhost", "127.0.0.1", "[::1]"];

function hostPermitido(host: string): boolean {
  let nome: string;
  try {
    nome = new URL(`http://${host}`).hostname;
  } catch {
    return false;
  }
  if (HOSTS_LOCAIS.includes(nome)) return true;
  const extras = (process.env.ALLOWED_HOSTS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return extras.includes(host.toLowerCase()) || extras.includes(nome);
}

function origemPermitida(origem: string, host: string): boolean {
  try {
    return new URL(origem).host === new URL(`http://${host}`).host;
  } catch {
    return false;
  }
}

async function encaminhar(request: NextRequest, ctx: RouteContext<"/cp/[...path]">): Promise<Response> {
  const host = request.headers.get("host");
  if (host === null || !hostPermitido(host)) {
    return Response.json({ error: "host não permitido" }, { status: 403 });
  }
  const temCorpo = request.method !== "GET" && request.method !== "HEAD";
  const origem = request.headers.get("origin");
  if (temCorpo && origem !== null && !origemPermitida(origem, host)) {
    return Response.json({ error: "origem não permitida" }, { status: 403 });
  }

  const { path } = await ctx.params;
  const base = (process.env.CONTROL_PLANE_URL ?? "http://localhost:4000").replace(/\/+$/, "");
  const destino = new URL(`${base}/${path.map(encodeURIComponent).join("/")}`);
  destino.search = request.nextUrl.search;

  const cabecalhos = new Headers(request.headers);
  for (const nome of CABECALHOS_REQUISICAO_IGNORADOS) cabecalhos.delete(nome);

  let upstream: Response;
  try {
    upstream = await fetch(destino, {
      method: request.method,
      headers: cabecalhos,
      body: temCorpo ? await request.arrayBuffer() : undefined,
      signal: request.signal,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: "control-plane inalcançável" }, { status: 502 });
  }

  const cabecalhosResposta = new Headers(upstream.headers);
  for (const nome of CABECALHOS_RESPOSTA_IGNORADOS) cabecalhosResposta.delete(nome);
  if (cabecalhosResposta.get("content-type")?.startsWith("text/event-stream")) {
    cabecalhosResposta.set("cache-control", "no-cache, no-transform");
    cabecalhosResposta.set("x-accel-buffering", "no");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: cabecalhosResposta,
  });
}

export {
  encaminhar as GET,
  encaminhar as POST,
  encaminhar as PUT,
  encaminhar as PATCH,
  encaminhar as DELETE,
};
