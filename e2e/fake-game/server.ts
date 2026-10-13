import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ACCESS_TOKEN_VALIDO } from "./token.ts";

const PORTA = Number(process.env.PORT ?? 8090);
const INTERVALO_KILL_MS = Number(process.env.FAKE_KILL_MS ?? 2_000);
const HUNT = { slug: "e2e-hunt", nome: "Hunt E2E", nivel: 1 };
const ESPECIES = ["Rattata", "Pidgey", "Caterpie"];
const SITEKEY_FAKE = "0xFAKE-TURNSTILE-E2E";

const sockets = new Set<WebSocket>();
let revogado = false;

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
    case "GET /auth/provedores":
      return responder(res, 200, {
        turnstile: SITEKEY_FAKE,
        google: null,
        discord: null,
        confirmacaoEmail: false,
      });
    case "POST /auth/entrar":
      req.resume();
      return responder(res, 200, {
        nick: "treinador-e2e",
        token: ACCESS_TOKEN_VALIDO,
        provedor: "local",
        precisaNick: false,
        termosVersao: 1,
      });
    case "POST /__e2e/kick": {
      revogado = true;
      const fechados = sockets.size;
      for (const socket of sockets) socket.close(1000, "replaced");
      log(`kick: sessão revogada; ${fechados} socket(s) fechado(s)`);
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
  let autenticado = false;
  let kills = 0;
  let timer: NodeJS.Timeout | undefined;

  socket.on("message", (dados) => {
    let mensagem: unknown;
    try {
      mensagem = JSON.parse(String(dados));
    } catch {
      return;
    }
    if (typeof mensagem !== "object" || mensagem === null || !("t" in mensagem)) return;
    const m = mensagem as Record<string, unknown>;
    switch (m.t) {
      case "hello": {
        if (revogado || m.token !== ACCESS_TOKEN_VALIDO) {
          log(`hello recusado em ${url.pathname}`);
          enviar(socket, { t: "erro", msg: "login recusado" });
          socket.close(1000, "unauthorized");
          return;
        }
        autenticado = true;
        sockets.add(socket);
        log(`sessão aberta em ${url.pathname} (${sockets.size} ativa(s))`);
        enviar(socket, { t: "welcome", estado: { xp: 0, gold: 0, items: {}, dexMud: {}, pkMud: {} } });
        timer = setInterval(() => {
          kills += 1;
          enviar(socket, {
            t: "batalha",
            ev: [
              {
                k: "morte",
                quem: "selvagem",
                nome: ESPECIES[kills % ESPECIES.length],
                xp: 10,
                ouro: 5,
              },
            ],
          });
        }, INTERVALO_KILL_MS);
        return;
      }
      case "hunt.select":
        if (!autenticado) return;
        return enviar(socket, {
          t: "campo.init",
          slug: typeof m.slug === "string" ? m.slug : HUNT.slug,
          mapa: {},
          box: {},
          heroi: {},
          mobs: [],
        });
      case "ping":
        return enviar(socket, { t: "pong" });
    }
  });
  socket.on("close", (codigo) => {
    clearInterval(timer);
    sockets.delete(socket);
    log(`sessão fechada (código ${codigo})`);
  });
}

const servidor = createServer(aoRequisitar);
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", aoConectar);
servidor.on("upgrade", (req, socket, cabeca) => {
  const caminho = new URL(req.url ?? "/", "http://fake-game").pathname;
  if (caminho !== "/") {
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
