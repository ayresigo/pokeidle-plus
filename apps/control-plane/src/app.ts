import Fastify from "fastify";
import { registerAccountsRoutes } from "./accounts/routes.js";
import { registerGuard } from "./auth/guard.js";
import { DockerOrchestrator } from "./orchestrator/orchestrator.js";
import type { ContainerOrchestrator } from "./orchestrator/types.js";
import { registerProxyRoutes } from "./proxy/routes.js";
import { registerSessionRoutes } from "./session/routes.js";
import { SessionStore } from "./session/store.js";
import { registerStreamRoutes } from "./stream/routes.js";
import { Supervisor } from "./supervisor/supervisor.js";
import { UpdateManager } from "./update/manager.js";
import { registerUpdateRoutes } from "./update/routes.js";
import { registerWorkerRoutes } from "./workers/routes.js";

export interface BuildAppOpts {
  dataDir?: string;
  centralApiUrl?: string;
  orchestrator?: ContainerOrchestrator;
  workerImage?: string;
  gameUrl?: string;
  controlPlaneUrl?: string;
  supervisorPollMs?: number;
  currentVersion?: string;
  autoUpdate?: boolean;
  updateCheckIntervalMs?: number;
}

export function buildApp(opts?: BuildAppOpts) {
  const app = Fastify();

  const dataDir = opts?.dataDir ?? process.env.DATA_DIR ?? "/data";
  const centralApiUrl =
    opts?.centralApiUrl ?? process.env.CENTRAL_API_URL ?? "http://localhost:8080";
  const workerImage =
    opts?.workerImage ??
    process.env.WORKER_IMAGE ??
    "ghcr.io/multiacc-pokeidle/mpw-worker:stable";
  const sessionStore = new SessionStore(dataDir, centralApiUrl);
  const orchestrator =
    opts?.orchestrator ??
    new DockerOrchestrator(undefined, process.env.WORKER_NETWORK || undefined);
  const supervisor = new Supervisor(orchestrator, opts?.supervisorPollMs);
  const updateManager = new UpdateManager({
    dataDir,
    centralApiUrl,
    sessionStore,
    orchestrator,
    supervisor,
    workerImage,
    currentVersion: opts?.currentVersion ?? process.env.CURRENT_VERSION ?? "dev",
    autoUpdateEnv: opts?.autoUpdate ?? process.env.AUTO_UPDATE === "true",
    checkIntervalMs: opts?.updateCheckIntervalMs,
  });

  registerGuard(app, sessionStore);
  registerWorkerRoutes(app, {
    sessionStore,
    orchestrator,
    supervisor,
    centralApiUrl,
    workerImage,
    gameUrl: opts?.gameUrl ?? process.env.GAME_URL ?? "https://poke.idleworld.online",
    controlPlaneUrl:
      opts?.controlPlaneUrl ??
      process.env.CONTROL_PLANE_URL ??
      "http://host.docker.internal:4000",
  });
  registerStreamRoutes(app, { orchestrator, supervisor });
  registerUpdateRoutes(app, { updateManager });
  registerSessionRoutes(app, sessionStore);
  registerAccountsRoutes(app, { sessionStore, centralApiUrl });
  registerProxyRoutes(app, orchestrator);

  app.addHook("onClose", async () => {
    supervisor.stop();
    updateManager.stop();
  });

  app.get("/health", async () => ({ status: "ok" }));

  return { app, sessionStore, supervisor, updateManager };
}
