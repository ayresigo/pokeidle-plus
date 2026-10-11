import { defineConfig, env } from "prisma/config";

try {
  process.loadEnvFile(new URL("./.env", import.meta.url));
} catch {
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
