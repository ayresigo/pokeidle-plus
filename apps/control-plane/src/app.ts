import Fastify from "fastify";
import { registerGuard } from "./auth/guard.js";
import { SessionStore } from "./session/store.js";

export interface BuildAppOpts {
  dataDir?: string;
  centralApiUrl?: string;
}

export function buildApp(opts?: BuildAppOpts) {
  const app = Fastify();

  const sessionStore = new SessionStore(
    opts?.dataDir ?? process.env.DATA_DIR ?? "/data",
    opts?.centralApiUrl ?? process.env.CENTRAL_API_URL ?? "http://localhost:8080",
  );

  registerGuard(app, sessionStore);

  app.get("/health", async () => ({ status: "ok" }));

  return { app, sessionStore };
}
