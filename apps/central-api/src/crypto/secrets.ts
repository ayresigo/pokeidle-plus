import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

let chaveCache: { hex: string; chave: Buffer } | null = null;

function carregarChave(): Buffer {
  const hex = process.env.SECRETS_KEY;
  if (!hex) {
    throw new Error("SECRETS_KEY não definida no ambiente");
  }
  if (chaveCache?.hex === hex) {
    return chaveCache.chave;
  }
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("SECRETS_KEY deve ser uma string hexadecimal válida");
  }
  const chave = Buffer.from(hex, "hex");
  if (chave.length !== KEY_BYTES) {
    throw new Error(
      `SECRETS_KEY deve ter 32 bytes (64 caracteres hex), recebeu ${chave.length} bytes`,
    );
  }
  chaveCache = { hex, chave };
  return chave;
}

export function initSecrets(): void {
  carregarChave();
}

export function encrypt(plain: string): Buffer<ArrayBuffer> {
  const chave = carregarChave();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", chave, nonce);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
}

export function decrypt(payload: Buffer): string {
  const chave = carregarChave();
  if (payload.length < NONCE_BYTES + TAG_BYTES) {
    throw new Error("Payload criptografado inválido: tamanho insuficiente");
  }
  const decipher = createDecipheriv("aes-256-gcm", chave, payload.subarray(0, NONCE_BYTES));
  decipher.setAuthTag(payload.subarray(payload.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(payload.subarray(NONCE_BYTES, payload.length - TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}
