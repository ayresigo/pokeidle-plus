import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { login, logout, refresh } from "./service.js";

const ERRO_CREDENCIAIS = { error: "credenciais inválidas" };

interface LoginBody {
  username: string;
  password: string;
}

interface RefreshBody {
  refreshToken: string;
}

const schemaLogin = {
  body: {
    type: "object",
    required: ["username", "password"],
    properties: {
      username: { type: "string" },
      password: { type: "string" },
    },
  },
} as const;

const schemaRefresh = {
  body: {
    type: "object",
    required: ["refreshToken"],
    properties: {
      refreshToken: { type: "string" },
    },
  },
} as const;

export function registerAuthRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.post<{ Body: LoginBody }>("/auth/login", { schema: schemaLogin }, async (request, reply) => {
    const { username, password } = request.body;
    const tokens = await login(prisma, username, password);
    if (!tokens) {
      return reply.code(401).send(ERRO_CREDENCIAIS);
    }
    return reply.send(tokens);
  });

  app.post<{ Body: RefreshBody }>("/auth/refresh", { schema: schemaRefresh }, async (request, reply) => {
    const tokens = await refresh(prisma, request.body.refreshToken);
    if (!tokens) {
      return reply.code(401).send(ERRO_CREDENCIAIS);
    }
    return reply.send(tokens);
  });

  app.post<{ Body: RefreshBody }>("/auth/logout", { schema: schemaRefresh }, async (request, reply) => {
    await logout(prisma, request.body.refreshToken);
    return reply.code(204).send();
  });
}
