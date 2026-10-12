import type { FastifyInstance, FastifyReply } from "fastify";
import type { SessionStore } from "../session/store.js";

export interface AccountsDeps {
  sessionStore: SessionStore;
  centralApiUrl: string;
}

interface ParamsConta {
  id: string;
}

export function registerAccountsRoutes(app: FastifyInstance, deps: AccountsDeps): void {
  const { sessionStore, centralApiUrl } = deps;
  const guard = { preHandler: app.requireSession({ precisaCentral: true }) };

  async function repassar(
    reply: FastifyReply,
    metodo: string,
    caminho: string,
    corpo?: unknown,
  ): Promise<FastifyReply> {
    const resultado = await sessionStore.getAccessToken();
    if (resultado.token === null) {
      return reply.code(503).send({ error: "central inalcançável" });
    }
    const headers: Record<string, string> = { authorization: `Bearer ${resultado.token}` };
    if (corpo !== undefined) headers["content-type"] = "application/json";
    let resposta: Response;
    try {
      resposta = await fetch(`${centralApiUrl}${caminho}`, {
        method: metodo,
        headers,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch {
      return reply.code(502).send({ error: "falha ao contatar o central" });
    }
    if (resposta.status >= 500) {
      return reply.code(502).send({ error: "falha ao contatar o central" });
    }
    const texto = await resposta.text();
    reply.code(resposta.status);
    if (texto === "") return reply.send();
    const tipo = resposta.headers.get("content-type");
    if (tipo !== null) reply.header("content-type", tipo);
    return reply.send(texto);
  }

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
