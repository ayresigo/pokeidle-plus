import Fastify from "fastify";
import { registerGuard } from "./auth/guard.js";
import { DockerOrchestrator } from "./orchestrator/orchestrator.js";
import type { ContainerOrchestrator } from "./orchestrator/types.js";
import { SessionStore } from "./session/store.js";
import { registerStreamRoutes } from "./stream/routes.js";
import { Supervisor } from "./supervisor/supervisor.js";
import { registerWorkerRoutes } from "./workers/routes.js";

export interface BuildAppOpts {
  dataDir?: string;
  centralApiUrl?: string;
  orchestrator?: ContainerOrchestrator;
  workerImage?: string;
  gameUrl?: string;
  controlPlaneUrl?: string;
  supervisorPollMs?: number;
}

export function buildApp(opts?: BuildAppOpts) {
  const app = Fastify();

  const centralApiUrl =
    opts?.centralApiUrl ?? process.env.CENTRAL_API_URL ?? "http://localhost:8080";
  const sessionStore = new SessionStore(
    opts?.dataDir ?? process.env.DATA_DIR ?? "/data",
    centralApiUrl,
  );
  const orchestrator =
    opts?.orchestrator ??
    new DockerOrchestrator(undefined, process.env.WORKER_NETWORK || undefined);
  const supervisor = new Supervisor(orchestrator, opts?.supervisorPollMs);

  registerGuard(app, sessionStore);
  registerWorkerRoutes(app, {
    sessionStore,
    orchestrator,
    supervisor,
    centralApiUrl,
    workerImage:
      opts?.workerImage ??
      process.env.WORKER_IMAGE ??
      "ghcr.io/multiacc-pokeidle/mpw-worker:stable",
    gameUrl: opts?.gameUrl ?? process.env.GAME_URL ?? "https://poke.idleworld.online",
    controlPlaneUrl:
      opts?.controlPlaneUrl ??
      process.env.CONTROL_PLANE_URL ??
      "http://host.docker.internal:4000",
  });
  registerStreamRoutes(app, { orchestrator, supervisor });

  app.addHook("onClose", async () => {
    supervisor.stop();
  });

  app.get("/health", async () => ({ status: "ok" }));

  return { app, sessionStore, supervisor };
}
