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

const EM_BREVE = Math.floor(Date.now() / 1000) + 3600;

describe("requireSession", () => {
  let dir: string;
  let app: FastifyInstance;
  let sessionStore: SessionStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "guard-test-"));
    const built = buildApp({ dataDir: dir, centralApiUrl: "http://central.test" });
    app = built.app;
    sessionStore = built.sessionStore;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  async function semearSessaoEmGrace() {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "session.json"),
      JSON.stringify({ refreshToken: "refresh-abc", obtainedAt: new Date().toISOString() }),
    );
    await sessionStore.init();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("central fora do ar")),
    );
  }

  function registrarRotaProtegida(opts?: { precisaCentral?: boolean }) {
    const espiao = vi.fn(async () => ({ ok: true }));
    app.get("/protegida", { preHandler: app.requireSession(opts) }, espiao);
    return espiao;
  }

  it("retorna 401 sem sessão e não chama o handler", async () => {
    const espiao = registrarRotaProtegida();
    const resposta = await app.inject({ method: "GET", url: "/protegida" });
    expect(resposta.statusCode).toBe(401);
    expect(espiao).not.toHaveBeenCalled();
  });

  it("passa com sessão válida", async () => {
    sessionStore.definirAccess(fabricarJwt(EM_BREVE));
    const espiao = registrarRotaProtegida();
    const resposta = await app.inject({ method: "GET", url: "/protegida" });
    expect(resposta.statusCode).toBe(200);
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("passa em grace (offline: true) para rota default", async () => {
    await semearSessaoEmGrace();
    const espiao = registrarRotaProtegida();
    const resposta = await app.inject({ method: "GET", url: "/protegida" });
    expect(resposta.statusCode).toBe(200);
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("retorna 503 em grace para rota que precisa do central", async () => {
    await semearSessaoEmGrace();
    const espiao = registrarRotaProtegida({ precisaCentral: true });
    const resposta = await app.inject({ method: "GET", url: "/protegida" });
    expect(resposta.statusCode).toBe(503);
    expect(resposta.json()).toEqual({ error: "central inalcançável" });
    expect(espiao).not.toHaveBeenCalled();
  });

  it("mantém /health aberto sem sessão", async () => {
    const resposta = await app.inject({ method: "GET", url: "/health" });
    expect(resposta.statusCode).toBe(200);
  });
});
