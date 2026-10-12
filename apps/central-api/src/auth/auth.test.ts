import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";

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

async function seedUser(opts?: { active?: boolean }) {
  return prisma.user.create({
    data: {
      username: "ash",
      passwordHash: await argon2.hash("pikachu123", { type: argon2.argon2id }),
      role: "admin",
      active: opts?.active ?? true,
    },
  });
}

async function login(username = "ash", password = "pikachu123") {
  return app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username, password },
  });
}

describe("auth", () => {
  beforeEach(limparBanco);

  afterAll(async () => {
    await limparBanco();
    await prisma.$disconnect();
    await app.close();
  });

  it("login com user seedado retorna par de tokens", async () => {
    const user = await seedUser();
    const res = await login();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
    expect(body.passwordHash).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(user.passwordHash);

    const payload = jwt.verify(body.accessToken, process.env.JWT_SECRET!) as jwt.JwtPayload;
    expect(payload.sub).toBe(user.id);
    expect(payload.role).toBe("admin");
    expect(payload.exp! - payload.iat!).toBe(15 * 60);

    const tokenHash = createHash("sha256").update(body.refreshToken).digest("hex");
    const salvo = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    expect(salvo).not.toBeNull();
    expect(salvo!.userId).toBe(user.id);
    expect(salvo!.revokedAt).toBeNull();
    expect(salvo!.expiresAt.getTime() - salvo!.createdAt.getTime()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
  });

  it("senha errada retorna 401 genérico", async () => {
    await seedUser();
    const res = await login("ash", "senha-errada");

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "credenciais inválidas" });
  });

  it("user inativo retorna 401 idêntico ao de senha errada", async () => {
    await seedUser({ active: false });
    const res = await login();

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "credenciais inválidas" });
  });

  it("refresh rotaciona e revoga o token antigo", async () => {
    await seedUser();
    const loginRes = await login();
    const { refreshToken } = loginRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");
    expect(body.refreshToken).not.toBe(refreshToken);

    const hashAntigo = createHash("sha256").update(refreshToken).digest("hex");
    const antigo = await prisma.refreshToken.findUnique({ where: { tokenHash: hashAntigo } });
    expect(antigo!.revokedAt).not.toBeNull();
  });

  it("refresh revogado retorna 401", async () => {
    await seedUser();
    const loginRes = await login();
    const { refreshToken } = loginRes.json();

    await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refresh inexistente retorna 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: "0".repeat(64) },
    });
    expect(res.statusCode).toBe(401);
  });

  it("corrida de refresh com o mesmo token: exatamente um sucesso", async () => {
    await seedUser();
    const loginRes = await login();
    const { refreshToken } = loginRes.json();

    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } }),
      app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } }),
    ]);

    const status = [a.statusCode, b.statusCode].sort();
    expect(status).toEqual([200, 401]);
  });

  it("refresh expirado mas não revogado retorna 401", async () => {
    await seedUser();
    const loginRes = await login();
    const { refreshToken } = loginRes.json();

    const hash = createHash("sha256").update(refreshToken).digest("hex");
    await prisma.refreshToken.update({
      where: { tokenHash: hash },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refresh de user desativado após emissão retorna 401", async () => {
    const user = await seedUser();
    const loginRes = await login();
    const { refreshToken } = loginRes.json();

    await prisma.user.update({ where: { id: user.id }, data: { active: false } });

    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(401);
  });

  it("login com username não-string retorna 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: 123, password: "pikachu123" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refresh com refreshToken não-string retorna 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: 123 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("buildApp lança se JWT_SECRET ausente", async () => {
    const secret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    vi.resetModules();
    try {
      const modulo = await import("../app.js");
      expect(() => modulo.buildApp()).toThrow(/JWT_SECRET/);
    } finally {
      process.env.JWT_SECRET = secret;
      vi.resetModules();
    }
  });

  it("buildApp lança se JWT_SECRET tem menos de 32 caracteres", () => {
    const secret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "a".repeat(31);
    try {
      expect(() => buildApp()).toThrow(/JWT_SECRET.*32/);
    } finally {
      process.env.JWT_SECRET = secret;
    }
  });

  it("executa argon2.verify também para user inexistente", async () => {
    const spy = vi.spyOn(argon2, "verify");
    try {
      const res = await login("nao-existe", "qualquer");
      expect(res.statusCode).toBe(401);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("executa argon2.verify também para user inativo", async () => {
    await seedUser({ active: false });
    const spy = vi.spyOn(argon2, "verify");
    try {
      const res = await login();
      expect(res.statusCode).toBe(401);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("logout revoga o refresh token", async () => {
    await seedUser();
    const loginRes = await login();
    const { refreshToken } = loginRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(204);

    const hash = createHash("sha256").update(refreshToken).digest("hex");
    const salvo = await prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    expect(salvo!.revokedAt).not.toBeNull();

    const resRefresh = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken },
    });
    expect(resRefresh.statusCode).toBe(401);
  });
});
