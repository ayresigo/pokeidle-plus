import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { GET, POST } from "./route";

function contexto(...path: string[]): RouteContext<"/cp/[...path]"> {
  return { params: Promise.resolve({ path }) };
}

function requisicao(metodo: string, cabecalhos: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/cp/accounts", {
    method: metodo,
    headers: cabecalhos,
    body: metodo === "GET" || metodo === "HEAD" ? undefined : "{}",
  });
}

describe("proxy /cp", () => {
  let upstream: Mock<typeof fetch>;

  beforeEach(() => {
    vi.stubEnv("CONTROL_PLANE_URL", "http://control-plane:4000");
    vi.stubEnv("ALLOWED_HOSTS", "");
    upstream = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", upstream);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "localhost:8080"])(
    "encaminha GET com Host local %s",
    async (host) => {
      const resposta = await GET(requisicao("GET", { host }), contexto("accounts"));

      expect(resposta.status).toBe(200);
      expect(upstream).toHaveBeenCalledOnce();
      expect(String(upstream.mock.calls[0][0])).toBe("http://control-plane:4000/accounts");
    },
  );

  it.each(["evil.example:3000", "localhost.evil.example:3000", "192.168.0.10:3000"])(
    "recusa com 403 Host não local %s (DNS rebinding)",
    async (host) => {
      const resposta = await GET(requisicao("GET", { host }), contexto("accounts"));

      expect(resposta.status).toBe(403);
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it("recusa requisição sem Host", async () => {
    const resposta = await GET(requisicao("GET", {}), contexto("accounts"));

    expect(resposta.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("ALLOWED_HOSTS libera outros nomes, com ou sem porta", async () => {
    vi.stubEnv("ALLOWED_HOSTS", "meupc.lan, painel.local:3000");

    const porNome = await GET(requisicao("GET", { host: "meupc.lan:3000" }), contexto("accounts"));
    const comPorta = await GET(requisicao("GET", { host: "painel.local:3000" }), contexto("accounts"));
    const portaErrada = await GET(requisicao("GET", { host: "painel.local:9999" }), contexto("accounts"));

    expect(porNome.status).toBe(200);
    expect(comPorta.status).toBe(200);
    expect(portaErrada.status).toBe(403);
  });

  it("POST com Origin do próprio host é encaminhado", async () => {
    const resposta = await POST(
      requisicao("POST", { host: "localhost:3000", origin: "http://localhost:3000" }),
      contexto("accounts"),
    );

    expect(resposta.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("POST sem Origin é encaminhado", async () => {
    const resposta = await POST(requisicao("POST", { host: "localhost:3000" }), contexto("accounts"));

    expect(resposta.status).toBe(200);
  });

  it.each(["http://evil.example", "http://localhost:4000", "null"])(
    "POST com Origin %s diferente do host é recusado com 403",
    async (origin) => {
      const resposta = await POST(
        requisicao("POST", { host: "localhost:3000", origin }),
        contexto("accounts"),
      );

      expect(resposta.status).toBe(403);
      expect(upstream).not.toHaveBeenCalled();
    },
  );

  it("GET com Origin de outro site continua permitido", async () => {
    const resposta = await GET(
      requisicao("GET", { host: "localhost:3000", origin: "http://evil.example" }),
      contexto("accounts"),
    );

    expect(resposta.status).toBe(200);
  });
});
