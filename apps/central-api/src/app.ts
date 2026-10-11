import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerAccountRoutes } from "./accounts/routes.js";
import { registerReleaseRoutes } from "./releases/routes.js";
import { requireJwtSecret } from "./auth/service.js";
import { initSecrets } from "./crypto/secrets.js";

export function buildApp() {
  requireJwtSecret();
  initSecrets();

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const app = Fastify({
    ajv: { customOptions: { coerceTypes: false } },
  });

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  app.get("/health", async () => ({ status: "ok" }));

  registerAuthRoutes(app, prisma);
  registerAccountRoutes(app, prisma);
  registerReleaseRoutes(app, prisma);

  return app;
}
