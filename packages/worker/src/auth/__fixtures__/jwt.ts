export function criarJwt(expSegundos: number, sub = "conta"): string {
  const [cabecalho, payload] = [{ alg: "HS256", typ: "JWT" }, { sub, exp: expSegundos }].map(
    (parte) => Buffer.from(JSON.stringify(parte)).toString("base64url"),
  );
  return `${cabecalho}.${payload}.assinatura`;
}

export function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}
