import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import type { SessionStore } from "./store.js";

function fabricarJwt(expSegundos: number): string {
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ exp: expSegundos })}.assinatura-falsa`;
}

const EM_BREVE = Math.floor(Date.now() / 1000) + 3600;

function respostaJson(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("rotas de sessão", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessionStore: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "session-routes-test-"));
    const built = buildApp({ dataDir: dir, centralApiUrl: "http://central.test" });
    app = built.app;
    sessionStore = built.sessionStore;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  async function semearSessao() {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "session.json"),
      JSON.stringify({ refreshToken: "refresh-abc", obtainedAt: new Date().toISOString() }),
    );
    await sessionStore.init();
  }

  describe("POST /auth/login", () => {
    it("autentica e responde 200 com authenticated true", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        respostaJson(200, { accessToken: fabricarJwt(EM_BREVE), refreshToken: "r" }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const resposta = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { username: "admin", password: "senha" },
      });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({ authenticated: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://central.test/auth/login",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ username: "admin", password: "senha" }),
        }),
      );
      expect((await sessionStore.getAccessToken()).token).toBeTruthy();
    });

    it("responde 401 quando o central recusa as credenciais", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respostaJson(401, { error: "x" })));

      const resposta = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { username: "admin", password: "errada" },
      });

      expect(resposta.statusCode).toBe(401);
      expect(resposta.json()).toEqual({ error: "credenciais inválidas" });
    });

    it("responde 503 quando o central está inalcançável", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

      const resposta = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { username: "admin", password: "senha" },
      });

      expect(resposta.statusCode).toBe(503);
      expect(resposta.json()).toEqual({ error: "central inalcançável" });
    });

    it("responde 503 quando o central devolve 5xx", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respostaJson(500, { error: "x" })));

      const resposta = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { username: "admin", password: "senha" },
      });

      expect(resposta.statusCode).toBe(503);
      expect(resposta.json()).toEqual({ error: "central inalcançável" });
    });

    it("rejeita corpo inválido com 400 sem chamar o central", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const resposta = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { username: "admin", password: "x".repeat(1000) },
      });

      expect(resposta.statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("POST /auth/logout", () => {
    it("encerra a sessão e responde 204", async () => {
      await semearSessao();
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", fetchMock);

      const resposta = await app.inject({ method: "POST", url: "/auth/logout" });

      expect(resposta.statusCode).toBe(204);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://central.test/auth/logout",
        expect.objectContaining({ method: "POST" }),
      );
      expect(await sessionStore.getAccessToken()).toEqual({ token: null, offline: false });
    });

    it("responde 204 mesmo sem sessão", async () => {
      const resposta = await app.inject({ method: "POST", url: "/auth/logout" });
      expect(resposta.statusCode).toBe(204);
    });
  });

  describe("GET /auth/session", () => {
    function centralComPerfil(perfil: unknown = { id: "u1", username: "ash", role: "admin" }) {
      return vi.fn().mockImplementation(async (url: string) =>
        url === "http://central.test/auth/me" ? respostaJson(200, perfil) : respostaJson(500, {}),
      );
    }

    it("autenticado e online inclui username e role buscados no central", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      const fetchMock = centralComPerfil();
      vi.stubGlobal("fetch", fetchMock);
      const resposta = await app.inject({ method: "GET", url: "/auth/session" });
      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({ authenticated: true, offline: false, username: "ash", role: "admin" });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer /);
    });

    it("usa o perfil em cache sem consultar o central de novo", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      const fetchMock = centralComPerfil();
      vi.stubGlobal("fetch", fetchMock);
      await app.inject({ method: "GET", url: "/auth/session" });
      const resposta = await app.inject({ method: "GET", url: "/auth/session" });
      expect(resposta.json()).toMatchObject({ username: "ash", role: "admin" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("autenticado sem perfil quando /auth/me falha", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respostaJson(500, {})));
      const resposta = await app.inject({ method: "GET", url: "/auth/session" });
      expect(resposta.json()).toEqual({ authenticated: true, offline: false });
    });

    it("login busca o perfil e a sessão o expõe", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async (url: string) =>
          url === "http://central.test/auth/me"
            ? respostaJson(200, { id: "u2", username: "misty", role: "user" })
            : respostaJson(200, { accessToken: fabricarJwt(EM_BREVE), refreshToken: "r" }),
        ),
      );
      await app.inject({ method: "POST", url: "/auth/login", payload: { username: "misty", password: "senha" } });
      const resposta = await app.inject({ method: "GET", url: "/auth/session" });
      expect(resposta.json()).toEqual({ authenticated: true, offline: false, username: "misty", role: "user" });
    });

    it("autenticado e offline em grace com central inalcançável", async () => {
      await semearSessao();
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
      const resposta = await app.inject({ method: "GET", url: "/auth/session" });
      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({ authenticated: true, offline: true });
    });

    it("offline em grace usa o último perfil persistido", async () => {
      await writeFile(
        path.join(dir, "session.json"),
        JSON.stringify({
          refreshToken: "refresh-abc",
          obtainedAt: new Date().toISOString(),
          perfil: { username: "brock", role: "admin" },
        }),
      );
      await sessionStore.init();
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
      const resposta = await app.inject({ method: "GET", url: "/auth/session" });
      expect(resposta.json()).toEqual({ authenticated: true, offline: true, username: "brock", role: "admin" });
    });

    it("logout limpa o perfil", async () => {
      sessionStore.definirAccess(fabricarJwt(EM_BREVE));
      vi.stubGlobal("fetch", centralComPerfil());
      await app.inject({ method: "GET", url: "/auth/session" });
      await app.inject({ method: "POST", url: "/auth/logout" });
      expect(sessionStore.perfil).toBeNull();
      const resposta = await app.inject({ method: "GET", url: "/auth/session" });
      expect(resposta.json()).toEqual({ authenticated: false, offline: false });
    });

    it("não autenticado sem sessão", async () => {
      const resposta = await app.inject({ method: "GET", url: "/auth/session" });
      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({ authenticated: false, offline: false });
    });
  });
});
