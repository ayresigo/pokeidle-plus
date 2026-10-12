import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { SessionStore } from "../session/store.js";

function fabricarJwt(expSegundos: number): string {
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ exp: expSegundos })}.assinatura-falsa`;
}

const TOKEN = fabricarJwt(Math.floor(Date.now() / 1000) + 3600);

interface CasoRepasse {
  method: "GET" | "POST" | "PATCH";
  url: string;
  payload?: Record<string, unknown>;
}

const CASOS: CasoRepasse[] = [
  { method: "GET", url: "/admin/users" },
  { method: "POST", url: "/admin/users", payload: { username: "amigo", password: "senha-forte-123", role: "user" } },
  { method: "PATCH", url: "/admin/users/abc", payload: { active: false } },
];

describe("proxy de usuários", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessionStore: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "users-routes-test-"));
    const built = buildApp({ dataDir: dir, centralApiUrl: "http://central.test" });
    app = built.app;
    sessionStore = built.sessionStore;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  it.each(CASOS)("$method $url repassa Bearer, método, corpo e resposta", async (caso) => {
    sessionStore.definirAccess(TOKEN);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ repassado: true }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await app.inject({ method: caso.method, url: caso.url, payload: caso.payload });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toEqual({ repassado: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://central.test${caso.url}`);
    expect(init.method).toBe(caso.method);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    if (caso.payload) {
      expect(JSON.parse(init.body as string)).toEqual(caso.payload);
    } else {
      expect(init.body).toBeUndefined();
    }
  });

  it("codifica o id na URL do central", async () => {
    sessionStore.definirAccess(TOKEN);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await app.inject({ method: "PATCH", url: "/admin/users/a%2Fb", payload: { role: "admin" } });

    expect(fetchMock.mock.calls[0][0]).toBe("http://central.test/admin/users/a%2Fb");
  });

  it.each([
    [403, { error: "acesso restrito a administradores" }],
    [409, { error: "nome de usuário já está em uso" }],
    [400, { error: "você não pode desativar a si mesmo" }],
    [404, { error: "usuário não encontrado" }],
  ])("repassa status %i e corpo de erro do central", async (status, corpo) => {
    sessionStore.definirAccess(TOKEN);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } }),
      ),
    );

    const resposta = await app.inject({ method: "POST", url: "/admin/users", payload: { username: "x" } });

    expect(resposta.statusCode).toBe(status);
    expect(resposta.json()).toEqual(corpo);
  });

  it("responde 502 genérico quando o central devolve 5xx", async () => {
    sessionStore.definirAccess(TOKEN);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("stack trace interno", { status: 500 })));

    const resposta = await app.inject({ method: "GET", url: "/admin/users" });

    expect(resposta.statusCode).toBe(502);
    expect(resposta.json()).toEqual({ error: "falha ao contatar o central" });
  });

  it("responde 503 em grace sem chamar /admin/users no central", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "session.json"),
      JSON.stringify({ refreshToken: "refresh-abc", obtainedAt: new Date().toISOString() }),
    );
    await sessionStore.init();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await app.inject({ method: "GET", url: "/admin/users" });

    expect(resposta.statusCode).toBe(503);
    expect(fetchMock.mock.calls.map(([u]) => String(u))).not.toContain("http://central.test/admin/users");
  });

  it("responde 401 sem sessão", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await app.inject({ method: "GET", url: "/admin/users" });

    expect(resposta.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("não expõe DELETE /admin/users/:id", async () => {
    sessionStore.definirAccess(TOKEN);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await app.inject({ method: "DELETE", url: "/admin/users/abc" });

    expect(resposta.statusCode).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
