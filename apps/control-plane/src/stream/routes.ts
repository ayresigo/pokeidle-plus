import type { FastifyInstance, FastifyReply } from "fastify";
import type { ContainerOrchestrator } from "../orchestrator/types.js";
import type { Supervisor } from "../supervisor/supervisor.js";

export interface StreamDeps {
  orchestrator: ContainerOrchestrator;
  supervisor: Supervisor;
}

function abrirSse(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  reply.raw.write(": conectado\n\n");
}

function enviarEvento(reply: FastifyReply, evento: string | null, dados: unknown): void {
  if (reply.raw.destroyed || reply.raw.writableEnded) return;
  if (evento) reply.raw.write(`event: ${evento}\n`);
  reply.raw.write(`data: ${JSON.stringify(dados)}\n\n`);
}

export function registerStreamRoutes(app: FastifyInstance, deps: StreamDeps): void {
  const { orchestrator, supervisor } = deps;

  app.get<{ Params: { accountId: string } }>(
    "/workers/:accountId/logs/stream",
    { preHandler: app.requireSession() },
    async (request, reply) => {
      const { accountId } = request.params;
      const worker = (await orchestrator.listWorkers()).find(
        (w) => w.accountId === accountId,
      );
      if (!worker) {
        return reply.code(404).send({ error: "worker não encontrado" });
      }

      abrirSse(reply);

      let pararFollow: (() => Promise<void>) | null = null;
      let fechado = false;
      request.raw.on("close", () => {
        fechado = true;
        if (pararFollow) void pararFollow();
      });

      try {
        const tail = await orchestrator.workerLogs(worker.id, 200);
        if (!fechado) {
          for (const linha of tail.split("\n")) {
            if (linha) {
              enviarEvento(reply, null, { line: linha, ts: new Date().toISOString() });
            }
          }
        }

        pararFollow = await orchestrator.followLogs(worker.id, (line, ts) => {
          enviarEvento(reply, null, { line, ts: ts.toISOString() });
        });
        if (fechado) void pararFollow();
      } catch {
        if (pararFollow) void pararFollow();
        request.raw.destroy();
      }
    },
  );

  app.get("/events", { preHandler: app.requireSession() }, async (request, reply) => {
    abrirSse(reply);
    enviarEvento(reply, "snapshot", supervisor.getSnapshot());

    const ouvinte = (snapshot: unknown) => enviarEvento(reply, "update", snapshot);
    supervisor.mudancas.on("update", ouvinte);

    request.raw.on("close", () => {
      supervisor.mudancas.off("update", ouvinte);
    });
  });
}
