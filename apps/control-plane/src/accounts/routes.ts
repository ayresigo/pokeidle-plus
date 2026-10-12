import type { FastifyInstance } from "fastify";
import { criarRepasse } from "../central/repasse.js";
import type { SessionStore } from "../session/store.js";

export interface AccountsDeps {
  sessionStore: SessionStore;
  centralApiUrl: string;
}

interface ParamsConta {
  id: string;
}

export function registerAccountsRoutes(app: FastifyInstance, deps: AccountsDeps): void {
  const repassar = criarRepasse(deps.sessionStore, deps.centralApiUrl);
  const guard = { preHandler: app.requireSession({ precisaCentral: true }) };

  app.get("/accounts", guard, async (_request, reply) => repassar(reply, "GET", "/accounts"));

  app.post("/accounts", guard, async (request, reply) =>
    repassar(reply, "POST", "/accounts", request.body),
  );

  app.patch<{ Params: ParamsConta }>("/accounts/:id", guard, async (request, reply) =>
    repassar(reply, "PATCH", `/accounts/${encodeURIComponent(request.params.id)}`, request.body),
  );

  app.delete<{ Params: ParamsConta }>("/accounts/:id", guard, async (request, reply) =>
    repassar(reply, "DELETE", `/accounts/${encodeURIComponent(request.params.id)}`),
  );

  app.put<{ Params: ParamsConta }>("/accounts/:id/tokens", guard, async (request, reply) =>
    repassar(
      reply,
      "PUT",
      `/accounts/${encodeURIComponent(request.params.id)}/tokens`,
      request.body,
    ),
  );
}
