import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { seedAdmin } from "./seed.js";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
}

const databaseUrl = process.env.DATABASE_URL;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const username = `admin-seed-${randomBytes(4).toString("hex")}`;
const password = "senha-super-secreta-123";
let adminIds: string[] = [];

describe("seed admin", () => {
  beforeAll(async () => {
    adminIds = [];
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: "admin-seed-" } } });
    await prisma.$disconnect();
  });

  it("falha com erro claro sem ADMIN_USERNAME/ADMIN_PASSWORD", async () => {
    await expect(
      seedAdmin({ DATABASE_URL: databaseUrl }),
    ).rejects.toThrow("ADMIN_USERNAME e ADMIN_PASSWORD são obrigatórios");
    await expect(
      seedAdmin({ ADMIN_USERNAME: username, DATABASE_URL: databaseUrl }),
    ).rejects.toThrow("ADMIN_USERNAME e ADMIN_PASSWORD são obrigatórios");
  });

  it("cria user admin com hash argon2id verificável", async () => {
    const { created } = await seedAdmin({
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: password,
      DATABASE_URL: databaseUrl,
    });
    expect(created).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    adminIds.push(user.id);
    expect(user.role).toBe("admin");
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await argon2.verify(user.passwordHash, password)).toBe(true);
  });

  it("rodando de novo não duplica nem altera o admin", async () => {
    const antes = await prisma.user.findUniqueOrThrow({ where: { username } });

    const { created } = await seedAdmin({
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: "outra-senha",
      DATABASE_URL: databaseUrl,
    });
    expect(created).toBe(false);

    const todos = await prisma.user.findMany({ where: { username } });
    expect(todos).toHaveLength(1);

    const depois = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(depois.passwordHash).toBe(antes.passwordHash);
    expect(await argon2.verify(depois.passwordHash, password)).toBe(true);
  });
});
