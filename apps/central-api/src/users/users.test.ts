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

const SENHA_SEED = "pikachu123456";
const SENHA_NOVA = "charmander-forte-2026";

async function limparBanco() {
  await prisma.refreshToken.deleteMany();
  await prisma.account.deleteMany();
  await prisma.release.deleteMany();
  await prisma.user.deleteMany();
}

async function logar(username: string, password: string) {
  return app.inject({ method: "POST", url: "/auth/login", payload: { username, password } });
}

async function seedUser(username: string, role: "admin" | "user") {
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await argon2.hash(SENHA_SEED, { type: argon2.argon2id }),
      role,
    },
  });
  const { accessToken, refreshToken } = (await logar(username, SENHA_SEED)).json();
  return { user, accessToken, refreshToken };
}

function authed(token: string) {
  return { authorization: `Bearer ${token}` };
}

function criar(token: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/admin/users", headers: authed(token), payload });
}

function alterar(token: string, id: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PATCH", url: `/admin/users/${id}`, headers: authed(token), payload });
}

function renovar(refreshToken: string) {
  return app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken } });
}

beforeEach(limparBanco);

afterAll(async () => {
  await limparBanco();
  await app.close();
  await prisma.$disconnect();
});

describe("acesso às rotas /admin/users", () => {
  it("user não-admin recebe 403 em todas as rotas", async () => {
    const { user, accessToken } = await seedUser("comum", "user");
    const listar = await app.inject({ method: "GET", url: "/admin/users", headers: authed(accessToken) });
    const criado = await criar(accessToken, { username: "outro", password: SENHA_NOVA });
    const alterado = await alterar(accessToken, user.id, { role: "admin" });
    expect([listar.statusCode, criado.statusCode, alterado.statusCode]).toEqual([403, 403, 403]);
    expect(await prisma.user.count()).toBe(1);
  });

  it("sem token recebe 401", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/users" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /admin/users", () => {
  it("lista usuários sem passwordHash", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    await seedUser("amigo", "user");
    const res = await app.inject({ method: "GET", url: "/admin/users", headers: authed(accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("passwordHash");
    expect(res.body).not.toContain("$argon2");
    const lista = res.json() as Record<string, unknown>[];
    expect(lista.map((u) => u.username)).toEqual(["admin1", "amigo"]);
    for (const u of lista) {
      expect(Object.keys(u).sort()).toEqual(["active", "createdAt", "id", "role", "username"]);
    }
  });
});

describe("POST /admin/users", () => {
  it("cria usuário com argon2id verificável e login funcionando", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    const res = await criar(accessToken, { username: "amigo.novo_1-x", password: SENHA_NOVA });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain("passwordHash");
    expect(res.json()).toMatchObject({ username: "amigo.novo_1-x", role: "user", active: true });
    const salvo = await prisma.user.findUniqueOrThrow({ where: { username: "amigo.novo_1-x" } });
    expect(salvo.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await argon2.verify(salvo.passwordHash, SENHA_NOVA)).toBe(true);
    expect((await logar("amigo.novo_1-x", SENHA_NOVA)).statusCode).toBe(200);
  });

  it("cria admin quando role é admin", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    const res = await criar(accessToken, { username: "ci-release", password: SENHA_NOVA, role: "admin" });
    expect(res.statusCode).toBe(201);
    expect(res.json().role).toBe("admin");
  });

  it("username duplicado recebe 409", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    await criar(accessToken, { username: "amigo", password: SENHA_NOVA });
    const res = await criar(accessToken, { username: "amigo", password: SENHA_NOVA });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBeTruthy();
  });

  it.each([
    ["username curto", { username: "ab", password: SENHA_NOVA }],
    ["username longo", { username: "a".repeat(65), password: SENHA_NOVA }],
    ["username com caractere inválido", { username: "amigo teste", password: SENHA_NOVA }],
    ["senha curta", { username: "amigo", password: "a".repeat(11) }],
    ["senha longa", { username: "amigo", password: "a".repeat(257) }],
    ["role inválido", { username: "amigo", password: SENHA_NOVA, role: "root" }],
    ["sem senha", { username: "amigo" }],
    ["senha não-string", { username: "amigo", password: 123456789012 }],
  ])("rejeita %s com 400", async (_nome, payload) => {
    const { accessToken } = await seedUser("admin1", "admin");
    const res = await criar(accessToken, payload);
    expect(res.statusCode).toBe(400);
    expect(await prisma.user.count()).toBe(1);
  });

  it("ignora campos fora do schema", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    const res = await criar(accessToken, { username: "amigo", password: SENHA_NOVA, active: false });
    expect(res.statusCode).toBe(201);
    expect(res.json().active).toBe(true);
  });
});

