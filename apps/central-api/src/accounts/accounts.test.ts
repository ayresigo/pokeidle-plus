import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import jwt from "jsonwebtoken";

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

async function seedUser(username: string) {
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await argon2.hash("pikachu123", { type: argon2.argon2id }),
      role: "admin",
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

const CONTA_BASE = {
  label: "conta principal",
  pokeidleUser: "treinador01",
  pokeidlePass: "senha-super-secreta",
};

async function criarConta(token: string, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/accounts",
    headers: authed(token),
    payload: { ...CONTA_BASE, ...overrides },
  });
}

describe("accounts", () => {
  beforeEach(limparBanco);

  afterAll(async () => {
    await limparBanco();
    await app.close();
    await prisma.$disconnect();
  });

  describe("autenticação", () => {
    it("GET /accounts sem token retorna 401", async () => {
      const res = await app.inject({ method: "GET", url: "/accounts" });
      expect(res.statusCode).toBe(401);
    });

    it("GET /accounts com token inválido retorna 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/accounts",
        headers: authed("token-lixo"),
      });
      expect(res.statusCode).toBe(401);
    });

    it("GET /accounts com token expirado retorna 401", async () => {
      const expirado = jwt.sign({}, process.env.JWT_SECRET!, {
        subject: "qualquer",
        expiresIn: -10,
      });
      const res = await app.inject({
        method: "GET",
        url: "/accounts",
        headers: authed(expirado),
      });
      expect(res.statusCode).toBe(401);
    });

    it("POST /accounts sem token retorna 401", async () => {
      const res = await app.inject({ method: "POST", url: "/accounts", payload: CONTA_BASE });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /accounts", () => {
    it("cria conta com segredos criptografados e resposta sem segredos", async () => {
      const { accessToken } = await seedUser("ash");
      const res = await criarConta(accessToken, {
        proxyUrl: "socks5://127.0.0.1:9050",
        solverKey: "chave-solver",
        accessToken: "tok-pokeidle",
        refreshToken: "ref-pokeidle",
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeTypeOf("string");
      expect(body.label).toBe(CONTA_BASE.label);
      expect(body.pokeidleUser).toBe(CONTA_BASE.pokeidleUser);
      expect(body.proxyUrl).toBe("socks5://127.0.0.1:9050");
      const serializado = JSON.stringify(body);
      for (const segredo of ["senha-super-secreta", "chave-solver", "tok-pokeidle", "ref-pokeidle"]) {
        expect(serializado).not.toContain(segredo);
      }
      for (const campo of Object.keys(body)) {
        expect(campo.endsWith("Enc")).toBe(false);
        expect(["pokeidlePass", "solverKey", "accessToken", "refreshToken"]).not.toContain(campo);
      }

      const salvo = await prisma.account.findUniqueOrThrow({ where: { id: body.id } });
      expect(Buffer.from(salvo.pokeidlePassEnc).toString("utf8")).not.toContain("senha-super-secreta");
      expect(Buffer.from(salvo.solverKeyEnc!).toString("utf8")).not.toContain("chave-solver");
      expect(Buffer.from(salvo.accessTokenEnc!).toString("utf8")).not.toContain("tok-pokeidle");
      expect(Buffer.from(salvo.refreshTokenEnc!).toString("utf8")).not.toContain("ref-pokeidle");
    });

    it("campos opcionais ausentes ficam null no banco", async () => {
      const { accessToken } = await seedUser("ash");
      const res = await criarConta(accessToken);
      expect(res.statusCode).toBe(201);
      const salvo = await prisma.account.findUniqueOrThrow({ where: { id: res.json().id } });
      expect(salvo.proxyUrl).toBeNull();
      expect(salvo.solverKeyEnc).toBeNull();
      expect(salvo.accessTokenEnc).toBeNull();
      expect(salvo.refreshTokenEnc).toBeNull();
    });

    it("proxyUrl com esquema inválido retorna 400", async () => {
      const { accessToken } = await seedUser("ash");
      const res = await criarConta(accessToken, { proxyUrl: "ftp://proxy:21" });
      expect(res.statusCode).toBe(400);
    });

    it("body sem pokeidlePass retorna 400", async () => {
      const { accessToken } = await seedUser("ash");
      const res = await app.inject({
        method: "POST",
        url: "/accounts",
        headers: authed(accessToken),
        payload: { label: "x", pokeidleUser: "y" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /accounts", () => {
    it("lista somente as contas do usuário autenticado", async () => {
      const ash = await seedUser("ash");
      const misty = await seedUser("misty");
      await criarConta(ash.accessToken, { label: "conta do ash" });
      await criarConta(ash.accessToken, { label: "segunda do ash" });
      await criarConta(misty.accessToken, { label: "conta da misty" });

      const res = await app.inject({
        method: "GET",
        url: "/accounts",
        headers: authed(ash.accessToken),
      });
      expect(res.statusCode).toBe(200);
      const lista = res.json();
      expect(lista).toHaveLength(2);
      const labels = lista.map((c: { label: string }) => c.label).sort();
      expect(labels).toEqual(["conta do ash", "segunda do ash"]);
      for (const conta of lista) {
        for (const campo of Object.keys(conta)) {
          expect(campo.endsWith("Enc")).toBe(false);
          expect(["pokeidlePass", "solverKey", "accessToken", "refreshToken"]).not.toContain(campo);
        }
      }
    });

    it("lista vazia quando usuário não tem contas", async () => {
      const { accessToken } = await seedUser("ash");
      const res = await app.inject({
        method: "GET",
        url: "/accounts",
        headers: authed(accessToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe("GET /accounts/:id/credentials", () => {
    it("retorna segredos descriptografados", async () => {
      const { accessToken } = await seedUser("ash");
      const criada = await criarConta(accessToken, {
        proxyUrl: "http://proxy:8080",
        solverKey: "chave-solver",
        accessToken: "tok-pokeidle",
        refreshToken: "ref-pokeidle",
      });
      const id = criada.json().id;
      const res = await app.inject({
        method: "GET",
        url: `/accounts/${id}/credentials`,
        headers: authed(accessToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        pokeidleUser: CONTA_BASE.pokeidleUser,
        pokeidlePass: "senha-super-secreta",
        accessToken: "tok-pokeidle",
        refreshToken: "ref-pokeidle",
        solverKey: "chave-solver",
        proxyUrl: "http://proxy:8080",
        huntSlug: null,
      });
    });

    it("segredos ausentes retornam null", async () => {
      const { accessToken } = await seedUser("ash");
      const criada = await criarConta(accessToken);
      const res = await app.inject({
        method: "GET",
        url: `/accounts/${criada.json().id}/credentials`,
        headers: authed(accessToken),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        pokeidleUser: CONTA_BASE.pokeidleUser,
        pokeidlePass: "senha-super-secreta",
        accessToken: null,
        refreshToken: null,
        solverKey: null,
        proxyUrl: null,
        huntSlug: null,
      });
    });
  });

  describe("huntSlug", () => {
    it("cria, atualiza e lê huntSlug sem criptografar", async () => {
      const { accessToken } = await seedUser("ash");
      const criada = await criarConta(accessToken, { huntSlug: "bellsprout" });
      expect(criada.statusCode).toBe(201);
      expect(criada.json().huntSlug).toBe("bellsprout");
      const id = criada.json().id;

      const salvo = await prisma.account.findUniqueOrThrow({ where: { id } });
      expect(salvo.huntSlug).toBe("bellsprout");

      const creds = await app.inject({
        method: "GET",
        url: `/accounts/${id}/credentials`,
        headers: authed(accessToken),
      });
      expect(creds.json().huntSlug).toBe("bellsprout");

      const patch = await app.inject({
        method: "PATCH",
        url: `/accounts/${id}`,
        headers: authed(accessToken),
        payload: { huntSlug: "oddish" },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().huntSlug).toBe("oddish");
      const atualizado = await prisma.account.findUniqueOrThrow({ where: { id } });
      expect(atualizado.huntSlug).toBe("oddish");
    });

    it("ausente fica null e não está entre campos criptografados", async () => {
      const { accessToken } = await seedUser("ash");
      const criada = await criarConta(accessToken);
      const salvo = await prisma.account.findUniqueOrThrow({ where: { id: criada.json().id } });
      expect(salvo.huntSlug).toBeNull();
      expect(Object.keys(salvo)).not.toContain("huntSlugEnc");
    });
  });

  describe("PATCH /accounts/:id", () => {
    it("atualiza label e recriptografa segredos enviados", async () => {
      const { accessToken } = await seedUser("ash");
      const criada = await criarConta(accessToken);
      const id = criada.json().id;
      const res = await app.inject({
        method: "PATCH",
        url: `/accounts/${id}`,
        headers: authed(accessToken),
        payload: { label: "renomeada", pokeidlePass: "nova-senha", solverKey: "nova-chave" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().label).toBe("renomeada");
      expect(JSON.stringify(res.json())).not.toContain("nova-senha");

      const salvo = await prisma.account.findUniqueOrThrow({ where: { id } });
      expect(Buffer.from(salvo.pokeidlePassEnc).toString("utf8")).not.toContain("nova-senha");
      expect(Buffer.from(salvo.solverKeyEnc!).toString("utf8")).not.toContain("nova-chave");

      const creds = await app.inject({
        method: "GET",
        url: `/accounts/${id}/credentials`,
        headers: authed(accessToken),
      });
      expect(creds.json().pokeidlePass).toBe("nova-senha");
      expect(creds.json().solverKey).toBe("nova-chave");
      expect(creds.json().accessToken).toBeNull();
    });

    it("PATCH vazio não altera nada", async () => {
      const { accessToken } = await seedUser("ash");
      const criada = await criarConta(accessToken);
      const id = criada.json().id;
      const res = await app.inject({
        method: "PATCH",
        url: `/accounts/${id}`,
        headers: authed(accessToken),
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const creds = await app.inject({
        method: "GET",
        url: `/accounts/${id}/credentials`,
        headers: authed(accessToken),
      });
      expect(creds.json().pokeidlePass).toBe("senha-super-secreta");
    });
  });

  describe("PUT /accounts/:id/tokens", () => {
    it("atualiza tokens criptografados no banco", async () => {
      const { accessToken } = await seedUser("ash");
      const criada = await criarConta(accessToken, {
        accessToken: "tok-antigo",
        refreshToken: "ref-antigo",
      });
      const id = criada.json().id;
      const res = await app.inject({
        method: "PUT",
        url: `/accounts/${id}/tokens`,
        headers: authed(accessToken),
        payload: { accessToken: "tok-novo", refreshToken: "ref-novo" },
      });
      expect(res.statusCode).toBe(204);

      const salvo = await prisma.account.findUniqueOrThrow({ where: { id } });
      expect(salvo.accessTokenEnc).not.toBeNull();
      expect(salvo.refreshTokenEnc).not.toBeNull();
      expect(Buffer.from(salvo.accessTokenEnc!).toString("utf8")).not.toContain("tok-novo");
      expect(Buffer.from(salvo.refreshTokenEnc!).toString("utf8")).not.toContain("ref-novo");

      const creds = await app.inject({
        method: "GET",
        url: `/accounts/${id}/credentials`,
        headers: authed(accessToken),
      });
      expect(creds.json().accessToken).toBe("tok-novo");
      expect(creds.json().refreshToken).toBe("ref-novo");
    });

    it("body incompleto retorna 400", async () => {
      const { accessToken } = await seedUser("ash");
      const criada = await criarConta(accessToken);
      const res = await app.inject({
        method: "PUT",
        url: `/accounts/${criada.json().id}/tokens`,
        headers: authed(accessToken),
        payload: { accessToken: "tok" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("DELETE /accounts/:id", () => {
    it("remove a conta", async () => {
      const { accessToken } = await seedUser("ash");
      const criada = await criarConta(accessToken);
      const id = criada.json().id;
      const res = await app.inject({
        method: "DELETE",
        url: `/accounts/${id}`,
        headers: authed(accessToken),
      });
      expect(res.statusCode).toBe(204);
      expect(await prisma.account.findUnique({ where: { id } })).toBeNull();
    });
  });

  describe("isolamento multi-tenant", () => {
    it("PATCH/DELETE/credentials/tokens em conta de outro user retornam 404", async () => {
      const ash = await seedUser("ash");
      const misty = await seedUser("misty");
      const criada = await criarConta(ash.accessToken);
      const id = criada.json().id;

      const patch = await app.inject({
        method: "PATCH",
        url: `/accounts/${id}`,
        headers: authed(misty.accessToken),
        payload: { label: "roubada" },
      });
      expect(patch.statusCode).toBe(404);

      const del = await app.inject({
        method: "DELETE",
        url: `/accounts/${id}`,
        headers: authed(misty.accessToken),
      });
      expect(del.statusCode).toBe(404);

      const creds = await app.inject({
        method: "GET",
        url: `/accounts/${id}/credentials`,
        headers: authed(misty.accessToken),
      });
      expect(creds.statusCode).toBe(404);

      const tokens = await app.inject({
        method: "PUT",
        url: `/accounts/${id}/tokens`,
        headers: authed(misty.accessToken),
        payload: { accessToken: "a", refreshToken: "b" },
      });
      expect(tokens.statusCode).toBe(404);

      const intacta = await prisma.account.findUniqueOrThrow({ where: { id } });
      expect(intacta.label).toBe(CONTA_BASE.label);
    });

    it("id inexistente retorna 404", async () => {
      const { accessToken } = await seedUser("ash");
      const res = await app.inject({
        method: "GET",
        url: "/accounts/00000000-0000-0000-0000-000000000000/credentials",
        headers: authed(accessToken),
      });
      expect(res.statusCode).toBe(404);
    });

    it("PATCH em conta já deletada retorna 404 sem erro 500", async () => {
      const { accessToken } = await seedUser("ash");
      const criada = await criarConta(accessToken);
      const id = criada.json().id;
      await app.inject({ method: "DELETE", url: `/accounts/${id}`, headers: authed(accessToken) });

      const patch = await app.inject({
        method: "PATCH",
        url: `/accounts/${id}`,
        headers: authed(accessToken),
        payload: { label: "tarde demais" },
      });
      expect(patch.statusCode).toBe(404);

      const tokens = await app.inject({
        method: "PUT",
        url: `/accounts/${id}/tokens`,
        headers: authed(accessToken),
        payload: { accessToken: "a", refreshToken: "b" },
      });
      expect(tokens.statusCode).toBe(404);
    });

    it("credentials com bytes corrompidos retorna 500 com erro legível", async () => {
      const { accessToken } = await seedUser("ash");
      const criada = await criarConta(accessToken);
      const id = criada.json().id;
      await prisma.account.update({
        where: { id },
        data: { pokeidlePassEnc: Buffer.from("bytes-corrompidos-sem-formato") },
      });

      const res = await app.inject({
        method: "GET",
        url: `/accounts/${id}/credentials`,
        headers: authed(accessToken),
      });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: "credenciais ilegíveis" });
    });

    it("campos acima do maxLength retornam 400", async () => {
      const { accessToken } = await seedUser("ash");
      const res = await criarConta(accessToken, {
        label: "x".repeat(129),
        pokeidlePass: "y".repeat(257),
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
