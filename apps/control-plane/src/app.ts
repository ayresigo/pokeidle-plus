import Fastify from "fastify";
import { SessionStore } from "./session/store.js";

export function buildApp() {
  const app = Fastify();

  const sessionStore = new SessionStore(
    process.env.DATA_DIR ?? "/data",
    process.env.CENTRAL_API_URL ?? "http://localhost:8080",
  );

  app.get("/health", async () => ({ status: "ok" }));

  return { app, sessionStore };
}
