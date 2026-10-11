import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient, Release } from "@prisma/client";
import { requireAuth } from "../auth/guard.js";

const REGEX_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

interface ReleaseBody {
  version?: string;
  channel?: string;
  imageDigest?: string;
  changelog?: string;
}

const schemaCriar = {
  body: {
    type: "object",
    required: ["version", "channel", "imageDigest", "changelog"],
    additionalProperties: false,
    properties: {
      version: { type: "string", pattern: REGEX_SEMVER.source, maxLength: 64 },
      channel: { type: "string", enum: ["stable", "beta"] },
      imageDigest: { type: "string", maxLength: 256 },
      changelog: { type: "string", maxLength: 8192 },
    },
  },
} as const;

const schemaVersion = {
  querystring: {
    type: "object",
    required: ["channel"],
    additionalProperties: false,
    properties: {
      channel: { type: "string", enum: ["stable", "beta"] },
    },
  },
} as const;

function publico(release: Release) {
  return {
    version: release.version,
    channel: release.channel,
    imageDigest: release.imageDigest,
    changelog: release.changelog,
    publishedAt: release.publishedAt,
  };
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  if (request.userRole !== "admin") {
    return reply.code(403).send({ error: "acesso restrito a administradores" });
  }
}

export function registerReleaseRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.register(async (escopo) => {
    escopo.addHook("preHandler", requireAuth);

    escopo.get<{ Querystring: { channel: string } }>(
      "/version",
      { schema: schemaVersion },
      async (request, reply) => {
        const release = await prisma.release.findFirst({
          where: { channel: request.query.channel },
          orderBy: { publishedAt: "desc" },
        });
        if (!release) {
          return reply.code(404).send({ error: "nenhuma release no canal" });
        }
        return reply.send(publico(release));
      },
    );

    escopo.post<{ Body: ReleaseBody }>(
      "/admin/releases",
      { schema: schemaCriar, preHandler: requireAdmin },
      async (request, reply) => {
        const duplicata = await prisma.release.findUnique({
          where: {
            version_channel: {
              version: request.body.version!,
              channel: request.body.channel!,
            },
          },
        });
        if (duplicata) {
          return reply.code(409).send({ error: "release já publicada neste canal" });
        }
        const release = await prisma.release.create({
          data: {
            version: request.body.version!,
            channel: request.body.channel!,
            imageDigest: request.body.imageDigest!,
            changelog: request.body.changelog!,
          },
        });
        return reply.code(201).send(publico(release));
      },
    );

    escopo.get(
      "/admin/releases",
      { preHandler: requireAdmin },
      async () => {
        const releases = await prisma.release.findMany({
          orderBy: { publishedAt: "desc" },
        });
        return releases.map(publico);
      },
    );
  });
}
