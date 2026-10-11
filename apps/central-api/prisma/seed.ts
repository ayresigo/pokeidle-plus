import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";

export interface SeedEnv {
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  DATABASE_URL?: string;
}

export async function seedAdmin(env: SeedEnv = process.env): Promise<{ created: boolean }> {
  const username = env.ADMIN_USERNAME;
  const password = env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("ADMIN_USERNAME e ADMIN_PASSWORD são obrigatórios para o seed admin");
  }
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL não definida no ambiente");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  try {
    const existente = await prisma.user.findUnique({ where: { username } });
    if (existente) {
      console.log(`seed admin: usuário "${username}" já existe, nada a fazer`);
      return { created: false };
    }
    const passwordHash = await argon2.hash(password);
    await prisma.user.create({ data: { username, passwordHash, role: "admin" } });
    console.log(`seed admin: usuário admin "${username}" criado`);
    return { created: true };
  } finally {
    await prisma.$disconnect();
  }
}

const executadoDireto =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executadoDireto) {
  try {
    process.loadEnvFile(new URL("../.env", import.meta.url));
  } catch {
  }
  seedAdmin()
    .then(() => process.exit(0))
    .catch((err: Error) => {
      console.error(`seed admin: ${err.message}`);
      process.exit(1);
    });
}
