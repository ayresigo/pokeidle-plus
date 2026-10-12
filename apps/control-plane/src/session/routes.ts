import type { FastifyInstance } from "fastify";
import { ErroCentralInalcancavel, ErroCredenciaisInvalidas, type SessionStore } from "./store.js";

interface LoginBody {
  username: string;
  password: string;
}

const LOGIN_SCHEMA = {
  body: {
    type: "object",
    required: ["username", "password"],
    additionalProperties: false,
    properties: {
      username: { type: "string", minLength: 1, maxLength: 128 },
      password: { type: "string", minLength: 1, maxLength: 256 },
    },
  },
};

export function registerSessionRoutes(app: FastifyInstance, sessionStore: SessionStore): void {
  app.post<{ Body: LoginBody }>("/auth/login", { schema: LOGIN_SCHEMA }, async (request, reply) => {
    try {
      await sessionStore.login(request.body.username, request.body.password);
    } catch (err) {
      if (err instanceof ErroCredenciaisInvalidas) {
        return reply.code(401).send({ error: "credenciais inválidas" });
      }
      if (err instanceof ErroCentralInalcancavel) {
        return reply.code(503).send({ error: "central inalcançável" });
      }
      request.log.error("falha inesperada no login");
      return reply.code(502).send({ error: "falha no login" });
    }
    return reply.code(200).send({ authenticated: true });
  });

  app.post("/auth/logout", async (_request, reply) => {
    await sessionStore.logout();
    return reply.code(204).send();
  });

  app.get("/auth/session", async () => {
    const resultado = await sessionStore.getAccessToken();
    if (resultado.token !== null && sessionStore.perfil === null) {
      await sessionStore.atualizarPerfil();
    }
    const authenticated = resultado.token !== null || resultado.offline;
    const perfil = authenticated ? sessionStore.perfil : null;
    return {
      authenticated,
      offline: resultado.offline,
      ...(perfil !== null && { username: perfil.username, role: perfil.role }),
    };
  });
}
