import type { FastifyInstance } from "fastify";
import type { ContainerOrchestrator } from "../orchestrator/types.js";
import type { SessionStore } from "../session/store.js";
import type { Supervisor } from "../supervisor/supervisor.js";

export interface WorkersDeps {
  sessionStore: SessionStore;
  orchestrator: ContainerOrchestrator;
  supervisor: Supervisor;
  centralApiUrl: string;
  workerImage: string;
  gameUrl: string;
  controlPlaneUrl: string;
}

interface CredenciaisConta {
  pokeidleUser: string;
  pokeidlePass: string;
  accessToken: string | null;
  refreshToken: string | null;
  solverKey: string | null;
  proxyUrl: string | null;
  huntSlug: string | null;
}

class ErroCredenciais extends Error {}

const DRAIN_STOP_SEGUNDOS = 30;

export function registerWorkerRoutes(app: FastifyInstance, deps: WorkersDeps): void {
  const { sessionStore, orchestrator, supervisor, centralApiUrl } = deps;

  supervisor.setOnTokensRenovados(async (accountId, tokens) => {
    const resultado = await sessionStore.getAccessToken();
    if (resultado.token === null) {
      throw new Error("sem sessão válida para write-back de tokens");
    }
    const resposta = await fetch(`${centralApiUrl}/accounts/${accountId}/tokens`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${resultado.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(tokens),
    });
    if (!resposta.ok) {
      throw new Error(`central respondeu ${resposta.status} no PUT de tokens`);
    }
  });

  async function buscarCredenciais(accountId: string, token: string): Promise<CredenciaisConta> {
    let resposta: Response;
    try {
      resposta = await fetch(`${centralApiUrl}/accounts/${accountId}/credentials`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new ErroCredenciais(
        `central inalcançável em /credentials: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!resposta.ok) {
      throw new ErroCredenciais(`central respondeu ${resposta.status} em /credentials`);
    }
    return (await resposta.json()) as CredenciaisConta;
  }

  function montarEnv(accountId: string, credenciais: CredenciaisConta): Record<string, string> {
    const env: Record<string, string> = {
      ACCOUNT_ID: accountId,
      GAME_URL: deps.gameUrl,
      POKEIDLE_USER: credenciais.pokeidleUser,
      POKEIDLE_PASS: credenciais.pokeidlePass,
      CONTROL_PLANE_URL: deps.controlPlaneUrl,
    };
    if (credenciais.accessToken !== null) env.ACCESS_TOKEN = credenciais.accessToken;
    if (credenciais.refreshToken !== null) env.REFRESH_TOKEN = credenciais.refreshToken;
    if (credenciais.solverKey !== null) env.SOLVER_KEY = credenciais.solverKey;
    if (credenciais.proxyUrl !== null) env.PROXY_URL = credenciais.proxyUrl;
    if (credenciais.huntSlug) env.HUNT_SLUG = credenciais.huntSlug;
    return env;
  }

  async function iniciarWorker(accountId: string, token: string): Promise<string> {
    const credenciais = await buscarCredenciais(accountId, token);
    const id = await orchestrator.createWorker({
      accountId,
      imageRef: deps.workerImage,
      env: montarEnv(accountId, credenciais),
    });
    await orchestrator.startWorker(id);
    supervisor.desireRunning(accountId);
    return id;
  }

  async function pararWorker(accountId: string): Promise<void> {
    supervisor.desireStopped(accountId);
    const workers = await orchestrator.listWorkers();
    const worker = workers.find((w) => w.accountId === accountId);
    if (!worker) return;
    await orchestrator.stopWorker(worker.id, DRAIN_STOP_SEGUNDOS);
    await orchestrator.removeWorker(worker.id);
  }

  app.post<{ Params: { accountId: string } }>(
    "/workers/:accountId/start",
    { preHandler: app.requireSession({ precisaCentral: true }) },
    async (request, reply) => {
      const resultado = await sessionStore.getAccessToken();
      if (resultado.token === null) {
        return reply.code(503).send({ error: "central inalcançável" });
      }
      try {
        const workerId = await iniciarWorker(request.params.accountId, resultado.token);
        return reply.code(200).send({ accountId: request.params.accountId, workerId });
      } catch (err) {
        request.log.error(
          { accountId: request.params.accountId },
          "falha ao iniciar worker",
        );
        if (err instanceof ErroCredenciais) {
          return reply.code(502).send({ error: "falha ao buscar credenciais no central" });
        }
        return reply
          .code(502)
          .send({ error: "falha ao criar ou iniciar worker no orquestrador" });
      }
    },
  );

  app.post<{ Params: { accountId: string } }>(
    "/workers/:accountId/stop",
    { preHandler: app.requireSession() },
    async (request, reply) => {
      await pararWorker(request.params.accountId);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { accountId: string } }>(
    "/workers/:accountId/restart",
    { preHandler: app.requireSession({ precisaCentral: true }) },
    async (request, reply) => {
      const resultado = await sessionStore.getAccessToken();
      if (resultado.token === null) {
        return reply.code(503).send({ error: "central inalcançável" });
      }
      await pararWorker(request.params.accountId);
      try {
        const workerId = await iniciarWorker(request.params.accountId, resultado.token);
        return reply.code(200).send({ accountId: request.params.accountId, workerId });
      } catch (err) {
        request.log.error(
          { accountId: request.params.accountId },
          "falha ao reiniciar worker",
        );
        if (err instanceof ErroCredenciais) {
          return reply.code(502).send({ error: "falha ao buscar credenciais no central" });
        }
        return reply
          .code(502)
          .send({ error: "falha ao criar ou iniciar worker no orquestrador" });
      }
    },
  );

  app.get("/workers/status", { preHandler: app.requireSession() }, async () =>
    supervisor.getSnapshot(),
  );
}
