import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { requireJwtSecret } from "./service.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    userRole?: string;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "não autenticado" });
  }
  try {
    const payload = jwt.verify(header.slice("Bearer ".length), requireJwtSecret(), {
      algorithms: ["HS256"],
    });
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      return reply.code(401).send({ error: "não autenticado" });
    }
    request.userId = payload.sub;
    if (typeof payload.role === "string") {
      request.userRole = payload.role;
    }
  } catch {
    return reply.code(401).send({ error: "não autenticado" });
  }
}
