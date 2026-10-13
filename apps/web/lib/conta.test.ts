import { describe, expect, it } from "vitest";
import type { Account } from "./api";
import {
  VALORES_VAZIOS,
  corpoCriacao,
  corpoEdicao,
  extrairTokens,
  tokensPreenchidos,
  validarConta,
  validarProxyUrl,
  type ValoresConta,
} from "./conta";

const validos: ValoresConta = { ...VALORES_VAZIOS, label: "Principal", pokeidleUser: "ash", pokeidlePass: "pikachu" };

const conta: Account = {
  id: "a1",
  label: "Principal",
  pokeidleUser: "ash",
  proxyUrl: "http://proxy:8080",
  huntSlug: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

describe("validarConta", () => {
  it("aceita o mínimo na criação", () => {
    expect(validarConta(validos, { modo: "criar" })).toEqual({});
  });

  it("exige label, usuário e senha na criação", () => {
    expect(validarConta({ ...VALORES_VAZIOS, label: "  " }, { modo: "criar" })).toEqual({
      label: "obrigatório",
      pokeidleUser: "obrigatório",
      pokeidlePass: "obrigatório",
    });
  });

  it("senha vazia na edição significa não alterar", () => {
    expect(validarConta({ ...validos, pokeidlePass: "" }, { modo: "editar", proxyAtual: null })).toEqual({});
  });

  it("aplica os limites do central por campo", () => {
    const erros = validarConta(
      {
        ...validos,
        label: "x".repeat(129),
        pokeidleUser: "u".repeat(129),
        pokeidlePass: "p".repeat(257),
        proxyUrl: `http://${"h".repeat(510)}`,
        solverKey: "s".repeat(2049),
        accessToken: "a".repeat(2049),
        refreshToken: "r".repeat(2049),
      },
      { modo: "criar" },
    );
    expect(erros).toEqual({
      label: "máximo de 128 caracteres",
      pokeidleUser: "máximo de 128 caracteres",
      pokeidlePass: "máximo de 256 caracteres",
      proxyUrl: "máximo de 512 caracteres",
      solverKey: "máximo de 2048 caracteres",
      accessToken: "máximo de 2048 caracteres",
      refreshToken: "máximo de 2048 caracteres",
    });
  });

  it("aceita no limite exato", () => {
    expect(validarConta({ ...validos, label: "x".repeat(128), pokeidlePass: "p".repeat(256) }, { modo: "criar" })).toEqual({});
  });

  it("valida o formato do proxy", () => {
    expect(validarConta({ ...validos, proxyUrl: "ftp://host" }, { modo: "criar" }).proxyUrl).toMatch(/http:\/\/, https:\/\/ ou socks5:\/\//);
    expect(validarConta({ ...validos, proxyUrl: "socks5://u:p@host:1080" }, { modo: "criar" })).toEqual({});
    expect(validarProxyUrl("http://host com espaço")).not.toBeNull();
    expect(validarProxyUrl("https://host:3128")).toBeNull();
  });

  it("não permite apagar o proxy na edição", () => {
    expect(validarConta({ ...validos, proxyUrl: "" }, { modo: "editar", proxyAtual: "http://proxy:8080" }).proxyUrl).toMatch(/não permite remover/);
    expect(validarConta({ ...validos, proxyUrl: "" }, { modo: "editar", proxyAtual: null })).toEqual({});
  });

  it("exige os dois tokens juntos", () => {
    expect(validarConta({ ...validos, accessToken: "a" }, { modo: "criar" })).toEqual({ refreshToken: "informe também o refreshToken" });
    expect(validarConta({ ...validos, refreshToken: "r" }, { modo: "criar" })).toEqual({ accessToken: "informe também o accessToken" });
  });
});

describe("corpoCriacao", () => {
  it("envia só os opcionais preenchidos, com trim", () => {
    expect(corpoCriacao({ ...validos, label: " Principal ", proxyUrl: "  ", solverKey: "" })).toEqual({
      label: "Principal",
      pokeidleUser: "ash",
      pokeidlePass: "pikachu",
    });
    expect(
      corpoCriacao({ ...validos, proxyUrl: "http://p:1", solverKey: " k ", accessToken: " a ", refreshToken: "r" }),
    ).toEqual({
      label: "Principal",
      pokeidleUser: "ash",
      pokeidlePass: "pikachu",
      proxyUrl: "http://p:1",
      solverKey: "k",
      accessToken: "a",
      refreshToken: "r",
    });
  });
});

describe("corpoEdicao", () => {
  const sem = { ...VALORES_VAZIOS, label: conta.label, pokeidleUser: conta.pokeidleUser, proxyUrl: conta.proxyUrl ?? "" };

  it("sem mudanças gera patch vazio", () => {
    expect(corpoEdicao(sem, conta)).toEqual({});
  });

  it("envia só campos alterados e segredos preenchidos, nunca tokens", () => {
    expect(
      corpoEdicao({ ...sem, label: "Nova", proxyUrl: "socks5://q:2", pokeidlePass: "nova", solverKey: "k", accessToken: "a", refreshToken: "r" }, conta),
    ).toEqual({ label: "Nova", proxyUrl: "socks5://q:2", pokeidlePass: "nova", solverKey: "k" });
  });

  it("envia huntSlug quando muda e omite quando igual ao atual", () => {
    expect(corpoEdicao({ ...sem, huntSlug: "bellsprout" }, conta)).toEqual({ huntSlug: "bellsprout" });
    expect(corpoEdicao({ ...sem, huntSlug: "" }, { ...conta, huntSlug: "bellsprout" })).toEqual({ huntSlug: "" });
    expect(corpoEdicao({ ...sem, huntSlug: "oddish" }, { ...conta, huntSlug: "oddish" })).toEqual({});
  });
});

describe("tokensPreenchidos", () => {
  it("só retorna com os dois tokens", () => {
    expect(tokensPreenchidos({ ...VALORES_VAZIOS, accessToken: " a ", refreshToken: "r" })).toEqual({ accessToken: "a", refreshToken: "r" });
    expect(tokensPreenchidos({ ...VALORES_VAZIOS, accessToken: "a" })).toBeNull();
  });
});

describe("extrairTokens", () => {
  const esperado = { ok: true, tokens: { accessToken: "aaa.bbb.ccc", refreshToken: "rrr" } };

  it("aceita o token único e preenche os dois campos", () => {
    expect(extrairTokens("aaa.bbb.ccc")).toEqual({
      ok: true,
      tokens: { accessToken: "aaa.bbb.ccc", refreshToken: "aaa.bbb.ccc" },
    });
  });

  it("tira espaços e aspas do token único", () => {
    expect(extrairTokens('  "aaa.bbb.ccc" \n')).toEqual({
      ok: true,
      tokens: { accessToken: "aaa.bbb.ccc", refreshToken: "aaa.bbb.ccc" },
    });
  });

  it("aceita o JSON antigo por compatibilidade", () => {
    expect(extrairTokens('{"accessToken":"aaa.bbb.ccc","refreshToken":"rrr"}')).toEqual(esperado);
  });

  it("aceita o JSON antigo com aspas simples do console", () => {
    expect(extrairTokens(`  '{"accessToken":"aaa.bbb.ccc","refreshToken":"rrr"}'\n`)).toEqual(esperado);
  });

  it("aceita o JSON antigo escapado", () => {
    expect(extrairTokens(JSON.stringify('{"accessToken":"aaa.bbb.ccc","refreshToken":"rrr"}'))).toEqual(esperado);
  });

  it("ignora chaves extras do JSON antigo", () => {
    expect(extrairTokens('{"accessToken":"aaa.bbb.ccc","refreshToken":"rrr","user":{"id":1}}')).toEqual(esperado);
  });

  it("dá erro claro para entrada vazia", () => {
    expect(extrairTokens("")).toEqual({ ok: false, erro: "cole o token do pokeidle.io" });
    expect(extrairTokens("   \n")).toEqual({ ok: false, erro: "cole o token do pokeidle.io" });
  });

  it("cobra os dois campos quando o JSON antigo vem incompleto", () => {
    expect(extrairTokens('{"accessToken":"a"}')).toEqual({ ok: false, erro: "refreshToken ausente no JSON colado" });
    expect(extrairTokens('{"refreshToken":"r"}')).toEqual({ ok: false, erro: "accessToken ausente no JSON colado" });
  });
});
