import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";

try {
  process.loadEnvFile(".env");
} catch {
}

process.env.JWT_SECRET ??= "segredo-teste-auth-com-32-caracteres-no-minimo";
process.env.SECRETS_KEY ??= "0".repeat(64);

import { buildApp } from "../app.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const app = buildApp();

async function limparBanco() {
  await prisma.refreshToken.deleteMany();
  await prisma.account.deleteMany();
  await prisma.release.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUser(username: string, role: "admin" | "user") {
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await argon2.hash("pikachu123", { type: argon2.argon2id }),
      role,
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username, password: "pikachu123" },
  });
  const { accessToken } = res.json();
  return { user, accessToken };
}

function authed(token: string) {
  return { authorization: `Bearer ${token}` };
}

const RELEASE_BASE = {
  version: "1.0.0",
  channel: "stable",
  imageDigest: "sha256:abc123",
  changelog: "primeira versão",
};

async function publicarRelease(token: string, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/admin/releases",
    headers: authed(token),
    payload: { ...RELEASE_BASE, ...overrides },
  });
}

beforeEach(limparBanco);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("POST /admin/releases", () => {
  it("admin publica release e recebe 201", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    const res = await publicarRelease(accessToken);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      version: "1.0.0",
      channel: "stable",
      imageDigest: "sha256:abc123",
    });
  });

  it("user não-admin recebe 403", async () => {
    const { accessToken } = await seedUser("user1", "user");
    const res = await publicarRelease(accessToken);
    expect(res.statusCode).toBe(403);
  });

  it("sem token recebe 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/releases",
      payload: RELEASE_BASE,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejeita duplicata de (version, channel) com 409", async () => {
    const { accessToken } = await seedUser("admin2", "admin");
    await publicarRelease(accessToken);
    const res = await publicarRelease(accessToken);
    expect(res.statusCode).toBe(409);
  });

  it("mesma versão em canal diferente é aceita", async () => {
    const { accessToken } = await seedUser("admin3", "admin");
    await publicarRelease(accessToken);
    const res = await publicarRelease(accessToken, { channel: "beta" });
    expect(res.statusCode).toBe(201);
  });

  it("rejeita version fora de semver", async () => {
    const { accessToken } = await seedUser("admin4", "admin");
    const res = await publicarRelease(accessToken, { version: "v1.0" });
    expect(res.statusCode).toBe(400);
  });

  it("rejeita channel fora do enum", async () => {
    const { accessToken } = await seedUser("admin5", "admin");
    const res = await publicarRelease(accessToken, { channel: "nightly" });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /version", () => {
  it("retorna a release mais recente do canal por publishedAt", async () => {
    const { accessToken } = await seedUser("admin6", "admin");
    await publicarRelease(accessToken, { version: "1.0.0" });
    await publicarRelease(accessToken, { version: "1.1.0", changelog: "segunda" });
    const res = await app.inject({
      method: "GET",
      url: "/version?channel=stable",
      headers: authed(accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: "1.1.0", changelog: "segunda" });
  });

  it("canal beta não vaza para stable", async () => {
    const { accessToken } = await seedUser("admin7", "admin");
    await publicarRelease(accessToken, { version: "1.0.0", channel: "stable" });
    await publicarRelease(accessToken, { version: "1.2.0", channel: "beta" });
    const res = await app.inject({
      method: "GET",
      url: "/version?channel=stable",
      headers: authed(accessToken),
    });
    expect(res.json()).toMatchObject({ version: "1.0.0" });
  });

  it("404 para canal sem release", async () => {
    const { accessToken } = await seedUser("admin8", "admin");
    await publicarRelease(accessToken, { channel: "stable" });
    const res = await app.inject({
      method: "GET",
      url: "/version?channel=beta",
      headers: authed(accessToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("sem token recebe 401", async () => {
    const res = await app.inject({ method: "GET", url: "/version?channel=stable" });
    expect(res.statusCode).toBe(401);
  });

  it("ordena por publishedAt, não por string de versão", async () => {
    const { accessToken } = await seedUser("admin9", "admin");
    await publicarRelease(accessToken, { version: "1.10.0" });
    await publicarRelease(accessToken, { version: "1.9.0" });
    const res = await app.inject({
      method: "GET",
      url: "/version?channel=stable",
      headers: authed(accessToken),
    });
    expect(res.json()).toMatchObject({ version: "1.9.0" });
  });
});

describe("GET /admin/releases", () => {
  it("admin lista histórico ordenado por publishedAt desc", async () => {
    const { accessToken } = await seedUser("admin10", "admin");
    await publicarRelease(accessToken, { version: "1.0.0" });
    await publicarRelease(accessToken, { version: "1.1.0" });
    const res = await app.inject({
      method: "GET",
      url: "/admin/releases",
      headers: authed(accessToken),
    });
    expect(res.statusCode).toBe(200);
    const releases = res.json();
    expect(releases).toHaveLength(2);
    expect(releases[0].version).toBe("1.1.0");
    expect(releases[1].version).toBe("1.0.0");
  });

  it("user não-admin recebe 403", async () => {
    const { accessToken } = await seedUser("user2", "user");
    const res = await app.inject({
      method: "GET",
      url: "/admin/releases",
      headers: authed(accessToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it("sem token recebe 401", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/releases" });
    expect(res.statusCode).toBe(401);
  });
});
