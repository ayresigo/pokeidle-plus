import { describe, it, expect } from "vitest";

process.env.JWT_SECRET ??= "segredo-teste-root-com-32-caracteres-no-minimo";
process.env.SECRETS_KEY ??= "0".repeat(64);

import { buildApp } from "../app.js";

describe("página raiz", () => {
  it("GET / retorna 200 com HTML útil em PT-BR", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);

    const corpo = res.body;
    expect(corpo).toContain('lang="pt-BR"');
    expect(corpo).toContain("PokeIdle Plus");
    expect(corpo).toContain("https://github.com/ayresigo/pokeidle-plus");
    expect(corpo.toLowerCase()).toContain("docker compose");
  });

  it("GET / não expõe dados sensíveis", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/" });

    const corpo = res.body.toLowerCase();
    for (const marcador of [
      "passwordhash",
      "imagedigest",
      "refreshtoken",
      "jwt_secret",
      "secrets_key",
      "database_url",
    ]) {
      expect(corpo).not.toContain(marcador);
    }
  });

  it("rota desconhecida continua retornando 404", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/rota-inexistente" });
    expect(res.statusCode).toBe(404);
  });
});
