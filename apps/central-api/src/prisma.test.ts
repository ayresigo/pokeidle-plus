import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

try {
  process.loadEnvFile(".env");
} catch {
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function limparBanco() {
  await prisma.refreshToken.deleteMany();
  await prisma.account.deleteMany();
  await prisma.release.deleteMany();
  await prisma.user.deleteMany();
}

describe("prisma + postgres dev", () => {
  beforeAll(limparBanco);

  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
  });

  it("cria user, account e release e lê de volta", async () => {
    const user = await prisma.user.create({
      data: {
        username: "alice",
        passwordHash: "hash-alice",
        role: "admin",
      },
    });
    expect(user.active).toBe(true);
    expect(user.createdAt).toBeInstanceOf(Date);

    const account = await prisma.account.create({
      data: {
        userId: user.id,
        label: "conta principal",
        pokeidleUser: "alice_pi",
        pokeidlePassEnc: Buffer.from("segredo-enc"),
      },
    });
    expect(account.accessTokenEnc).toBeNull();
    expect(account.proxyUrl).toBeNull();
    expect(account.huntSlug).toBeNull();

    const release = await prisma.release.create({
      data: {
        version: "1.0.0",
        channel: "stable",
        imageDigest: "sha256:abc123",
        changelog: "primeira release",
      },
    });

    const lido = await prisma.user.findUniqueOrThrow({
      where: { username: "alice" },
      include: { accounts: true },
    });
    expect(lido.accounts).toHaveLength(1);
    expect(Buffer.from(lido.accounts[0].pokeidlePassEnc).toString()).toBe("segredo-enc");
    expect(lido.role).toBe("admin");

    const releaseLida = await prisma.release.findUniqueOrThrow({ where: { id: release.id } });
    expect(releaseLida.version).toBe("1.0.0");
    expect(releaseLida.publishedAt).toBeInstanceOf(Date);
  });

  it("refresh token vinculado ao user com revoked_at nulo por padrão", async () => {
    const user = await prisma.user.create({
      data: { username: "bob", passwordHash: "hash-bob" },
    });
    const token = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: "hash-token-1",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    expect(token.revokedAt).toBeNull();
    expect(user.role).toBe("user");

    const lido = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: "hash-token-1" } });
    expect(lido.userId).toBe(user.id);
  });

  it("accounts filtradas por user_id retornam só as do usuário", async () => {
    const userA = await prisma.user.create({
      data: { username: "user-a", passwordHash: "h1" },
    });
    const userB = await prisma.user.create({
      data: { username: "user-b", passwordHash: "h2" },
    });

    await prisma.account.createMany({
      data: [
        { userId: userA.id, label: "a1", pokeidleUser: "a1", pokeidlePassEnc: Buffer.from("x") },
        { userId: userA.id, label: "a2", pokeidleUser: "a2", pokeidlePassEnc: Buffer.from("x") },
        { userId: userB.id, label: "b1", pokeidleUser: "b1", pokeidlePassEnc: Buffer.from("x") },
      ],
    });

    const doUserA = await prisma.account.findMany({ where: { userId: userA.id } });
    expect(doUserA).toHaveLength(2);
    expect(doUserA.every((a) => a.userId === userA.id)).toBe(true);

    const doUserB = await prisma.account.findMany({ where: { userId: userB.id } });
    expect(doUserB).toHaveLength(1);
    expect(doUserB[0].label).toBe("b1");
  });
});
