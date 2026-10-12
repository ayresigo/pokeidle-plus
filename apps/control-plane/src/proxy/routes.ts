import type { FastifyInstance } from "fastify";
import type { ContainerOrchestrator } from "../orchestrator/types.js";

interface ProxyTestBody {
  proxyUrl: string;
}

const IMAGEM_CURL = "curlimages/curl";
const TIMEOUT_TOTAL_MS = 20_000;
const FORMATO_IP = /^[0-9a-fA-F:.]{2,45}$/;

const PROXY_TEST_SCHEMA = {
  body: {
    type: "object",
    required: ["proxyUrl"],
    additionalProperties: false,
    properties: {
      proxyUrl: { type: "string", maxLength: 2048, pattern: "^(https?|socks5)://[^\\s]+$" },
    },
  },
};

export function registerProxyRoutes(app: FastifyInstance, orchestrator: ContainerOrchestrator): void {
  app.post<{ Body: ProxyTestBody }>(
    "/proxy/test",
    { schema: PROXY_TEST_SCHEMA, preHandler: app.requireSession() },
    async (request, reply) => {
      let id: string | null = null;
      try {
        id = await orchestrator.createOneShot(IMAGEM_CURL, [
          "curl",
          "-s",
          "--max-time",
          "15",
          "-x",
          request.body.proxyUrl,
          "https://api.ipify.org",
        ]);
        const resultado = await orchestrator.waitOneShot(id, TIMEOUT_TOTAL_MS);
        const ip = resultado.stdout.trim();
        if (resultado.exitCode === 0 && FORMATO_IP.test(ip)) {
          return reply.code(200).send({ ip });
        }
      } catch {
        request.log.warn("teste de proxy falhou no orquestrador");
      } finally {
        if (id !== null) {
          await orchestrator.removeOneShot(id).catch(() => {
            request.log.warn("falha ao remover container do teste de proxy");
          });
        }
      }
      return reply.code(502).send({ error: "proxy não respondeu" });
    },
  );
}
