import type { FastifyInstance } from "fastify";
import { criarRepasse } from "../central/repasse.js";
import type { SessionStore } from "../session/store.js";

export interface UsersDeps {
  sessionStore: SessionStore;
  centralApiUrl: string;
}

interface ParamsUsuario {
  id: string;
}

export function registerUsersRoutes(app: FastifyInstance, deps: UsersDeps): void {
  const repassar = criarRepasse(deps.sessionStore, deps.centralApiUrl);
  const guard = { preHandler: app.requireSession({ precisaCentral: true }) };

  app.get("/admin/users", guard, async (_request, reply) => repassar(reply, "GET", "/admin/users"));

  app.post("/admin/users", guard, async (request, reply) =>
    repassar(reply, "POST", "/admin/users", request.body),
  );

  app.patch<{ Params: ParamsUsuario }>("/admin/users/:id", guard, async (request, reply) =>
    repassar(reply, "PATCH", `/admin/users/${encodeURIComponent(request.params.id)}`, request.body),
  );
}
