import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALFABETO_SENHA,
  TAMANHO_SENHA_GERADA,
  gerarSenhaForte,
  validarNovoUsuario,
  validarSenha,
  validarUsername,
} from "./usuario";

describe("validarUsername", () => {
  it.each(["abc", "amigo-teste", "ci-release", "a.b_c-1", "A".repeat(64)])("aceita %s", (username) => {
    expect(validarUsername(username)).toBeNull();
  });

  it("exige preenchimento", () => {
    expect(validarUsername("")).toBe("obrigatório");
  });

  it("exige ao menos 3 caracteres", () => {
    expect(validarUsername("ab")).toBe("mínimo de 3 caracteres");
  });

  it("limita a 64 caracteres", () => {
    expect(validarUsername("a".repeat(65))).toBe("máximo de 64 caracteres");
  });

  it.each(["amigo teste", "amigo@x", "joão", "a/b"])("recusa caracteres fora de [a-zA-Z0-9._-] em %s", (username) => {
    expect(validarUsername(username)).toBe("use apenas letras sem acento, números, ponto, hífen ou sublinhado");
  });
});

describe("validarSenha", () => {
  it("aceita de 12 a 256 caracteres", () => {
    expect(validarSenha("a".repeat(12))).toBeNull();
    expect(validarSenha("a".repeat(256))).toBeNull();
  });

  it("exige preenchimento", () => {
    expect(validarSenha("")).toBe("obrigatório");
  });

  it("recusa menos de 12 caracteres", () => {
    expect(validarSenha("a".repeat(11))).toBe("mínimo de 12 caracteres");
  });

  it("recusa mais de 256 caracteres", () => {
    expect(validarSenha("a".repeat(257))).toBe("máximo de 256 caracteres");
  });

  it("conta caracteres como o backend (code points, não unidades UTF-16)", () => {
    expect(validarSenha("🔒".repeat(12))).toBeNull();
    expect(validarSenha("🔒".repeat(129))).toBeNull();
    expect(validarSenha("🔒".repeat(11))).toBe("mínimo de 12 caracteres");
  });
});

describe("validarNovoUsuario", () => {
  it("sem erros para dados válidos", () => {
    expect(validarNovoUsuario({ username: "amigo-teste", password: "senha-bem-forte" })).toEqual({});
  });

  it("reúne os erros por campo", () => {
    expect(validarNovoUsuario({ username: "a b", password: "curta" })).toEqual({
      username: "use apenas letras sem acento, números, ponto, hífen ou sublinhado",
      password: "mínimo de 12 caracteres",
    });
  });
});

describe("gerarSenhaForte", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gera 20 caracteres do alfabeto e passa na validação", () => {
    const senha = gerarSenhaForte();
    expect(TAMANHO_SENHA_GERADA).toBe(20);
    expect(senha).toHaveLength(20);
    for (const caractere of senha) expect(ALFABETO_SENHA).toContain(caractere);
    expect(validarSenha(senha)).toBeNull();
  });

  it("usa crypto.getRandomValues", () => {
    const espiao = vi.spyOn(globalThis.crypto, "getRandomValues");
    gerarSenhaForte();
    expect(espiao).toHaveBeenCalled();
  });

  it("gera senhas diferentes a cada chamada", () => {
    const senhas = new Set(Array.from({ length: 50 }, () => gerarSenhaForte()));
    expect(senhas.size).toBe(50);
  });

  it("descarta bytes que causariam viés no módulo", () => {
    const limite = 256 - (256 % ALFABETO_SENHA.length);
    const lotes = [new Uint8Array(20).fill(255), new Uint8Array(20).fill(limite), new Uint8Array(20).fill(1)];
    const fonte = vi.fn(() => lotes.shift() ?? new Uint8Array(20));
    expect(gerarSenhaForte(fonte)).toBe(ALFABETO_SENHA[1].repeat(20));
    expect(fonte).toHaveBeenCalledTimes(3);
  });

  it("alfabeto não tem caracteres repetidos", () => {
    expect(new Set(ALFABETO_SENHA).size).toBe(ALFABETO_SENHA.length);
  });
});
