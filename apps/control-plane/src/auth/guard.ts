import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { SessionStore } from "../session/store.js";

export interface RequireSessionOpts {
  precisaCentral?: boolean;
}

declare module "fastify" {
  interface FastifyInstance {
    requireSession(opts?: RequireSessionOpts): preHandlerHookHandler;
  }
}

export function registerGuard(app: FastifyInstance, sessionStore: SessionStore): void {
  app.decorate("requireSession", (rotaOpts?: RequireSessionOpts): preHandlerHookHandler => {
    return async (request, reply) => {
      const resultado = await sessionStore.getAccessToken();
      if (resultado.token !== null) {
        return;
      }
      if (resultado.offline) {
        if (rotaOpts?.precisaCentral) {
          await reply.code(503).send({ error: "central inalcançável" });
        }
        return;
      }
      await reply.code(401).send({ error: "não autenticado" });
    };
  });
}
