import type { FastifyReply } from "fastify";
import type { SessionStore } from "../session/store.js";

export type Repassar = (
  reply: FastifyReply,
  metodo: string,
  caminho: string,
  corpo?: unknown,
) => Promise<FastifyReply>;

export function criarRepasse(sessionStore: SessionStore, centralApiUrl: string): Repassar {
  return async (reply, metodo, caminho, corpo) => {
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
  };
}
