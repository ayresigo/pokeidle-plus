export const ACCESS_TOKEN_VALIDO = [
  { alg: "HS256", typ: "JWT" },
  { sub: "e2e-valido", exp: 4_102_444_800 },
]
  .map((parte) => Buffer.from(JSON.stringify(parte)).toString("base64url"))
  .concat("assinatura-falsa-e2e")
  .join(".");

export const REFRESH_TOKEN_E2E = "refresh-falso-e2e";