describe("PATCH /admin/users/:id", () => {
  it("404 para usuário inexistente", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    const res = await alterar(accessToken, "00000000-0000-0000-0000-000000000000", { active: false });
    expect(res.statusCode).toBe(404);
  });

  it("rejeita corpo vazio ou com campo inválido com 400", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    const { user } = await seedUser("amigo", "user");
    expect((await alterar(accessToken, user.id, {})).statusCode).toBe(400);
    expect((await alterar(accessToken, user.id, { active: "false" })).statusCode).toBe(400);
    expect((await alterar(accessToken, user.id, { password: "curta" })).statusCode).toBe(400);
    expect((await alterar(accessToken, user.id, { username: "novo" })).statusCode).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).username).toBe("amigo");
  });

  it("desativar revoga refresh tokens e login passa a dar 401", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    const { user, refreshToken } = await seedUser("amigo", "user");
    const res = await alterar(accessToken, user.id, { active: false });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("passwordHash");
    expect(res.json()).toMatchObject({ id: user.id, active: false });
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect((await renovar(refreshToken)).statusCode).toBe(401);
    expect((await logar("amigo", SENHA_SEED)).statusCode).toBe(401);
  });

  it("reativar permite login novamente", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    const { user } = await seedUser("amigo", "user");
    await alterar(accessToken, user.id, { active: false });
    const res = await alterar(accessToken, user.id, { active: true });
    expect(res.json().active).toBe(true);
    expect((await logar("amigo", SENHA_SEED)).statusCode).toBe(200);
  });

  it("redefinir senha revoga refresh tokens e a senha nova funciona", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    const { user, refreshToken } = await seedUser("amigo", "user");
    const res = await alterar(accessToken, user.id, { password: SENHA_NOVA });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(SENHA_NOVA);
    expect((await renovar(refreshToken)).statusCode).toBe(401);
    expect((await logar("amigo", SENHA_SEED)).statusCode).toBe(401);
    expect((await logar("amigo", SENHA_NOVA)).statusCode).toBe(200);
    const salvo = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(salvo.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("trocar papel não revoga refresh tokens", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    const { user, refreshToken } = await seedUser("amigo", "user");
    const res = await alterar(accessToken, user.id, { role: "admin" });
    expect(res.json().role).toBe("admin");
    expect((await renovar(refreshToken)).statusCode).toBe(200);
  });

  it("admin não pode desativar a si mesmo", async () => {
    const { user, accessToken } = await seedUser("admin1", "admin");
    await seedUser("admin2", "admin");
    const res = await alterar(accessToken, user.id, { active: false });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/si mesmo/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).active).toBe(true);
  });

  it("admin não pode rebaixar a si mesmo", async () => {
    const { user, accessToken } = await seedUser("admin1", "admin");
    await seedUser("admin2", "admin");
    const res = await alterar(accessToken, user.id, { role: "user" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/si mesmo/);
  });

  it("admin pode redefinir a própria senha", async () => {
    const { user, accessToken } = await seedUser("admin1", "admin");
    const res = await alterar(accessToken, user.id, { password: SENHA_NOVA });
    expect(res.statusCode).toBe(200);
    expect((await logar("admin1", SENHA_NOVA)).statusCode).toBe(200);
  });

  it("409 ao desativar o último admin ativo", async () => {
    const { user: admin1, accessToken: token1 } = await seedUser("admin1", "admin");
    const { user: admin2, accessToken: token2 } = await seedUser("admin2", "admin");
    expect((await alterar(token2, admin1.id, { active: false })).statusCode).toBe(200);
    const res = await alterar(token1, admin2.id, { active: false });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/administrador ativo/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin2.id } })).active).toBe(true);
  });

  it("409 ao rebaixar o último admin ativo", async () => {
    const { user: admin1, accessToken: token1 } = await seedUser("admin1", "admin");
    const { user: admin2, accessToken: token2 } = await seedUser("admin2", "admin");
    expect((await alterar(token2, admin1.id, { role: "user" })).statusCode).toBe(200);
    const res = await alterar(token1, admin2.id, { role: "user" });
    expect(res.statusCode).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin2.id } })).role).toBe("admin");
  });

  it("admin inativo pode ser rebaixado mesmo restando um único admin ativo", async () => {
    const { accessToken } = await seedUser("admin1", "admin");
    const { user: admin2 } = await seedUser("admin2", "admin");
    expect((await alterar(accessToken, admin2.id, { active: false })).statusCode).toBe(200);
    expect((await alterar(accessToken, admin2.id, { role: "user" })).statusCode).toBe(200);
  });
});

describe("GET /auth/me", () => {
  it("retorna id, username e role do usuário autenticado", async () => {
    const { user, accessToken } = await seedUser("amigo", "user");
    const res = await app.inject({ method: "GET", url: "/auth/me", headers: authed(accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: user.id, username: "amigo", role: "user" });
  });

  it("sem token recebe 401", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/me" });
    expect(res.statusCode).toBe(401);
  });

  it("usuário desativado recebe 401", async () => {
    const { user, accessToken } = await seedUser("amigo", "user");
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });
    const res = await app.inject({ method: "GET", url: "/auth/me", headers: authed(accessToken) });
    expect(res.statusCode).toBe(401);
  });
});
