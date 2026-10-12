import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, login, type WorkerSnapshot } from "./api";

function resposta(status: number, corpo?: unknown): Response {
  const texto = corpo === undefined ? null : typeof corpo === "string" ? corpo : JSON.stringify(corpo);
  return new Response(texto, { status, headers: { "content-type": "application/json" } });
}

describe("apiFetch", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const replace = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { pathname: "/", replace } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    replace.mockReset();
  });

  it("retorna o corpo tipado em sucesso, prefixando /cp", async () => {
    const snapshot: WorkerSnapshot[] = [
      {
        id: "c1",
        accountId: "a1",
        state: "running",
        health: "healthy",
        startedAt: "2026-10-11T00:00:00.000Z",
        restartCount: 0,
        desired: "running",
        backoffAtual: 0,
        degraded: false,
        lastError: null,
        jogo: { state: "in-game", lastAction: "batalha", lastError: null },
      },
    ];
    fetchMock.mockResolvedValue(resposta(200, snapshot));

    const resultado = await apiFetch<WorkerSnapshot[]>("/workers/status");

    expect(resultado).toEqual(snapshot);
    expect(resultado[0].jogo?.state).toBe("in-game");
    expect(fetchMock).toHaveBeenCalledWith("/cp/workers/status", expect.objectContaining({ cache: "no-store" }));
  });

  it("envia JSON com content-type quando há corpo", async () => {
    fetchMock.mockResolvedValue(resposta(200, { authenticated: true }));

    await login("admin", "segredo");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/cp/auth/login");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ username: "admin", password: "segredo" }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("retorna undefined em 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiFetch<void>("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("redireciona para /login em 401 e lança ApiError", async () => {
    fetchMock.mockResolvedValue(resposta(401, { error: "sessão ausente" }));

    const erro = await apiFetch("/accounts").catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ApiError);
    expect(erro).toMatchObject({ status: 401, message: "sessão ausente" });
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("não redireciona em 401 quando redirectOn401 é false", async () => {
    fetchMock.mockResolvedValue(resposta(401, { error: "credenciais inválidas" }));

    await expect(login("admin", "errada")).rejects.toMatchObject({ status: 401 });
    expect(replace).not.toHaveBeenCalled();
  });

  it("não redireciona em 401 quando já está em /login", async () => {
    vi.stubGlobal("window", { location: { pathname: "/login", replace } });
    fetchMock.mockResolvedValue(resposta(401, { error: "x" }));

    await expect(apiFetch("/accounts")).rejects.toBeInstanceOf(ApiError);
    expect(replace).not.toHaveBeenCalled();
  });

  it("lê a mensagem de {error} do corpo", async () => {
    fetchMock.mockResolvedValue(resposta(503, { error: "central inalcançável" }));

    await expect(apiFetch("/accounts")).rejects.toMatchObject({
      name: "ApiError",
      status: 503,
      message: "central inalcançável",
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("usa o statusText quando o corpo não é JSON com error", async () => {
    fetchMock.mockResolvedValue(new Response("<html>falha</html>", { status: 502, statusText: "Bad Gateway" }));

    await expect(apiFetch("/accounts")).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });
  });

  it("usa mensagem genérica sem statusText nem corpo", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(apiFetch("/accounts")).rejects.toMatchObject({ status: 500, message: "erro 500" });
  });
});
