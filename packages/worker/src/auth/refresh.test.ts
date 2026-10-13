import { describe, expect, it } from "vitest";
import { criarJwt } from "./__fixtures__/jwt.js";
import { RefreshNaoSuportadoError, lerExpiracao, renovarTokens } from "./refresh.js";

describe("lerExpiracao", () => {
  it("lê o exp do payload do JWT em milissegundos", () => {
    expect(lerExpiracao(criarJwt(1_800_000_000))).toBe(1_800_000_000_000);
  });

  it.each(["nao-e-jwt", "a.b.c", `x.${Buffer.from('{"sub":"s"}').toString("base64url")}.y`])(
    "retorna null para %s",
    (token) => {
      expect(lerExpiracao(token)).toBeNull();
    },
  );

  it("retorna null para o token opaco de duas partes do pokeidle", () => {
    expect(lerExpiracao(`${"a".repeat(76)}.${"b".repeat(75)}`)).toBeNull();
  });
});

describe("renovarTokens", () => {
  it("rejeita com RefreshNaoSuportadoError porque pokeidle não tem refresh", async () => {
    await expect(renovarTokens()).rejects.toBeInstanceOf(RefreshNaoSuportadoError);
  });
});
