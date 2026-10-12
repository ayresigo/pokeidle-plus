import { mkdtemp, readFile, writeFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErroCentralInalcancavel, ErroCredenciaisInvalidas, SessionStore } from "./store.js";

function fabricarJwt(expSegundos: number): string {
  const b64url = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ exp: expSegundos })}.assinatura-falsa`;
}

function respostaJson(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CENTRAL = "http://central.test";

const AGORA = Date.now();
const EM_BREVE = Math.floor(AGORA / 1000) + 3600;
const EXPIRADO = Math.floor(AGORA / 1000) - 3600;

describe("SessionStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "session-test-"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function semearSessao(obtainedAt: Date, refreshToken = "refresh-abc") {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "session.json"),
      JSON.stringify({ refreshToken, obtainedAt: obtainedAt.toISOString() }),
    );
  }

  it("login persiste session.json em disco e retorna access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respostaJson(200, { accessToken: fabricarJwt(EM_BREVE), refreshToken: "refresh-novo" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new SessionStore(dir, CENTRAL);
    await store.login("admin", "senha");

    expect(fetchMock).toHaveBeenCalledWith(`${CENTRAL}/auth/login`, expect.objectContaining({ method: "POST" }));
    const salvo = JSON.parse(await readFile(path.join(dir, "session.json"), "utf8"));
    expect(salvo.refreshToken).toBe("refresh-novo");
    expect(salvo.obtainedAt).toBeDefined();

    const resultado = await store.getAccessToken();
    expect(resultado.offline).toBe(false);
    expect(resultado.token).toBeTruthy();
  });

  it("login com 401 do central lança ErroCredenciaisInvalidas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respostaJson(401, { error: "x" })));
    const store = new SessionStore(dir, CENTRAL);
    await expect(store.login("admin", "errada")).rejects.toBeInstanceOf(ErroCredenciaisInvalidas);
  });

  it("login com 5xx do central lança ErroCentralInalcancavel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respostaJson(502, { error: "x" })));
    const store = new SessionStore(dir, CENTRAL);
    await expect(store.login("admin", "senha")).rejects.toBeInstanceOf(ErroCentralInalcancavel);
  });

  it("login com falha de rede lança ErroCentralInalcancavel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const store = new SessionStore(dir, CENTRAL);
    await expect(store.login("admin", "senha")).rejects.toBeInstanceOf(ErroCentralInalcancavel);
  });

  it("renova com access expirado via refresh no central", async () => {
    await semearSessao(new Date(AGORA));
    const novoAccess = fabricarJwt(EM_BREVE);
    const fetchMock = vi.fn().mockResolvedValue(
      respostaJson(200, { accessToken: novoAccess, refreshToken: "refresh-rotacionado" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const store = new SessionStore(dir, CENTRAL);
    await store.init();
    store.definirAccess(fabricarJwt(EXPIRADO));

    const resultado = await store.getAccessToken();
    expect(resultado).toEqual({ token: novoAccess, offline: false });
    expect(fetchMock).toHaveBeenCalledWith(
      `${CENTRAL}/auth/refresh`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ refreshToken: "refresh-abc" }) }),
    );
    const salvo = JSON.parse(await readFile(path.join(dir, "session.json"), "utf8"));
    expect(salvo.refreshToken).toBe("refresh-rotacionado");
  });

  it("modo grace quando central cai (erro de rede) com refresh válido há <7d", async () => {
    await semearSessao(new Date(AGORA - 24 * 3600 * 1000));
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const store = new SessionStore(dir, CENTRAL);
    await store.init();
    store.definirAccess(fabricarJwt(EXPIRADO));

    const resultado = await store.getAccessToken();
    expect(resultado).toEqual({ token: null, offline: true });
  });

  it("modo grace quando central responde 5xx", async () => {
    await semearSessao(new Date(AGORA - 24 * 3600 * 1000));
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(502, { error: "bad gateway" }));
    vi.stubGlobal("fetch", fetchMock);

    const store = new SessionStore(dir, CENTRAL);
    await store.init();
    store.definirAccess(fabricarJwt(EXPIRADO));

    expect(await store.getAccessToken()).toEqual({ token: null, offline: true });
  });

  it("grace expirada (obtainedAt >7d) retorna offline:false", async () => {
    await semearSessao(new Date(AGORA - 8 * 24 * 3600 * 1000));
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const store = new SessionStore(dir, CENTRAL);
    await store.init();
    store.definirAccess(fabricarJwt(EXPIRADO));

    expect(await store.getAccessToken()).toEqual({ token: null, offline: false });
  });

  it("401 do central em refresh retorna offline:false e limpa sessão", async () => {
    await semearSessao(new Date(AGORA));
    const fetchMock = vi.fn().mockResolvedValue(respostaJson(401, { error: "credenciais inválidas" }));
    vi.stubGlobal("fetch", fetchMock);

    const store = new SessionStore(dir, CENTRAL);
    await store.init();
    store.definirAccess(fabricarJwt(EXPIRADO));

    expect(await store.getAccessToken()).toEqual({ token: null, offline: false });
    await expect(access(path.join(dir, "session.json"))).rejects.toThrow();
    expect(await store.getAccessToken()).toEqual({ token: null, offline: false });
  });

  it("logout chama central (best-effort), apaga session.json e limpa memória", async () => {
    await semearSessao(new Date(AGORA));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const store = new SessionStore(dir, CENTRAL);
    await store.init();
    store.definirAccess(fabricarJwt(EM_BREVE));

    await store.logout();

    expect(fetchMock).toHaveBeenCalledWith(
      `${CENTRAL}/auth/logout`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ refreshToken: "refresh-abc" }) }),
    );
    await expect(access(path.join(dir, "session.json"))).rejects.toThrow();
    expect(await store.getAccessToken()).toEqual({ token: null, offline: false });
  });

  it("logout tolera central inalcançável", async () => {
    await semearSessao(new Date(AGORA));
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const store = new SessionStore(dir, CENTRAL);
    await store.init();

    await expect(store.logout()).resolves.toBeUndefined();
    await expect(access(path.join(dir, "session.json"))).rejects.toThrow();
  });

  it("chamadas concorrentes de getAccessToken fazem um único refresh (single-flight)", async () => {
    await semearSessao(new Date(AGORA));
    const novoAccess = fabricarJwt(EM_BREVE);
    const pendente = Promise.withResolvers<Response>();
    const fetchMock = vi.fn().mockReturnValue(pendente.promise);
    vi.stubGlobal("fetch", fetchMock);

    const store = new SessionStore(dir, CENTRAL);
    await store.init();
    store.definirAccess(fabricarJwt(EXPIRADO));

    const p1 = store.getAccessToken();
    const p2 = store.getAccessToken();
    pendente.resolve(respostaJson(200, { accessToken: novoAccess, refreshToken: "refresh-rot" }));

    expect(await p1).toEqual({ token: novoAccess, offline: false });
    expect(await p2).toEqual({ token: novoAccess, offline: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("session.json corrompido não derruba init e segue como sessão inexistente", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "session.json"), "lixo{{{nao-json");

    const store = new SessionStore(dir, CENTRAL);
    await expect(store.init()).resolves.toBeUndefined();
    expect(await store.getAccessToken()).toEqual({ token: null, offline: false });
  });

  it("boot sem session.json retorna token null offline:false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const store = new SessionStore(dir, CENTRAL);
    await store.init();

    expect(await store.getAccessToken()).toEqual({ token: null, offline: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("perfil", () => {
    function centralComTokensEPerfil(statusMe = 200) {
      return vi.fn().mockImplementation(async (url: string) => {
        if (url === `${CENTRAL}/auth/me`) return respostaJson(statusMe, { id: "u1", username: "ash", role: "admin" });
        return respostaJson(200, { accessToken: fabricarJwt(EM_BREVE), refreshToken: "refresh-novo" });
      });
    }

    it("login busca /auth/me e persiste o perfil junto ao session.json", async () => {
      const fetchMock = centralComTokensEPerfil();
      vi.stubGlobal("fetch", fetchMock);

      const store = new SessionStore(dir, CENTRAL);
      await store.login("ash", "senha");

      expect(store.perfil).toEqual({ username: "ash", role: "admin" });
      const chamadaMe = fetchMock.mock.calls.find(([u]) => u === `${CENTRAL}/auth/me`) as [string, RequestInit];
      expect((chamadaMe[1].headers as Record<string, string>).authorization).toMatch(/^Bearer /);
      const salvo = JSON.parse(await readFile(path.join(dir, "session.json"), "utf8"));
      expect(salvo.perfil).toEqual({ username: "ash", role: "admin" });
    });

    it("login segue válido sem perfil quando /auth/me falha", async () => {
      vi.stubGlobal("fetch", centralComTokensEPerfil(500));

      const store = new SessionStore(dir, CENTRAL);
      await store.login("ash", "senha");

      expect(store.perfil).toBeNull();
      expect((await store.getAccessToken()).token).toBeTruthy();
      const salvo = JSON.parse(await readFile(path.join(dir, "session.json"), "utf8"));
      expect(salvo.perfil).toBeUndefined();
    });

    it("init restaura o perfil persistido e o mantém em grace", async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "session.json"),
        JSON.stringify({
          refreshToken: "refresh-abc",
          obtainedAt: new Date(AGORA).toISOString(),
          perfil: { username: "ash", role: "user" },
        }),
      );
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

      const store = new SessionStore(dir, CENTRAL);
      await store.init();
      await store.atualizarPerfil();

      expect(await store.getAccessToken()).toEqual({ token: null, offline: true });
      expect(store.perfil).toEqual({ username: "ash", role: "user" });
    });

    it("perfil persistido inválido é ignorado", async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "session.json"),
        JSON.stringify({ refreshToken: "r", obtainedAt: new Date(AGORA).toISOString(), perfil: { username: 1 } }),
      );

      const store = new SessionStore(dir, CENTRAL);
      await store.init();

      expect(store.perfil).toBeNull();
    });

    it("atualizarPerfil no boot renova o access e grava o perfil atual", async () => {
      await semearSessao(new Date(AGORA));
      vi.stubGlobal("fetch", centralComTokensEPerfil());

      const store = new SessionStore(dir, CENTRAL);
      await store.init();
      await store.atualizarPerfil();

      expect(store.perfil).toEqual({ username: "ash", role: "admin" });
      const salvo = JSON.parse(await readFile(path.join(dir, "session.json"), "utf8"));
      expect(salvo).toMatchObject({ refreshToken: "refresh-novo", perfil: { username: "ash", role: "admin" } });
    });

    it("logout limpa o perfil", async () => {
      vi.stubGlobal("fetch", centralComTokensEPerfil());
      const store = new SessionStore(dir, CENTRAL);
      await store.login("ash", "senha");

      await store.logout();

      expect(store.perfil).toBeNull();
    });
  });
});
