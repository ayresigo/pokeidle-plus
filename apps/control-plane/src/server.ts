import { buildApp } from "./app.js";

try {
  process.loadEnvFile(".env");
} catch {
}

const port = Number(process.env.PORT ?? 4000);

const { app, sessionStore, supervisor, updateManager } = buildApp();

await sessionStore.init();
supervisor.start();
updateManager.start();

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
