export function lerExpiracao(token: string): number | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(partes[1] ?? "", "base64url").toString("utf8"));
    const exp =
      typeof payload === "object" && payload !== null && "exp" in payload ? payload.exp : null;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}
