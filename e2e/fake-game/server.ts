import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ACCESS_TOKEN_VALIDO } from "./token.ts";

const PORTA = Number(process.env.PORT ?? 8090);
const INTERVALO_KILL_MS = Number(process.env.FAKE_KILL_MS ?? 2_000);
const HUNT = { slug: "e2e-hunt", name: "Hunt E2E", level: 1 };
const ESPECIES = ["Rattata", "Pidgey", "Caterpie"];
const ROTA_WS = /^\/ws\d*$/;

const sockets = new Set<WebSocket>();

function responder(res: ServerResponse, status: number, corpo: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(corpo));
}

function log(mensagem: string): void {
  console.log(`fake-game: ${mensagem}`);
}

function aoRequisitar(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://fake-game");
  const rota = `${req.method} ${url.pathname}`;
  switch (rota) {
    case "GET /health":
      return responder(res, 200, { status: "ok", sockets: sockets.size });
    case "GET /api/game/map-markers":
      return responder(res, 200, { map: { w: 1, h: 1 }, hunts: [HUNT] });
    case "POST /api/auth/refresh":
      req.resume();
      return responder(res, 401, { error: "refresh recusado pelo fake-game" });
    case "POST /__e2e/kick": {
      const fechados = sockets.size;
      for (const socket of sockets) socket.close(4005, "replaced");
      log(`kick: ${fechados} socket(s) fechado(s) com 4005`);
      return responder(res, 200, { fechados });
    }
    default:
      return responder(res, 404, { error: `rota desconhecida: ${rota}` });
  }
}

function enviar(socket: WebSocket, mensagem: Record<string, unknown>): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(mensagem));
}

function aoConectar(socket: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url ?? "/", "http://fake-game");
  if (url.searchParams.get("token") !== ACCESS_TOKEN_VALIDO) {
    log(`token recusado em ${url.pathname}`);
    socket.close(4001, "unauthorized");
    return;
  }
  sockets.add(socket);
  log(`sessão aberta em ${url.pathname} (${sockets.size} ativa(s))`);
  let kills = 0;
  const timer = setInterval(() => {
    kills += 1;
    enviar(socket, { type: "field-kill", speciesName: ESPECIES[kills % ESPECIES.length] });
  }, INTERVALO_KILL_MS);
  socket.on("message", (dados) => {
    let mensagem: unknown;
    try {
      mensagem = JSON.parse(String(dados));
    } catch {
      return;
    }
    if (typeof mensagem !== "object" || mensagem === null || !("type" in mensagem)) return;
    switch (mensagem.type) {
      case "ping":
        return enviar(socket, { type: "pong" });
      case "balls-get":
        return enviar(socket, { type: "balls", counts: { pokeball: 50 } });
      case "enter-hunt":
        return enviar(socket, {
          type: "field-init",
          slug: "slug" in mensagem && typeof mensagem.slug === "string" ? mensagem.slug : HUNT.slug,
        });
      case "leave-hunt":
        return enviar(socket, { type: "field-none" });
    }
  });
  socket.on("close", (codigo) => {
    clearInterval(timer);
    sockets.delete(socket);
    log(`sessão fechada (código ${codigo})`);
  });
  enviar(socket, { type: "field-init", slug: HUNT.slug });
}

const servidor = createServer(aoRequisitar);
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", aoConectar);
servidor.on("upgrade", (req, socket, cabeca) => {
  const caminho = new URL(req.url ?? "/", "http://fake-game").pathname;
  if (!ROTA_WS.test(caminho)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, cabeca, (ws) => wss.emit("connection", ws, req));
});

const encerrar = () => {
  for (const socket of sockets) socket.terminate();
  servidor.close(() => process.exit(0));
};
process.once("SIGTERM", encerrar);
process.once("SIGINT", encerrar);

servidor.listen(PORTA, "0.0.0.0", () => log(`ouvindo em :${PORTA}`));
