import type { FastifyInstance } from "fastify";
import type { Account, PrismaClient } from "@prisma/client";
import { requireAuth } from "../auth/guard.js";
import { decrypt, encrypt } from "../crypto/secrets.js";

const REGEX_PROXY_URL = /^(https?|socks5):\/\/\S+$/;

interface AccountBody {
  label?: string;
  pokeidleUser?: string;
  pokeidlePass?: string;
  proxyUrl?: string;
  huntSlug?: string;
  solverKey?: string;
  accessToken?: string;
  refreshToken?: string;
}

interface TokensBody {
  accessToken: string;
  refreshToken: string;
}

const propriedadesConta = {
  label: { type: "string", maxLength: 128 },
  pokeidleUser: { type: "string", maxLength: 128 },
  pokeidlePass: { type: "string", maxLength: 256 },
  proxyUrl: { type: "string", pattern: REGEX_PROXY_URL.source, maxLength: 512 },
  huntSlug: { type: "string", maxLength: 64 },
  solverKey: { type: "string", maxLength: 2048 },
  accessToken: { type: "string", maxLength: 2048 },
  refreshToken: { type: "string", maxLength: 2048 },
} as const;

const schemaCriar = {
  body: {
    type: "object",
    required: ["label", "pokeidleUser", "pokeidlePass"],
    additionalProperties: false,
    properties: propriedadesConta,
  },
} as const;

const schemaAtualizar = {
  body: {
    type: "object",
    additionalProperties: false,
    properties: propriedadesConta,
  },
} as const;

const schemaTokens = {
  body: {
    type: "object",
    required: ["accessToken", "refreshToken"],
    additionalProperties: false,
    properties: {
      accessToken: { type: "string", maxLength: 2048 },
      refreshToken: { type: "string", maxLength: 2048 },
    },
  },
} as const;

function publico(account: Account) {
  return {
    id: account.id,
    label: account.label,
    pokeidleUser: account.pokeidleUser,
    proxyUrl: account.proxyUrl,
    huntSlug: account.huntSlug,
    createdAt: account.createdAt,
  };
}

function descriptografar(valor: Uint8Array | null): string | null {
  return valor === null ? null : decrypt(Buffer.from(valor));
}

function camposCriptografados(body: AccountBody) {
  return {
    ...(body.pokeidlePass !== undefined && { pokeidlePassEnc: encrypt(body.pokeidlePass) }),
    ...(body.solverKey !== undefined && { solverKeyEnc: encrypt(body.solverKey) }),
    ...(body.accessToken !== undefined && { accessTokenEnc: encrypt(body.accessToken) }),
    ...(body.refreshToken !== undefined && { refreshTokenEnc: encrypt(body.refreshToken) }),
  };
}

export function registerAccountRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.register(async (escopo) => {
    escopo.addHook("preHandler", requireAuth);

    escopo.get("/accounts", async (request) => {
      const contas = await prisma.account.findMany({
        where: { userId: request.userId! },
        orderBy: { createdAt: "asc" },
      });
      return contas.map(publico);
    });

    escopo.post<{ Body: AccountBody }>(
      "/accounts",
      { schema: schemaCriar },
      async (request, reply) => {
        const conta = await prisma.account.create({
          data: {
            userId: request.userId!,
            label: request.body.label!,
            pokeidleUser: request.body.pokeidleUser!,
            proxyUrl: request.body.proxyUrl ?? null,
            huntSlug: request.body.huntSlug ?? null,
            pokeidlePassEnc: encrypt(request.body.pokeidlePass!),
            solverKeyEnc: request.body.solverKey === undefined ? null : encrypt(request.body.solverKey),
            accessTokenEnc:
              request.body.accessToken === undefined ? null : encrypt(request.body.accessToken),
            refreshTokenEnc:
              request.body.refreshToken === undefined ? null : encrypt(request.body.refreshToken),
          },
        });
        return reply.code(201).send(publico(conta));
      },
    );

    async function buscarPropria(userId: string, id: string): Promise<Account | null> {
      return prisma.account.findFirst({ where: { id, userId } });
    }

    const ERRO_NAO_ENCONTRADA = { error: "conta não encontrada" };

    escopo.patch<{ Params: { id: string }; Body: AccountBody }>(
      "/accounts/:id",
      { schema: schemaAtualizar },
      async (request, reply) => {
        const userId = request.userId!;
        const body = request.body;
        const atualizado = await prisma.account.updateMany({
          where: { id: request.params.id, userId },
          data: {
            ...(body.label !== undefined && { label: body.label }),
            ...(body.pokeidleUser !== undefined && { pokeidleUser: body.pokeidleUser }),
            ...(body.proxyUrl !== undefined && { proxyUrl: body.proxyUrl }),
            ...(body.huntSlug !== undefined && { huntSlug: body.huntSlug }),
            ...camposCriptografados(body),
          },
        });
        if (atualizado.count === 0) {
          return reply.code(404).send(ERRO_NAO_ENCONTRADA);
        }
        const conta = await prisma.account.findFirstOrThrow({
          where: { id: request.params.id, userId },
        });
        return reply.send(publico(conta));
      },
    );

    escopo.delete<{ Params: { id: string } }>("/accounts/:id", async (request, reply) => {
      const removido = await prisma.account.deleteMany({
        where: { id: request.params.id, userId: request.userId! },
      });
      if (removido.count === 0) {
        return reply.code(404).send(ERRO_NAO_ENCONTRADA);
      }
      return reply.code(204).send();
    });

    escopo.get<{ Params: { id: string } }>(
      "/accounts/:id/credentials",
      async (request, reply) => {
        const conta = await buscarPropria(request.userId!, request.params.id);
        if (!conta) {
          return reply.code(404).send(ERRO_NAO_ENCONTRADA);
        }
        try {
          return reply.send({
            pokeidleUser: conta.pokeidleUser,
            pokeidlePass: descriptografar(conta.pokeidlePassEnc),
            accessToken: descriptografar(conta.accessTokenEnc),
            refreshToken: descriptografar(conta.refreshTokenEnc),
            solverKey: descriptografar(conta.solverKeyEnc),
            proxyUrl: conta.proxyUrl,
            huntSlug: conta.huntSlug,
          });
        } catch (err) {
          request.log.error(err, "falha ao descriptografar credenciais da conta %s", conta.id);
          return reply.code(500).send({ error: "credenciais ilegíveis" });
        }
      },
    );

    escopo.put<{ Params: { id: string }; Body: TokensBody }>(
      "/accounts/:id/tokens",
      { schema: schemaTokens },
      async (request, reply) => {
        const atualizado = await prisma.account.updateMany({
          where: { id: request.params.id, userId: request.userId! },
          data: {
            accessTokenEnc: encrypt(request.body.accessToken),
            refreshTokenEnc: encrypt(request.body.refreshToken),
          },
        });
        if (atualizado.count === 0) {
          return reply.code(404).send(ERRO_NAO_ENCONTRADA);
        }
        return reply.code(204).send();
      },
    );
  });
}
