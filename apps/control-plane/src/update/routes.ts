import type { FastifyInstance } from "fastify";
import type { UpdateManager } from "./manager.js";

export interface UpdateDeps {
  updateManager: UpdateManager;
}

export function registerUpdateRoutes(app: FastifyInstance, deps: UpdateDeps): void {
  const { updateManager } = deps;

  app.get("/update/status", { preHandler: app.requireSession() }, async () =>
    updateManager.getStatus(),
  );

  app.post(
    "/update/apply",
    { preHandler: app.requireSession({ precisaCentral: true }) },
    async (_request, reply) => {
      const resultado = await updateManager.applyUpdate();
      const status = await updateManager.getStatus();
      switch (resultado) {
        case "ok":
          return reply.code(200).send(status);
        case "sem_atualizacao":
          return reply.code(400).send({ error: "nenhuma atualização disponível", status });
        case "ocupado":
          return reply.code(409).send({ error: "update ou rollback em andamento", status });
        case "falhou":
          return reply.code(502).send({ error: "falha ao aplicar atualização", status });
      }
    },
  );

  app.post<{ Body: { autoUpdate?: unknown } | undefined }>(
    "/update/settings",
    { preHandler: app.requireSession({ precisaCentral: true }) },
    async (request, reply) => {
      const autoUpdate = request.body?.autoUpdate;
      if (typeof autoUpdate !== "boolean") {
        return reply.code(400).send({ error: "autoUpdate deve ser booleano" });
      }
      await updateManager.setAutoUpdate(autoUpdate);
      return reply.code(200).send(await updateManager.getStatus());
    },
  );

  app.post(
    "/update/rollback",
    { preHandler: app.requireSession() },
    async (_request, reply) => {
      const resultado = await updateManager.rollback();
      const status = await updateManager.getStatus();
      switch (resultado) {
        case "ok":
          return reply.code(200).send(status);
        case "sem_rollback":
          return reply.code(404).send({ error: "nenhum rollback disponível", status });
        case "ocupado":
          return reply.code(409).send({ error: "update ou rollback em andamento", status });
        case "falhou":
          return reply.code(502).send({ error: "falha ao executar rollback", status });
      }
    },
  );
}
