import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { Prisma, type PrismaClient, type Role, type User } from "@prisma/client";
import { requireAdmin, requireAuth } from "../auth/guard.js";

interface CriarBody {
  username: string;
  password: string;
  role?: Role;
}

interface AlterarBody {
  active?: boolean;
  role?: Role;
  password?: string;
}

interface ParamsUsuario {
  id: string;
}

const PROPRIEDADE_SENHA = { type: "string", minLength: 12, maxLength: 256 } as const;
const PROPRIEDADE_ROLE = { type: "string", enum: ["user", "admin"] } as const;

const schemaCriar = {
  body: {
    type: "object",
    required: ["username", "password"],
    additionalProperties: false,
    properties: {
      username: { type: "string", minLength: 3, maxLength: 64, pattern: "^[a-zA-Z0-9._-]+$" },
      password: PROPRIEDADE_SENHA,
      role: PROPRIEDADE_ROLE,
    },
  },
} as const;

const schemaAlterar = {
  params: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", maxLength: 64 },
    },
  },
  body: {
    type: "object",
    additionalProperties: false,
    properties: {
      active: { type: "boolean" },
      role: PROPRIEDADE_ROLE,
      password: PROPRIEDADE_SENHA,
    },
  },
} as const;

type Resultado = { status: number; corpo: unknown };

function publico(user: User) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
  };
}

export function registerUserRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.register(async (escopo) => {
    escopo.addHook("preHandler", requireAuth);
    escopo.addHook("preHandler", requireAdmin);

    escopo.get("/admin/users", async () => {
      const usuarios = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
      return usuarios.map(publico);
    });

    escopo.post<{ Body: CriarBody }>("/admin/users", { schema: schemaCriar }, async (request, reply) => {
      const { username, password, role = "user" } = request.body;
      try {
        const user = await prisma.user.create({
          data: { username, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), role },
        });
        return reply.code(201).send(publico(user));
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return reply.code(409).send({ error: "nome de usuário já está em uso" });
        }
        throw err;
      }
    });

    escopo.patch<{ Params: ParamsUsuario; Body: AlterarBody }>(
      "/admin/users/:id",
      { schema: schemaAlterar },
      async (request, reply) => {
        const { id } = request.params;
        const { active, role, password } = request.body;
        if (active === undefined && role === undefined && password === undefined) {
          return reply.code(400).send({ error: "informe active, role ou password" });
        }
        const perdeAdmin = active === false || role === "user";

        if (id === request.userId && active === false) {
          return reply.code(400).send({ error: "você não pode desativar a si mesmo" });
        }
        if (id === request.userId && role === "user") {
          return reply.code(400).send({ error: "você não pode remover o papel de administrador de si mesmo" });
        }

        const passwordHash =
          password === undefined ? undefined : await argon2.hash(password, { type: argon2.argon2id });

        const resultado = await prisma.$transaction(async (tx): Promise<Resultado> => {
          const adminsAtivos = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM users WHERE role = 'admin' AND active = true FOR UPDATE`;
          const alvo = await tx.user.findUnique({ where: { id } });
          if (!alvo) {
            return { status: 404, corpo: { error: "usuário não encontrado" } };
          }
          const alvoEhAdminAtivo = adminsAtivos.some((admin) => admin.id === alvo.id);
          if (perdeAdmin && alvoEhAdminAtivo && adminsAtivos.length <= 1) {
            return {
              status: 409,
              corpo: { error: "a operação deixaria o sistema sem nenhum administrador ativo" },
            };
          }
          const atualizado = await tx.user.update({
            where: { id },
            data: { active, role, passwordHash },
          });
          if (active === false || passwordHash !== undefined) {
            await tx.refreshToken.updateMany({
              where: { userId: id, revokedAt: null },
              data: { revokedAt: new Date() },
            });
          }
          return { status: 200, corpo: publico(atualizado) };
        });

        return reply.code(resultado.status).send(resultado.corpo);
      },
    );
  });
}
