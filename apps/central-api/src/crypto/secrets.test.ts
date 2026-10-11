import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDecipheriv, randomBytes } from "node:crypto";

const CHAVE_VALIDA = randomBytes(32).toString("hex");
const OUTRA_CHAVE = randomBytes(32).toString("hex");

let segredoOriginal: string | undefined;

beforeEach(() => {
  segredoOriginal = process.env.SECRETS_KEY;
  process.env.SECRETS_KEY = CHAVE_VALIDA;
});

afterEach(() => {
  if (segredoOriginal === undefined) {
    delete process.env.SECRETS_KEY;
  } else {
    process.env.SECRETS_KEY = segredoOriginal;
  }
});

async function carregarModulo() {
  return import("./secrets.js");
}

describe("secrets (AES-256-GCM)", () => {
  it("roundtrip: decrypt(encrypt(x)) retorna x", async () => {
    const { encrypt, decrypt } = await carregarModulo();
    const plain = "senha-super-secreta-do-pokeidle";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("payload segue formato nonce(12) || ciphertext || tag(16)", async () => {
    const { encrypt } = await carregarModulo();
    const plain = "abc";
    const payload = encrypt(plain);
    expect(payload.length).toBe(12 + plain.length + 16);
  });

  it("dois encrypts do mesmo plaintext geram payloads diferentes", async () => {
    const { encrypt } = await carregarModulo();
    const a = encrypt("mesmo-texto");
    const b = encrypt("mesmo-texto");
    expect(a.equals(b)).toBe(false);
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
  });

  it("decrypt com chave errada lança", async () => {
    const { encrypt } = await carregarModulo();
    const payload = encrypt("segredo");
    process.env.SECRETS_KEY = OUTRA_CHAVE;
    const { decrypt } = await carregarModulo();
    expect(() => decrypt(payload)).toThrow();
  });

  it("payload truncado lança", async () => {
    const { encrypt, decrypt } = await carregarModulo();
    const payload = encrypt("texto-qualquer");
    expect(() => decrypt(payload.subarray(0, payload.length - 1))).toThrow();
    expect(() => decrypt(payload.subarray(0, 20))).toThrow();
  });

  it("payload corrompido lança", async () => {
    const { encrypt, decrypt } = await carregarModulo();
    const payload = encrypt("texto-qualquer");
    const corrompido = Buffer.from(payload);
    corrompido[15] = corrompido[15] ^ 0xff;
    expect(() => decrypt(corrompido)).toThrow();
  });

  it("chave com tamanho errado lança com mensagem clara", async () => {
    process.env.SECRETS_KEY = randomBytes(16).toString("hex");
    const { initSecrets } = await carregarModulo();
    expect(() => initSecrets()).toThrow(/SECRETS_KEY.*32/i);
  });

  it("chave não-hex lança com mensagem clara", async () => {
    process.env.SECRETS_KEY = "zz".repeat(32);
    const { initSecrets } = await carregarModulo();
    expect(() => initSecrets()).toThrow(/SECRETS_KEY.*hex/i);
  });

  it("fail-fast sem SECRETS_KEY", async () => {
    delete process.env.SECRETS_KEY;
    const { initSecrets, encrypt } = await carregarModulo();
    expect(() => initSecrets()).toThrow(/SECRETS_KEY/);
    expect(() => encrypt("x")).toThrow(/SECRETS_KEY/);
  });

  it("ciphertext é decriptável por implementação de referência", async () => {
    const { encrypt } = await carregarModulo();
    const plain = "referencia";
    const payload = encrypt(plain);
    const chave = Buffer.from(CHAVE_VALIDA, "hex");
    const decipher = createDecipheriv("aes-256-gcm", chave, payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(payload.length - 16));
    const texto = Buffer.concat([
      decipher.update(payload.subarray(12, payload.length - 16)),
      decipher.final(),
    ]).toString("utf8");
    expect(texto).toBe(plain);
  });
});
